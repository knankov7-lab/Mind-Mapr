import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from './api';
import { useAuth } from './AuthContext';

export default function AdminPanel({ onClose }) {
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
      setPerformance(perf.data || null);
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
    <div style={{position:'absolute',right:18,top:62,bottom:14,left:380,background:'rgba(18,26,46,.92)',padding:24,borderRadius:'18px',boxShadow:'0 18px 55px rgba(0,0,0,.35)',overflow:'auto',minWidth:520}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <h3 style={{fontWeight:800,letterSpacing:'.2px',color:'#dfe6ff'}}>Администраторски панел</h3>
        <button className="btn ghost" onClick={onClose} style={{fontWeight:700}}>✖</button>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        {can('users.read') ? <button className={tab==='users'?'btn primary':'btn ghost'} onClick={()=>setTab('users')}>Потребители</button> : null}
        {can('rooms.read') ? <button className={tab==='rooms'?'btn primary':'btn ghost'} onClick={()=>setTab('rooms')}>Карти</button> : null}
        {can('saves.read') ? <button className={tab==='saves'?'btn primary':'btn ghost'} onClick={()=>setTab('saves')}>Всички записи</button> : null}
        {can('stats.read') ? <button className={tab==='stats'?'btn primary':'btn ghost'} onClick={()=>setTab('stats')}>Статистика</button> : null}
        {can('stats.read') ? <button className={tab==='performance'?'btn primary':'btn ghost'} onClick={()=>setTab('performance')}>Performance</button> : null}
        {can('logs.read') ? <button className={tab==='logs'?'btn primary':'btn ghost'} onClick={()=>setTab('logs')}>Логове</button> : null}
        {can('logs.read') ? <button className={tab==='role-audit'?'btn primary':'btn ghost'} onClick={()=>setTab('role-audit')}>Role Audit</button> : null}
        {can('settings.read') ? <button className={tab==='settings'?'btn primary':'btn ghost'} onClick={()=>setTab('settings')}>Настройки</button> : null}
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
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <h4 style={{margin:'8px 0'}}>Server Load / Performance</h4>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6,opacity:.9}}>
                Auto-refresh
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

          <div style={{background:'rgba(255,255,255,.04)',borderRadius:'12px',padding:'12px',fontSize:13,border:'1px solid rgba(255,255,255,.10)',marginBottom:10}}>
            <div><b>Monitor uptime:</b> {formatNumber(performance?.monitor?.uptimeSec || 0)} сек</div>
            <div><b>Window:</b> {formatNumber(performance?.monitor?.windowSec || 0)} сек</div>
            <div><b>In-flight:</b> {formatNumber(performance?.requests?.inFlight || 0)}</div>
            <div><b>Total requests:</b> {formatNumber(performance?.requests?.total || 0)}</div>
            <div><b>Recent requests:</b> {formatNumber(performance?.requests?.recentWindowRequests || 0)} ({formatNumber(performance?.requests?.recentWindowRps || 0)} req/s)</div>
            <div><b>Error rate:</b> {formatNumber(performance?.requests?.errorRatePct || 0)}%</div>
            <div><b>Avg / P95 latency:</b> {formatMs(performance?.requests?.avgLatencyMs)} / {formatMs(performance?.requests?.p95LatencyMs)}</div>
            <div><b>Node:</b> {performance?.process?.nodeVersion || '-'} | <b>PID:</b> {performance?.process?.pid || '-'}</div>
            <div><b>Memory RSS / Heap:</b> {formatNumber(performance?.process?.memoryRssMb || 0)} MB / {formatNumber(performance?.process?.heapUsedMb || 0)} MB</div>
            <div><b>CPU load 1/5/15:</b> {formatNumber(performance?.process?.cpuLoad1m || 0)} / {formatNumber(performance?.process?.cpuLoad5m || 0)} / {formatNumber(performance?.process?.cpuLoad15m || 0)}</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,alignItems:'start'}}>
            <div style={{maxHeight:260,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead style={{background:'rgba(124,92,255,.18)'}}>
                  <tr>
                    <th style={{textAlign:'left',padding:'10px'}}>Status bucket</th>
                    <th style={{textAlign:'left',padding:'10px'}}>Count (window)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(performance?.recentStatusBuckets || {}).map(([bucket, count]) => (
                    <tr key={bucket} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                      <td style={{padding:'10px'}}>{bucket}</td>
                      <td style={{padding:'10px'}}>{formatNumber(count || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{maxHeight:260,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead style={{background:'rgba(124,92,255,.18)'}}>
                  <tr>
                    <th style={{textAlign:'left',padding:'10px'}}>Metric</th>
                    <th style={{textAlign:'left',padding:'10px'}}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>Avg latency</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.avgLatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P50 latency</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.p50LatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P95 latency</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.p95LatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>P99 latency</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.p99LatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>Max latency</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.maxLatencyMs)}</td></tr>
                  <tr style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{padding:'10px'}}>Recent P95</td><td style={{padding:'10px'}}>{formatMs(performance?.requests?.recentWindowP95LatencyMs)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,marginBottom:8,flexWrap:'wrap'}}>
            <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6}}>
              Method
              <select
                className="select"
                style={{padding:'6px 10px',borderRadius:10,minWidth:110}}
                value={performanceMethodFilter}
                onChange={(e) => setPerformanceMethodFilter(String(e.target.value || 'ALL').toUpperCase())}
              >
                {performanceMethods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6}}>
              Endpoint contains
              <input
                value={performanceEndpointFilter}
                onChange={(e) => setPerformanceEndpointFilter(e.target.value)}
                placeholder="/api/admin"
                style={{borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:'6px 10px',minWidth:220}}
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
              Clear
            </button>
          </div>

          <div style={{maxHeight:320,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)',marginTop:10}}>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}>
                <tr>
                  <th style={{textAlign:'left',padding:'10px'}}>Endpoint</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Requests</th>
                  <th style={{textAlign:'left',padding:'10px'}}>5xx</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Error %</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Avg ms</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Max ms</th>
                  <th style={{textAlign:'left',padding:'10px'}}>Last status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTopEndpoints.map((row) => (
                  <tr key={row.endpoint} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                    <td style={{padding:'10px',whiteSpace:'nowrap',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis'}} title={row.endpoint}>{row.endpoint}</td>
                    <td style={{padding:'10px'}}>{formatNumber(row.requests || 0)}</td>
                    <td style={{padding:'10px'}}>{formatNumber(row.errors5xx || 0)}</td>
                    <td style={{padding:'10px'}}>{formatNumber(row.errorRatePct || 0)}%</td>
                    <td style={{padding:'10px'}}>{formatMs(row.avgLatencyMs)}</td>
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
