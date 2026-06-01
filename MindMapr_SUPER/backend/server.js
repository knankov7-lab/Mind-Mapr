const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createServerPerformanceMonitor } = require("./perfMonitor");
const { toSofiaSqlString } = require("./time");
const {
  authMiddleware,
  requireAuth,
  requireAdmin,
  register,
  login,
  hashPassword,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
  verifyToken,
  isAdminRole,
  isAdminUserLike,
} = require("./auth");
// AI seeding removed
const {
  initDatabase,
  run,
  get,
  all,
  insertRoom,
  insertSave,
  getLatestSave,
  listSaves,
  listSavesByUser,
  getSaveById,
  deleteSaveById,
  listPublicRooms,

  getRoomById,
  updateRoomMeta,
  updateRoomTeam,
  listSavesForRoom,
  getSaveContentById,

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

  // Room members
  getRoomMember,
  upsertRoomMemberRole,
  deleteRoomMember,

  getUserById,
  getUserByEmail,
  insertUser,
  listUsers,
  listRooms,
} = require("./db");

const app = express();

// Respect X-Forwarded-For when running behind a reverse proxy so rate limits
// are applied per real client IP, not per proxy IP.
const trustProxyRaw = String(process.env.TRUST_PROXY || "1").trim().toLowerCase();
if (trustProxyRaw === "true" || trustProxyRaw === "1") {
  app.set("trust proxy", 1);
} else if (trustProxyRaw === "false" || trustProxyRaw === "0") {
  app.set("trust proxy", false);
} else {
  const parsedTrustProxy = Number(trustProxyRaw);
  app.set("trust proxy", Number.isFinite(parsedTrustProxy) ? parsedTrustProxy : 1);
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));

const perfMonitor = createServerPerformanceMonitor({
  maxLatencySamples: 4000,
  maxRecentSamples: 5000,
  recentWindowMs: 60000,
  maxEndpoints: 300,
});
app.locals.getServerPerformanceSnapshot = perfMonitor.getSnapshot;
app.use(perfMonitor.middleware);

// Health / keep-alive endpoint
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use(authMiddleware);

const SETTINGS_TTL_MS = 5000;
let settingsCache = { at: 0, data: null };

function parseBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseIntSafe(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

async function getRuntimeSettings() {
  const now = Date.now();
  if (settingsCache.data && now - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.data;
  }

  const rows = await all("SELECT key, value FROM settings");
  const raw = {};
  for (const row of rows || []) {
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      raw[row.key] = row.value;
    }
  }

  const data = {
    maintenanceMode: parseBool(raw.maintenanceMode, false),
    enableLogging: parseBool(raw.enableLogging, true),
    publicMapsApproval: parseBool(raw.publicMapsApproval, true),
    maxNodesPerMap: Math.max(10, parseIntSafe(raw.maxNodesPerMap, 1000)),
    maxRoomUsers: Math.max(1, parseIntSafe(raw.maxRoomUsers, 50)),
    maxSavesPerUser: Math.max(1, parseIntSafe(raw.maxSavesPerUser, 100)),
    theme: String(raw.theme || "dark").toLowerCase() === "light" ? "light" : "dark",
    lang: String(raw.lang || "bg").toLowerCase(),
  };

  settingsCache = { at: now, data };
  return data;
}

app.use(async (req, res, next) => {
  try {
    const settings = await getRuntimeSettings();
    if (!settings.maintenanceMode) return next();

    const isHealth = req.path === "/api/health";
    const isPublicSettings = req.path === "/api/settings/public";
    const isAdmin = !!req.user && isAdminUser(req);
    if (isHealth || isPublicSettings || isAdmin) return next();

    return res.status(503).json({ error: "System is in maintenance mode" });
  } catch {
    return next();
  }
});

async function logAction(req, action, details) {
  try {
    const settings = await getRuntimeSettings();
    if (!settings.enableLogging) return;
    await insertLog(req.user?.id ?? null, action, details ?? null, req.ip);
  } catch {
    // ignore logging failures
  }
}

function isAdminUser(req) {
  return isAdminUserLike(req.user);
}

async function canAccessRoom(req, roomId, { allowPublicRead = false } = {}) {
  const rm = await getRoomById(roomId);
  if (!rm) return { ok: false, status: 404, error: "room not found", room: null };

  const isPublic = Number(rm.public || 0) === 1;
  const admin = !!req.user && isAdminUser(req);
  const owner = !!req.user && Number(rm.created_by) === Number(req.user.id);

  if (allowPublicRead && isPublic) return { ok: true, room: rm, role: "public" };
  if (!req.user) return { ok: false, status: 401, error: "Authentication required", room: rm };
  if (admin || owner) return { ok: true, room: rm, role: admin ? String(req.user.role || 'admin').toLowerCase() : "owner" };

  const teamId = rm.team_id;
  if (teamId != null) {
    const member = await getTeamMember(Number(teamId), Number(req.user.id));
    if (member) return { ok: true, room: rm, role: member.role_in_team };
  }

  const roomMember = await getRoomMember(roomId, req.user.id);
  if (roomMember) return { ok: true, room: rm, role: roomMember.role_in_room };

  return { ok: false, status: 403, error: "forbidden", room: rm };
}

async function accessForRoomAndUser(roomId, user, { allowPublicRead = false } = {}) {
  const rm = await getRoomById(roomId);
  if (!rm) return { ok: false, status: 404, error: 'room not found', room: null };

  const isPublic = Number(rm.public || 0) === 1;
  const isAdmin = !!user && isAdminRole(user.role);
  const isOwner = !!user && Number(rm.created_by) === Number(user.id);
  if (allowPublicRead && isPublic && !user) {
    return { ok: true, room: rm, role: 'public', canWrite: false, canRead: true };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Authentication required', room: rm };
  }
  if (isAdmin) return { ok: true, room: rm, role: String(user.role || 'admin').toLowerCase(), canWrite: true, canRead: true };
  if (isOwner) return { ok: true, room: rm, role: 'owner', canWrite: true, canRead: true };

  const teamId = rm.team_id;
  if (teamId != null) {
    const member = await getTeamMember(Number(teamId), Number(user.id));
    if (!member) return { ok: false, status: 403, error: 'forbidden', room: rm };
    const role = String(member.role_in_team || 'viewer');
    const canWrite = role === 'owner' || role === 'editor';
    return { ok: true, room: rm, role, canWrite, canRead: true };
  }

  const roomMember = await getRoomMember(roomId, user.id);
  if (roomMember) {
    const role = String(roomMember.role_in_room || 'viewer');
    const canWrite = role === 'owner' || role === 'editor';
    return { ok: true, room: rm, role, canWrite, canRead: true };
  }

  return { ok: false, status: 403, error: 'forbidden', room: rm };
}

async function canUserApproveRoomRequests(roomInfo, user) {
  if (!roomInfo || !user) return false;

  const isAdmin = isAdminRole(user.role);
  if (isAdmin) return true;

  const userId = Number(user.id);
  if (!Number.isFinite(userId)) return false;

  if (Number(roomInfo.created_by) === userId) return true;

  if (roomInfo.team_id != null) {
    const teamMember = await getTeamMember(Number(roomInfo.team_id), userId);
    if (teamMember && String(teamMember.role_in_team || '').toLowerCase() === 'owner') return true;
  }

  const roomMember = await getRoomMember(roomInfo.room_id, userId);
  if (roomMember && String(roomMember.role_in_room || '').toLowerCase() === 'owner') return true;

  return false;
}

async function getRoomApproverUserIds(roomInfo) {
  if (!roomInfo) return [];
  const ids = new Set();

  const creatorId = Number(roomInfo.created_by);
  if (Number.isFinite(creatorId)) ids.add(creatorId);

  const roomOwners = await all(
    'SELECT user_id FROM room_members WHERE room_id = ? AND role_in_room = ?',
    [String(roomInfo.room_id), 'owner']
  );
  for (const row of roomOwners || []) {
    const id = Number(row?.user_id);
    if (Number.isFinite(id)) ids.add(id);
  }

  if (roomInfo.team_id != null) {
    const teamOwners = await all(
      'SELECT user_id FROM team_members WHERE team_id = ? AND role_in_team = ?',
      [Number(roomInfo.team_id), 'owner']
    );
    for (const row of teamOwners || []) {
      const id = Number(row?.user_id);
      if (Number.isFinite(id)) ids.add(id);
    }
  }

  return Array.from(ids);
}

// Списък с всички карти (saves)
app.get("/api/maps/list", requireAuth, async (req, res) => {
  try {
    const saves = await listSavesByUser(req.user.id);
    res.json({ saves });
  } catch (err) {
    res.status(500).json({ error: "List failed" });
  }
});

// Изтриване на карта (save) по id
app.delete("/api/maps/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const save = await getSaveById(id);
    if (!save) return res.status(404).json({ error: "not found" });

    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    const isOwner = Number(save.saved_by) === Number(req.user?.id);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: "forbidden" });
    }

    const result = await deleteSaveById(id);
    return res.json({ ok: true, deleted: result.changes || 0 });
  } catch (_err) {
    return res.status(500).json({ error: "Delete failed" });
  }
});

const guestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Too many requests from this IP, please try again later." },
  skip: (req) => !!req.user,
});

// Публични (одобрени) карти/стаи - достъпни без вход
app.get("/api/maps/public", guestLimiter, async (req, res) => {
  try {
    const limit = req.query.limit;
    const rooms = await listPublicRooms(limit);
    res.json({ rooms });
  } catch (_err) {
    res.status(500).json({ error: "Public list failed" });
  }
});

// История на записите (версии) за стая
app.get("/api/maps/history", requireAuth, async (req, res) => {
  const room = (req.query.room || "").toString().trim();
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    const access = await canAccessRoom(req, room, { allowPublicRead: false });
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const limit = req.query.limit;
    const saves = await listSavesForRoom(room, limit);
    res.json({ room, saves });
  } catch (_err) {
    res.status(500).json({ error: "History failed" });
  }
});

// Зареждане на конкретна версия (save) по id
app.get("/api/maps/load-save", requireAuth, async (req, res) => {
  const id = Number(req.query.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "id required" });

  try {
    const save = await getSaveContentById(id);
    if (!save) return res.status(404).json({ error: "not found" });

    const access = await canAccessRoom(req, save.room_id, { allowPublicRead: false });
    const isSaver = Number(save.saved_by) === Number(req.user.id);
    if (!access.ok && !isSaver) return res.status(access.status).json({ error: access.error });

    res.json({
      id: save.id,
      room: save.room_id,
      created_at: save.created_at,
      nodes: JSON.parse(save.nodes),
      edges: JSON.parse(save.edges),
    });
  } catch (_err) {
    res.status(500).json({ error: "Load save failed" });
  }
});

// Room metadata (name/description/tags)
app.get("/api/rooms/meta", guestLimiter, async (req, res) => {
  const room = (req.query.room || "").toString().trim();
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    const access = await canAccessRoom(req, room, { allowPublicRead: true });
    if (!access.ok) {
      return res.json({
        room_id: room,
        name: "",
        description: "",
        tags: "",
        public: 0,
        team_id: null,
        created_by: null,
        created_at: null,
      });
    }
    const rm = access.room;

    res.json({
      room_id: rm.room_id,
      name: rm.name,
      description: rm.description,
      tags: rm.tags,
      public: rm.public,
      team_id: rm.team_id,
      created_by: rm.created_by,
      created_at: rm.created_at,
    });
  } catch (_err) {
    res.status(500).json({ error: "Meta load failed" });
  }
});

app.put("/api/rooms/meta", requireAuth, async (req, res) => {
  const { room, name, description, tags } = req.body || {};
  const roomId = (room || "").toString().trim();
  if (!roomId) return res.status(400).json({ error: "room required" });

  try {
    const access = await canAccessRoom(req, roomId, { allowPublicRead: false });
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const isAdmin = isAdminUser(req);
    const isOwner = Number(access.room.created_by) === Number(req.user.id);
    const isEditor = String(access.role) === 'editor' || String(access.role) === 'owner';
    if (!isAdmin && !isOwner && !isEditor) return res.status(403).json({ error: "forbidden" });

    const nextName = typeof name === "string" ? name.trim().slice(0, 80) : null;
    const nextDesc = typeof description === "string" ? description.trim().slice(0, 500) : null;
    const nextTags = typeof tags === "string" ? tags.trim().slice(0, 500) : null;

    await updateRoomMeta(roomId, nextName, nextDesc, nextTags);
    await logAction(req, 'room_meta_update', { room: roomId, name: nextName, tags: nextTags });
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: "Meta update failed" });
  }
});

app.post("/api/rooms/request-publish", requireAuth, async (req, res) => {
  const room = (req.body?.room || "").toString().trim();
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    const access = await canAccessRoom(req, room, { allowPublicRead: false });
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const canWrite =
      isAdminUser(req) || String(access.role) === "owner" || String(access.role) === "editor";
    if (!canWrite) return res.status(403).json({ error: "forbidden" });

    await run(
      "UPDATE rooms SET public = 0, approval_status = 'pending' WHERE room_id = ?",
      [room]
    );
    await logAction(req, "room_publish_request", { room });
    return res.json({ ok: true, room, approval_status: "pending" });
  } catch (_err) {
    return res.status(500).json({ error: "Publish request failed" });
  }
});

const roomState = new Map();

app.get("/api/health", async (req, res) => {
  try {
    await get("SELECT 1 AS ok");

    const userInfo = req.user
      ? { id: req.user.id, email: req.user.email, role: req.user.role }
      : null;

    res.json({
      ok: true,
      service: "MindMapr API",
      database: "turso",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: toSofiaSqlString(),
      user: userInfo,
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      service: "MindMapr API",
      database: "turso",
      timestamp: toSofiaSqlString(),
      error: err?.message || "database unavailable",
    });
  }
});

app.get("/api/settings/public", async (_req, res) => {
  try {
    const settings = await getRuntimeSettings();
    res.json({ theme: settings.theme, lang: settings.lang });
  } catch (_err) {
    res.json({ theme: "dark", lang: "bg" });
  }
});

app.post("/api/auth/register", register);
app.post("/api/auth/login", login);
app.put("/api/auth/profile", requireAuth, updateProfile);
app.post("/api/auth/change-password", requireAuth, changePassword);
app.post("/api/auth/request-reset", guestLimiter, requestPasswordReset);
app.post("/api/auth/reset-password", guestLimiter, resetPassword);

app.post("/api/maps/save", requireAuth, async (req, res) => {
  const { room, nodes, edges, teamId } = req.body || {};
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    const settings = await getRuntimeSettings();
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const safeEdges = Array.isArray(edges) ? edges : [];

    if (safeNodes.length > settings.maxNodesPerMap) {
      return res.status(400).json({ error: `max nodes exceeded (${settings.maxNodesPerMap})` });
    }

    const userSaves = await listSavesByUser(req.user.id);
    if (Array.isArray(userSaves) && userSaves.length >= settings.maxSavesPerUser) {
      return res.status(400).json({ error: `max saves per user exceeded (${settings.maxSavesPerUser})` });
    }

    const roomId = String(room);

    // If room exists and is team-bound, enforce membership.
    const existingRoom = await getRoomById(roomId);
    if (existingRoom?.team_id != null) {
      const access = await canAccessRoom(req, roomId, { allowPublicRead: false });
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      const canWrite = isAdminUser(req) || String(access.role) === 'owner' || String(access.role) === 'editor';
      if (!canWrite) return res.status(403).json({ error: 'forbidden' });
    }

    await insertRoom(roomId, null, req.user.id);

    // Auto-approve when manual review is disabled.
    if (!settings.publicMapsApproval) {
      await run("UPDATE rooms SET public = 1, approval_status = 'approved' WHERE room_id = ?", [roomId]);
    } else {
      await run("UPDATE rooms SET approval_status = COALESCE(NULLIF(approval_status, ''), 'pending') WHERE room_id = ?", [roomId]);
    }

    // Optionally attach a team to the room on first save
    const tid = teamId == null ? null : Number(teamId);
    if (tid != null && Number.isFinite(tid) && tid > 0) {
      const member = await getTeamMember(tid, req.user.id);
      if (!member && !isAdminUser(req)) {
        return res.status(403).json({ error: 'not a team member' });
      }
      const rm = await getRoomById(roomId);
      if (rm && rm.team_id == null) {
        await updateRoomTeam(roomId, tid);
      }
    }

    await insertSave(
      roomId,
      JSON.stringify(safeNodes),
      JSON.stringify(safeEdges),
      req.user.id
    );
    await logAction(req, 'map_save', { room: roomId, nodes: safeNodes.length, edges: safeEdges.length });
    return res.json({ ok: true });
  } catch (_err) {
    return res.status(500).json({ error: "Save failed" });
  }
});

app.get("/api/maps/load", guestLimiter, async (req, res) => {
  const room = req.query.room;
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    const roomId = String(room);
    const access = await canAccessRoom(req, roomId, { allowPublicRead: true });
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const save = await getLatestSave(roomId);
    if (!save) return res.status(404).json({ error: "not found" });
    await logAction(req, 'map_load', { room: roomId });
    return res.json({
      room: save.room_id,
      nodes: JSON.parse(save.nodes),
      edges: JSON.parse(save.edges),
    });
  } catch (_err) {
    return res.status(500).json({ error: "Load failed" });
  }
});

// Teams API
app.post('/api/teams', requireAuth, async (req, res) => {
  const { name, description } = req.body || {};
  try {
    const r = await insertTeam(name, req.user.id, description ?? null);
    await addTeamMember(r.lastID, req.user.id, 'owner');
    await logAction(req, 'team_create', { teamId: r.lastID, name: String(name || '').trim() });
    const team = await getTeamById(r.lastID);
    res.json({ ok: true, team });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to create team' });
  }
});

app.get('/api/teams', requireAuth, async (req, res) => {
  try {
    const teams = await listTeamsForUser(req.user.id);
    res.json({ teams });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

app.get('/api/teams/:id/members', requireAuth, async (req, res) => {
  const teamId = Number(req.params.id);
  if (!Number.isFinite(teamId) || teamId <= 0) return res.status(400).json({ error: 'invalid team id' });
  try {
    const member = await getTeamMember(teamId, req.user.id);
    if (!member && !isAdminUser(req)) return res.status(403).json({ error: 'forbidden' });
    const members = await listTeamMembers(teamId);
    res.json({ teamId, members });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to list members' });
  }
});

app.post('/api/teams/:id/members', requireAuth, async (req, res) => {
  const teamId = Number(req.params.id);
  const { email, role } = req.body || {};
  if (!Number.isFinite(teamId) || teamId <= 0) return res.status(400).json({ error: 'invalid team id' });
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const myMember = await getTeamMember(teamId, req.user.id);
    const canManage = isAdminUser(req) || String(myMember?.role_in_team) === 'owner';
    if (!canManage) return res.status(403).json({ error: 'forbidden' });

    const u = await getUserByEmail(String(email).trim().toLowerCase());
    if (!u) return res.status(404).json({ error: 'user not found' });
    await addTeamMember(teamId, u.id, role || 'viewer');
    await logAction(req, 'team_add_member', { teamId, userId: u.id, role: role || 'viewer' });
    const members = await listTeamMembers(teamId);
    res.json({ ok: true, members });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.put('/api/teams/:id/members/:userId', requireAuth, async (req, res) => {
  const teamId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const { role } = req.body || {};
  if (!Number.isFinite(teamId) || teamId <= 0) return res.status(400).json({ error: 'invalid team id' });
  if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'invalid user id' });
  try {
    const myMember = await getTeamMember(teamId, req.user.id);
    const canManage = isAdminUser(req) || String(myMember?.role_in_team) === 'owner';
    if (!canManage) return res.status(403).json({ error: 'forbidden' });
    await setTeamMemberRole(teamId, userId, role || 'viewer');
    await logAction(req, 'team_set_role', { teamId, userId, role: role || 'viewer' });
    const members = await listTeamMembers(teamId);
    res.json({ ok: true, members });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

app.delete('/api/teams/:id/members/:userId', requireAuth, async (req, res) => {
  const teamId = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isFinite(teamId) || teamId <= 0) return res.status(400).json({ error: 'invalid team id' });
  if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'invalid user id' });
  try {
    const myMember = await getTeamMember(teamId, req.user.id);
    const canManage = isAdminUser(req) || String(myMember?.role_in_team) === 'owner';
    if (!canManage) return res.status(403).json({ error: 'forbidden' });
    await removeTeamMember(teamId, userId);
    await logAction(req, 'team_remove_member', { teamId, userId });
    const members = await listTeamMembers(teamId);
    res.json({ ok: true, members });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Attach room to team (optional)
app.put('/api/rooms/team', requireAuth, async (req, res) => {
  const { room, teamId } = req.body || {};
  const roomId = String(room || '').trim();
  const tid = Number(teamId);
  if (!roomId) return res.status(400).json({ error: 'room required' });
  if (!Number.isFinite(tid) || tid <= 0) return res.status(400).json({ error: 'invalid teamId' });
  try {
    const access = await canAccessRoom(req, roomId, { allowPublicRead: false });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const myMember = await getTeamMember(tid, req.user.id);
    const canAttach = isAdminUser(req) || String(myMember?.role_in_team) === 'owner';
    if (!canAttach) return res.status(403).json({ error: 'forbidden' });
    await updateRoomTeam(roomId, tid);
    await logAction(req, 'room_attach_team', { room: roomId, teamId: tid });
    res.json({ ok: true });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to attach team' });
  }
});

// Comments API
app.get('/api/comments', guestLimiter, async (req, res) => {
  const room = String(req.query.room || '').trim();
  if (!room) return res.status(400).json({ error: 'room required' });
  try {
    const access = await canAccessRoom(req, room, { allowPublicRead: true });
    if (!access.ok) {
      return res.json({ room, comments: [] });
    }
    const rows = await listCommentsForRoom(room, req.query.limit);
    res.json({ room, comments: rows });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

app.post('/api/comments', requireAuth, async (req, res) => {
  const { room, nodeId, content } = req.body || {};
  const roomId = String(room || '').trim();
  if (!roomId) return res.status(400).json({ error: 'room required' });
  try {
    const access = await canAccessRoom(req, roomId, { allowPublicRead: false });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    await insertComment(roomId, req.user.id, nodeId ?? null, content);
    await logAction(req, 'comment_create', { room: roomId, nodeId: nodeId ?? null });
    const rows = await listCommentsForRoom(roomId, 200);
    res.json({ ok: true, comments: rows });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to create comment' });
  }
});

app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  try {
    const c = await getCommentById(id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const access = await canAccessRoom(req, c.room_id, { allowPublicRead: false });
    const isAdmin = isAdminUser(req);
    const isOwner = access.ok && String(access.role) === 'owner';
    const isAuthor = Number(c.user_id) === Number(req.user.id);
    if (!isAdmin && !isOwner && !isAuthor) return res.status(403).json({ error: 'forbidden' });
    await deleteCommentById(id);
    await logAction(req, 'comment_delete', { room: c.room_id, commentId: id });
    res.json({ ok: true });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// AI analyze endpoint removed

const adminRouter = require('./admin');
// Generate mind map from topic
// AI endpoints removed
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });
const joinRequests = new Map();

const PORT = Number(process.env.PORT) || 3000;

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Tip: stop the other process, or run with a different port, e.g. in PowerShell: $env:PORT=3002; npm start");
    process.exit(1);
  }
  console.error("HTTP server error:", err);
  process.exit(1);
});

wss.on("error", (err) => {
  console.error("WebSocket server error:", err);
});

function getOrInitRoom(room) {
  if (!roomState.has(room)) {
    roomState.set(room, {
      nodes: [{ id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема" }, type: "default" }],
      edges: [],
      participants: [],
      chat: [],
      cursors: {},
    });
  }
  return roomState.get(room);
}

function sendToUser(userId, payload) {
  if (!Number.isFinite(Number(userId))) return;
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (Number(client.meta?.user?.id) !== Number(userId)) return;
    try {
      client.send(data);
    } catch {
      // ignore
    }
  });
}

function isUserOnline(userId) {
  if (!Number.isFinite(Number(userId))) return false;
  return Array.from(wss.clients).some(
    (client) => client.readyState === WebSocket.OPEN && Number(client.meta?.user?.id) === Number(userId)
  );
}

function getOpenClientsByUserAndRoom(userId, roomId) {
  return Array.from(wss.clients).filter((client) => {
    if (client.readyState !== WebSocket.OPEN) return false;
    if (Number(client.meta?.user?.id) !== Number(userId)) return false;
    if (String(client.meta?.room || '') !== String(roomId || '')) return false;
    return true;
  });
}

async function isProtectedRoomUser(roomInfo, userId) {
  const target = await getUserById(Number(userId));
  if (!target) return false;
  return canUserApproveRoomRequests(roomInfo, target);
}

function findPendingJoinRequest(roomId, userId) {
  for (const req of joinRequests.values()) {
    if (String(req.roomId) === String(roomId) && Number(req.requesterUserId) === Number(userId)) {
      return req;
    }
  }
  return null;
}

wss.on("connection", (ws) => {
  ws.meta = {
    room: null,
    name: "guest",
    clientId: crypto.randomBytes(6).toString('hex'),
    user: null,
    role: 'guest',
    canWrite: false,
    canRead: false,
  };

  ws.on("message", async (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch (_err) {
      return;
    }

    if (msg.type === "join") {
      const nextRoom = (msg.room || "demo").toString().trim() || 'demo';
      const token = typeof msg.token === 'string' ? msg.token.trim() : '';
      const claimedUser = token ? verifyToken(token) : null;
      if (claimedUser) ws.meta.user = claimedUser;

      // First authenticated user to open a new room becomes its owner.
      if (claimedUser) {
        try {
          const existingRoom = await getRoomById(nextRoom);
          if (!existingRoom) {
            await insertRoom(nextRoom, null, claimedUser.id);
          }
        } catch {
          // ignore room bootstrap errors and continue with access checks
        }
      }

      const inviteToken = typeof msg.invite === 'string' ? msg.invite.trim() : '';
      let invite = null;
      if (inviteToken) {
        try { invite = await getInviteByToken(inviteToken); } catch (_) { invite = null; }
      }

      let access = await accessForRoomAndUser(nextRoom, claimedUser, { allowPublicRead: true });

      // If normal access denied, but an invite token exists and is valid for this room, allow join according to invite.
      if (!access.ok && invite) {
        let expired = false;
        try { if (invite.expires_at) expired = Date.now() > new Date(invite.expires_at).getTime(); } catch (_) { expired = true; }
        const used = !!invite.used_at && Number(invite.single_use) === 1;
        if (!expired && !used && String(invite.room_id) === String(nextRoom)) {
          access = { ok: true, room: await getRoomById(nextRoom), role: invite.role, canWrite: (invite.role === 'owner' || invite.role === 'editor') };
        } else {
          invite = null;
        }
      }

      if (!access.ok) {
        const deniedRoom = access.room;
        const isForbidden = String(access.error || '') === 'forbidden';
        const isAuthedRequester = !!claimedUser && Number.isFinite(Number(claimedUser.id));

        if (isForbidden && deniedRoom && isAuthedRequester) {
          const approverIds = (await getRoomApproverUserIds(deniedRoom))
            .filter((id) => Number(id) !== Number(claimedUser.id));
          const onlineApproverIds = approverIds.filter((id) => isUserOnline(id));

          if (onlineApproverIds.length > 0) {
            const existing = findPendingJoinRequest(nextRoom, claimedUser.id);
            const reqPayload = existing || {
              requestId: crypto.randomBytes(8).toString('hex'),
              roomId: nextRoom,
              requesterUserId: Number(claimedUser.id),
              requesterEmail: claimedUser.email || null,
              requesterUsername: claimedUser.username || null,
              requesterName: String(msg.name || claimedUser.username || claimedUser.email || 'user').slice(0, 40),
              requestedAt: toSofiaSqlString(),
            };

            if (!existing) {
              joinRequests.set(reqPayload.requestId, reqPayload);
            }

            for (const approverId of onlineApproverIds) {
              sendToUser(approverId, {
                type: 'join-request',
                request: {
                  requestId: reqPayload.requestId,
                  room: reqPayload.roomId,
                  requesterUserId: reqPayload.requesterUserId,
                  requesterEmail: reqPayload.requesterEmail,
                  requesterUsername: reqPayload.requesterUsername,
                  requesterName: reqPayload.requesterName,
                  requestedAt: reqPayload.requestedAt,
                },
              });
            }

            try {
              ws.send(
                JSON.stringify({
                  type: 'join-request-pending',
                  room: nextRoom,
                  message: 'Изпратена е заявка до ръководителя на стаята. Изчакай одобрение.',
                })
              );
            } catch {}
            return;
          }
        }

        try {
          ws.send(JSON.stringify({ type: 'error', room: nextRoom, error: access.error || 'forbidden' }));
        } catch {}
        try {
          ws.send(
            JSON.stringify({
              type: 'hello',
              room: nextRoom,
              clientId: ws.meta.clientId,
              role: ws.meta.role || 'guest',
              canWrite: false,
            })
          );
        } catch {}
        return;
      }

      ws.meta.room = nextRoom;
      ws.meta.user = claimedUser;
      ws.meta.role = access.role;
      ws.meta.canWrite = !!access.canWrite;
      ws.meta.canRead = !!access.canRead;

      const safeNameFromMsg = (msg.name || "guest").toString().slice(0, 40);
      const userDisplay = claimedUser
        ? (claimedUser.username || claimedUser.email || safeNameFromMsg)
        : safeNameFromMsg;
      ws.meta.name = String(userDisplay).slice(0, 40);

      const state = getOrInitRoom(ws.meta.room);
      try {
        const settings = await getRuntimeSettings();
        const participantsCount = Array.isArray(state.participants) ? state.participants.length : 0;
        const isAdminJoin = isAdminUserLike(ws.meta.user || { role: ws.meta.role, email: null });
        if (!isAdminJoin && participantsCount >= settings.maxRoomUsers) {
          ws.send(JSON.stringify({ type: 'error', room: ws.meta.room, error: `room is full (${settings.maxRoomUsers})` }));
          return;
        }
      } catch {
        // ignore settings read errors and continue with default behavior
      }

      if (!state.participants.find((p) => p.clientId === ws.meta.clientId)) {
        state.participants.push({
          clientId: ws.meta.clientId,
          name: ws.meta.name,
          role: ws.meta.role,
          userId: claimedUser?.id ?? null,
        });
      }

      ws.send(JSON.stringify({
        type: 'hello',
        room: ws.meta.room,
        clientId: ws.meta.clientId,
        role: ws.meta.role,
        canWrite: ws.meta.canWrite,
      }));

      ws.send(JSON.stringify({ type: "state", room: ws.meta.room, nodes: state.nodes, edges: state.edges }));
      ws.send(JSON.stringify({ type: 'presence', room: ws.meta.room, participants: state.participants }));
      ws.send(JSON.stringify({ type: 'chat-history', room: ws.meta.room, messages: state.chat }));
      ws.send(JSON.stringify({ type: 'cursors', room: ws.meta.room, cursors: state.cursors }));

      broadcast(
        ws.meta.room,
        {
          type: "toast",
          room: ws.meta.room,
          message: `👋 ${ws.meta.name} се присъедини.`,
        },
        ws
      );

      broadcast(ws.meta.room, { type: 'presence', room: ws.meta.room, participants: state.participants }, null);

      // If invite was single-use, mark it used
      if (invite && Number(invite.single_use) === 1) {
        try { await markInviteUsed(invite.token); } catch (_) {}
      }

      return;
    }

    if (msg.type === 'join-request-decision') {
      const requestId = String(msg.requestId || '').trim();
      const action = String(msg.action || '').toLowerCase();
      const requestedRole = String(msg.role || 'viewer').toLowerCase();
      const safeRole = requestedRole === 'editor' ? 'editor' : 'viewer';
      if (!requestId || !['approve', 'deny'].includes(action)) return;

      const request = joinRequests.get(requestId);
      if (!request) return;

      const actor = ws.meta.user;
      if (!actor) return;

      const roomInfo = await getRoomById(request.roomId);
      if (!roomInfo) {
        joinRequests.delete(requestId);
        return;
      }

      const canApprove = await canUserApproveRoomRequests(roomInfo, actor);
      if (!canApprove) {
        try {
          ws.send(JSON.stringify({ type: 'error', room: request.roomId, error: 'forbidden' }));
        } catch {}
        return;
      }

      joinRequests.delete(requestId);

      if (action === 'approve') {
        await upsertRoomMemberRole(request.roomId, request.requesterUserId, safeRole, actor.id);
        sendToUser(request.requesterUserId, {
          type: 'join-request-result',
          approved: true,
          room: request.roomId,
          role: safeRole,
          message: `Достъпът ти беше одобрен като ${safeRole}.`,
        });
        try {
          ws.send(JSON.stringify({ type: 'toast', room: request.roomId, message: 'Заявката е одобрена.' }));
        } catch {}
      } else {
        sendToUser(request.requesterUserId, {
          type: 'join-request-result',
          approved: false,
          room: request.roomId,
          role: null,
          message: 'Собственикът отказа заявката за достъп.',
        });
        try {
          ws.send(JSON.stringify({ type: 'toast', room: request.roomId, message: 'Заявката е отказана.' }));
        } catch {}
      }
      return;
    }

    if (msg.type === 'room-member-manage') {
      const roomId = String(msg.room || ws.meta.room || '').trim();
      const action = String(msg.action || '').toLowerCase();
      const targetUserId = Number(msg.userId);
      const requestedRole = String(msg.role || 'viewer').toLowerCase();
      const safeRole = requestedRole === 'editor' ? 'editor' : 'viewer';

      if (!roomId || !Number.isFinite(targetUserId)) return;
      if (!['set-role', 'remove'].includes(action)) return;
      if (!ws.meta.user) return;

      const roomInfo = await getRoomById(roomId);
      if (!roomInfo) return;

      const canManage = await canUserApproveRoomRequests(roomInfo, ws.meta.user);
      if (!canManage) {
        try {
          ws.send(JSON.stringify({ type: 'error', room: roomId, error: 'forbidden' }));
        } catch {}
        return;
      }

      if (Number(ws.meta.user.id) === targetUserId) {
        try {
          ws.send(JSON.stringify({ type: 'toast', room: roomId, message: 'Не можеш да променяш собствената си роля оттук.' }));
        } catch {}
        return;
      }

      const targetIsProtected = await isProtectedRoomUser(roomInfo, targetUserId);
      if (targetIsProtected) {
        try {
          ws.send(JSON.stringify({ type: 'toast', room: roomId, message: 'Този потребител е owner/admin и не може да бъде променян от този панел.' }));
        } catch {}
        return;
      }

      if (action === 'set-role') {
        await upsertRoomMemberRole(roomId, targetUserId, safeRole, ws.meta.user.id);

        const state = getOrInitRoom(roomId);
        if (Array.isArray(state.participants)) {
          state.participants = state.participants.map((p) => {
            if (Number(p.userId) !== targetUserId) return p;
            return { ...p, role: safeRole };
          });
        }

        const targetClients = getOpenClientsByUserAndRoom(targetUserId, roomId);
        for (const client of targetClients) {
          client.meta.role = safeRole;
          client.meta.canWrite = safeRole === 'owner' || safeRole === 'editor';
          try {
            client.send(JSON.stringify({
              type: 'hello',
              room: roomId,
              clientId: client.meta.clientId,
              role: client.meta.role,
              canWrite: client.meta.canWrite,
            }));
            client.send(JSON.stringify({ type: 'toast', room: roomId, message: `Ролята ти е променена на ${safeRole}.` }));
          } catch {}
        }

        broadcast(roomId, { type: 'presence', room: roomId, participants: state.participants }, null);
        try {
          ws.send(JSON.stringify({ type: 'toast', room: roomId, message: `Ролята е променена на ${safeRole}.` }));
        } catch {}
        return;
      }

      await deleteRoomMember(roomId, targetUserId);

      const targetClients = getOpenClientsByUserAndRoom(targetUserId, roomId);
      const nextRoleByClientId = new Map();
      for (const client of targetClients) {
        const nextAccess = await accessForRoomAndUser(roomId, client.meta.user, { allowPublicRead: true });
        if (!nextAccess.ok) {
          try {
            client.send(JSON.stringify({ type: 'error', room: roomId, error: 'forbidden' }));
            client.send(JSON.stringify({ type: 'toast', room: roomId, message: 'Достъпът ти до стаята е премахнат.' }));
          } catch {}
          try { client.close(); } catch {}
          continue;
        }

        client.meta.role = nextAccess.role;
        client.meta.canWrite = !!nextAccess.canWrite;
        client.meta.canRead = !!nextAccess.canRead;
        nextRoleByClientId.set(client.meta.clientId, client.meta.role);
        try {
          client.send(JSON.stringify({
            type: 'hello',
            room: roomId,
            clientId: client.meta.clientId,
            role: client.meta.role,
            canWrite: client.meta.canWrite,
          }));
          client.send(JSON.stringify({ type: 'toast', room: roomId, message: 'Достъпът ти е обновен.' }));
        } catch {}
      }

      const state = roomState.get(roomId);
      if (state?.participants) {
        state.participants = state.participants.map((p) => {
          if (Number(p.userId) !== targetUserId) return p;
          const liveRole = nextRoleByClientId.get(p.clientId);
          if (!liveRole) return p;
          return { ...p, role: liveRole };
        });
        broadcast(roomId, { type: 'presence', room: roomId, participants: state.participants }, null);
      }

      try {
        ws.send(JSON.stringify({ type: 'toast', room: roomId, message: 'Потребителят е премахнат от room members.' }));
      } catch {}
      return;
    }

    if (msg.type === "update") {
      if (!ws.meta.room) return;
      const room = ws.meta.room;

      if (!ws.meta.canWrite) {
        try {
          ws.send(JSON.stringify({ type: 'toast', room, message: 'Нямаш права за редакция (Viewer).' }));
        } catch {}
        return;
      }

      const safeNodes = Array.isArray(msg.nodes) ? msg.nodes : [];
      const safeEdges = Array.isArray(msg.edges) ? msg.edges : [];
      const state = getOrInitRoom(room);
      state.nodes = safeNodes;
      state.edges = safeEdges;

      broadcast(room, { type: "state", room, nodes: safeNodes, edges: safeEdges }, ws);
    }

    if (msg.type === 'cursor') {
      if (!ws.meta.room) return;
      const room = ws.meta.room;
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const state = getOrInitRoom(room);
      state.cursors[ws.meta.clientId] = {
        clientId: ws.meta.clientId,
        name: ws.meta.name,
        role: ws.meta.role,
        x,
        y,
        at: toSofiaSqlString(),
      };
      broadcast(room, { type: 'cursor', room, cursor: state.cursors[ws.meta.clientId] }, null);
    }

    if (msg.type === 'chat') {
      if (!ws.meta.room) return;
      const room = ws.meta.room;
      const name = ws.meta.name;
      const text = String(msg.text || '').trim().slice(0, 800);
      if (!text) return;
      const state = getOrInitRoom(room);
      const entry = { id: crypto.randomBytes(6).toString('hex'), at: toSofiaSqlString(), name, text, role: ws.meta.role };
      state.chat.push(entry);
      if (state.chat.length > 50) state.chat.splice(0, state.chat.length - 50);
      broadcast(room, { type: 'chat', room, message: entry }, null);
    }
  });

  ws.on("close", () => {
    if (!ws.meta.room) return;
    const state = roomState.get(ws.meta.room);
    if (state?.participants) {
      state.participants = state.participants.filter((p) => p.clientId !== ws.meta.clientId);
      broadcast(ws.meta.room, { type: 'presence', room: ws.meta.room, participants: state.participants }, null);
    }
    if (state?.cursors && state.cursors[ws.meta.clientId]) {
      delete state.cursors[ws.meta.clientId];
      broadcast(ws.meta.room, { type: 'cursors', room: ws.meta.room, cursors: state.cursors }, null);
    }
    broadcast(
      ws.meta.room,
      {
        type: "toast",
        room: ws.meta.room,
        message: `👋 ${ws.meta.name} излезе.`,
      },
      ws
    );
  });
});

function broadcast(room, payload, exceptWs) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client === exceptWs) return;
    if ((client.meta?.room || "demo") !== room) return;
    client.send(data);
  });
}

async function ensureAdminUser() {
  async function seedAccount({ email, password, username, role, sourceLabel }) {
    if (!email || !password) return false;
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await getUserByEmail(normalizedEmail);
    if (existing) return true;
    const passwordHash = await hashPassword(password);
    await insertUser(normalizedEmail, username || 'admin', passwordHash, role);
    console.log(`Seeded ${role} user from ${sourceLabel}.`);
    return true;
  }

  const legacyEmail = process.env.ADMIN_EMAIL;
  const legacyPassword = process.env.ADMIN_PASSWORD;
  const requestedAdminRole = String(process.env.ADMIN_ROLE || 'admin').trim().toLowerCase();
  const legacyRole = requestedAdminRole === 'admin' ? 'admin' : 'admin';

  const adminSeeded = await seedAccount({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    username: process.env.ADMIN_USERNAME || 'admin',
    role: 'admin',
    sourceLabel: 'ADMIN_EMAIL/ADMIN_PASSWORD',
  });

  if (adminSeeded) {
    return;
  }

  // Local dev fallback
  try {
    const row = await get('SELECT COUNT(1) as cnt FROM users');
    const count = row?.cnt || 0;
    if (Number(count) === 0) {
      const fallbackEmail = 'admin@local';
      const fallbackPassword = 'admin';
      const passwordHash = await hashPassword(fallbackPassword);
      await insertUser(fallbackEmail, 'admin', passwordHash, 'admin');
      console.log(`Seeded default admin user: ${fallbackEmail} / ${fallbackPassword}`);
    }
  } catch (e) {
    // ignore errors seeding dev admin
  }
}

async function start() {
  try {
    await initDatabase();
    await ensureAdminUser();
    // AI example seeding skipped/removed
    server.listen(PORT, () => {
      console.log(`API: http://localhost:${PORT}`);
      console.log(`WS : ws://localhost:${PORT}/ws`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
