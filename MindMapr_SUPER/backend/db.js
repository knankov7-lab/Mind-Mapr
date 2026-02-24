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

    CREATE INDEX IF NOT EXISTS idx_saves_room_created_at ON saves(room_id, created_at DESC);
  `);

  return db;
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

module.exports = {
  initDatabase,
  insertUser,
  getUserByEmail,
  getUserById,
  listUsers,
  insertRoom,
  getRoomById,
  listRooms,
  insertSave,
  getLatestSave,
};
