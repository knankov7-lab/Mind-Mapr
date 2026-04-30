const { createClient } = require("@libsql/client");
const { toSofiaSqlString } = require("./time");

let db;

function ensureDb() {
  if (!db) throw new Error("Database not initialized");
}

// Normalize libsql result rows to plain objects
function toRows(result) {
  return (result.rows || []).map((row) => {
    const obj = {};
    for (const col of result.columns) obj[col] = row[col];
    return obj;
  });
}

async function run(sql, params = []) {
  ensureDb();
  const result = await db.execute({ sql, args: params });
  return { lastID: Number(result.lastInsertRowid ?? 0), changes: result.rowsAffected ?? 0 };
}

async function get(sql, params = []) {
  ensureDb();
  const result = await db.execute({ sql, args: params });
  const rows = toRows(result);
  return rows[0] ?? null;
}

async function all(sql, params = []) {
  ensureDb();
  const result = await db.execute({ sql, args: params });
  return toRows(result);
}

// exec: run multiple statements separated by semicolons
async function exec(sql) {
  ensureDb();
  // libsql client requires statements one at a time
  const stmts = sql
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of stmts) {
    await db.execute(stmt);
  }
}

async function listSaves() {
  return all(
    "SELECT id, room_id, created_at, saved_by FROM saves ORDER BY created_at DESC"
  );
}

async function listSavesByUser(userId) {
  return all(
    "SELECT id, room_id, created_at, saved_by FROM saves WHERE saved_by = ? ORDER BY created_at DESC, id DESC",
    [userId]
  );
}

async function initDatabase() {
  if (db) return db;

  const url = process.env.TURSO_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_URL env var is required");

  db = createClient({ url, authToken });

  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_in_team TEXT NOT NULL DEFAULT 'viewer',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT UNIQUE NOT NULL,
      name TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      nodes TEXT NOT NULL,
      edges TEXT NOT NULL,
      saved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (saved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      node_id TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(token_hash)
    );

    CREATE TABLE IF NOT EXISTS ai_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent TEXT NOT NULL,
      input TEXT,
      output TEXT NOT NULL,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_saves_room_created_at ON saves(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_examples_intent_created_at ON ai_examples(intent, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_team_members_team_user ON team_members(team_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_room_created_at ON comments(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_resets_user_expires ON password_resets(user_id, expires_at DESC);

    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at DATETIME,
      created_by INTEGER,
      single_use INTEGER DEFAULT 0,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_invites_room ON invites(room_id);

    CREATE TABLE IF NOT EXISTS room_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role_in_room TEXT NOT NULL DEFAULT 'viewer',
      approved_by INTEGER,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(room_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_members_room_user ON room_members(room_id, user_id);
  `);

  // Lightweight migrations
  // Ensure rooms.public exists (used for approved/online maps)
  try {
    await run("ALTER TABLE rooms ADD COLUMN public INTEGER DEFAULT 0");
  } catch (_e) {
    // ignore if column already exists
  }

  // Optional room metadata
  try {
    await run("ALTER TABLE rooms ADD COLUMN description TEXT");
  } catch (_e) {
    // ignore
  }
  try {
    await run("ALTER TABLE rooms ADD COLUMN tags TEXT");
  } catch (_e) {
    // ignore
  }

  // Teams support: optional team_id attached to room
  try {
    await run("ALTER TABLE rooms ADD COLUMN team_id INTEGER");
  } catch (_e) {
    // ignore
  }

  try {
    await run("ALTER TABLE rooms ADD COLUMN approval_status TEXT DEFAULT 'pending'");
  } catch (_e) {
    // ignore
  }

  await run("UPDATE rooms SET approval_status = 'approved' WHERE public = 1 AND (approval_status IS NULL OR approval_status = '')");
  await run("UPDATE rooms SET approval_status = 'pending' WHERE public = 0 AND (approval_status IS NULL OR approval_status = '')");

  await run("CREATE INDEX IF NOT EXISTS idx_rooms_public ON rooms(public)");
  await run("CREATE INDEX IF NOT EXISTS idx_rooms_team_id ON rooms(team_id)");

  return db;
}

async function updateUserProfile(userId, { username } = {}) {
  const safeUsername = username == null ? null : String(username).trim().slice(0, 60);
  return run("UPDATE users SET username = ? WHERE id = ?", [safeUsername, userId]);
}

async function updateUserPasswordHash(userId, passwordHash) {
  const safeHash = String(passwordHash || "");
  if (!safeHash) throw new Error("password hash required");
  return run("UPDATE users SET password_hash = ? WHERE id = ?", [safeHash, userId]);
}

async function insertTeam(name, ownerId, description = null) {
  const safeName = String(name || "").trim().slice(0, 80);
  if (!safeName) throw new Error("team name required");
  const safeDesc = description == null ? null : String(description).trim().slice(0, 500);
  return run(
    "INSERT INTO teams (name, owner_id, description, created_at) VALUES (?, ?, ?, ?)",
    [safeName, ownerId, safeDesc, toSofiaSqlString()]
  );
}

async function getTeamById(teamId) {
  return get("SELECT * FROM teams WHERE id = ?", [teamId]);
}

async function addTeamMember(teamId, userId, roleInTeam = "viewer") {
  const role = String(roleInTeam || "viewer").toLowerCase();
  const safeRole = ["owner", "editor", "viewer"].includes(role) ? role : "viewer";
  return run(
    "INSERT OR IGNORE INTO team_members (team_id, user_id, role_in_team, joined_at) VALUES (?, ?, ?, ?)",
    [teamId, userId, safeRole, toSofiaSqlString()]
  );
}

async function setTeamMemberRole(teamId, userId, roleInTeam) {
  const role = String(roleInTeam || "viewer").toLowerCase();
  const safeRole = ["owner", "editor", "viewer"].includes(role) ? role : "viewer";
  return run(
    "UPDATE team_members SET role_in_team = ? WHERE team_id = ? AND user_id = ?",
    [safeRole, teamId, userId]
  );
}

async function removeTeamMember(teamId, userId) {
  return run("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]);
}

async function getTeamMember(teamId, userId) {
  return get(
    "SELECT team_id, user_id, role_in_team, joined_at FROM team_members WHERE team_id = ? AND user_id = ?",
    [teamId, userId]
  );
}

async function listTeamMembers(teamId) {
  return all(
    `
      SELECT
        tm.user_id,
        tm.role_in_team,
        tm.joined_at,
        u.email,
        u.username
      FROM team_members tm
      LEFT JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY tm.role_in_team ASC, tm.joined_at ASC
    `,
    [teamId]
  );
}

async function listTeamsForUser(userId) {
  return all(
    `
      SELECT
        t.id,
        t.name,
        t.description,
        t.owner_id,
        t.created_at,
        tm.role_in_team
      FROM team_members tm
      INNER JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
      ORDER BY t.created_at DESC, t.id DESC
    `,
    [userId]
  );
}

async function updateRoomTeam(roomId, teamId) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("room required");
  const tid = teamId == null ? null : Number(teamId);
  if (tid != null && (!Number.isFinite(tid) || tid <= 0)) throw new Error("invalid teamId");
  return run("UPDATE rooms SET team_id = ? WHERE room_id = ?", [tid, rid]);
}

async function insertComment(roomId, userId, nodeId, content) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("room required");
  const txt = String(content || "").trim().slice(0, 2000);
  if (!txt) throw new Error("content required");
  const nid = nodeId == null ? null : String(nodeId).trim().slice(0, 120);
  return run(
    "INSERT INTO comments (room_id, user_id, node_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    [rid, userId, nid, txt, toSofiaSqlString()]
  );
}

async function listCommentsForRoom(roomId, limit = 200) {
  const rid = String(roomId || "").trim();
  if (!rid) return [];
  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.max(1, Math.min(500, lim)) : 200;
  return all(
    `
      SELECT
        c.id,
        c.room_id,
        c.node_id,
        c.content,
        c.created_at,
        c.user_id,
        u.email AS user_email,
        u.username AS user_username
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.room_id = ?
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ?
    `,
    [rid, safeLimit]
  );
}

async function getCommentById(id) {
  return get(
    "SELECT id, room_id, user_id, node_id, content, created_at FROM comments WHERE id = ?",
    [id]
  );
}

async function deleteCommentById(id) {
  return run("DELETE FROM comments WHERE id = ?", [id]);
}

async function insertLog(userId, action, details = null, ip = null) {
  const safeAction = String(action || "").trim().slice(0, 80);
  if (!safeAction) throw new Error("action required");
  const safeUserId = userId == null ? null : Number(userId);
  const safeDetails = details == null ? null : JSON.stringify(details);
  const safeIp = ip == null ? null : String(ip).slice(0, 80);
  return run(
    "INSERT INTO logs (user_id, action, details, ip, created_at) VALUES (?, ?, ?, ?, ?)",
    [safeUserId, safeAction, safeDetails, safeIp, toSofiaSqlString()]
  );
}

async function listLogs({ limit = 200, userId = null, action = null } = {}) {
  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.max(1, Math.min(500, lim)) : 200;

  const where = [];
  const params = [];
  if (userId != null) {
    where.push("l.user_id = ?");
    params.push(Number(userId));
  }
  if (action) {
    where.push("l.action = ?");
    params.push(String(action));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return all(
    `
      SELECT
        l.id,
        l.user_id,
        l.action,
        l.details,
        l.ip,
        l.created_at,
        u.email AS user_email,
        u.username AS user_username
      FROM logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${whereSql}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ?
    `,
    [...params, safeLimit]
  );
}

async function insertPasswordReset(userId, tokenHash, expiresAtIso) {
  const safeHash = String(tokenHash || "").trim();
  const safeExpires = String(expiresAtIso || "").trim();
  if (!safeHash) throw new Error("token hash required");
  if (!safeExpires) throw new Error("expires required");
  return run(
    "INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [userId, safeHash, safeExpires, toSofiaSqlString()]
  );
}

async function getPasswordResetByHash(tokenHash) {
  return get(
    "SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM password_resets WHERE token_hash = ?",
    [String(tokenHash)]
  );
}

async function markPasswordResetUsed(id) {
  return run("UPDATE password_resets SET used_at = ? WHERE id = ?", [toSofiaSqlString(), id]);
}

async function insertUser(email, username, passwordHash, role = "user") {
  return run(
    "INSERT INTO users (email, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    [email, username, passwordHash, role, toSofiaSqlString()]
  );
}

async function getUserByEmail(email) {
  return get("SELECT * FROM users WHERE email = ?", [email]);
}

async function getUserById(id) {
  return get("SELECT * FROM users WHERE id = ?", [id]);
}

async function listUsers() {
  return all(
    "SELECT id, email, username, role, created_at FROM users ORDER BY created_at DESC"
  );
}

async function insertRoom(roomId, name, createdBy) {
  return run(
    "INSERT OR IGNORE INTO rooms (room_id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
    [roomId, name, createdBy, toSofiaSqlString()]
  );
}

async function getRoomById(roomId) {
  return get("SELECT * FROM rooms WHERE room_id = ?", [roomId]);
}

async function listRooms() {
  return all(
    "SELECT id, room_id, name, created_by, created_at FROM rooms ORDER BY created_at DESC"
  );
}

async function listPublicRooms(limit = 200) {
  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.max(1, Math.min(500, lim)) : 200;
  return all(
    `
      SELECT
        r.room_id,
        r.name,
        r.description,
        r.tags,
        r.created_at,
        r.created_by,
        u.email AS created_by_email,
        u.username AS created_by_username,
        (
          SELECT COUNT(1) FROM saves s
          WHERE s.room_id = r.room_id
        ) AS saves_count,
        (
          SELECT MAX(created_at) FROM saves s
          WHERE s.room_id = r.room_id
        ) AS last_saved_at
      FROM rooms r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.public = 1
      ORDER BY (last_saved_at IS NULL) ASC, last_saved_at DESC, r.created_at DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

async function updateRoomMeta(roomId, name, description, tags) {
  return run(
    "UPDATE rooms SET name = ?, description = ?, tags = ? WHERE room_id = ?",
    [name ?? null, description ?? null, tags ?? null, roomId]
  );
}

async function insertSave(roomId, nodes, edges, savedBy) {
  return run(
    "INSERT INTO saves (room_id, nodes, edges, saved_by, created_at) VALUES (?, ?, ?, ?, ?)",
    [roomId, nodes, edges, savedBy, toSofiaSqlString()]
  );
}

async function getLatestSave(roomId) {
  return get(
    "SELECT * FROM saves WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [roomId]
  );
}

async function listSavesForRoom(roomId, limit = 50) {
  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.max(1, Math.min(200, lim)) : 50;
  return all(
    "SELECT id, room_id, saved_by, created_at FROM saves WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [roomId, safeLimit]
  );
}

async function getSaveContentById(id) {
  return get(
    "SELECT id, room_id, nodes, edges, saved_by, created_at FROM saves WHERE id = ?",
    [id]
  );
}

async function getSaveById(id) {
  return get(
    "SELECT id, room_id, saved_by, created_at FROM saves WHERE id = ?",
    [id]
  );
}

async function deleteSaveById(id) {
  return run("DELETE FROM saves WHERE id = ?", [id]);
}

async function listAiExamples(intent, limit = 20) {
  const safeIntent = (intent || "").toString().trim();
  if (!safeIntent) return [];

  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.max(1, Math.min(50, lim)) : 20;

  return all(
    "SELECT id, intent, input, output, tags, created_at FROM ai_examples WHERE intent = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [safeIntent, safeLimit]
  );
}

async function insertAiExample(intent, input, output, tags = null) {
  const safeIntent = (intent || "").toString().trim();
  if (!safeIntent) throw new Error("intent required");

  const safeInput = input == null ? null : String(input);
  const safeOutput = String(output ?? "");
  if (!safeOutput.trim()) throw new Error("output required");
  const safeTags = tags == null ? null : String(tags);

  return run(
    "INSERT INTO ai_examples (intent, input, output, tags, created_at) VALUES (?, ?, ?, ?, ?)",
    [safeIntent, safeInput, safeOutput, safeTags, toSofiaSqlString()]
  );
}

async function deleteAiExampleById(id) {
  return run("DELETE FROM ai_examples WHERE id = ?", [id]);
}

async function countAiExamples() {
  const row = await get("SELECT COUNT(1) AS cnt FROM ai_examples");
  return Number(row?.cnt || 0);
}

// Invites
async function insertInvite(token, roomId, role, expiresAtIso = null, createdBy = null, singleUse = 0) {
  const t = String(token || '').trim();
  const rid = String(roomId || '').trim();
  const r = String(role || 'viewer').toLowerCase();
  if (!t) throw new Error('token required');
  if (!rid) throw new Error('room required');
  const safeSingle = singleUse ? 1 : 0;
  return run(
    'INSERT INTO invites (token, room_id, role, expires_at, created_by, single_use, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [t, rid, r, expiresAtIso || null, createdBy == null ? null : Number(createdBy), safeSingle, toSofiaSqlString()]
  );
}

async function getInviteByToken(token) {
  if (!token) return null;
  return get('SELECT token, room_id, role, expires_at, created_by, single_use, used_at, created_at FROM invites WHERE token = ?', [String(token)]);
}

async function deleteInviteByToken(token) {
  if (!token) return null;
  return run('DELETE FROM invites WHERE token = ?', [String(token)]);
}

async function markInviteUsed(token) {
  if (!token) return null;
  return run('UPDATE invites SET used_at = ? WHERE token = ?', [toSofiaSqlString(), String(token)]);
}

async function getRoomMember(roomId, userId) {
  return get(
    'SELECT room_id, user_id, role_in_room, approved_by, approved_at, created_at FROM room_members WHERE room_id = ? AND user_id = ?',
    [String(roomId), Number(userId)]
  );
}

async function upsertRoomMemberRole(roomId, userId, roleInRoom = 'viewer', approvedBy = null) {
  const role = String(roleInRoom || 'viewer').toLowerCase();
  const safeRole = ['owner', 'editor', 'viewer'].includes(role) ? role : 'viewer';
  const approver = approvedBy == null ? null : Number(approvedBy);
  return run(
    `
      INSERT INTO room_members (room_id, user_id, role_in_room, approved_by, approved_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, user_id)
      DO UPDATE SET
        role_in_room = excluded.role_in_room,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at
    `,
    [String(roomId), Number(userId), safeRole, approver, toSofiaSqlString(), toSofiaSqlString()]
  );
}

async function deleteRoomMember(roomId, userId) {
  return run(
    'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
    [String(roomId), Number(userId)]
  );
}

module.exports = {
  initDatabase,
  // low-level helpers (used by admin routes)
  run,
  get,
  all,
  exec,
  insertUser,
  getUserByEmail,
  getUserById,
  listUsers,
  updateUserProfile,
  updateUserPasswordHash,
  insertRoom,
  getRoomById,
  listRooms,
  listPublicRooms,
  updateRoomMeta,
  updateRoomTeam,
  insertSave,
  getLatestSave,
  listSaves,
  listSavesByUser,
  listSavesForRoom,
  getSaveContentById,
  getSaveById,
  deleteSaveById,

  // Teams
  insertTeam,
  getTeamById,
  listTeamsForUser,
  addTeamMember,
  setTeamMemberRole,
  removeTeamMember,
  getTeamMember,
  listTeamMembers,

  // Comments
  insertComment,
  listCommentsForRoom,
  getCommentById,
  deleteCommentById,

  // Logs
  insertLog,
  listLogs,

  // Password reset
  insertPasswordReset,
  getPasswordResetByHash,
  markPasswordResetUsed,

  // AI examples (few-shot training)
  listAiExamples,
  insertAiExample,
  deleteAiExampleById,
  countAiExamples,
  // Invites
  insertInvite,
  getInviteByToken,
  deleteInviteByToken,
  markInviteUsed,
  // Room members
  getRoomMember,
  upsertRoomMemberRole,
  deleteRoomMember,
};
