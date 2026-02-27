const express = require('express');
const router = express.Router();
const {
  run,
  get,
  all,
  exec,
  listAiExamples,
  insertAiExample,
  deleteAiExampleById,
  insertLog,
  listLogs,
} = require('./db');

let adminSchemaReady = false;
async function ensureAdminSchema() {
  if (adminSchemaReady) return;
  try {
    await run("ALTER TABLE rooms ADD COLUMN public INTEGER DEFAULT 0");
  } catch (e) {
    // ignore if column already exists
  }
  await exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  adminSchemaReady = true;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureAdminSchema();
    next();
  } catch (e) {
    next(e);
  }
});

// List users
router.get('/users', async (req, res) => {
  try {
    const rows = await all('SELECT id, email, username, role, created_at FROM users ORDER BY id DESC');
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to list users' }); }
});

// List rooms
router.get('/rooms', async (req, res) => {
  try {
    const rows = await all('SELECT id, room_id, name, created_by, created_at, public FROM rooms ORDER BY created_at DESC');
    res.json({ rooms: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to list rooms' }); }
});

// List all saves (admin only)
router.get('/saves', async (_req, res) => {
  try {
    const rows = await all(`
      SELECT
        s.id,
        s.room_id,
        s.created_at,
        s.saved_by,
        u.email AS saved_by_email,
        u.username AS saved_by_username
      FROM saves s
      LEFT JOIN users u ON u.id = s.saved_by
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 500
    `);
    res.json({ saves: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list saves' });
  }
});

// Approve room (mark public)
router.post('/rooms/:room/approve', async (req, res) => {
  const room = req.params.room;
  try {
    await run('UPDATE rooms SET public = 1 WHERE room_id = ?', [room]);
    try {
      await insertLog(req.user?.id ?? null, 'admin_room_approve', { room }, req.ip);
    } catch {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to approve room' }); }
});

// Delete room and its saves
router.delete('/rooms/:room', async (req, res) => {
  const room = req.params.room;
  try {
    await run('DELETE FROM saves WHERE room_id = ?', [room]);
    await run('DELETE FROM rooms WHERE room_id = ?', [room]);
    try {
      await insertLog(req.user?.id ?? null, 'admin_room_delete', { room }, req.ip);
    } catch {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete room' }); }
});

// Logs (admin only)
router.get('/logs', async (req, res) => {
  try {
    const limit = req.query.limit;
    const userId = req.query.userId;
    const action = req.query.action;
    const rows = await listLogs({
      limit,
      userId: userId != null && String(userId).trim() ? Number(userId) : null,
      action: action != null && String(action).trim() ? String(action).trim() : null,
    });
    res.json({ logs: rows });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to list logs' });
  }
});

// Stats: active users (count), popular maps, keywords
router.get('/stats', async (req, res) => {
  try {
    const usersCountRow = await get('SELECT COUNT(1) as cnt FROM users');
    const usersCount = usersCountRow?.cnt || 0;

    const popular = await all(`
      SELECT room_id, COUNT(*) as saves FROM saves GROUP BY room_id ORDER BY saves DESC LIMIT 10
    `);

    // keywords from latest saves
    const saves = await all('SELECT nodes FROM saves ORDER BY created_at DESC LIMIT 200');
    const counts = {};
    saves.forEach(s => {
      try {
        const nodes = JSON.parse(s.nodes || '[]');
        nodes.forEach(n => {
          const text = (n.data?.label || '').toString().toLowerCase();
          text.split(/[^\p{L}0-9]+/u).forEach(w => { if (!w) return; counts[w] = (counts[w]||0)+1; });
        });
      } catch (e) {}
    });
    const keywords = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,v])=>({ keyword:k, count:v }));

    res.json({ activeUsers: usersCount, popularMaps: popular, keywords });
  } catch (e) { res.status(500).json({ error: 'Failed to compute stats' }); }
});

// Settings endpoints
router.get('/settings', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => obj[r.key] = JSON.parse(r.value));
    res.json(obj);
  } catch (e) { res.status(500).json({ error: 'Failed to load settings' }); }
});

router.put('/settings', async (req, res) => {
  try {
    const entries = req.body || {};
    const keys = Object.keys(entries);
    for (const k of keys) {
      await run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(entries[k])]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to save settings' }); }
});

// AI "training" examples (few-shot)
router.get('/ai/examples', async (req, res) => {
  try {
    const intent = (req.query.intent || '').toString().trim();
    if (!intent) return res.status(400).json({ error: 'intent required' });
    const limit = req.query.limit;
    const rows = await listAiExamples(intent, limit);
    res.json({ intent, examples: rows });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to list ai examples' });
  }
});

router.post('/ai/examples', async (req, res) => {
  try {
    const { intent, input, output, tags } = req.body || {};
    const safeIntent = (intent || '').toString().trim();
    const safeOutput = (output || '').toString();
    if (!safeIntent) return res.status(400).json({ error: 'intent required' });
    if (!safeOutput.trim()) return res.status(400).json({ error: 'output required' });
    await insertAiExample(safeIntent, input ?? null, safeOutput, tags ?? null);
    res.json({ ok: true });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to create ai example' });
  }
});

router.delete('/ai/examples/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const r = await deleteAiExampleById(id);
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to delete ai example' });
  }
});

module.exports = router;
