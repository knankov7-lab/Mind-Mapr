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

  // AI admin tools archived (moved to archive/ai branch)

  useEffect(() => { fetchAll(); }, []);

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
    // archived: AI example creation moved to archive branch
  }

  async function deleteAiExample(id) {
    // archived: AI example deletion moved to archive branch
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
        {/* AI admin tools archived */}
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

      {/* AI admin tools archived */}
    </div>
  );
}
