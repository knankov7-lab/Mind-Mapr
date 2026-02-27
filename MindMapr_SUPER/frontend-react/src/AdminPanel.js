import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from './api';

export default function AdminPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [saves, setSaves] = useState([]);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('users');

  const aiIntents = useMemo(() => (
    [
      { id: 'suggest-nodes', label: 'Предложения за възли (suggest-nodes)' },
      { id: 'generate-map', label: 'Генериране на карта (generate-map)' },
    ]
  ), []);
  const [aiIntent, setAiIntent] = useState('suggest-nodes');
  const [aiExamples, setAiExamples] = useState([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiForm, setAiForm] = useState({ input: '', output: '', tags: '' });

  const fetchAiExamples = useCallback(async () => {
    setAiError('');
    setAiBusy(true);
    try {
      const res = await api.get(`/admin/ai/examples?intent=${encodeURIComponent(aiIntent)}&limit=50`);
      setAiExamples(res.data?.examples || []);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to load AI examples';
      setAiError(String(msg));
      setAiExamples([]);
    } finally {
      setAiBusy(false);
    }
  }, [aiIntent]);

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    if (tab !== 'ai') return;
    fetchAiExamples();
  }, [tab, fetchAiExamples]);

  async function fetchAll() {
    try {
      const [u, r, s, sett] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/rooms'),
        api.get('/admin/stats'),
        api.get('/admin/settings')
      ]);
      setUsers(u.data.users || u.data || []);
      setRooms(r.data.rooms || r.data || []);
      setStats(s.data || null);
      setSettings(sett.data || {});

      // optional: fetch saves (admin-only)
      const sv = await api.get('/admin/saves');
      setSaves(sv.data.saves || sv.data || []);

      const lg = await api.get('/admin/logs?limit=200');
      setLogs(lg.data.logs || lg.data || []);
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
    await api.post(`/admin/rooms/${encodeURIComponent(roomId)}/approve`);
    fetchAll();
  }

  async function deleteRoom(roomId) {
    if (!window.confirm('Delete room and saves?')) return;
    await api.delete(`/admin/rooms/${encodeURIComponent(roomId)}`);
    fetchAll();
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await api.put('/admin/settings', settings);
      fetchAll();
    } catch (e) {
      console.error(e);
    } finally { setSaving(false); }
  }

  async function createAiExample() {
    setAiError('');
    const output = (aiForm.output || '').toString();
    if (!output.trim()) {
      setAiError('Полето Output е задължително.');
      return;
    }

    setAiBusy(true);
    try {
      await api.post('/admin/ai/examples', {
        intent: aiIntent,
        input: aiForm.input || null,
        output: output,
        tags: aiForm.tags || null,
      });
      setAiForm({ input: '', output: '', tags: '' });
      await fetchAiExamples();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to create AI example';
      setAiError(String(msg));
    } finally {
      setAiBusy(false);
    }
  }

  async function deleteAiExample(id) {
    if (!window.confirm('Изтрий този AI пример?')) return;
    setAiError('');
    setAiBusy(true);
    try {
      await api.delete(`/admin/ai/examples/${encodeURIComponent(id)}`);
      await fetchAiExamples();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to delete AI example';
      setAiError(String(msg));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div style={{position:'absolute',right:18,top:62,bottom:14,left:380,background:'rgba(18,26,46,.92)',padding:24,borderRadius:'18px',boxShadow:'0 18px 55px rgba(0,0,0,.35)',overflow:'auto',minWidth:520}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <h3 style={{fontWeight:800,letterSpacing:'.2px',color:'#dfe6ff'}}>Администраторски панел</h3>
        <button className="btn ghost" onClick={onClose} style={{fontWeight:700}}>✖</button>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <button className={tab==='users'?'btn primary':'btn ghost'} onClick={()=>setTab('users')}>Потребители</button>
        <button className={tab==='rooms'?'btn primary':'btn ghost'} onClick={()=>setTab('rooms')}>Карти</button>
        <button className={tab==='saves'?'btn primary':'btn ghost'} onClick={()=>setTab('saves')}>Всички записи</button>
        <button className={tab==='stats'?'btn primary':'btn ghost'} onClick={()=>setTab('stats')}>Статистика</button>
        <button className={tab==='logs'?'btn primary':'btn ghost'} onClick={()=>setTab('logs')}>Логове</button>
        <button className={tab==='settings'?'btn primary':'btn ghost'} onClick={()=>setTab('settings')}>Настройки</button>
        <button className={tab==='ai'?'btn primary':'btn ghost'} onClick={()=>setTab('ai')}>AI Обучение</button>
      </div>

      {tab==='users' && (
        <section>
          <h4 style={{margin:'8px 0'}}>Потребители</h4>
          <div style={{maxHeight:180,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:13}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}><tr><th>ID</th><th>Email</th><th>Username</th><th>Role</th></tr></thead>
              <tbody>{(users||[]).map(u=> (
                <tr key={u.id} style={{background:u.role==='admin'?'rgba(38,209,167,.12)':'none'}}><td>{u.id}</td><td>{u.email}</td><td>{u.username}</td><td>{u.role}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab==='rooms' && (
        <section>
          <h4 style={{margin:'8px 0'}}>Карти / Стаи</h4>
          <div style={{maxHeight:200,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
            <table style={{width:'100%',fontSize:13}}>
              <thead style={{background:'rgba(124,92,255,.18)'}}><tr><th>Room</th><th>Name</th><th>Public</th><th>Actions</th></tr></thead>
              <tbody>{(rooms||[]).map(r=> (
                <tr key={r.room_id}><td>{r.room_id}</td><td>{r.name}</td><td>{r.public?'✅':'❌'}</td>
                  <td style={{display:'flex',gap:4}}>
                    <button className="btn ghost" style={{fontSize:12}} onClick={()=>approveRoom(r.room_id)}>✔ Одобри</button>
                    <button className="btn warn" style={{fontSize:12}} onClick={()=>deleteRoom(r.room_id)}>🗑 Изтрий</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab==='saves' && (
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

      {tab==='stats' && (
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

      {tab==='logs' && (
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

      {tab==='settings' && (
        <section>
          <h4 style={{margin:'8px 0'}}>Настройки</h4>
          <div style={{display:'grid',gridTemplateColumns:'1fr 160px',gap:8}}>
            <label style={{fontSize:13}}>Limits (JSON):<textarea value={JSON.stringify(settings.limits||{},null,2)} onChange={e=>setSettings({...settings, limits: JSON.parse(e.target.value||'{}')})} style={{width:'100%',height:80,borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff'}} /></label>
            <label style={{fontSize:13}}>Theme (light/dark):<input value={settings.theme||'dark'} onChange={e=>setSettings({...settings, theme: e.target.value})} style={{width:'100%',borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff'}} /></label>
            <label style={{fontSize:13}}>Language:<input value={settings.lang||'bg'} onChange={e=>setSettings({...settings, lang: e.target.value})} style={{width:'100%',borderRadius:'10px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff'}} /></label>
          </div>
          <div style={{marginTop:8}}>
            <button className="btn primary" onClick={saveSettings} disabled={saving}>{saving? 'Запазване...' : 'Запази настройки'}</button>
          </div>
        </section>
      )}

      {tab==='ai' && (
        <section>
          <h4 style={{margin:'8px 0'}}>AI Обучение (примери)</h4>
          <div style={{background:'rgba(255,255,255,.04)',borderRadius:'12px',padding:'12px',fontSize:13,border:'1px solid rgba(255,255,255,.10)'}}>
            <div style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
              <label style={{display:'flex',flexDirection:'column',gap:6,minWidth:320}}>
                <span style={{opacity:.9}}>Intent</span>
                <select className="select" value={aiIntent} onChange={(e) => setAiIntent(e.target.value)}>
                  {aiIntents.map((x) => (
                    <option key={x.id} value={x.id}>{x.label}</option>
                  ))}
                </select>
              </label>
              <button className="btn ghost" onClick={fetchAiExamples} disabled={aiBusy}>↻ Обнови</button>
            </div>

            <div style={{marginTop:10,opacity:.85,fontSize:12}}>
              Това е „обучение“ чрез curated примери (few-shot). Колкото по-добри примери добавиш, толкова по-добър става стилът на AI.
            </div>

            {aiError ? (
              <div style={{marginTop:10,padding:'10px 12px',borderRadius:12,border:'1px solid rgba(255,110,110,.28)',background:'rgba(255,110,110,.12)',color:'rgba(255,220,220,.95)'}}>
                {aiError}
              </div>
            ) : null}

            <div style={{marginTop:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <label style={{display:'flex',flexDirection:'column',gap:6}}>
                <span style={{opacity:.9}}>Input (по избор)</span>
                <textarea
                  value={aiForm.input}
                  onChange={(e) => setAiForm((p) => ({ ...p, input: e.target.value }))}
                  placeholder="Примерен вход: списък от възли, тема, инструкции..."
                  style={{width:'100%',height:120,borderRadius:'12px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:10}}
                />
              </label>
              <label style={{display:'flex',flexDirection:'column',gap:6}}>
                <span style={{opacity:.9}}>Output (задължително)</span>
                <textarea
                  value={aiForm.output}
                  onChange={(e) => setAiForm((p) => ({ ...p, output: e.target.value }))}
                  placeholder={aiIntent === 'suggest-nodes'
                    ? 'Пример: ["Причини","Последици","Решения"]'
                    : 'Пример: ["Определение","Примери","Заключение"]'
                  }
                  style={{width:'100%',height:120,borderRadius:'12px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:10}}
                />
              </label>
            </div>
            <div style={{marginTop:10,display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
              <label style={{display:'flex',flexDirection:'column',gap:6,minWidth:260}}>
                <span style={{opacity:.9}}>Tags (по избор)</span>
                <input
                  value={aiForm.tags}
                  onChange={(e) => setAiForm((p) => ({ ...p, tags: e.target.value }))}
                  placeholder="например: училище, история"
                  style={{width:'100%',borderRadius:'12px',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:'10px 12px'}}
                />
              </label>
              <button className="btn primary" onClick={createAiExample} disabled={aiBusy}>➕ Добави пример</button>
            </div>

            <div style={{marginTop:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:8}}>
                <b>Примери ({aiExamples.length})</b>
                {aiBusy ? <span style={{opacity:.8,fontSize:12}}>Зареждане...</span> : null}
              </div>
              <div style={{maxHeight:280,overflow:'auto',border:'1px solid rgba(255,255,255,.10)',borderRadius:'12px',background:'rgba(255,255,255,.04)'}}>
                <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                  <thead style={{background:'rgba(124,92,255,.18)'}}>
                    <tr>
                      <th style={{textAlign:'left',padding:'10px 10px'}}>ID</th>
                      <th style={{textAlign:'left',padding:'10px 10px'}}>Input</th>
                      <th style={{textAlign:'left',padding:'10px 10px'}}>Output</th>
                      <th style={{textAlign:'left',padding:'10px 10px'}}>Tags</th>
                      <th style={{textAlign:'left',padding:'10px 10px'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(aiExamples || []).map((ex) => (
                      <tr key={ex.id} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}>
                        <td style={{padding:'10px 10px',whiteSpace:'nowrap',opacity:.9}}>{ex.id}</td>
                        <td style={{padding:'10px 10px',maxWidth:260,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',opacity:.9}} title={ex.input || ''}>{ex.input || '—'}</td>
                        <td style={{padding:'10px 10px',maxWidth:320,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={ex.output || ''}>{ex.output}</td>
                        <td style={{padding:'10px 10px',maxWidth:160,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',opacity:.9}} title={ex.tags || ''}>{ex.tags || '—'}</td>
                        <td style={{padding:'10px 10px'}}>
                          <button className="btn warn" style={{fontSize:12}} onClick={() => deleteAiExample(ex.id)} disabled={aiBusy}>🗑 Изтрий</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
