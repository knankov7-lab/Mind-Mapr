const os = require('os');

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function normalizePath(inputPath) {
  const raw = String(inputPath || '/');
  return raw
    .replace(/[0-9a-f]{8,}/gi, ':id')
    .replace(/\b\d+\b/g, ':id')
    .replace(/\/+/g, '/');
}

function toRoundedMs(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function createServerPerformanceMonitor(options = {}) {
  const maxLatencySamples = clampNumber(options.maxLatencySamples || 3000, 300, 20000);
  const maxRecentSamples = clampNumber(options.maxRecentSamples || 4000, 600, 50000);
  const maxEndpoints = clampNumber(options.maxEndpoints || 250, 30, 2000);
  const recentWindowMs = clampNumber(options.recentWindowMs || 60000, 5000, 300000);

  const startedAt = Date.now();
  const endpointStats = new Map();
  const latencyMsSamples = [];
  const recentRequests = [];

  let inFlight = 0;
  let totalRequests = 0;
  let totalErrors = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;

  function addSample(array, item, cap) {
    array.push(item);
    if (array.length > cap) {
      array.splice(0, array.length - cap);
    }
  }

  function sweepRecent(nowTs) {
    while (recentRequests.length > 0 && nowTs - recentRequests[0].ts > recentWindowMs) {
      recentRequests.shift();
    }
  }

  function middleware(req, res, next) {
    const started = process.hrtime.bigint();
    const rawPath = String(req.originalUrl || req.url || '/').split('?')[0] || '/';
    const endpointKey = `${String(req.method || 'GET').toUpperCase()} ${normalizePath(rawPath)}`;

    totalRequests += 1;
    inFlight += 1;

    res.on('finish', () => {
      const ended = process.hrtime.bigint();
      inFlight = Math.max(0, inFlight - 1);

      const latencyMs = Number(ended - started) / 1e6;
      const status = Number(res.statusCode || 0);
      const nowTs = Date.now();
      const isError = status >= 500;

      totalLatencyMs += latencyMs;
      if (latencyMs > maxLatencyMs) maxLatencyMs = latencyMs;
      if (isError) totalErrors += 1;

      addSample(latencyMsSamples, latencyMs, maxLatencySamples);
      addSample(recentRequests, { ts: nowTs, latencyMs, status, endpointKey }, maxRecentSamples);
      sweepRecent(nowTs);

      const current = endpointStats.get(endpointKey) || {
        key: endpointKey,
        count: 0,
        errorCount: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
        lastStatus: 0,
        lastSeenAt: 0,
      };
      current.count += 1;
      current.totalLatencyMs += latencyMs;
      if (isError) current.errorCount += 1;
      if (latencyMs > current.maxLatencyMs) current.maxLatencyMs = latencyMs;
      current.lastStatus = status;
      current.lastSeenAt = nowTs;
      endpointStats.set(endpointKey, current);

      if (endpointStats.size > maxEndpoints) {
        const oldestKey = endpointStats.entries().next().value?.[0];
        if (oldestKey) endpointStats.delete(oldestKey);
      }
    });

    next();
  }

  function getSnapshot() {
    const nowTs = Date.now();
    sweepRecent(nowTs);

    const requestCount = Math.max(1, totalRequests);
    const avgLatencyMs = totalLatencyMs / requestCount;

    const statusBuckets = {
      informational1xx: 0,
      success2xx: 0,
      redirect3xx: 0,
      client4xx: 0,
      server5xx: 0,
    };

    for (const item of recentRequests) {
      if (item.status >= 500) statusBuckets.server5xx += 1;
      else if (item.status >= 400) statusBuckets.client4xx += 1;
      else if (item.status >= 300) statusBuckets.redirect3xx += 1;
      else if (item.status >= 200) statusBuckets.success2xx += 1;
      else if (item.status >= 100) statusBuckets.informational1xx += 1;
    }

    const endpointRows = Array.from(endpointStats.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((row) => ({
        endpoint: row.key,
        requests: row.count,
        errors5xx: row.errorCount,
        errorRatePct: toRoundedMs((row.errorCount / Math.max(1, row.count)) * 100),
        avgLatencyMs: toRoundedMs(row.totalLatencyMs / Math.max(1, row.count)),
        maxLatencyMs: toRoundedMs(row.maxLatencyMs),
        lastStatus: row.lastStatus,
        lastSeenAt: row.lastSeenAt,
      }));

    const recentLatencies = recentRequests.map((x) => x.latencyMs);

    return {
      generatedAt: nowTs,
      monitor: {
        startedAt,
        uptimeSec: Math.max(0, Math.round((nowTs - startedAt) / 1000)),
        windowSec: Math.round(recentWindowMs / 1000),
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        memoryRssMb: toRoundedMs(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: toRoundedMs(process.memoryUsage().heapUsed / (1024 * 1024)),
        heapTotalMb: toRoundedMs(process.memoryUsage().heapTotal / (1024 * 1024)),
        cpuLoad1m: toRoundedMs((os.loadavg() || [0])[0] || 0),
        cpuLoad5m: toRoundedMs((os.loadavg() || [0, 0])[1] || 0),
        cpuLoad15m: toRoundedMs((os.loadavg() || [0, 0, 0])[2] || 0),
      },
      requests: {
        total: totalRequests,
        inFlight,
        total5xxErrors: totalErrors,
        errorRatePct: toRoundedMs((totalErrors / Math.max(1, totalRequests)) * 100),
        avgLatencyMs: toRoundedMs(avgLatencyMs),
        maxLatencyMs: toRoundedMs(maxLatencyMs),
        p50LatencyMs: toRoundedMs(percentile(latencyMsSamples, 50)),
        p95LatencyMs: toRoundedMs(percentile(latencyMsSamples, 95)),
        p99LatencyMs: toRoundedMs(percentile(latencyMsSamples, 99)),
        recentWindowRequests: recentRequests.length,
        recentWindowRps: toRoundedMs(recentRequests.length / Math.max(1, recentWindowMs / 1000)),
        recentWindowAvgLatencyMs: toRoundedMs(
          recentLatencies.reduce((acc, val) => acc + val, 0) / Math.max(1, recentLatencies.length)
        ),
        recentWindowP95LatencyMs: toRoundedMs(percentile(recentLatencies, 95)),
      },
      recentStatusBuckets: statusBuckets,
      topEndpoints: endpointRows,
    };
  }

  return {
    middleware,
    getSnapshot,
  };
}

module.exports = {
  createServerPerformanceMonitor,
};
