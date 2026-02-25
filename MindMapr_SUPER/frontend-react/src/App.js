import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges
} from "reactflow";
import { nanoid } from "nanoid";
import { useAuth } from "./AuthContext";
import { mapsAPI, aiAPI } from "./api";
import AdminPanel from './AdminPanel';

const WS = "ws://localhost:3000/ws";

function getRoomFromUrl() {
  const u = new URL(window.location.href);
  const r = u.searchParams.get("room");
  return r && r.trim() ? r.trim() : "demo";
}
function setRoomInUrl(room) {
  const u = new URL(window.location.href);
  u.searchParams.set("room", room);
  window.history.replaceState({}, "", u.toString());
}

export default function App() {
  const { user, isAuthenticated, isAdmin, login, register, logout } = useAuth();
  const [room, setRoom] = useState(getRoomFromUrl());
  const [name, setName] = useState(() => localStorage.getItem("mm_name") || "guest");
  const [status, setStatus] = useState("offline"); // online/offline
  const [lastSync, setLastSync] = useState(null);
  const [toast, setToast] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [aiResult, setAiResult] = useState(null);
    const [aiTopic, setAiTopic] = useState("");
    const [aiLoading, setAiLoading] = useState(false);
  const [authForm, setAuthForm] = useState({ email: "", password: "", username: "" });
  const [authError, setAuthError] = useState("");

  const [nodes, setNodes] = useState(() => ([
    { id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема" }, type: "default" }
  ]));
  const [edges, setEdges] = useState([]);

  const wsRef = useRef(null);
  const suppressRemoteRef = useRef(false);
  const pendingTimerRef = useRef(null);

  useEffect(() => { localStorage.setItem("mm_name", name); }, [name]);
  useEffect(() => { setRoomInUrl(room); }, [room]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => setToast(""), 2500);
  }, []);

  // WebSocket connect & room join
  useEffect(() => {
    const ws = new WebSocket(WS);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("online");
      ws.send(JSON.stringify({ type: "join", room, name }));
      showToast("Свързан(а) за екипна работа. Сподели линка с room параметъра.");
    };
    ws.onclose = () => setStatus("offline");
    ws.onerror = () => setStatus("offline");

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state" && msg.room === room) {
          suppressRemoteRef.current = true;
          setNodes(msg.nodes || []);
          setEdges(msg.edges || []);
          setLastSync(new Date().toLocaleTimeString());
          window.setTimeout(() => (suppressRemoteRef.current = false), 0);
        }
        if (msg.type === "toast" && msg.room === room) {
          showToast(msg.message || "Обновление от екипа");
        }
      } catch {}
    };

    return () => {
      try { ws.close(); } catch {}
    };
  }, [room]);

  const broadcastState = useCallback((nextNodes, nextEdges) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      type: "update",
      room,
      name,
      nodes: nextNodes,
      edges: nextEdges
    }));
    setLastSync(new Date().toLocaleTimeString());
  }, [room, name]);

  // throttle updates
  const scheduleBroadcast = useCallback((nextNodes, nextEdges) => {
    if (suppressRemoteRef.current) return;
    if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => {
      broadcastState(nextNodes, nextEdges);
    }, 120);
  }, [broadcastState]);

  const onNodesChange = useCallback((changes) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      scheduleBroadcast(next, edges);
      return next;
    });
  }, [edges, scheduleBroadcast]);

  const onEdgesChange = useCallback((changes) => {
    setEdges((eds) => {
      const next = applyEdgeChanges(changes, eds);
      scheduleBroadcast(nodes, next);
      return next;
    });
  }, [nodes, scheduleBroadcast]);

  const onConnect = useCallback((connection) => {
    setEdges((eds) => {
      const next = addEdge({ ...connection, animated: true }, eds);
      scheduleBroadcast(nodes, next);
      return next;
    });
  }, [nodes, scheduleBroadcast]);

  const addIdea = useCallback(() => {
    const id = nanoid(8);
    const baseX = (Math.random() * 320) + 120;
    const baseY = (Math.random() * 260) - 120;

    const newNode = {
      id,
      position: { x: baseX, y: baseY },
      data: { label: "Нова идея" },
      type: "default"
    };

    const newEdge = { id: `e-root-${id}`, source: "root", target: id, animated: true };

    const nextNodes = [...nodes, newNode];
    const nextEdges = [...edges, newEdge];

    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
  }, [nodes, edges, scheduleBroadcast]);

  const renameSelected = useCallback(() => {
    const label = prompt("Нов текст на избрания възел:");
    if (!label) return;
    const selected = nodes.find(n => n.selected);
    if (!selected) return alert("Маркирай възел (клик) и опитай пак.");
    const nextNodes = nodes.map(n => n.id === selected.id ? ({ ...n, data: { ...n.data, label } }) : n);
    setNodes(nextNodes);
    scheduleBroadcast(nextNodes, edges);
  }, [nodes, edges, scheduleBroadcast]);

  const deleteSelected = useCallback(() => {
    const selectedIds = new Set(nodes.filter(n => n.selected).map(n => n.id));
    if (!selectedIds.size) return alert("Маркирай възел(и) и опитай пак.");
    if (selectedIds.has("root")) return alert("Главната тема не може да се изтрие.");
    const nextNodes = nodes.filter(n => !selectedIds.has(n.id));
    const nextEdges = edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target));
    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
  }, [nodes, edges, scheduleBroadcast]);

  const saveSnapshot = useCallback(async () => {
    if (!isAuthenticated) {
      showToast("Трябва да сте влезли в системата, за да запазите.");
      return;
    }
    try {
      await mapsAPI.save(room, nodes, edges);
      showToast("Запазено в базата данни.");
    } catch (error) {
      showToast("Грешка при запис: " + (error.response?.data?.error || error.message));
    }
  }, [room, nodes, edges, showToast, isAuthenticated, mapsAPI]);

  const loadSnapshot = useCallback(async () => {
    try {
      const res = await mapsAPI.load(room);
      const data = res.data;
      if (!data?.nodes) return showToast("Невалиден запис.");
      setNodes(data.nodes);
      setEdges(data.edges || []);
      scheduleBroadcast(data.nodes, data.edges || []);
      showToast("Заредено.");
    } catch (_err) {
      showToast("Няма запазена карта за тази стая.");
    }
  }, [room, scheduleBroadcast, showToast]);

  const onAuthFieldChange = useCallback((key, value) => {
    setAuthForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleLogin = useCallback(async () => {
    setAuthError("");
    const result = await login(authForm.email, authForm.password);
    if (!result.success) {
      setAuthError(result.error || "Login failed");
      return;
    }
    showToast("Успешен вход.");
    setAuthForm((prev) => ({ ...prev, password: "" }));
  }, [authForm.email, authForm.password, login, showToast]);

  const handleRegister = useCallback(async () => {
    setAuthError("");
    const result = await register(authForm.email, authForm.password, authForm.username);
    if (!result.success) {
      setAuthError(result.error || "Registration failed");
      return;
    }
    showToast("Регистрацията е успешна.");
    setAuthForm((prev) => ({ ...prev, password: "" }));
  }, [authForm.email, authForm.password, authForm.username, register, showToast]);

  const runAI = useCallback(async () => {
    setAiResult(null);
    try {
      const res = await aiAPI.analyze(nodes, edges);
      setAiResult(res.data);
      showToast("AI анализ готов.");
    } catch (error) {
      showToast("Грешка при AI анализ: " + (error.response?.data?.error || error.message));
    }
  }, [nodes, edges, showToast, aiAPI]);

  const generateMindMap = useCallback(async () => {
    if (!aiTopic.trim()) {
      showToast("Въведи тема за генериране.");
      return;
    }
    setAiLoading(true);
    try {
      const res = await aiAPI.generateMap(aiTopic);
      setNodes(res.data.nodes);
      setEdges(res.data.edges);
      showToast("Генерирана мисловна карта по тема: " + aiTopic);
    } catch (error) {
      showToast("Грешка при AI генериране: " + (error.response?.data?.error || error.message));
    } finally {
      setAiLoading(false);
    }
  }, [aiTopic, aiAPI, showToast]);

  const shareLink = useMemo(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("room", room);
    return u.toString();
  }, [room]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        addIdea();
      }
      if (e.key === "Delete") deleteSelected();
      if (e.key === "F2") renameSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addIdea, deleteSelected, renameSelected]);

  return (
    <>
      <div className="header">
        <div className="brand">
          <span style={{fontSize:18}}>🧠 MindMapr</span>
          <span className="badge">Realtime</span>
        </div>
        <div className="row" style={{gap:12}}>
          <span className="pill" title="Състояние на връзката за екипна работа">
            <span className={"dot " + (status === "online" ? "ok" : "bad")} />
            {status === "online" ? "онлайн" : "офлайн"}
          </span>
          <span className="pill" title="Последна синхронизация">
            ⏱ {lastSync || "—"}
          </span>
          {isAdmin ? (
            <button className="btn ghost" onClick={() => setShowAdmin(true)}>⚙️ Admin</button>
          ) : null}
        </div>
      </div>

      <div className="main">
        <div className="panel">
          <div className="section">
            <h3>Стая за екипна работа</h3>
            <div className="col">
              <div className="row">
                <input className="input" value={room} onChange={(e)=>setRoom(e.target.value)} placeholder="room-id"/>
                <button className="btn ghost" onClick={() => {
                  navigator.clipboard?.writeText(shareLink);
                  showToast("Линкът е копиран. Изпрати го на екипа.");
                }}>🔗 Копирай линк</button>
              </div>
              <div className="row">
                <input className="input" value={name} onChange={(e)=>setName(e.target.value)} placeholder="име/ник"/>
                <button className="btn warn" onClick={() => {
                  // force reconnect by changing room to same value (hack)
                  setRoom(r => (r + ""));
                  showToast("Ако смениш room, ще се свържеш към нова стая.");
                }}>👥 Име</button>
              </div>
              <div className="small">
                Отвори линка на друг компютър/браузър със същия <b>room</b> и ще редактирате заедно в реално време.
              </div>
            </div>
          </div>

          <div className="section">
            <h3>Профил</h3>
            {isAuthenticated ? (
              <div className="col">
                <div className="small">
                  Влезнал(а) като <b>{user?.email}</b> ({user?.role})
                </div>
                <button className="btn ghost" onClick={logout}>Изход</button>
              </div>
            ) : (
              <div className="col">
                <input
                  className="input"
                  value={authForm.email}
                  onChange={(e) => onAuthFieldChange("email", e.target.value)}
                  placeholder="email"
                />
                <input
                  className="input"
                  type="password"
                  value={authForm.password}
                  onChange={(e) => onAuthFieldChange("password", e.target.value)}
                  placeholder="password"
                />
                <input
                  className="input"
                  value={authForm.username}
                  onChange={(e) => onAuthFieldChange("username", e.target.value)}
                  placeholder="username (за регистрация)"
                />
                <div className="row">
                  <button className="btn primary" onClick={handleLogin}>Вход</button>
                  <button className="btn ghost" onClick={handleRegister}>Регистрация</button>
                </div>
                {authError ? <div className="small" style={{ color: "#ff8f8f" }}>{authError}</div> : null}
              </div>
            )}
          </div>

          <div className="section">
            <h3>Инструменти</h3>
            <div className="col">
              <div className="row">
                <button className="btn primary" onClick={addIdea}>➕ Нова идея <span className="small">(Ctrl+K)</span></button>
                <button className="btn ghost" onClick={renameSelected}>✏️ Преименувай <span className="small">(F2)</span></button>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={deleteSelected}>🗑 Изтрий <span className="small">(Del)</span></button>
                <button className="btn ghost" onClick={() => {
                  // reset
                  const starter = [{ id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема" }, type: "default" }];
                  setNodes(starter);
                  setEdges([]);
                  scheduleBroadcast(starter, []);
                }}>↩️ Нова карта</button>
              </div>
            </div>
          </div>

          <div className="section">
            <h3>Запис / Зареждане</h3>
            <div className="row">
              <button className="btn ghost" onClick={saveSnapshot}>💾 Запази</button>
              <button className="btn ghost" onClick={loadSnapshot}>📂 Зареди</button>
            </div>
            <div className="small">Записът е в базата данни. Изисква се вход в системата.</div>
          </div>

          <div className="section">
            <h3>AI асистент</h3>
            <div className="col" style={{gap:10}}>
              <div className="row">
                <input
                  className="input"
                  value={aiTopic}
                  onChange={e => setAiTopic(e.target.value)}
                  placeholder="Въведи тема (например: Екология)"
                  disabled={aiLoading}
                />
                <button className="btn primary" onClick={generateMindMap} disabled={aiLoading}>
                  {aiLoading ? "Генерира..." : "🧠 Генерирай карта"}
                </button>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={runAI}>🤖 Анализирай текущата карта</button>
              </div>
            </div>
            {aiResult ? (
              <div style={{marginTop:10}}>
                <div className="pill" style={{marginBottom:8}}>🧾 Обобщение</div>
                <div className="small" style={{whiteSpace:"pre-wrap"}}>{aiResult.summary}</div>
                <div style={{height:8}} />
                <div className="pill" style={{marginBottom:8}}>✨ Предложения</div>
                <ul className="small" style={{margin:0, paddingLeft:18}}>
                  {(aiResult.suggestions || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            ) : (
              <div className="small" style={{marginTop:8}}>
                AI дава предложения за структура и липсващи теми на базата на възлите/връзките.
              </div>
            )}
          </div>

          <div className="footerNote">
            Съвет: влачи възлите с мишка. Свързвай възли като дърпаш от точката на възела към друг възел.
            <div className="help" style={{marginTop:10}}>
              <span className="pill">Drag</span>
              <span className="pill">Connect</span>
              <span className="pill">Zoom</span>
              <span className="pill">MiniMap</span>
            </div>
          </div>
        </div>

        <div className="canvasWrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>

          {toast ? <div className="toast">{toast}</div> : null}
        </div>
      </div>
      {showAdmin ? <AdminPanel onClose={() => setShowAdmin(false)} /> : null}
    </>
  );
}
