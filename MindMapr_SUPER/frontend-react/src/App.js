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

const API = "http://localhost:3000";
const WS = "ws://localhost:3002";

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
  const [room, setRoom] = useState(getRoomFromUrl());
  const [name, setName] = useState(() => localStorage.getItem("mm_name") || "guest");
  const [status, setStatus] = useState("offline"); // online/offline
  const [lastSync, setLastSync] = useState(null);
  const [toast, setToast] = useState("");
  const [aiResult, setAiResult] = useState(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const res = await fetch(`${API}/api/maps/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, nodes, edges })
    });
    if (res.ok) showToast("Запазено локално (в сървъра).");
    else showToast("Грешка при запис.");
  }, [room, nodes, edges, showToast]);

  const loadSnapshot = useCallback(async () => {
    const res = await fetch(`${API}/api/maps/load?room=${encodeURIComponent(room)}`);
    if (!res.ok) return showToast("Няма запазена карта за тази стая.");
    const data = await res.json();
    if (!data?.nodes) return showToast("Невалиден запис.");
    setNodes(data.nodes);
    setEdges(data.edges || []);
    scheduleBroadcast(data.nodes, data.edges || []);
    showToast("Заредено.");
  }, [room, scheduleBroadcast, showToast]);

  const runAI = useCallback(async () => {
    setAiResult(null);
    const res = await fetch(`${API}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, nodes, edges })
    });
    const data = await res.json();
    setAiResult(data);
    showToast("AI анализ готов.");
  }, [room, nodes, edges, showToast]);

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
            <div className="small">Записът е в паметта на сървъра (демо). За диплома може да се замени с база данни.</div>
          </div>

          <div className="section">
            <h3>AI асистент</h3>
            <div className="row">
              <button className="btn primary" onClick={runAI}>🤖 Анализирай карта</button>
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
    </>
  );
}
