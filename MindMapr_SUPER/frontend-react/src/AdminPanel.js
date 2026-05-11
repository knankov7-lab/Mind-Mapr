import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from './api';
import { useAuth } from './AuthContext';

function useWindowWidth() {
  const [width, setWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export default function AdminPanel({ onClose }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 768;
  const { user, can: authCan } = useAuth();
  const [users, setUsers] = useState([]);
  const [userRoleDrafts, setUserRoleDrafts] = useState({});
  const [userRoleBusy, setUserRoleBusy] = useState({});
  const [rooms, setRooms] = useState([]);
  const [saves, setSaves] = useState([]);
  const [stats, setStats] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [performanceMethodFilter, setPerformanceMethodFilter] = useState('ALL');
  const [performanceEndpointFilter, setPerformanceEndpointFilter] = useState('');
  const [performanceRefreshMs, setPerformanceRefreshMs] = useState(10000);
  const [performanceHistory, setPerformanceHistory] = useState([]);
  const [performanceTrendMetric, setPerformanceTrendMetric] = useState('rps');
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('users');

  const can = useCallback((permission) => authCan(permission), [authCan]);

  const roleAuditLogs = useMemo(() => {
    const rows = Array.isArray(logs) ? logs : [];
    return rows
      .filter((row) => {
        const action = String(row?.action || '').toLowerCase();
        return action === 'admin_user_set_role' || action === 'team_set_role';
      })
      .map((row) => {
        let details = null;
        try {
          details = row?.details ? JSON.parse(String(row.details)) : null;
        } catch {
          details = null;
        }
        return {
          ...row,
          parsedDetails: details,
        };
      });
  }, [logs]);

  const roleOptions = useMemo(() => [
    { value: 'user', label: 'user' },
    { value: 'admin', label: 'admin' },
  ], []);

  const roleLabel = useCallback((roleValue) => {
    const role = String(roleValue || 'user').toLowerCase();
    return role;
  }, []);

  const roleBadgeStyle = useCallback((roleValue) => {
    const role = String(roleValue || 'user').toLowerCase();
    if (role === 'admin') {
      return {
        background: 'rgba(139, 102, 255, .18)',
        border: '1px solid rgba(139, 102, 255, .45)',
        color: '#ece3ff',
      };
    }
    return {
      background: 'rgba(38, 209, 167, .14)',
      border: '1px solid rgba(38, 209, 167, .35)',
      color: '#d9fff6',
    };
  }, []);

  const formatMs = useCallback((value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `${num.toFixed(2)} ms`;
  }, []);

  const formatNumber = useCallback((value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return new Intl.NumberFormat('bg-BG').format(num);
  }, []);

  const formatPct = useCallback((value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.00%';
    return `${num.toFixed(2)}%`;
  }, []);

  const getLatencySeverity = useCallback((value) => {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return { level: 'ok', label: 'OK', style: { color: '#d7ffe9', background: 'rgba(45, 212, 191, .18)', border: '1px solid rgba(45, 212, 191, .35)' } };
    if (ms >= 800) {
      return { level: 'high', label: 'Висок риск', style: { color: '#ffe2e2', background: 'rgba(248, 113, 113, .2)', border: '1px solid rgba(248, 113, 113, .45)' } };
    }
    if (ms >= 300) {
      return { level: 'medium', label: 'Внимание', style: { color: '#fff2cc', background: 'rgba(251, 191, 36, .18)', border: '1px solid rgba(251, 191, 36, .45)' } };
    }
    return { level: 'ok', label: 'OK', style: { color: '#d7ffe9', background: 'rgba(45, 212, 191, .18)', border: '1px solid rgba(45, 212, 191, .35)' } };
  }, []);

  const getErrorSeverity = useCallback((value) => {
    const pct = Number(value);
    if (!Number.isFinite(pct)) return { level: 'ok', label: 'OK', style: { color: '#d7ffe9', background: 'rgba(45, 212, 191, .18)', border: '1px solid rgba(45, 212, 191, .35)' } };
    if (pct >= 3) {
      return { level: 'high', label: 'Критично', style: { color: '#ffe2e2', background: 'rgba(248, 113, 113, .2)', border: '1px solid rgba(248, 113, 113, .45)' } };
    }
    if (pct >= 1) {
      return { level: 'medium', label: 'Внимание', style: { color: '#fff2cc', background: 'rgba(251, 191, 36, .18)', border: '1px solid rgba(251, 191, 36, .45)' } };
    }
    return { level: 'ok', label: 'OK', style: { color: '#d7ffe9', background: 'rgba(45, 212, 191, .18)', border: '1px solid rgba(45, 212, 191, .35)' } };
  }, []);

  const performanceMethods = useMemo(() => {
    const source = Array.isArray(performance?.topEndpoints) ? performance.topEndpoints : [];
    const methods = new Set(['ALL']);
    source.forEach((row) => {
      const endpoint = String(row?.endpoint || '').trim();
      const method = endpoint.split(' ')[0];
      if (method) methods.add(method.toUpperCase());
    });
    return Array.from(methods);
  }, [performance]);

  const filteredTopEndpoints = useMemo(() => {
    const source = Array.isArray(performance?.topEndpoints) ? performance.topEndpoints : [];
    const needle = String(performanceEndpointFilter || '').trim().toLowerCase();
    return source.filter((row) => {
      const endpoint = String(row?.endpoint || '').trim();
      const method = endpoint.split(' ')[0]?.toUpperCase() || '';
      const methodOk = performanceMethodFilter === 'ALL' || method === performanceMethodFilter;
      const textOk = !needle || endpoint.toLowerCase().includes(needle);
      return methodOk && textOk;
    });
  }, [performance, performanceMethodFilter, performanceEndpointFilter]);

  const statusChartRows = useMemo(() => {
    const buckets = performance?.recentStatusBuckets || {};
    const rows = [
      { key: 'success2xx', label: '2xx', color: '#2dd4bf', value: Number(buckets.success2xx || 0) },
      { key: 'redirect3xx', label: '3xx', color: '#60a5fa', value: Number(buckets.redirect3xx || 0) },
      { key: 'client4xx', label: '4xx', color: '#fbbf24', value: Number(buckets.client4xx || 0) },
      { key: 'server5xx', label: '5xx', color: '#f87171', value: Number(buckets.server5xx || 0) },
      { key: 'informational1xx', label: '1xx', color: '#c084fc', value: Number(buckets.informational1xx || 0) },
    ];
    const total = rows.reduce((acc, row) => acc + row.value, 0);
    return rows.map((row) => ({
      ...row,
      pct: total > 0 ? (row.value / total) * 100 : 0,
      total,
    }));
  }, [performance]);

  const statusBucketLabels = useMemo(() => ({
    informational1xx: '1xx Информационни',
    success2xx: '2xx Успешни',
    redirect3xx: '3xx Пренасочвания',
    client4xx: '4xx Клиентски грешки',
    server5xx: '5xx Сървърни грешки',
  }), []);

  const trendMetricConfig = useMemo(() => ({
    rps: { label: 'RPS', color: '#60a5fa' },
    p95: { label: 'P95 (ms)', color: '#f59e0b' },
    err: { label: 'Error %', color: '#f87171' },
  }), []);

  const trendSeries = useMemo(() => {
    const points = Array.isArray(performanceHistory) ? performanceHistory : [];
    const values = points.map((point) => {
      if (performanceTrendMetric === 'p95') return Number(point.p95 || 0);
      if (performanceTrendMetric === 'err') return Number(point.errorRate || 0);
      return Number(point.rps || 0);
    });
    const maxValue = Math.max(1, ...values);
    const minValue = Math.min(...values, 0);
    const range = Math.max(1e-9, maxValue - minValue);
    const chartWidth = 100;
    const chartHeight = 36;
    const pointsPath = values
      .map((val, idx) => {
        const x = values.length <= 1 ? 0 : (idx / (values.length - 1)) * chartWidth;
        const normalized = (val - minValue) / range;
        const y = chartHeight - normalized * chartHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    const latest = values.length ? values[values.length - 1] : 0;
    const avg = values.length ? values.reduce((acc, v) => acc + v, 0) / values.length : 0;
    return {
      values,
      pointsPath,
      latest,
      avg,
      maxValue,
      minValue,
      samples: values.length,
    };
  }, [performanceHistory, performanceTrendMetric]);

  const topEndpointShares = useMemo(() => {
    const rows = filteredTopEndpoints.slice(0, 8);
    const totalRequests = rows.reduce((acc, row) => acc + Number(row.requests || 0), 0);
    return rows.map((row) => ({
      ...row,
      sharePct: totalRequests > 0 ? (Number(row.requests || 0) / totalRequests) * 100 : 0,
    }));
  }, [filteredTopEndpoints]);


  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user, can]);

  useEffect(() => {
    if (!user || tab !== 'performance' || !can('stats.read') || performanceRefreshMs <= 0) return undefined;
    const timer = setInterval(() => {
      fetchPerformance();
    }, performanceRefreshMs);
    return () => clearInterval(timer);
  }, [tab, user, can, performanceRefreshMs]);

  // AI training UI removed

  async function fetchAll() {
    try {
      if (can('users.read')) {
        const u = await api.get('/admin/users');
        const userRows = u.data.users || u.data || [];
        setUsers(userRows);
        setUserRoleDrafts((prev) => {
          const next = { ...prev };
          for (const row of userRows) {
            const id = Number(row?.id);
            if (!Number.isFinite(id)) continue;
            next[id] = String(row?.role || 'user').toLowerCase();
          }
          return next;
        });
      }
      if (can('rooms.read')) {
        const r = await api.get('/admin/rooms');
        setRooms(r.data.rooms || r.data || []);
      }
      if (can('stats.read')) {
        const s = await api.get('/admin/stats');
        setStats(s.data || null);
        await fetchPerformance();
      }
      if (can('settings.read')) {
        const sett = await api.get('/admin/settings');
        setSettings(sett.data || {});
      }
      if (can('saves.read')) {
        const sv = await api.get('/admin/saves');
        setSaves(sv.data.saves || sv.data || []);
      }
      if (can('logs.read')) {
        const lg = await api.get('/admin/logs?limit=200');
        setLogs(lg.data.logs || lg.data || []);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchPerformance() {
    if (!can('stats.read')) return;
    try {
      const perf = await api.get('/admin/performance');
      const next = perf.data || null;
      setPerformance(next);
      setPerformanceHistory((prev) => {
        const series = Array.isArray(prev) ? prev : [];
        const point = {
          ts: Date.now(),
          rps: Number(next?.requests?.recentWindowRps || 0),
          p95: Number(next?.requests?.p95LatencyMs || 0),
          errorRate: Number(next?.requests?.errorRatePct || 0),
        };
        const merged = [...series, point];
        if (merged.length > 90) {
          return merged.slice(merged.length - 90);
        }
        return merged;
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function deleteSave(saveId) {
    if (!window.confirm('Изтрий този запис?')) return;
    await api.delete(`/maps/${encodeURIComponent(saveId)}`);
    fetchAll();
  }

  async function approveRoom(roomId) {
    if (!can('rooms.approve')) return;
    await api.post(`/admin/rooms/${encodeURIComponent(roomId)}/approve`);
    fetchAll();
  }

  async function deleteRoom(roomId) {
    if (!can('rooms.delete')) return;
    if (!window.confirm('Delete room and saves?')) return;
    await api.delete(`/admin/rooms/${encodeURIComponent(roomId)}`);
    fetchAll();
  }

  async function saveSettings() {
    if (!can('settings.write')) return;
    setSaving(true);
    try {
      await api.put('/admin/settings', settings);
      fetchAll();
    } catch (e) {
      console.error(e);
    } finally { setSaving(false); }
  }

  function setRoleDraft(userId, role) {
    const id = Number(userId);
    if (!Number.isFinite(id)) return;
    setUserRoleDrafts((prev) => ({ ...prev, [id]: String(role || 'user').toLowerCase() }));
  }

  async function applyUserRole(userRow) {
    const userId = Number(userRow?.id);
    if (!Number.isFinite(userId)) return;
    if (Number(user?.id) === userId) return;

    const currentRole = String(userRow?.role || 'user').toLowerCase();
    const draftRole = String(userRoleDrafts[userId] || currentRole).toLowerCase();
    if (draftRole === currentRole) return;

    const ok = window.confirm(`Смяна на роля за ${userRow?.email || userRow?.username || `#${userId}`} към ${draftRole}?`);
    if (!ok) return;

    setUserRoleBusy((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.put(`/admin/users/${encodeURIComponent(userId)}/role`, { role: draftRole });
      await fetchAll();
    } catch (e) {
      console.error(e);
      window.alert(e?.response?.data?.error || 'Грешка при смяна на роля');
    } finally {
      setUserRoleBusy((prev) => ({ ...prev, [userId]: false }));
    }
  }

  // AI example management removed

  return (
    <div style={isMobile
      ? {position:'fixed',top:54,left:0,right:0,bottom:0,background:'rgba(18,26,46,.97)',padding:'12px',borderRadius:0,boxShadow:'none',overflow:'auto',zIndex:1100}
      : {position:'fixed',right:18,top:66,bottom:14,left:380,background:'rgba(18,26,46,.92)',padding:24,borderRadius:'18px',boxShadow:'0 18px 55px rgba(0,0,0,.35)',overflow:'auto',minWidth:520,zIndex:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <h3 style={{fontWeight:800,letterSpacing:'.2px',color:'#dfe6ff',fontSize: isMobile ? 17 : 20}}>Администраторски панел</h3>
        <button className="btn ghost" onClick={onClose} style={{fontWeight:700,width:'auto',padding:'8px 14px'}}>✖</button>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {can('users.read') ? <button className={tab==='users'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('users')}>Потребители</button> : null}
        {can('rooms.read') ? <button className={tab==='rooms'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('rooms')}>Карти</button> : null}
        {can('saves.read') ? <button className={tab==='saves'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('saves')}>Записи</button> : null}
        {can('stats.read') ? <button className={tab==='stats'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('stats')}>Статистика</button> : null}
        {can('stats.read') ? <button className={tab==='performance'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('performance')}>Натоварване</button> : null}
        {can('logs.read') ? <button className={tab==='logs'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('logs')}>Логове</button> : null}
        {can('logs.read') ? <button className={tab==='role-audit'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('role-audit')}>Роли</button> : null}
        {can('settings.read') ? <button className={tab==='settings'?'btn primary':'btn ghost'} style={{width:'auto',padding:isMobile?'8px 10px':'10px 14px',fontSize:isMobile?12:14}} onClick={()=>setTab('settings')}>Настройки</button> : null}
        {/* AI training tab removed */}
      </div>

      {tab==='users' && can('users.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Потребители</h4>
          <div style={{maxHeight:180,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:13}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}><tr><th>ID</th><th>Email</th><th>Username</th><th>Role</th><th>Manage</th></tr></thead>
              <tbody>{(users||[]).map(u=> (
                <tr key={u.id} style={{background: String(u.role || '').toLowerCase() === 'admin' ? 'rgba(38,209,167,.12)' : 'none'}}>
                  <td>{u.id}</td>
                  <td>{u.email}</td>
                  <td>{u.username}</td>
                  <td>
                    <span
                      style={{
                        ...roleBadgeStyle(u.role),
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '.2px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td>
                      {Number(user?.id) === Number(u.id) ? (
                        <span style={{opacity:.8,fontSize:12}}>текущ профил</span>
                      ) : (
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          <select
                            className="select"
                            style={{padding:'6px 10px',borderRadius:10,minWidth:120}}
                            value={String(userRoleDrafts[u.id] || u.role || 'user').toLowerCase()}
                            onChange={(e) => setRoleDraft(u.id, e.target.value)}
                            disabled={!!userRoleBusy[u.id]}
                          >
                            {roleOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          <button
                            className="btn ghost"
                            style={{fontSize:12,padding:'6px 10px',width:'auto'}}
                            onClick={() => applyUserRole(u)}
                            disabled={!!userRoleBusy[u.id]}
                          >
                            {userRoleBusy[u.id] ? '...' : 'Apply'}
                          </button>
                        </div>
                      )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{marginTop:8,fontSize:12,opacity:.85}}>
            Роли: <b>user</b> и <b>admin</b>.
          </div>
          {can('users.manage') ? <div style={{marginTop:8,fontSize:12,opacity:.85}}>Промяната на роля влиза в сила веднага. Засегнатият потребител може да трябва да влезе отново.</div> : null}
        </section>
      )}

      {tab==='rooms' && can('rooms.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Карти / Стаи</h4>
          <div style={{maxHeight:200,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:13}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}><tr><th>Room</th><th>Name</th><th>Public</th><th>Actions</th></tr></thead>
              <tbody>{(rooms||[]).map(r=> (
                <tr key={r.room_id}><td>{r.room_id}</td><td>{r.name}</td><td>{r.public?'✅':'❌'}</td>
                  <td style={{display:'flex',gap:4}}>
                    {can('rooms.approve') ? <button className="btn ghost" style={{fontSize:12}} onClick={()=>approveRoom(r.room_id)}>✔ Одобри</button> : null}
                    {can('rooms.delete') ? <button className="btn warn" style={{fontSize:12}} onClick={()=>deleteRoom(r.room_id)}>🗑 Изтрий</button> : null}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab==='saves' && can('saves.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Всички записи (всички потребители)</h4>
          <div style={{maxHeight:300,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:13}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}><tr><th>ID</th><th>Room</th><th>User</th><th>Дата</th><th>Actions</th></tr></thead>
              <tbody>{(saves||[]).map(sv => (
                <tr key={sv.id}>
                  <td>{sv.id}</td>
                  <td>{sv.room_id}</td>
                  <td>{sv.saved_by_email || sv.saved_by_username || sv.saved_by || '-'}</td>
                  <td>{sv.created_at ? new Date(sv.created_at).toLocaleString() : '-'}</td>
                  <td>
                    <button className="btn warn" style={{fontSize:12}} onClick={() => deleteSave(sv.id)}>🗑 Изтрий</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{marginTop:8,fontSize:12,opacity:.85}}>
            Показва последните 500 записа. Изтриването е необратимо.
          </div>
        </section>
      )}

      {tab==='stats' && can('stats.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Статистика</h4>
          <div style={{background:'rgba(255,255,255,.04)',borderRadius:'12px',padding:'12px',fontSize:13,border:'1px solid rgba(255,255,255,.10)'}}>
            <div><b>Активни потребители:</b> {stats?.activeUsers || 0}</div>
            <div style={{marginTop:8}}><b>Популярни карти:</b></div>
            <ul style={{margin:0,paddingLeft:18}}>{stats?.popularMaps?.map(m=>(<li key={m.room_id}>{m.room_id} ({m.saves} записа)</li>))}</ul>
            <div style={{marginTop:8}}><b>Ключови думи:</b></div>
            <ul style={{margin:0,paddingLeft:18}}>{stats?.keywords?.map(k=>(<li key={k.keyword}>{k.keyword} ({k.count})</li>))}</ul>
          </div>
        </section>
      )}

      {tab==='performance' && can('stats.read') && (
        <section>
          {(() => {
            const avgLatencySeverity = getLatencySeverity(performance?.requests?.avgLatencyMs);
            const errorSeverity = getErrorSeverity(performance?.requests?.errorRatePct);
            return (
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                <span style={{...avgLatencySeverity.style,padding:'4px 10px',borderRadius:999,fontSize:12,fontWeight:700}}>
                  Avg ms: {avgLatencySeverity.label}
                </span>
                <span style={{...errorSeverity.style,padding:'4px 10px',borderRadius:999,fontSize:12,fontWeight:700}}>
                  Error %: {errorSeverity.label}
                </span>
                <span style={{padding:'4px 10px',borderRadius:999,fontSize:12,border:'1px solid rgba(255,255,255,.2)',background:'rgba(255,255,255,.05)'}}>
                  Прагове: Avg ms 300/800, Error % 1/3
                </span>
              </div>
            );
          })()}

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <h4 style={{margin:'8px 0'}}>Натоварване и производителност</h4>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6,opacity:.9}}>
                Авто-обновяване
                <select
                  className="select"
                  style={{padding:'6px 10px',borderRadius:10,minWidth:92}}
                  value={String(performanceRefreshMs)}
                  onChange={(e) => setPerformanceRefreshMs(Number(e.target.value || 0))}
                >
                  <option value="0">Off</option>
                  <option value="5000">5s</option>
                  <option value="10000">10s</option>
                  <option value="30000">30s</option>
                  <option value="60000">60s</option>
                </select>
              </label>
              <button className="btn ghost" style={{fontSize:12}} onClick={fetchPerformance}>Опресни</button>
            </div>
          </div>

          <div style={{background:'rgba(96,165,250,.10)',border:'1px solid rgba(96,165,250,.25)',borderRadius:'12px',padding:'10px 12px',fontSize:12,lineHeight:1.45,marginBottom:10}}>
            Този панел показва текущото здраве на API сървъра.
            <div><b>RPS</b> = заявки в секунда, <b>P95</b> = време, под което попадат 95% от заявките, <b>Error %</b> = дял на 5xx грешките.</div>
            <div>Ползвай филтрите по-долу за метод и endpoint, за да откриеш най-натоварените или проблемни маршрути.</div>
          </div>

          <div style={{background:'rgba(255,255,255,.04)',borderRadius:'12px',padding:'12px',fontSize:13,border:'1px solid rgba(255,255,255,.10)',marginBottom:10}}>
            <div><b>Време на работа:</b> {formatNumber(performance?.monitor?.uptimeSec || 0)} сек</div>
            <div><b>Прозорец за анализ:</b> {formatNumber(performance?.monitor?.windowSec || 0)} сек</div>
            <div><b>Текущо активни заявки:</b> {formatNumber(performance?.requests?.inFlight || 0)}</div>
            <div><b>Общо обработени заявки:</b> {formatNumber(performance?.requests?.total || 0)}</div>
            <div><b>Последна минута:</b> {formatNumber(performance?.requests?.recentWindowRequests || 0)} заявки ({formatNumber(performance?.requests?.recentWindowRps || 0)} req/s)</div>
            <div>
              <b>Дял на 5xx грешки:</b> {formatNumber(performance?.requests?.errorRatePct || 0)}%
              <span style={{...getErrorSeverity(performance?.requests?.errorRatePct).style,display:'inline-block',marginLeft:8,padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700}}>
                {getErrorSeverity(performance?.requests?.errorRatePct).label}
              </span>
            </div>
            <div>
              <b>Средно / P95 време:</b> {formatMs(performance?.requests?.avgLatencyMs)} / {formatMs(performance?.requests?.p95LatencyMs)}
              <span style={{...getLatencySeverity(performance?.requests?.avgLatencyMs).style,display:'inline-block',marginLeft:8,padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700}}>
                {getLatencySeverity(performance?.requests?.avgLatencyMs).label}
              </span>
            </div>
            <div><b>Node процес:</b> {performance?.process?.nodeVersion || '-'} | <b>PID:</b> {performance?.process?.pid || '-'}</div>
            <div><b>Памет RSS / Heap:</b> {formatNumber(performance?.process?.memoryRssMb || 0)} MB / {formatNumber(performance?.process?.heapUsedMb || 0)} MB</div>
            <div><b>CPU load (1/5/15):</b> {formatNumber(performance?.process?.cpuLoad1m || 0)} / {formatNumber(performance?.process?.cpuLoad5m || 0)} / {formatNumber(performance?.process?.cpuLoad15m || 0)}</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:10,alignItems:'start'}}>
            <div style={{border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)',padding:'10px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8,flexWrap:'wrap'}}>
                <div style={{fontSize:12,fontWeight:700,opacity:.95}}>Тренд в реално време</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <button className={performanceTrendMetric==='rps'?'btn primary':'btn ghost'} style={{fontSize:11,padding:'5px 8px',width:'auto'}} onClick={()=>setPerformanceTrendMetric('rps')}>RPS</button>
                  <button className={performanceTrendMetric==='p95'?'btn primary':'btn ghost'} style={{fontSize:11,padding:'5px 8px',width:'auto'}} onClick={()=>setPerformanceTrendMetric('p95')}>P95</button>
                  <button className={performanceTrendMetric==='err'?'btn primary':'btn ghost'} style={{fontSize:11,padding:'5px 8px',width:'auto'}} onClick={()=>setPerformanceTrendMetric('err')}>Error %</button>
                  <button className="btn ghost" style={{fontSize:11,padding:'5px 8px',width:'auto'}} onClick={()=>setPerformanceHistory([])}>Нулирай</button>
                </div>
              </div>
              <div style={{fontSize:11,opacity:.8,marginBottom:8}}>
                Избери метрика, за да видиш как се променя във времето. По-стръмни пикове означават внезапно натоварване.
              </div>
              <div style={{height:140,border:'1px solid rgba(255,255,255,.08)',borderRadius:'10px',background:'linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01))',padding:'8px'}}>
                <svg viewBox="0 0 100 36" preserveAspectRatio="none" style={{width:'100%',height:'100%'}}>
                  <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(255,255,255,.16)" strokeWidth="0.6" />
                  <line x1="0" y1="18" x2="100" y2="18" stroke="rgba(255,255,255,.08)" strokeWidth="0.4" />
                  <line x1="0" y1="0" x2="100" y2="0" stroke="rgba(255,255,255,.08)" strokeWidth="0.4" />
                  {trendSeries.pointsPath ? (
                    <polyline
                      points={trendSeries.pointsPath}
                      fill="none"
                      stroke={trendMetricConfig[performanceTrendMetric]?.color || '#60a5fa'}
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : null}
                </svg>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(90px,1fr))',gap:8,marginTop:8,fontSize:12}}>
                <div><b>{trendMetricConfig[performanceTrendMetric]?.label || 'Метрика'}:</b> {formatNumber(trendSeries.latest)}</div>
                <div><b>Средно:</b> {formatNumber(trendSeries.avg)}</div>
                <div><b>Проби:</b> {formatNumber(trendSeries.samples)}</div>
              </div>
            </div>

            <div style={{maxHeight:260,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead style={{background:'rgba(124,92,255,.18)'}}>
                  <tr>
                    <th style={{textAlign:'left',padding:'10px'}}>Тип отговор</th>
                    <th style={{textAlign:'left',padding:'10px'}}>Брой (прозорец)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(performance?.recentStatusBuckets || {}).map(([bucket, count]) => (
                    <tr key={bucket} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                      <td style={{padding:'10px'}}>{statusBucketLabels[bucket] || bucket}</td>
                      <td style={{padding:'10px'}}>{formatNumber(count || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{maxHeight:260,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)',padding:'10px'}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8,opacity:.95}}>Разпределение на статусите</div>
              <div style={{fontSize:11,opacity:.8,marginBottom:8}}>
                Идеалният сценарий е доминираща лента 2xx и минимални 4xx/5xx.
              </div>
              <div style={{display:'flex',height:18,borderRadius:999,overflow:'hidden',border:'1px solid rgba(255,255,255,.10)',marginBottom:8}}>
                {statusChartRows.map((row) => (
                  <div
                    key={row.key}
                    title={`${row.label}: ${formatNumber(row.value)} (${formatPct(row.pct)})`}
                    style={{width:`${row.pct}%`,background:row.color,minWidth:row.value > 0 ? 3 : 0}}
                  />
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:6,fontSize:12,marginBottom:10}}>
                {statusChartRows.map((row) => (
                  <div key={row.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'4px 6px',borderRadius:8,background:'rgba(255,255,255,.03)'}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                      <span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:row.color}} />
                      {row.label}
                    </span>
                    <span>{formatNumber(row.value)} ({formatPct(row.pct)})</span>
                  </div>
                ))}
              </div>

              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead style={{background:'rgba(124,92,255,.18)'}}>
                  <tr>
                    <th style={{textAlign:'left',padding:'10px'}}>Метрика</th>
                    <th style={{textAlign:'left',padding:'10px'}}>Стойност</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>Средно време</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.avgLatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P50</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.p50LatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P95</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.p95LatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P99</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.p99LatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>Максимум</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.maxLatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P95 за прозореца</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.recentWindowP95LatencyMs)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,marginBottom:8,flexWrap:'wrap'}}>
            <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6}}>
              Метод
              <select
                className="select"
                style={{padding:'6px 10px',borderRadius:10,minWidth:0,flex:'0 0 auto'}}
                value={performanceMethodFilter}
                onChange={(e) => setPerformanceMethodFilter(String(e.target.value || 'ALL').toUpperCase())}
              >
                {performanceMethods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6}}>
              Endpoint съдържа
              <input
                value={performanceEndpointFilter}
                onChange={(e) => setPerformanceEndpointFilter(e.target.value)}
                placeholder="/api/admin"
                style={{borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:'6px 10px',flex:1,minWidth:0,width:'100%'}}
              />
            </label>
            <button
              className="btn ghost"
              style={{fontSize:12,padding:'6px 10px',width:'auto'}}
              onClick={() => {
                setPerformanceMethodFilter('ALL');
                setPerformanceEndpointFilter('');
              }}
            >
              Изчисти
            </button>
          </div>

          <div style={{border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)',padding:'10px',marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8,opacity:.95}}>Дял на натоварване по endpoint (Топ 8)</div>
            <div style={{fontSize:11,opacity:.8,marginBottom:8}}>
              Клик върху ред, за да приложиш автоматично филтър по метод и endpoint в таблицата по-долу.
            </div>
            <div style={{display:'grid',gap:6}}>
              {topEndpointShares.map((row) => (
                <button
                  key={`share-${row.endpoint}`}
                  className="btn ghost"
                  style={{width:'100%',textAlign:'left',padding:'6px 8px'}}
                  onClick={() => {
                    const endpointText = String(row.endpoint || '');
                    const method = endpointText.split(' ')[0]?.toUpperCase() || 'ALL';
                    const pathOnly = endpointText.includes(' ') ? endpointText.substring(endpointText.indexOf(' ') + 1) : endpointText;
                    setPerformanceMethodFilter(method || 'ALL');
                    setPerformanceEndpointFilter(pathOnly || '');
                  }}
                  title="Click to apply filters"
                >
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,marginBottom:4}}>
                    <span style={{maxWidth:'70%',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.endpoint}</span>
                    <span>{formatNumber(row.requests)} заявки ({formatPct(row.sharePct)})</span>
                  </div>
                  <div style={{height:8,borderRadius:999,overflow:'hidden',background:'rgba(255,255,255,.08)'}}>
                    <div style={{height:'100%',width:`${row.sharePct}%`,background:'linear-gradient(90deg, #60a5fa, #2dd4bf)'}} />
                  </div>
                </button>
              ))}
            </div>
            {topEndpointShares.length === 0 ? <div style={{fontSize:12,opacity:.8}}>Няма достатъчно данни за схема.</div> : null}
          </div>

          <div style={{maxHeight:320,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)',marginTop:10}}>
            <div style={{fontSize:11,opacity:.8,padding:'8px 10px'}}>
              Таблицата показва най-натоварените endpoints. Следи високи стойности в колоните 5xx и Avg ms.
            </div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}>
                <tr>
                  <th style={{textAlign:'left',padding:'10px'}}>Endpoint</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Заявки</th>
                  <th style={{textAlign:'left',padding:'10px'}}>5xx</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Грешки %</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Avg ms</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Max ms</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Последен статус</th>
                </tr>
              </thead>
              <tbody>
                {filteredTopEndpoints.map((row) => (
                  <tr key={row.endpoint} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                    <td style={{padding:'10px',whiteSpace:'nowrap',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis'}} title={row.endpoint}>{row.endpoint}</td>
                    <td style={{padding:'10px'}}>{formatNumber(row.requests || 0)}</td>
                    <td style={{padding:'10px'}}>{formatNumber(row.errors5xx || 0)}</td>
                    <td style={{padding:'10px'}}>
                      <span style={{...getErrorSeverity(row.errorRatePct).style,display:'inline-flex',alignItems:'center',gap:6,padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700}}>
                        {formatNumber(row.errorRatePct || 0)}% ({getErrorSeverity(row.errorRatePct).label})
                      </span>
                    </td>
                    <td style={{padding:'10px'}}>
                      <span style={{...getLatencySeverity(row.avgLatencyMs).style,display:'inline-flex',alignItems:'center',gap:6,padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700}}>
                        {formatMs(row.avgLatencyMs)} ({getLatencySeverity(row.avgLatencyMs).label})
                      </span>
                    </td>
                    <td style={{padding:'10px'}}>{formatMs(row.maxLatencyMs)}</td>
                    <td style={{padding:'10px'}}>{row.lastStatus || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredTopEndpoints.length === 0 ? (
              <div style={{padding:'12px',fontSize:12,opacity:.85}}>Няма резултати за избраните филтри.</div>
            ) : null}
          </div>
        </section>
      )}

      {tab==='logs' && can('logs.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Логове (последни 200)</h4>
          <div style={{maxHeight:360,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}>
                <tr>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Дата</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Потребител</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Действие</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Детайли</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>IP</th>
                </tr>
              </thead>
              <tbody>
                {(logs || []).map((l) => (
                  <tr key={l.id} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                    <td style={{padding:'10px 10px',whiteSpace:'nowrap',opacity:.9}}>{l.created_at ? new Date(l.created_at).toLocaleString() : '-'}</td>
                    <td style={{padding:'10px 10px',maxWidth:220,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',opacity:.9}} title={l.user_email || ''}>
                      {l.user_email || l.user_username || l.user_id || '—'}
                    </td>
                    <td style={{padding:'10px 10px',whiteSpace:'nowrap'}}>{l.action}</td>
                    <td style={{padding:'10px 10px',maxWidth:360,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',opacity:.9}} title={l.details || ''}>
                      {l.details || '—'}
                    </td>
                    <td style={{padding:'10px 10px',whiteSpace:'nowrap',opacity:.85}}>{l.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{marginTop:8,fontSize:12,opacity:.85}}>
            Логовете се записват за вход/запис/коментари/админ действия.
          </div>
        </section>
      )}

      {tab==='role-audit' && can('logs.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Role Audit</h4>
          <div style={{maxHeight:360,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}>
                <tr>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Дата</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Actor</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Действие</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Target</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Нова роля</th>
                  <th style={{textAlign:'left',padding:'10px 10px'}}>Контекст</th>
                </tr>
              </thead>
              <tbody>
                {roleAuditLogs.map((row) => {
                  const details = row.parsedDetails || {};
                  const targetLabel = details.userId ? `user:${details.userId}` : '—';
                  const nextRole = details.role || '—';
                  const context = details.teamId ? `team:${details.teamId}` : (details.room ? `room:${details.room}` : 'global');
                  return (
                    <tr key={row.id} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap',opacity:.9}}>{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
                      <td style={{padding:'10px 10px',maxWidth:220,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',opacity:.9}} title={row.user_email || ''}>
                        {row.user_email || row.user_username || row.user_id || '—'}
                      </td>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap'}}>{row.action}</td>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap'}}>{targetLabel}</td>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap'}}>
                        <span
                          style={{
                            ...roleBadgeStyle(nextRole),
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: '.2px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {roleLabel(nextRole)}
                        </span>
                      </td>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap',opacity:.9}}>{context}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {roleAuditLogs.length === 0 ? (
              <div style={{padding:'12px',fontSize:12,opacity:.85}}>Няма записи за промени по роли в последните логове.</div>
            ) : null}
          </div>
          <div style={{marginTop:8,fontSize:12,opacity:.85}}>
            Показва действия: <b>admin_user_set_role</b> и <b>team_set_role</b>.
          </div>
        </section>
      )}

      {tab==='settings' && can('settings.read') && (
        <section>
          <h4 style={{margin:'8px 0'}}>Настройки</h4>
          <div style={{display:'grid',gridTemplateColumns:'1fr 160px',gap:8}}>
            <label style={{fontSize:13}}>Limits (JSON):<textarea value={JSON.stringify(settings.limits||{},null,2)} onChange={e=>setSettings({...settings, limits: JSON.parse(e.target.value||'{}')})} style={{width:'100%',height:80,borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff'}} /></label>
            <label style={{fontSize:13}}>Theme (light/dark):<input value={settings.theme||'dark'} onChange={e=>setSettings({...settings, theme: e.target.value})} style={{width:'100%',borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff'}} /></label>
            <label style={{fontSize:13}}>Language:<input value={settings.lang||'bg'} onChange={e=>setSettings({...settings, lang: e.target.value})} style={{width:'100%',borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff'}} /></label>
          </div>
          <div style={{marginTop:8}}>
            <button className="btn primary" onClick={saveSettings} disabled={saving || !can('settings.write')}>{saving? 'Запазване...' : 'Запази настройки'}</button>
          </div>
        </section>
      )}

      {/* AI training panel removed */}
    </div>
  );
}
