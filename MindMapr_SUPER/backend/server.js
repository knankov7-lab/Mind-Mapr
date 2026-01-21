const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use((req,res,next)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));

// In-memory storage (demo)
const roomState = new Map(); // room -> { nodes, edges }
const roomSaves = new Map(); // room -> saved snapshot

app.get("/api/health", (req,res)=>res.json({ ok:true, service:"MindMapr API" }));

app.post("/api/maps/save", (req,res)=>{
  const { room, nodes, edges } = req.body || {};
  if (!room) return res.status(400).json({ error: "room required" });
  roomSaves.set(room, { room, nodes: nodes || [], edges: edges || [] });
  return res.json({ ok:true });
});

app.get("/api/maps/load", (req,res)=>{
  const room = req.query.room;
  if (!room) return res.status(400).json({ error: "room required" });
  const data = roomSaves.get(room);
  if (!data) return res.status(404).json({ error: "not found" });
  return res.json(data);
});

app.post("/api/ai/analyze", (req,res)=>{
  const { nodes = [], edges = [] } = req.body || {};
  const n = Array.isArray(nodes) ? nodes.length : 0;
  const e = Array.isArray(edges) ? edges.length : 0;

  const suggestions = [];
  if (n < 4) suggestions.push("Добави поне 3–5 под-теми към главната тема.");
  if (e < Math.max(1, n-1)) suggestions.push("Свържи повече възли, за да се виждат зависимости.");
  const leafs = new Set((nodes||[]).map(x=>x.id));
  (edges||[]).forEach(ed => { if (ed.source) leafs.delete(ed.source); });
  if (leafs.size > 2) suggestions.push("Има много крайни възли — помисли за групиране/подтематика.");

  res.json({
    summary: `Картата съдържа ${n} възела и ${e} връзки. Структурата е ${n > 8 ? "богата" : "компактна"}.`,
    suggestions: suggestions.length ? suggestions : ["Структурата изглежда добра. Добави конкретни примери към ключовите възли."]
  });
});

// HTTP server for Express + WS
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

function getOrInitRoom(room) {
  if (!roomState.has(room)) {
    roomState.set(room, {
      nodes: [{ id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема" }, type: "default" }],
      edges: []
    });
  }
  return roomState.get(room);
}

wss.on("connection", (ws) => {
  ws.meta = { room: null, name: "guest" };

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "join") {
      ws.meta.room = (msg.room || "demo").toString();
      ws.meta.name = (msg.name || "guest").toString();

      const state = getOrInitRoom(ws.meta.room);
      ws.send(JSON.stringify({ type: "state", room: ws.meta.room, nodes: state.nodes, edges: state.edges }));

      // notify others
      broadcast(ws.meta.room, {
        type: "toast",
        room: ws.meta.room,
        message: `👋 ${ws.meta.name} се присъедини.`
      }, ws);

      return;
    }

    if (msg.type === "update") {
      const room = (msg.room || ws.meta.room || "demo").toString();
      const name = (msg.name || ws.meta.name || "guest").toString();
      ws.meta.room = room;
      ws.meta.name = name;

      // store state (demo)
      const safeNodes = Array.isArray(msg.nodes) ? msg.nodes : [];
      const safeEdges = Array.isArray(msg.edges) ? msg.edges : [];
      roomState.set(room, { nodes: safeNodes, edges: safeEdges });

      // broadcast full state to others (simple & reliable for demo)
      broadcast(room, { type: "state", room, nodes: safeNodes, edges: safeEdges }, ws);
      return;
    }
  });

  ws.on("close", () => {
    if (!ws.meta.room) return;
    broadcast(ws.meta.room, {
      type: "toast",
      room: ws.meta.room,
      message: `👋 ${ws.meta.name} излезе.`
    }, ws);
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
server.listen(PORT, () => {
  console.log(`API: http://localhost:${PORT}`);
  console.log(`WS : ws://localhost:${PORT}/ws`);
});

