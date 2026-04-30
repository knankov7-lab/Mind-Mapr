const express = require('express');
const router = express.Router();
const { requireAdmin } = require('./auth');
const {
  run,
  get,
  all,
  exec,
  getUserById,
  updateUserRole,
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
  try {
    await run("ALTER TABLE rooms ADD COLUMN approval_status TEXT DEFAULT 'pending'");
  } catch (e) {
    // ignore if column already exists
  }
  await exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  await run("UPDATE rooms SET approval_status = 'approved' WHERE public = 1 AND (approval_status IS NULL OR approval_status = '')");
  await run("UPDATE rooms SET approval_status = 'pending' WHERE public = 0 AND (approval_status IS NULL OR approval_status = '')");
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
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const rows = await all('SELECT id, email, username, role, created_at FROM users ORDER BY id DESC');
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to list users' }); }
});

// Update user role
router.put('/users/:id/role', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const role = String(req.body?.role || '').trim().toLowerCase();
  const allowedRoles = ['user', 'admin'];

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'invalid user id' });
  }
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  if (Number(req.user?.id) === userId) {
    return res.status(400).json({ error: 'cannot change own role from admin panel' });
  }

  try {
    const target = await getUserById(userId);
    if (!target) return res.status(404).json({ error: 'user not found' });

    await updateUserRole(userId, role);
    try {
      await insertLog(req.user?.id ?? null, 'admin_user_set_role', { userId, role }, req.ip);
    } catch {}
    const updated = await getUserById(userId);
    res.json({ ok: true, user: updated ? { id: updated.id, email: updated.email, username: updated.username, role: updated.role } : null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// List rooms
router.get('/rooms', requireAdmin, async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        r.id,
        r.room_id,
        r.name,
        r.created_by,
        r.created_at,
        COALESCE(r.public, 0) AS public,
        COALESCE(r.approval_status, CASE WHEN COALESCE(r.public, 0) = 1 THEN 'approved' ELSE 'pending' END) AS approval_status,
        COALESCE(stats.saves_count, 0) AS saves_count,
        stats.last_saved_at,
        0 AS is_pending_only
      FROM rooms r
      LEFT JOIN (
        SELECT room_id, COUNT(*) AS saves_count, MAX(created_at) AS last_saved_at
        FROM saves
        GROUP BY room_id
      ) stats ON stats.room_id = r.room_id

      UNION ALL

      SELECT
        NULL AS id,
        s.room_id,
        NULL AS name,
        NULL AS created_by,
        MIN(s.created_at) AS created_at,
        0 AS public,
        'pending' AS approval_status,
        COUNT(*) AS saves_count,
        MAX(s.created_at) AS last_saved_at,
        1 AS is_pending_only
      FROM saves s
      LEFT JOIN rooms r ON r.room_id = s.room_id
      WHERE r.room_id IS NULL
      GROUP BY s.room_id

      ORDER BY public DESC, last_saved_at DESC, created_at DESC
    `);
    res.json({ rooms: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to list rooms' }); }
});

// List all saves (admin only)
router.get('/saves', requireAdmin, async (_req, res) => {
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
router.post('/rooms/:room/approve', requireAdmin, async (req, res) => {
  const room = req.params.room;
  try {
    await run(
      'INSERT OR IGNORE INTO rooms (room_id, name, created_by) VALUES (?, ?, ?)',
      [room, null, req.user?.id ?? null]
    );
    await run("UPDATE rooms SET public = 1, approval_status = 'approved' WHERE room_id = ?", [room]);
    try {
      await insertLog(req.user?.id ?? null, 'admin_room_approve', { room }, req.ip);
    } catch {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to approve room' }); }
});

// Reject room from public approval flow
router.post('/rooms/:room/reject', requireAdmin, async (req, res) => {
  const room = req.params.room;
  try {
    await run(
      'INSERT OR IGNORE INTO rooms (room_id, name, created_by) VALUES (?, ?, ?)',
      [room, null, req.user?.id ?? null]
    );
    await run("UPDATE rooms SET public = 0, approval_status = 'rejected' WHERE room_id = ?", [room]);
    try {
      await insertLog(req.user?.id ?? null, 'admin_room_reject', { room }, req.ip);
    } catch {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to reject room' }); }
});

// Delete room and its saves
router.delete('/rooms/:room', requireAdmin, async (req, res) => {
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
router.get('/logs', requireAdmin, async (req, res) => {
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
router.get('/stats', requireAdmin, async (req, res) => {
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
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => obj[r.key] = JSON.parse(r.value));
    res.json(obj);
  } catch (e) { res.status(500).json({ error: 'Failed to load settings' }); }
});

router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const entries = req.body || {};
    const keys = Object.keys(entries);
    for (const k of keys) {
      await run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(entries[k])]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to save settings' }); }
});

// AI admin endpoints removed

module.exports = router;
