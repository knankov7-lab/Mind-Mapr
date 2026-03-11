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
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "mindmapr.db");
let db;

function ensureDb() {
  if (!db) throw new Error("Database not initialized");
}

function run(sql, params = []) {
  ensureDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  ensureDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  ensureDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function exec(sql) {
  ensureDb();
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function initDatabase() {
  if (db) return db;

  db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      resolve(connection);
    });
  });

  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA foreign_keys = ON");

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
    "INSERT INTO teams (name, owner_id, description) VALUES (?, ?, ?)",
    [safeName, ownerId, safeDesc]
  );
}

async function getTeamById(teamId) {
  return get("SELECT * FROM teams WHERE id = ?", [teamId]);
}

async function addTeamMember(teamId, userId, roleInTeam = "viewer") {
  const role = String(roleInTeam || "viewer").toLowerCase();
  const safeRole = ["owner", "editor", "viewer"].includes(role) ? role : "viewer";
  return run(
    "INSERT OR IGNORE INTO team_members (team_id, user_id, role_in_team) VALUES (?, ?, ?)",
    [teamId, userId, safeRole]
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
    "INSERT INTO comments (room_id, user_id, node_id, content) VALUES (?, ?, ?, ?)",
    [rid, userId, nid, txt]
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
    "INSERT INTO logs (user_id, action, details, ip) VALUES (?, ?, ?, ?)",
    [safeUserId, safeAction, safeDetails, safeIp]
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
    "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, safeHash, safeExpires]
  );
}

async function getPasswordResetByHash(tokenHash) {
  return get(
    "SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM password_resets WHERE token_hash = ?",
    [String(tokenHash)]
  );
}

async function markPasswordResetUsed(id) {
  return run("UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
}

async function insertUser(email, username, passwordHash, role = "user") {
  return run(
    "INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, username, passwordHash, role]
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
    "INSERT OR IGNORE INTO rooms (room_id, name, created_by) VALUES (?, ?, ?)",
    [roomId, name, createdBy]
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
    "INSERT INTO saves (room_id, nodes, edges, saved_by) VALUES (?, ?, ?, ?)",
    [roomId, nodes, edges, savedBy]
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
    "INSERT INTO ai_examples (intent, input, output, tags) VALUES (?, ?, ?, ?)",
    [safeIntent, safeInput, safeOutput, safeTags]
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
    'INSERT INTO invites (token, room_id, role, expires_at, created_by, single_use) VALUES (?, ?, ?, ?, ?, ?)',
    [t, rid, r, expiresAtIso || null, createdBy == null ? null : Number(createdBy), safeSingle]
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
  return run('UPDATE invites SET used_at = CURRENT_TIMESTAMP WHERE token = ?', [String(token)]);
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
};
