const express = require('express');
const router = express.Router();
const { db } = require('./db');

// Ensure 'public' column and settings table exist
(async () => {
  try {
    await db.exec("ALTER TABLE rooms ADD COLUMN public INTEGER DEFAULT 0;");
  } catch (e) {
    // ignore if column already exists
  }
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  } catch (e) {}
})();

// List users
router.get('/users', async (req, res) => {
  try {
    const rows = await db.all('SELECT id, email, username, role, created_at FROM users ORDER BY id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Failed to list users' }); }
});

// List rooms
router.get('/rooms', async (req, res) => {
  try {
    const rows = await db.all('SELECT id, room_id, name, created_by, created_at, public FROM rooms ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Failed to list rooms' }); }
});

// Approve room (mark public)
router.post('/rooms/:room/approve', async (req, res) => {
  const room = req.params.room;
  try {
    await db.run('UPDATE rooms SET public = 1 WHERE room_id = ?', [room]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to approve room' }); }
});

// Delete room and its saves
router.delete('/rooms/:room', async (req, res) => {
  const room = req.params.room;
  try {
    await db.run('DELETE FROM saves WHERE room_id = ?', [room]);
    await db.run('DELETE FROM rooms WHERE room_id = ?', [room]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete room' }); }
});

// Stats: active users (count), popular maps, keywords
router.get('/stats', async (req, res) => {
  try {
    const usersCountRow = await db.get('SELECT COUNT(1) as cnt FROM users');
    const usersCount = usersCountRow?.cnt || 0;

    const popular = await db.all(`
      SELECT room_id, COUNT(*) as saves FROM saves GROUP BY room_id ORDER BY saves DESC LIMIT 10
    `);

    // keywords from latest saves
    const saves = await db.all('SELECT nodes FROM saves ORDER BY created_at DESC LIMIT 200');
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
    const rows = await db.all('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => obj[r.key] = JSON.parse(r.value));
    res.json(obj);
  } catch (e) { res.status(500).json({ error: 'Failed to load settings' }); }
});

router.put('/settings', async (req, res) => {
  try {
    const entries = req.body || {};
    const keys = Object.keys(entries);
    const stmt = await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const k of keys) {
      await stmt.run(k, JSON.stringify(entries[k]));
    }
    await stmt.finalize();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to save settings' }); }
});

module.exports = router;
