import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useStore
} from "reactflow";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import jsQR from "jsqr";
import LZString from "lz-string";
import { useAuth } from "./AuthContext";
import { mapsAPI, aiAPI, roomsAPI, commentsAPI } from "./api";
import AdminPanel from "./AdminPanel";
import MapListDialog from "./MapListDialog";
import MapHistoryDialog from "./MapHistoryDialog";

function inferWsUrl() {
  const fromEnv = process.env.REACT_APP_WS_URL;
  if (fromEnv) return fromEnv;

  if (typeof window !== 'undefined') {
    // Prefer same-origin WebSocket endpoint so CRA dev proxy can forward to backend.
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProto}://${window.location.host}/ws`;
  }

  return 'ws://localhost:3001/ws';
}

const WS = inferWsUrl();

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

export default function EditorApp() {
  const [showMapList, setShowMapList] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const handleSelectMap = async (roomId) => {
    setRoom(roomId);
    setShowMapList(false);
    try {
      const res = await mapsAPI.load(roomId);
      const data = res.data;
      if (!data?.nodes) return showToast("Невалиден запис.");
      setNodes(data.nodes);
      setEdges(data.edges || []);
      scheduleBroadcast(data.nodes, data.edges || []);
      showToast("Картата е заредена.");
    } catch {
      showToast("Грешка при зареждане на картата.");
    }
  };

  const { user, token, isAuthenticated, isAdmin, login, register, logout } = useAuth();
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

  const PANEL_MIN = 240;
  const PANEL_MAX = 560;
  const [panelWidth, setPanelWidth] = useState(() => {
    const raw = localStorage.getItem("mm_panelWidth");
    const n = Number(raw);
    if (Number.isFinite(n) && n >= PANEL_MIN && n <= PANEL_MAX) return n;
    return 320;
  });
  const mainRef = useRef(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("mm_panelWidth", String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizingRef.current) return;
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = e.clientX - rect.left;
      const clamped = Math.max(PANEL_MIN, Math.min(PANEL_MAX, next));
      setPanelWidth(clamped);
    };
    const onUp = () => {
      resizingRef.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const [nodes, setNodes] = useState(() => [
    { id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема" }, type: "default" }
  ]);
  const [edges, setEdges] = useState([]);

  const wsRef = useRef(null);
  const suppressRemoteRef = useRef(false);
  const pendingTimerRef = useRef(null);
  const importFileRef = useRef(null);
  const importImageRef = useRef(null);

  const [meta, setMeta] = useState({ name: "", description: "", tags: "" });
  const [metaBusy, setMetaBusy] = useState(false);

  const [participants, setParticipants] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState('');

  const [comments, setComments] = useState([]);

  const [myClientId, setMyClientId] = useState(null);
  const [myRole, setMyRole] = useState('guest');
  const [canEdit, setCanEdit] = useState(false);
  const [cursors, setCursors] = useState({});
  const rfRef = useRef(null);
  const lastCursorSentAtRef = useRef(0);

  function CursorsOverlay({ cursors, myClientId }) {
    const transform = useStore((s) => s.transform);
    const [tx, ty, zoom] = transform || [0, 0, 1];
    const list = Object.values(cursors || {});

    return (
      <div className="cursorOverlay">
        {list.map((c) => {
          const x = Number(c?.x);
          const y = Number(c?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const sx = x * zoom + tx;
          const sy = y * zoom + ty;
          const isMe = c.clientId && myClientId && c.clientId === myClientId;
          return (
            <div
              key={c.clientId}
              className={"cursorItem" + (isMe ? " me" : "")}
              style={{ transform: `translate(${sx}px, ${sy}px)` }}
            >
              <div className="cursorDot" />
              <div className="cursorLabel">{c.name || 'user'}</div>
            </div>
          );
        })}
      </div>
    );
  }
  const [commentText, setCommentText] = useState('');
  const [commentNodeId, setCommentNodeId] = useState('');

  useEffect(() => {
    localStorage.setItem("mm_name", name);
  }, [name]);
  useEffect(() => {
    setRoomInUrl(room);
  }, [room]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => setToast(""), 2500);
  }, []);

  const loadMeta = useCallback(async () => {
    if (!room) return;
    if (!isAuthenticated) {
      setMeta({ name: "", description: "", tags: "" });
      return;
    }
    try {
      const res = await roomsAPI.getMeta(room);
      setMeta({
        name: res.data?.name || "",
        description: res.data?.description || "",
        tags: res.data?.tags || "",
      });
    } catch {
      // ignore (room may be private / forbidden)
    }
  }, [room, isAuthenticated]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // WebSocket connect & room join
  useEffect(() => {
    const ws = new WebSocket(WS);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("online");
      ws.send(JSON.stringify({ type: "join", room, name, token: token || '' }));
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
        if (msg.type === 'presence' && msg.room === room) {
          setParticipants(Array.isArray(msg.participants) ? msg.participants : []);
        }
        if (msg.type === 'chat-history' && msg.room === room) {
          setChatMessages(Array.isArray(msg.messages) ? msg.messages : []);
        }
        if (msg.type === 'chat' && msg.room === room) {
          setChatMessages((prev) => {
            const next = [...(prev || []), msg.message].filter(Boolean);
            return next.slice(Math.max(0, next.length - 60));
          });
        }
        if (msg.type === 'hello' && msg.room === room) {
          setMyClientId(msg.clientId || null);
          setMyRole(msg.role || 'guest');
          setCanEdit(!!msg.canWrite);
        }
        if (msg.type === 'cursor' && msg.room === room && msg.cursor?.clientId) {
          setCursors((prev) => ({ ...(prev || {}), [msg.cursor.clientId]: msg.cursor }));
        }
        if (msg.type === 'cursors' && msg.room === room && msg.cursors) {
          setCursors(msg.cursors || {});
        }
        if (msg.type === 'error' && msg.room === room) {
          setCanEdit(false);
          showToast(msg.error || 'Нямаш достъп до стаята.');
        }
      } catch {}
    };

    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, [room, name, token, showToast]);

  const onCanvasMouseMove = useCallback(
    (ev) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      if (!myClientId) return;
      const now = Date.now();
      if (now - lastCursorSentAtRef.current < 40) return;

      const inst = rfRef.current;
      const pt = { x: ev.clientX, y: ev.clientY };
      let flow;
      try {
        if (inst?.screenToFlowPosition) flow = inst.screenToFlowPosition(pt);
        else if (inst?.project) flow = inst.project(pt);
      } catch {
        flow = null;
      }
      if (!flow || !Number.isFinite(flow.x) || !Number.isFinite(flow.y)) return;

      lastCursorSentAtRef.current = now;
      ws.send(JSON.stringify({ type: 'cursor', room, x: flow.x, y: flow.y }));
    },
    [room, myClientId]
  );

  const loadComments = useCallback(async () => {
    if (!room) return;
    if (!isAuthenticated) {
      setComments([]);
      return;
    }
    try {
      const res = await commentsAPI.list(room, 200);
      setComments(res.data?.comments || []);
    } catch {
      setComments([]);
    }
  }, [room, isAuthenticated]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const sendChat = useCallback(() => {
    const ws = wsRef.current;
    const text = (chatText || '').trim();
    if (!ws || ws.readyState !== 1) return;
    if (!text) return;
    ws.send(JSON.stringify({ type: 'chat', room, name, text }));
    setChatText('');
  }, [chatText, room, name]);

  const addComment = useCallback(async () => {
    const content = (commentText || '').trim();
    if (!content) return;
    try {
      await commentsAPI.create(room, content, (commentNodeId || '').trim() || null);
      setCommentText('');
      setCommentNodeId('');
      await loadComments();
      showToast('Коментарът е добавен.');
    } catch {
      showToast('Грешка при коментар. (Нужен е вход за частни карти)');
    }
  }, [commentText, commentNodeId, room, loadComments, showToast]);

  const broadcastState = useCallback(
    (nextNodes, nextEdges) => {
      if (!canEdit) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      ws.send(
        JSON.stringify({
          type: "update",
          room,
          name,
          nodes: nextNodes,
          edges: nextEdges
        })
      );
      setLastSync(new Date().toLocaleTimeString());
    },
    [canEdit, room, name]
  );

  // throttle updates
  const scheduleBroadcast = useCallback(
    (nextNodes, nextEdges) => {
      if (!canEdit) return;
      if (suppressRemoteRef.current) return;
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = window.setTimeout(() => {
        broadcastState(nextNodes, nextEdges);
      }, 120);
    },
    [canEdit, broadcastState]
  );

  const onNodesChange = useCallback(
    (changes) => {
      if (!canEdit) return;
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        scheduleBroadcast(next, edges);
        return next;
      });
    },
    [canEdit, edges, scheduleBroadcast]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      if (!canEdit) return;
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        scheduleBroadcast(nodes, next);
        return next;
      });
    },
    [canEdit, nodes, scheduleBroadcast]
  );

  const onConnect = useCallback(
    (connection) => {
      if (!canEdit) return;
      setEdges((eds) => {
        const next = addEdge({ ...connection, animated: true }, eds);
        scheduleBroadcast(nodes, next);
        return next;
      });
    },
    [canEdit, nodes, scheduleBroadcast]
  );

  const addIdea = useCallback(() => {
    if (!canEdit) return;
    const id = nanoid(8);
    const baseX = Math.random() * 320 + 120;
    const baseY = Math.random() * 260 - 120;

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
  }, [canEdit, nodes, edges, scheduleBroadcast]);

  const renderChat = () => (
    <div style={{marginTop:10,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.10)',borderRadius:14,padding:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
        <b>Чат</b>
        <span style={{fontSize:12,opacity:.85}}>Онлайн: {participants.length || 0}</span>
      </div>
      {participants.length ? (
        <div style={{marginTop:8,fontSize:12,opacity:.85}}>
          {participants.slice(0, 8).map((p) => p.name).join(', ')}{participants.length > 8 ? '…' : ''}
        </div>
      ) : null}
      <div style={{marginTop:10,maxHeight:140,overflow:'auto',borderRadius:12,border:'1px solid rgba(255,255,255,.08)',background:'rgba(0,0,0,.12)',padding:10,fontSize:12}}>
        {(chatMessages || []).map((m) => (
          <div key={m.id || m.at || Math.random()} style={{marginBottom:6}}>
            <span style={{opacity:.75}}>[{m.at ? new Date(m.at).toLocaleTimeString() : ''}]</span>{' '}
            <b style={{color:'#dfe6ff'}}>{m.name || 'guest'}:</b>{' '}
            <span style={{opacity:.95}}>{m.text}</span>
          </div>
        ))}
        {!chatMessages?.length ? <div style={{opacity:.7}}>Няма съобщения.</div> : null}
      </div>
      <div style={{display:'flex',gap:8,marginTop:10}}>
        <input
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder="Напиши съобщение…"
          style={{flex:1,borderRadius:12,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:'10px 12px'}}
          onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
        />
        <button className="btn primary" onClick={sendChat} style={{whiteSpace:'nowrap'}}>Изпрати</button>
      </div>
    </div>
  );

  const renderComments = () => (
    <div style={{marginTop:10,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.10)',borderRadius:14,padding:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
        <b>Коментари</b>
        <button className="btn ghost" onClick={loadComments} style={{fontSize:12}}>↻</button>
      </div>
      <div style={{marginTop:10,maxHeight:160,overflow:'auto',borderRadius:12,border:'1px solid rgba(255,255,255,.08)',background:'rgba(0,0,0,.12)',padding:10,fontSize:12}}>
        {(comments || []).map((c) => (
          <div key={c.id} style={{marginBottom:10,paddingBottom:10,borderBottom:'1px solid rgba(255,255,255,.06)'}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
              <div style={{opacity:.9}}>
                <b>{c.user_username || c.user_email || c.user_id || 'user'}</b>
                <span style={{opacity:.75}}> · {c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                {c.node_id ? <span style={{opacity:.75}}> · node: {c.node_id}</span> : null}
              </div>
            </div>
            <div style={{marginTop:6,opacity:.95,whiteSpace:'pre-wrap'}}>{c.content}</div>
          </div>
        ))}
        {!comments?.length ? <div style={{opacity:.7}}>Няма коментари.</div> : null}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 140px',gap:8,marginTop:10}}>
        <input
          value={commentNodeId}
          onChange={(e) => setCommentNodeId(e.target.value)}
          placeholder="nodeId (по избор)"
          style={{borderRadius:12,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:'10px 12px'}}
        />
        <button className="btn ghost" onClick={() => { setCommentNodeId(''); }} style={{fontSize:12}}>Изчисти</button>
      </div>
      <textarea
        value={commentText}
        onChange={(e) => setCommentText(e.target.value)}
        placeholder="Добави коментар… (за частни карти е нужен вход)"
        style={{width:'100%',height:80,marginTop:8,borderRadius:12,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#e9eeff',padding:10}}
      />
      <div style={{display:'flex',gap:8,marginTop:8}}>
        <button className="btn primary" onClick={addComment}>Добави</button>
      </div>
    </div>
  );

  const renameSelected = useCallback(() => {
    if (!canEdit) return;
    const label = prompt("Нов текст на избрания възел:");
    if (!label) return;
    const selected = nodes.find((n) => n.selected);
    if (!selected) return alert("Маркирай възел (клик) и опитай пак.");
    const nextNodes = nodes.map((n) =>
      n.id === selected.id ? { ...n, data: { ...n.data, label } } : n
    );
    setNodes(nextNodes);
    scheduleBroadcast(nextNodes, edges);
  }, [canEdit, nodes, edges, scheduleBroadcast]);

  const deleteSelected = useCallback(() => {
    if (!canEdit) return;
    const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!selectedIds.size) return alert("Маркирай възел(и) и опитай пак.");
    if (selectedIds.has("root")) return alert("Главната тема не може да се изтрие.");
    const nextNodes = nodes.filter((n) => !selectedIds.has(n.id));
    const nextEdges = edges.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target));
    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
  }, [canEdit, nodes, edges, scheduleBroadcast]);

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
  }, [isAuthenticated, room, nodes, edges, showToast]);

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

  const restoreSave = useCallback(async (saveId) => {
    try {
      const res = await mapsAPI.loadSave(saveId);
      const data = res.data;
      if (!data?.nodes) return showToast("Невалиден запис.");
      setNodes(data.nodes);
      setEdges(data.edges || []);
      scheduleBroadcast(data.nodes, data.edges || []);
      setShowHistory(false);
      showToast("Версията е възстановена.");
    } catch (err) {
      const apiError = err?.response?.data?.error;
      if (apiError === "forbidden") showToast("Нямаш права да възстановиш тази версия.");
      else showToast("Грешка при възстановяване.");
    }
  }, [scheduleBroadcast, showToast]);

  const exportJson = useCallback(() => {
    const payload = {
      exported_at: new Date().toISOString(),
      room,
      meta,
      nodes,
      edges,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeRoom = (room || "map").replace(/[^a-z0-9_-]/gi, "_");
    a.href = url;
    a.download = `mindmap_${safeRoom}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Експортът е готов.");
  }, [room, meta, nodes, edges, showToast]);

  const exportImage = useCallback(async () => {
    try {
      const payload = {
        exported_at: new Date().toISOString(),
        room,
        meta,
        nodes,
        edges,
      };
      const json = JSON.stringify(payload);
      const packed = "MM1:" + LZString.compressToEncodedURIComponent(json);

      const qrUrl = await QRCode.toDataURL(packed, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 8,
      });

      const qrImg = new Image();
      await new Promise((resolve, reject) => {
        qrImg.onload = resolve;
        qrImg.onerror = reject;
        qrImg.src = qrUrl;
      });

      const canvas = document.createElement("canvas");
      const w = 980;
      const h = 520;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas context");

      // background
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#0b1020");
      g.addColorStop(1, "#101a33");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // card
      const cardX = 28;
      const cardY = 28;
      const cardW = w - 56;
      const cardH = h - 56;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.strokeStyle = "rgba(124,92,255,0.22)";
      ctx.lineWidth = 2;
      roundRect(ctx, cardX, cardY, cardW, cardH, 18);
      ctx.fill();
      ctx.stroke();

      // Title
      ctx.fillStyle = "rgba(233,238,255,0.96)";
      ctx.font = "800 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("MindMapr • Export", cardX + 24, cardY + 52);

      // Subtitle
      ctx.fillStyle = "rgba(168,179,207,0.95)";
      ctx.font = "600 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Room: ${room}`, cardX + 24, cardY + 80);
      const counts = `${Array.isArray(nodes) ? nodes.length : 0} nodes • ${Array.isArray(edges) ? edges.length : 0} edges`;
      ctx.fillText(counts, cardX + 24, cardY + 100);

      // QR container
      const qrSize = 360;
      const qrX = cardX + cardW - qrSize - 24;
      const qrY = cardY + 90;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 18);
      ctx.fill();
      ctx.stroke();
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // Instructions
      ctx.fillStyle = "rgba(168,179,207,0.95)";
      ctx.font = "600 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      wrapText(
        ctx,
        "Import: Upload this image in MindMapr (Import Image) to restore the map.",
        cardX + 24,
        cardY + 150,
        cardW - qrSize - 72,
        20
      );
      ctx.fillStyle = "rgba(168,179,207,0.8)";
      ctx.font = "500 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("Note: Very large maps may not fit into a single QR image.", cardX + 24, cardY + cardH - 26);

      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      const safeRoom = (room || "map").replace(/[^a-z0-9_-]/gi, "_");
      a.href = url;
      a.download = `mindmap_${safeRoom}.png`;
      a.click();
      showToast("Експортът като изображение е готов.");
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (msg.toLowerCase().includes("code length") || msg.toLowerCase().includes("too long")) {
        showToast("Картата е твърде голяма за експорт като QR изображение. Ползвай Export JSON.");
      } else {
        showToast("Грешка при експорт като изображение.");
      }
    }
  }, [room, meta, nodes, edges, showToast]);

  const importImage = useCallback(async (file) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas context");
      ctx.drawImage(bitmap, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height, {
        inversionAttempts: "attemptBoth",
      });

      if (!code?.data) {
        showToast("Не открих QR код в изображението.");
        return;
      }

      const raw = String(code.data);
      let jsonText = raw;
      if (raw.startsWith("MM1:")) {
        const decompressed = LZString.decompressFromEncodedURIComponent(raw.slice(4));
        if (!decompressed) {
          showToast("QR кодът е невалиден или повреден.");
          return;
        }
        jsonText = decompressed;
      }

      const data = JSON.parse(jsonText);
      if (!Array.isArray(data?.nodes)) return showToast("Невалиден импорт (nodes). ");
      if (!Array.isArray(data?.edges)) return showToast("Невалиден импорт (edges). ");

      setNodes(data.nodes);
      setEdges(data.edges);
      if (data?.meta && typeof data.meta === "object") {
        setMeta((m) => ({
          ...m,
          name: typeof data.meta.name === "string" ? data.meta.name : m.name,
          description: typeof data.meta.description === "string" ? data.meta.description : m.description,
          tags: typeof data.meta.tags === "string" ? data.meta.tags : m.tags,
        }));
      }
      scheduleBroadcast(data.nodes, data.edges);
      showToast("Импортът от изображение е успешен.");
    } catch {
      showToast("Грешка при импорт от изображение.");
    }
  }, [scheduleBroadcast, showToast]);

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    let line = "";
    let yy = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      const w = ctx.measureText(test).width;
      if (w > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = words[i];
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  const importJson = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data?.nodes)) return showToast("Невалиден файл (nodes).");
      if (!Array.isArray(data?.edges)) return showToast("Невалиден файл (edges).");
      setNodes(data.nodes);
      setEdges(data.edges);
      scheduleBroadcast(data.nodes, data.edges);
      showToast("Импортът е успешен.");
    } catch {
      showToast("Грешка при импорт.");
    }
  }, [scheduleBroadcast, showToast]);

  const saveMeta = useCallback(async () => {
    if (!isAuthenticated) {
      showToast("Трябва да си влезнал(а), за да редактираш информацията.");
      return;
    }
    setMetaBusy(true);
    try {
      await roomsAPI.updateMeta(room, meta);
      showToast("Информацията е записана.");
    } catch (err) {
      const apiError = err?.response?.data?.error;
      if (apiError === "forbidden") showToast("Нямаш права да редактираш тази стая.");
      else showToast("Грешка при запис на информацията.");
    } finally {
      setMetaBusy(false);
    }
  }, [isAuthenticated, room, meta, showToast]);

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
  }, [nodes, edges, showToast]);

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
  }, [aiTopic, showToast]);

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
          <span style={{ fontSize: 18 }}>🧠 MindMapr</span>
          <span className="badge">Realtime</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="pill" title="Състояние на връзката за екипна работа">
            <span className={"dot " + (status === "online" ? "ok" : "bad")} />
            {status === "online" ? "онлайн" : "офлайн"}
          </span>
          <span className="pill" title="Последна синхронизация">
            ⏱ {lastSync || "—"}
          </span>
          {isAdmin ? (
            <button className="btn ghost" onClick={() => setShowAdmin(true)}>
              ⚙️ Admin
            </button>
          ) : null}
        </div>
      </div>

      <div className="main" ref={mainRef} style={{ gridTemplateColumns: `${panelWidth}px 12px 1fr` }}>
        <div className="panel">
          <div className="section">
            <h3>Стая за екипна работа</h3>
            <div className="col">
              <div className="row">
                <input
                  className="input"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="room-id"
                />
                <button
                  className="btn ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(shareLink);
                    showToast("Линкът е копиран. Изпрати го на екипа.");
                  }}
                >
                  🔗 Копирай линк
                </button>
              </div>
              <div className="row">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="име/ник"
                />
                <button
                  className="btn warn"
                  onClick={() => {
                    setRoom((r) => r + "");
                    showToast("Ако смениш room, ще се свържеш към нова стая.");
                  }}
                >
                  👥 Име
                </button>
              </div>
              <div className="small">
                Отвори линка на друг компютър/браузър със същия <b>room</b> и ще редактирате заедно в
                реално време.
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
                <button className="btn ghost" onClick={logout}>
                  Изход
                </button>
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
                  <button className="btn primary" onClick={handleLogin}>
                    Вход
                  </button>
                  <button className="btn ghost" onClick={handleRegister}>
                    Регистрация
                  </button>
                </div>
                {authError ? <div className="small" style={{ color: "#ff8f8f" }}>{authError}</div> : null}
              </div>
            )}
          </div>

          <div className="section">
            <h3>Инструменти</h3>
            <div className="col">
              <div className="row">
                <button className="btn primary" onClick={addIdea}>
                  ➕ Нова идея <span className="small">(Ctrl+K)</span>
                </button>
                <button className="btn ghost" onClick={renameSelected}>
                  ✏️ Преименувай <span className="small">(F2)</span>
                </button>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={deleteSelected}>
                  🗑 Изтрий <span className="small">(Del)</span>
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const starter = [
                      {
                        id: "root",
                        position: { x: 0, y: 0 },
                        data: { label: "Главна тема" },
                        type: "default"
                      }
                    ];
                    setNodes(starter);
                    setEdges([]);
                    scheduleBroadcast(starter, []);
                  }}
                >
                  ↩️ Нова карта
                </button>
              </div>
            </div>
          </div>

          <div className="section">
            <h3>Запис / Зареждане</h3>
            <div className="panelActionGrid">
              <button className="btn ghost" onClick={saveSnapshot}>
                💾 Запази
              </button>
              <button className="btn ghost" onClick={loadSnapshot}>
                📂 Зареди
              </button>
              <button className="btn ghost" onClick={() => setShowMapList(true)}>
                📜 Списък карти
              </button>
              <button className="btn ghost" onClick={() => setShowHistory(true)}>
                🕘 История
              </button>
              <Link className="btn ghost" to="/online">
                🌐 Онлайн карти
              </Link>
            </div>
            <div className="small">Записът е в базата данни. Изисква се вход в системата.</div>
            <MapListDialog open={showMapList} onClose={() => setShowMapList(false)} onSelect={handleSelectMap} />
            <MapHistoryDialog
              open={showHistory}
              onClose={() => setShowHistory(false)}
              room={room}
              onRestore={restoreSave}
            />
          </div>

          <div className="section">
            <h3>Експорт / Импорт</h3>
            <div className="panelActionGrid">
              <button className="btn ghost" onClick={exportJson}>⬇ Export JSON</button>
              <button className="btn ghost" onClick={() => importFileRef.current?.click()}>
                ⬆ Import JSON
              </button>
              <button className="btn ghost" onClick={exportImage}>🖼 Export Image</button>
              <button className="btn ghost" onClick={() => importImageRef.current?.click()}>
                🖼 Import Image
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  importJson(f);
                }}
              />
              <input
                ref={importImageRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  importImage(f);
                }}
              />
            </div>
            <div className="small">Можеш да запазиш/заредиш като JSON файл или като PNG изображение (QR).</div>
          </div>

          <div className="section">
            <h3>Информация за карта</h3>
            <div className="col">
              <input
                className="input"
                value={meta.name}
                onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
                placeholder="Име на карта (по избор)"
              />
              <input
                className="input"
                value={meta.description}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                placeholder="Описание (по избор)"
              />
              <input
                className="input"
                value={meta.tags}
                onChange={(e) => setMeta((m) => ({ ...m, tags: e.target.value }))}
                placeholder="Тагове (например: училище, история)"
              />
              <div className="row">
                <button className="btn ghost" onClick={loadMeta} disabled={metaBusy}>↻ Зареди</button>
                <button className="btn primary" onClick={saveMeta} disabled={metaBusy}>💾 Запази инфо</button>
              </div>
              <div className="small">Името/описанието се виждат и в „Онлайн карти“ (ако стаята е одобрена).</div>
            </div>
          </div>

          <div className="section">
            <h3>AI асистент</h3>
            <div className="col" style={{ gap: 10 }}>
              <div className="row">
                <input
                  className="input"
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="Въведи тема (например: Екология)"
                  disabled={aiLoading}
                />
                <button className="btn primary" onClick={generateMindMap} disabled={aiLoading}>
                  {aiLoading ? "Генерира..." : "🧠 Генерирай карта"}
                </button>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={runAI}>
                  🤖 Анализирай текущата карта
                </button>
              </div>
            </div>
            {aiResult ? (
              <div style={{ marginTop: 10 }}>
                <div className="pill" style={{ marginBottom: 8 }}>
                  🧾 Обобщение
                </div>
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                  {aiResult.summary}
                </div>
                <div style={{ height: 8 }} />
                <div className="pill" style={{ marginBottom: 8 }}>
                  ✨ Предложения
                </div>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {(aiResult.suggestions || []).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="small" style={{ marginTop: 8 }}>
                AI дава предложения за структура и липсващи теми на базата на възлите/връзките.
              </div>
            )}
          </div>

          <div className="footerNote">
            Съвет: влачи възлите с мишка. Свързвай възли като дърпаш от точката на възела към друг възел.
            <div className="help" style={{ marginTop: 10 }}>
              <span className="pill">Drag</span>
              <span className="pill">Connect</span>
              <span className="pill">Zoom</span>
              <span className="pill">MiniMap</span>
            </div>
          </div>
        </div>

        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Промени ширината на менюто"
          tabIndex={0}
          onMouseDown={(e) => {
            e.preventDefault();
            resizingRef.current = true;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPanelWidth((w) => Math.max(PANEL_MIN, w - 20));
            if (e.key === "ArrowRight") setPanelWidth((w) => Math.min(PANEL_MAX, w + 20));
            if (e.key === "Home") setPanelWidth(PANEL_MIN);
            if (e.key === "End") setPanelWidth(PANEL_MAX);
          }}
        />

        <div className="canvasWrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfRef.current = inst; }}
            onMouseMove={onCanvasMouseMove}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable={canEdit}
            edgesUpdatable={canEdit}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
            <CursorsOverlay cursors={cursors} myClientId={myClientId} />
          </ReactFlow>

          {toast ? <div className="toast">{toast}</div> : null}
        </div>
      </div>
      {showAdmin ? <AdminPanel onClose={() => setShowAdmin(false)} /> : null}
    </>
  );
}
