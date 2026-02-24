const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const rateLimit = require("express-rate-limit");
const { authMiddleware, requireAuth, requireAdmin, register, login, hashPassword } = require("./auth");
const {
  initDatabase,
  insertRoom,
  insertSave,
  getLatestSave,
  getUserByEmail,
  insertUser,
  listUsers,
  listRooms,
} = require("./db");

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));

app.use(authMiddleware);

const guestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many requests from this IP, please try again later." },
  skip: (req) => !!req.user,
});

const roomState = new Map();

app.get("/api/health", (req, res) => {
  const userInfo = req.user
    ? { id: req.user.id, email: req.user.email, role: req.user.role }
    : null;
  res.json({ ok: true, service: "MindMapr API", user: userInfo });
});

app.post("/api/auth/register", register);
app.post("/api/auth/login", login);

app.post("/api/maps/save", requireAuth, async (req, res) => {
  const { room, nodes, edges } = req.body || {};
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    await insertRoom(String(room), null, req.user.id);
    await insertSave(
      String(room),
      JSON.stringify(Array.isArray(nodes) ? nodes : []),
      JSON.stringify(Array.isArray(edges) ? edges : []),
      req.user.id
    );
    return res.json({ ok: true });
  } catch (_err) {
    return res.status(500).json({ error: "Save failed" });
  }
});

app.get("/api/maps/load", guestLimiter, async (req, res) => {
  const room = req.query.room;
  if (!room) return res.status(400).json({ error: "room required" });

  try {
    const save = await getLatestSave(String(room));
    if (!save) return res.status(404).json({ error: "not found" });
    return res.json({
      room: save.room_id,
      nodes: JSON.parse(save.nodes),
      edges: JSON.parse(save.edges),
    });
  } catch (_err) {
    return res.status(500).json({ error: "Load failed" });
  }
});

app.post("/api/ai/analyze", guestLimiter, (req, res) => {
  const { nodes = [], edges = [] } = req.body || {};
  const n = Array.isArray(nodes) ? nodes.length : 0;
  const e = Array.isArray(edges) ? edges.length : 0;

  const suggestions = [];
  if (n < 4) suggestions.push("Добави поне 3–5 под-теми към главната тема.");
  if (e < Math.max(1, n - 1)) suggestions.push("Свържи повече възли, за да се виждат зависимости.");
  const leafs = new Set((nodes || []).map((x) => x.id));
  (edges || []).forEach((ed) => {
    if (ed.source) leafs.delete(ed.source);
  });
  if (leafs.size > 2) suggestions.push("Има много крайни възли - помисли за групиране/подтематика.");

  res.json({
    summary: `Картата съдържа ${n} възела и ${e} връзки. Структурата е ${n > 8 ? "богата" : "компактна"}.`,
    suggestions: suggestions.length
      ? suggestions
      : ["Структурата изглежда добра. Добави конкретни примери към ключовите възли."],
  });
});

const adminRouter = require('./admin');
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

function getOrInitRoom(room) {
  if (!roomState.has(room)) {
    roomState.set(room, {
      nodes: [{ id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема" }, type: "default" }],
      edges: [],
    });
  }
  return roomState.get(room);
}

wss.on("connection", (ws) => {
  ws.meta = { room: null, name: "guest" };

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch (_err) {
      return;
    }

    if (msg.type === "join") {
      ws.meta.room = (msg.room || "demo").toString();
      ws.meta.name = (msg.name || "guest").toString();

      const state = getOrInitRoom(ws.meta.room);
      ws.send(JSON.stringify({ type: "state", room: ws.meta.room, nodes: state.nodes, edges: state.edges }));

      broadcast(
        ws.meta.room,
        {
          type: "toast",
          room: ws.meta.room,
          message: `👋 ${ws.meta.name} се присъедини.`,
        },
        ws
      );
      return;
    }

    if (msg.type === "update") {
      const room = (msg.room || ws.meta.room || "demo").toString();
      const name = (msg.name || ws.meta.name || "guest").toString();
      ws.meta.room = room;
      ws.meta.name = name;

      const safeNodes = Array.isArray(msg.nodes) ? msg.nodes : [];
      const safeEdges = Array.isArray(msg.edges) ? msg.edges : [];
      roomState.set(room, { nodes: safeNodes, edges: safeEdges });

      broadcast(room, { type: "state", room, nodes: safeNodes, edges: safeEdges }, ws);
    }
  });

  ws.on("close", () => {
    if (!ws.meta.room) return;
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

const PORT = 3000;

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminUsername = process.env.ADMIN_USERNAME || "admin";

  if (!adminEmail || !adminPassword) return;

  const normalizedEmail = String(adminEmail).trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) return;

  const passwordHash = await hashPassword(adminPassword);
  await insertUser(normalizedEmail, adminUsername, passwordHash, "admin");
  console.log("Seeded admin user from ADMIN_EMAIL/ADMIN_PASSWORD.");
}

async function start() {
  try {
    await initDatabase();
    await ensureAdminUser();
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
