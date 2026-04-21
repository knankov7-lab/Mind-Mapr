import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Position,
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
import { mapsAPI, roomsAPI, commentsAPI } from "./api";
import AdminPanel from "./AdminPanel";
import MapListDialog from "./MapListDialog";
import MapHistoryDialog from "./MapHistoryDialog";
import { formatSofiaDateTime, formatSofiaTime, getSofiaNowTime } from "./time";

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

function createStarterNodes() {
  return [
    { id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема", shape: "rect" }, type: "idea" }
  ];
}

function sanitizeRoomSegment(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return normalized || "project";
}

function buildPersonalRoomId(userData) {
  const base = sanitizeRoomSegment(userData?.username || userData?.email?.split("@")[0] || "project");
  return `${base}-${Date.now().toString(36)}-${nanoid(6).toLowerCase()}`;
}

export default function EditorApp() {
  const [showMapList, setShowMapList] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  

  const { user, token, isAuthenticated, isAdmin, login, register, logout } = useAuth();
  const [room, setRoom] = useState(getRoomFromUrl());
  const [name, setName] = useState(() => localStorage.getItem("mm_name") || "guest");
  const [status, setStatus] = useState("offline"); // online/offline
  const [lastSync, setLastSync] = useState(null);
  const [clockTime, setClockTime] = useState(() => getSofiaNowTime());
  const [toast, setToast] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameModalInputRef = useRef(null);
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
    { id: "root", position: { x: 0, y: 0 }, data: { label: "Главна тема", shape: "rect" }, type: "idea" }
  ]);
  const [edges, setEdges] = useState([]);
  const [isMapCompletedView, setIsMapCompletedView] = useState(false);
  const [autoConnectToRoot, setAutoConnectToRoot] = useState(false);

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
  const [joinRequests, setJoinRequests] = useState([]);

  const [myClientId, setMyClientId] = useState(null);
  const [myRole, setMyRole] = useState('guest');
  const initialCanEdit = (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('edit') === '1';
    } catch (e) {
      return false;
    }
  })();
  const [canEdit, setCanEdit] = useState(initialCanEdit);
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

  const sendJoin = useCallback((nextRoom = room) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "join", room: nextRoom, name, token: token || '' }));
  }, [room, name, token]);

  useEffect(() => {
    localStorage.setItem("mm_name", name);
  }, [name]);
  useEffect(() => {
    setRoomInUrl(room);
  }, [room]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setClockTime(getSofiaNowTime());
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => setToast(""), 2500);
  }, []);

  const resetEditorForRoom = useCallback((nextRoom, message) => {
    const starter = normalizeNodes(createStarterNodes());
    setRoom(nextRoom);
    setNodes(starter);
    setEdges([]);
    setMeta({ name: "", description: "", tags: "" });
    setParticipants([]);
    setChatMessages([]);
    setComments([]);
    setCursors({});
    setShowMapList(false);
    setShowHistory(false);
    showToast(message || "Отворена е нова празна карта.");
  }, [showToast]);

  const startPersonalProject = useCallback((userData) => {
    const nextRoom = buildPersonalRoomId(userData || user);
    resetEditorForRoom(nextRoom, "Създаден е личен проект. Натисни Запази, за да го запишеш.");
  }, [resetEditorForRoom, user]);

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

  // Quietly ignore AbortError from interrupted media play() promises
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
      if (!proto) return;
      const origPlay = proto.play;
      proto.play = function () {
        const p = origPlay.apply(this, arguments);
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            // ignore AbortError caused by calling pause() immediately after play()
            if (err && (err.name === 'AbortError' || /play\(\) request was interrupted/i.test(String(err.message || '')))) {
              return;
            }
            // preserve other errors
            // eslint-disable-next-line no-console
            console.error('Media play() error:', err);
          });
        }
        return p;
      };
      return () => {
        try {
          proto.play = origPlay;
        } catch {}
      };
    } catch (e) {
      // ignore
    }
  }, []);

  // WebSocket connect & room join
  useEffect(() => {
    setJoinRequests([]);
  }, [room]);

  useEffect(() => {
    const ws = new WebSocket(WS);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("online");
      sendJoin(room);
      showToast("Свързан(а) за екипна работа. Сподели линка с room параметъра.");
    };
    ws.onclose = () => setStatus("offline");
    ws.onerror = () => setStatus("offline");

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state" && msg.room === room) {
          suppressRemoteRef.current = true;
          setNodes(normalizeNodes(msg.nodes || []));
          setEdges(msg.edges || []);
          setLastSync(Date.now());
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
        if (msg.type === 'join-request' && msg.request) {
          const req = msg.request;
          if (String(req.room || '') !== String(room || '')) return;
          setJoinRequests((prev) => {
            if (prev.some((item) => item.requestId === req.requestId)) return prev;
            return [...prev, req];
          });
          showToast(`Нова заявка за достъп от ${req.requesterName || req.requesterEmail || 'потребител'}.`);
        }
        if (msg.type === 'join-request-pending' && msg.room === room) {
          showToast(msg.message || 'Изчаква се одобрение от собственика на стаята.');
        }
        if (msg.type === 'join-request-result' && msg.room === room) {
          showToast(msg.message || (msg.approved ? 'Заявката е одобрена.' : 'Заявката е отказана.'));
          if (msg.approved) {
            setTimeout(() => sendJoin(room), 120);
          }
        }
      } catch {}
    };

    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, [room, sendJoin, showToast]);

  const decideJoinRequest = useCallback((requestId, action, role = 'viewer') => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) {
      showToast('Няма връзка със сървъра.');
      return;
    }
    ws.send(JSON.stringify({
      type: 'join-request-decision',
      requestId,
      action,
      role,
    }));
    setJoinRequests((prev) => prev.filter((item) => item.requestId !== requestId));
  }, [showToast]);

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
      setLastSync(Date.now());
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

  const handleSelectMap = async (roomId) => {
    setRoom(roomId);
    setShowMapList(false);
    try {
      const res = await mapsAPI.load(roomId);
      const data = res.data;
      console.log("Loaded map data:", data);
      if (!data?.nodes) return showToast("Невалиден запис.");
      setNodes(normalizeNodes(data.nodes));
      setEdges(data.edges || []);
      scheduleBroadcast(normalizeNodes(data.nodes), data.edges || []);
      showToast("Картата е заредена.");
    } catch {
      showToast("Грешка при зареждане на картата.");
    }
  };

  // normalize nodes to use local 'idea' node type and default shape
  const normalizeNodes = (list) => {
    if (!Array.isArray(list)) return [];
    return list.map((n) => {
      // Strip shape-related keys from node.style – those belong inside the
      // custom IdeaNode component, not on the ReactFlow wrapper div.
      const rawStyle = n.style || {};
      const cleanStyle = { ...rawStyle };
      delete cleanStyle.background;
      delete cleanStyle.backgroundColor;
      delete cleanStyle.boxShadow;
      delete cleanStyle.color;
      delete cleanStyle.width;
      delete cleanStyle.height;
      delete cleanStyle.padding;
      delete cleanStyle.borderRadius;
      delete cleanStyle.paddingLeft;
      delete cleanStyle.paddingRight;
      return {
        ...n,
        type: "idea",
        style: Object.keys(cleanStyle).length ? cleanStyle : undefined,
        data: {
          ...(n.data || {}),
          shape: (n.data && n.data.shape) || "rect",
        },
      };
    });
  };
  

  const hexToRgba = (hex, alpha = 1) => {
    if (!hex || typeof hex !== 'string') return null;
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const getCircleDiameterPx = (label) => {
    const text = String(label || '').trim();
    if (!text) return 92;
    const words = text.split(/\s+/).filter(Boolean);
    const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);
    return Math.max(92, Math.min(168, longestWordLength * 12 + 44, 168));
  };

  const getDiamondSizePx = (label) => {
    const text = String(label || '').trim();
    if (!text) return 96;
    const words = text.split(/\s+/).filter(Boolean);
    const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);
    const lineCount = Math.max(1, Math.min(words.length || 1, 3));
    const widthDriven = longestWordLength * 14 + 30;
    const heightDriven = lineCount * 24 + 50;
    return Math.max(96, Math.min(172, Math.max(widthDriven, heightDriven)));
  };

  const canvasRef = useRef(null);
  const [nodeContextMenu, setNodeContextMenu] = useState(null);
  const renameInputRef = useRef(null);
  const colorInputRef = useRef(null);
  const [previewShape, setPreviewShape] = useState(null);

  const IdeaNode = ({ id, data, selected }) => {
    const isPreview = previewShape && previewShape.nodeId === id;
    const displayShape = (isPreview && previewShape.shape) ? previewShape.shape : (data && data.shape) || "rect";
    const displayColor = (isPreview && previewShape.color) ? previewShape.color : (data && data.color);
    const style = {};
    if (displayColor) {
      // keep styling minimal here; prefer node.style from node object when present
      style.backgroundColor = displayColor;
      style.color = '#fff';
      style.boxShadow = `0 10px 30px ${hexToRgba(displayColor, 0.16) || 'rgba(0,0,0,.16)'}`;
      try { console.log('[IdeaNode] id=', id, 'color=', displayColor); } catch {}
    }

    // Inline adjustments per shape – must also reset conflicting base
    // .customNode styles (min-width, padding) so they don't override shape sizing.
    const shapeInline = {};
    if (displayShape === 'circle') {
      const circleSize = getCircleDiameterPx(data?.label);
      shapeInline.width = `${circleSize}px`;
      shapeInline.height = `${circleSize}px`;
      shapeInline.minWidth = `${circleSize}px`;
      shapeInline.minHeight = `${circleSize}px`;
      shapeInline.padding = '10px';
      shapeInline.display = 'flex';
      shapeInline.alignItems = 'center';
      shapeInline.justifyContent = 'center';
      shapeInline.borderRadius = '999px';
      shapeInline.overflow = 'hidden';
    } else if (displayShape === 'pill') {
      shapeInline.borderRadius = '999px';
      shapeInline.paddingLeft = '22px';
      shapeInline.paddingRight = '22px';
      shapeInline.paddingTop = '10px';
      shapeInline.paddingBottom = '10px';
      shapeInline.minHeight = '50px';
    } else if (displayShape === 'diamond') {
      const diamondSize = getDiamondSizePx(data?.label);
      shapeInline.width = `${diamondSize}px`;
      shapeInline.height = `${diamondSize}px`;
      shapeInline.minWidth = `${diamondSize}px`;
      shapeInline.minHeight = `${diamondSize}px`;
      shapeInline.padding = '8px';
      shapeInline.display = 'flex';
      shapeInline.alignItems = 'center';
      shapeInline.justifyContent = 'center';
      shapeInline.transform = 'rotate(45deg)';
      shapeInline.overflow = 'hidden';
    } else {
      // rect – ensure defaults
      shapeInline.borderRadius = '8px';
      shapeInline.minWidth = '88px';
      shapeInline.paddingTop = '12px';
      shapeInline.paddingBottom = '12px';
    }

    const finalStyle = { ...style, ...shapeInline };
    return (
      <div
        className={`customNode shape-${displayShape} ${isPreview ? "preview" : ""} ${selected ? "selected" : ""}`}
        style={finalStyle}
      >
        <Handle
          type="target"
          position={Position.Top}
          style={{ width: 8, height: 8, opacity: 0, pointerEvents: canEdit ? "auto" : "none" }}
        />
        <div className="nodeLabel" style={displayShape === 'diamond' ? { transform: 'rotate(-45deg)' } : undefined}>{data?.label}</div>
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ width: 8, height: 8, opacity: 0, pointerEvents: canEdit ? "auto" : "none" }}
        />
      </div>
    );
  };

  const nodeTypes = useMemo(() => ({ idea: IdeaNode }), []);

  const presentedEdges = useMemo(() => {
    if (!Array.isArray(edges)) return [];
    return edges.map((edge) => {
      const base = {
        ...edge,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: isMapCompletedView ? "#26d1a7" : "#8ea0d8",
        },
      };

      if (!isMapCompletedView) {
        return {
          ...base,
          className: "edge-normal",
          animated: true,
          style: {
            ...(edge?.style || {}),
            stroke: "#8ea0d8",
            strokeWidth: 2,
          },
        };
      }

      return {
        ...base,
        className: "edge-completed",
        animated: false,
        style: {
          ...(edge?.style || {}),
          stroke: "#26d1a7",
          strokeWidth: 3.2,
          strokeLinecap: "round",
        },
      };
    });
  }, [edges, isMapCompletedView]);

  const minimapNodeColor = useCallback((node) => {
    const custom = node?.data?.color || node?.style?.backgroundColor || node?.style?.background;
    if (typeof custom === "string" && custom.trim()) return custom;
    return node?.selected ? "#26d1a7" : "#7c5cff";
  }, []);

  const minimapNodeStrokeColor = useCallback((node) => {
    return node?.selected ? "#dffff7" : "#c9b8ff";
  }, []);

  console.log(nodes, "render nodes");

  const openNodeMenuAtEvent = (ev, node) => {
    if (!canEdit) return;
    try {
      ev.preventDefault();
    } catch {}
    try { console.log('[openNodeMenuAtEvent] nodeId=', node?.id, 'canEdit=', canEdit); } catch {}
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = rect ? ev.clientX - rect.left : ev.clientX;
    const y = rect ? ev.clientY - rect.top : ev.clientY;
    const label = (node && node.data && node.data.label) || "";
    // if node isn't selected yet, select it locally so actions apply to the intended node
    if (!node.selected) {
      setNodes((prev) => (prev || []).map((n) => ({ ...n, selected: n.id === node.id })));
    }
    setNodeContextMenu({
      x,
      y,
      nodeId: node.id,
      renameValue: label,
      editing: false,
      pendingColor: node?.data?.color ?? null,
    });
  };

  const closeNodeMenu = () => {
    setNodeContextMenu(null);
    setPreviewShape(null);
  };

  const renameNode = () => {
    if (!nodeContextMenu?.nodeId) return closeNodeMenu();
    setNodeContextMenu((prev) => ({ ...(prev || {}), editing: true }));
  };

  const commitRename = () => {
    if (!nodeContextMenu?.nodeId) return closeNodeMenu();
    const label = String(nodeContextMenu.renameValue || "").trim();
    if (!label) return closeNodeMenu();
    setNodes((prev) => {
      const next = (prev || []).map((n) =>
        n.id === nodeContextMenu.nodeId ? { ...n, data: { ...n.data, label } } : n
      );
      scheduleBroadcast(next, edges);
      return next;
    });
    closeNodeMenu();
  };

  const cancelRename = () => {
    if (nodeContextMenu?.editing) {
      setNodeContextMenu((prev) => ({ ...(prev || {}), editing: false }));
    } else {
      closeNodeMenu();
    }
  };

  const setShapeForNode = (shape) => {
    if (!nodeContextMenu?.nodeId) return closeNodeMenu();
    try { console.log('[setShapeForNode] nodeId=', nodeContextMenu.nodeId, 'shape=', shape); } catch {}
    setNodes((prev) => {
      const next = (prev || []).map((n) => {
        if (n.id !== nodeContextMenu.nodeId) return n;
        // Only store the shape in data – visual rendering is handled entirely
        // by the IdeaNode component. Remove any stale shape overrides
        // from node.style so the ReactFlow wrapper stays neutral.
        const rawStyle = n.style || {};
        const cleanStyle = { ...rawStyle };
        delete cleanStyle.width;
        delete cleanStyle.height;
        delete cleanStyle.padding;
        delete cleanStyle.borderRadius;
        delete cleanStyle.paddingLeft;
        delete cleanStyle.paddingRight;
        return {
          ...n,
          data: { ...(n.data || {}), shape },
          style: Object.keys(cleanStyle).length ? cleanStyle : undefined,
        };
      });
      scheduleBroadcast(next, edges);
      return next;
    });
    setPreviewShape(null);
    try { showToast(`Форма: ${shape}`); } catch {}
    closeNodeMenu();
  };

  const setColorForNode = (color) => {
    if (!nodeContextMenu?.nodeId) return closeNodeMenu();
    try {
      // eslint-disable-next-line no-console
      console.log('[setColorForNode] nodeId=', nodeContextMenu.nodeId, 'color=', color);
    } catch {}
    setNodes((prev) => {
      const next = (prev || []).map((n) => {
        if (n.id !== nodeContextMenu.nodeId) return n;
        const existingStyle = n.style || {};
        const cleanStyle = { ...(existingStyle || {}) };
        delete cleanStyle.background;
        delete cleanStyle.backgroundColor;
        delete cleanStyle.boxShadow;
        delete cleanStyle.color;

        return {
          ...n,
          data: { ...(n.data || {}), color },
          style: Object.keys(cleanStyle).length ? cleanStyle : undefined,
        };
      });
      scheduleBroadcast(next, edges);
      return next;
    });
    setPreviewShape(null);
    try { showToast(`Цвят: ${color ? color : 'изчистен'}`); } catch {}
    closeNodeMenu();
  };

  const activeNodeColor = (() => {
    if (nodeContextMenu && Object.prototype.hasOwnProperty.call(nodeContextMenu, 'pendingColor')) {
      return nodeContextMenu.pendingColor || '#7c5cff';
    }
    if (!nodeContextMenu?.nodeId) return '#7c5cff';
    const currentNode = (nodes || []).find((node) => node.id === nodeContextMenu.nodeId);
    return currentNode?.data?.color || '#7c5cff';
  })();

  const quickPaletteColors = [
    '#7c5cff',
    '#3b82f6',
    '#14b8a6',
    '#22c55e',
    '#eab308',
    '#f97316',
    '#ef4444',
    '#ec4899',
    '#64748b',
    '#111827',
  ];

  const previewNodeColor = (color) => {
    if (!nodeContextMenu?.nodeId) return;
    setPreviewShape({ nodeId: nodeContextMenu.nodeId, color });
  };

  const clearNodeColorPreview = () => {
    if (!nodeContextMenu?.nodeId) return;
    setPreviewShape({ nodeId: nodeContextMenu.nodeId, color: null });
  };

  const selectPendingNodeColor = (color) => {
    if (!nodeContextMenu?.nodeId) return;
    setNodeContextMenu((prev) => ({ ...(prev || {}), pendingColor: color }));
    setPreviewShape({ nodeId: nodeContextMenu.nodeId, color });
  };

  const restorePendingNodeColorPreview = () => {
    if (!nodeContextMenu?.nodeId) return;
    setPreviewShape({ nodeId: nodeContextMenu.nodeId, color: nodeContextMenu.pendingColor ?? null });
  };

  const confirmPendingNodeColor = () => {
    if (!nodeContextMenu?.nodeId) return closeNodeMenu();
    setColorForNode(nodeContextMenu.pendingColor ?? null);
  };

  const deleteNodeFromMenu = () => {
    if (!nodeContextMenu?.nodeId) return closeNodeMenu();
    const id = nodeContextMenu.nodeId;
    if (id === "root") {
      showToast("Главната тема не може да се изтрие.");
      closeNodeMenu();
      return;
    }
    const nextNodes = (nodes || []).filter((n) => n.id !== id);
    const nextEdges = (edges || []).filter((e) => e.source !== id && e.target !== id);
    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
    closeNodeMenu();
  };

  useEffect(() => {
    const onDoc = (e) => {
      if (!nodeContextMenu) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const menuEl = document.querySelector('.contextMenu');
      if (menuEl && (menuEl === e.target || menuEl.contains(e.target))) return;
      // if click outside canvas or menu, close
      if (!canvas.contains(e.target)) closeNodeMenu();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [nodeContextMenu]);

  useEffect(() => {
    if (nodeContextMenu?.editing) {
      // small timeout to ensure element is in DOM
      setTimeout(() => {
        try {
          renameInputRef.current?.focus();
          renameInputRef.current?.select && renameInputRef.current.select();
        } catch {}
      }, 10);
    }
  }, [nodeContextMenu?.editing]);

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
      if (!connection?.source || !connection?.target) return;
      if (connection.source === connection.target) return;
      setEdges((eds) => {
        const alreadyLinked = (eds || []).some(
          (edge) => edge.source === connection.source && edge.target === connection.target
        );
        if (alreadyLinked) return eds;
        const next = addEdge({ ...connection, animated: true }, eds);
        scheduleBroadcast(nodes, next);
        return next;
      });
    },
    [canEdit, nodes, scheduleBroadcast]
  );

  const deleteNodeByDoubleClick = useCallback(
    (_event, node) => {
      if (!canEdit) return;
      const nodeId = node?.id;
      if (!nodeId || nodeId === "root") {
        showToast("Главната тема не може да се изтрие.");
        return;
      }

      const ok = window.confirm(`Да изтрия ли възела "${node?.data?.label || nodeId}"?`);
      if (!ok) return;

      const nextNodes = (nodes || []).filter((n) => n.id !== nodeId);
      const nextEdges = (edges || []).filter((e) => e.source !== nodeId && e.target !== nodeId);
      setNodes(nextNodes);
      setEdges(nextEdges);
      scheduleBroadcast(nextNodes, nextEdges);
      showToast("Възелът е изтрит.");
    },
    [canEdit, nodes, edges, scheduleBroadcast, showToast]
  );

  const addIdea = useCallback(() => {
    if (!canEdit) return;
    const id = nanoid(8);
    const baseX = Math.random() * 320 + 120;
    const baseY = Math.random() * 260 - 120;

    const newNode = {
      id,
      position: { x: baseX, y: baseY },
      data: { label: "Нова идея", shape: "rect" },
      type: "idea"
    };

    const nextNodes = [...nodes, newNode];
    const nextEdges = autoConnectToRoot
      ? [...edges, { id: `e-root-${id}`, source: "root", target: id, animated: true }]
      : [...edges];

    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
  }, [canEdit, nodes, edges, autoConnectToRoot, scheduleBroadcast]);

  const connectSelectedNodes = useCallback(() => {
    if (!canEdit) return;
    const selected = (nodes || []).filter((n) => n.selected);
    if (selected.length !== 2) {
      showToast("Маркирай точно 2 възела, за да ги свържеш.");
      return;
    }

    const [sourceNode, targetNode] = selected;
    if (!sourceNode?.id || !targetNode?.id || sourceNode.id === targetNode.id) return;

    const exists = (edges || []).some((e) => e.source === sourceNode.id && e.target === targetNode.id);
    if (exists) {
      showToast("Тези възли вече са свързани.");
      return;
    }

    const nextEdges = addEdge({ source: sourceNode.id, target: targetNode.id, animated: true }, edges || []);
    setEdges(nextEdges);
    scheduleBroadcast(nodes, nextEdges);
    showToast(`Свързах "${sourceNode.data?.label || sourceNode.id}" → "${targetNode.data?.label || targetNode.id}".`);
  }, [canEdit, nodes, edges, scheduleBroadcast, showToast]);

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
            <span style={{opacity:.75}}>[{formatSofiaTime(m.at)}]</span>{' '}
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
                <span style={{opacity:.75}}> · {formatSofiaDateTime(c.created_at)}</span>
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
          className="input"
        />
        <div />
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Добави коментар..."
          className="input"
          rows={3}
          style={{gridColumn:'1 / span 2',resize:'vertical'}}
        />
        <button className="btn primary" onClick={addComment} style={{gridColumn:'2',justifySelf:'end'}}>Изпрати</button>
      </div>
    </div>
  );

  const renameSelected = useCallback(() => {
    if (!canEdit) return;
    const selected = nodes.find((n) => n.selected);
    if (!selected) {
      showToast("Маркирай възел (клик) и опитай пак.");
      return;
    }
    setRenameValue(selected.data?.label || "");
    setShowRenameModal(true);
  }, [canEdit, nodes, showToast]);

  const commitRenameSelected = useCallback(() => {
    const label = String((renameValue || "").trim());
    if (!label) {
      setShowRenameModal(false);
      return;
    }
    const selected = nodes.find((n) => n.selected);
    if (!selected) {
      setShowRenameModal(false);
      showToast("Маркирай възел (клик) и опитай пак.");
      return;
    }
    const nextNodes = nodes.map((n) =>
      n.id === selected.id ? { ...n, data: { ...n.data, label } } : n
    );
    setNodes(nextNodes);
    scheduleBroadcast(nextNodes, edges);
    setShowRenameModal(false);
  }, [nodes, edges, renameValue, scheduleBroadcast, showToast]);

  const cancelRenameSelected = useCallback(() => {
    setShowRenameModal(false);
  }, []);

  useEffect(() => {
    if (showRenameModal) {
      setTimeout(() => {
        if (renameModalInputRef.current) {
          renameModalInputRef.current.focus();
          renameModalInputRef.current.select();
        }
      }, 0);
    }
  }, [showRenameModal]);

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
      setNodes(normalizeNodes(data.nodes));
      setEdges(data.edges || []);
      scheduleBroadcast(normalizeNodes(data.nodes), data.edges || []);
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
      setNodes(normalizeNodes(data.nodes));
      setEdges(data.edges || []);
      scheduleBroadcast(normalizeNodes(data.nodes), data.edges || []);
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

      setNodes(normalizeNodes(data.nodes));
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
      setNodes(normalizeNodes(data.nodes));
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
    startPersonalProject(result.user || { email: authForm.email, username: authForm.username });
    showToast("Регистрацията е успешна. Създадох ти личен проект.");
    setAuthForm((prev) => ({ ...prev, password: "" }));
  }, [authForm.email, authForm.password, authForm.username, register, showToast, startPersonalProject]);

  // AI features removed: runAI and generateMindMap disabled

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
          <span className="pill" title={lastSync ? `Последна синхронизация: ${formatSofiaDateTime(lastSync)}` : "Текущ час в България"}>
            ⏱ {clockTime}
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
              {isAuthenticated ? (
                <button className="btn primary" onClick={() => startPersonalProject(user)}>
                  🆕 Мой проект
                </button>
              ) : null}
            </div>
          </div>

          <div className="section">
            <h3>Профил</h3>
            {isAuthenticated ? (
              <div className="col">
                <div className="small">
                  Влезнал(а) като <b>{user?.email}</b> ({user?.role})
                </div>
                <button className="btn primary" onClick={() => startPersonalProject(user)}>
                  🆕 Нов личен проект
                </button>
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

          {isAuthenticated && (myRole === 'owner' || myRole === 'admin') && joinRequests.length > 0 ? (
            <div className="section">
              <h3>Заявки за достъп</h3>
              <div className="col">
                {joinRequests.map((req) => (
                  <div key={req.requestId} className="small" style={{ border: '1px solid #2b3550', borderRadius: 10, padding: 10 }}>
                    <div><b>{req.requesterName || req.requesterUsername || req.requesterEmail || 'Потребител'}</b></div>
                    <div style={{ opacity: 0.85 }}>иска достъп до стаята</div>
                    <div style={{ marginBottom: 8 }}><b>{req.room}</b></div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <button className="btn primary" onClick={() => decideJoinRequest(req.requestId, 'approve', 'editor')}>
                        Одобри като Editor
                      </button>
                      <button className="btn ghost" onClick={() => decideJoinRequest(req.requestId, 'approve', 'viewer')}>
                        Одобри като Viewer
                      </button>
                      <button className="btn warn" onClick={() => decideJoinRequest(req.requestId, 'deny')}>
                        Откажи
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
                    resetEditorForRoom(room, "Отворена е нова празна карта в текущата стая.");
                  }}
                >
                  ↩️ Нова карта
                </button>
                <button
                  className={isMapCompletedView ? "btn primary" : "btn ghost"}
                  onClick={() => {
                    setIsMapCompletedView((v) => !v);
                    showToast(!isMapCompletedView ? "Включен е режим: Завършена карта." : "Изключен е режим: Завършена карта.");
                  }}
                >
                  ✅ Завършена карта
                </button>
              </div>
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <button className="btn ghost" onClick={connectSelectedNodes}>
                  🔗 Свържи избраните 2 възела
                </button>
                <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={autoConnectToRoot}
                    onChange={(e) => setAutoConnectToRoot(e.target.checked)}
                  />
                  Авто връзка към главната тема
                </label>
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

          {/* AI assistant removed */}

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

        <div className="canvasWrap" ref={canvasRef}>
          <ReactFlow
            nodes={nodes}
            edges={presentedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfRef.current = inst; }}
            nodeTypes={nodeTypes}
            onNodeContextMenu={openNodeMenuAtEvent}
            onNodeDoubleClick={deleteNodeByDoubleClick}
            onMouseMove={onCanvasMouseMove}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable={canEdit}
            edgesUpdatable={canEdit}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <MiniMap
              pannable
              zoomable
              nodeColor={minimapNodeColor}
              nodeStrokeColor={minimapNodeStrokeColor}
              nodeStrokeWidth={2}
              maskColor="rgba(6, 10, 20, 0.35)"
              style={{ width: 220, height: 140 }}
            />
            <Controls />
            <CursorsOverlay cursors={cursors} myClientId={myClientId} />
          </ReactFlow>

          {nodeContextMenu ? (
            <div
              className="contextMenu"
              style={{ position: 'absolute', left: nodeContextMenu.x, top: nodeContextMenu.y, zIndex: 1200 }}
            >
              {nodeContextMenu.editing ? (
                <div className="contextItem" style={{ flexDirection: 'column', gap: 8 }}>
                  <input
                    ref={renameInputRef}
                    className="contextRenameInput"
                    value={nodeContextMenu.renameValue || ''}
                    onChange={(e) => setNodeContextMenu((prev) => ({ ...(prev || {}), renameValue: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    placeholder="Ново име..."
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button className="btn primary" onClick={commitRename}>OK</button>
                    <button className="btn ghost" onClick={cancelRename}>Отмени</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="contextItem" onClick={renameNode}>✏️ Преименувай</div>
                  <div className="contextItem">
                    Форма
                    <div className="shapeList">
                      <button
                        type="button"
                        className="shapeBtn"
                        onMouseEnter={() => setPreviewShape({ nodeId: nodeContextMenu.nodeId, shape: 'rect' })}
                        onMouseLeave={() => setPreviewShape(null)}
                        onClick={(e) => { try { console.log('[shapeBtn.click] rect', e.target); } catch {} ; setShapeForNode('rect'); }}
                      >▭</button>
                      <button
                        type="button"
                        className="shapeBtn"
                        onMouseEnter={() => setPreviewShape({ nodeId: nodeContextMenu.nodeId, shape: 'pill' })}
                        onMouseLeave={() => setPreviewShape(null)}
                        onClick={(e) => { try { console.log('[shapeBtn.click] pill', e.target); } catch {} ; setShapeForNode('pill'); }}
                      >▯</button>
                      <button
                        type="button"
                        className="shapeBtn"
                        onMouseEnter={() => setPreviewShape({ nodeId: nodeContextMenu.nodeId, shape: 'circle' })}
                        onMouseLeave={() => setPreviewShape(null)}
                        onClick={(e) => { try { console.log('[shapeBtn.click] circle', e.target); } catch {} ; setShapeForNode('circle'); }}
                      >◯</button>
                      <button
                        type="button"
                        className="shapeBtn"
                        onMouseEnter={() => setPreviewShape({ nodeId: nodeContextMenu.nodeId, shape: 'diamond' })}
                        onMouseLeave={() => setPreviewShape(null)}
                        onClick={(e) => { try { console.log('[shapeBtn.click] diamond', e.target); } catch {} ; setShapeForNode('diamond'); }}
                      >◆</button>
                    </div>
                  </div>
                  <div className="contextItem">
                    Цвят
                    <div className="shapeList colorPalette">
                      <button
                        type="button"
                        className="colorClearBtn"
                        onMouseEnter={clearNodeColorPreview}
                        onMouseLeave={restorePendingNodeColorPreview}
                        onClick={() => selectPendingNodeColor(null)}
                        title="Изчисти цвета"
                      >
                        Без цвят
                      </button>
                      {quickPaletteColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="colorSwatchBtn"
                          style={{ background: color }}
                          onMouseEnter={() => previewNodeColor(color)}
                          onMouseLeave={restorePendingNodeColorPreview}
                          onClick={() => selectPendingNodeColor(color)}
                          title={color}
                          aria-label={`Избери цвят ${color}`}
                        />
                      ))}
                      <button
                        type="button"
                        className="colorPickerTrigger"
                        onMouseLeave={restorePendingNodeColorPreview}
                        onClick={() => colorInputRef.current?.click()}
                        title="Отвори палитра за избор на цвят"
                      >
                        <span className="colorPickerSwatch" style={{ background: activeNodeColor }} />
                        Още
                      </button>
                      <input
                        ref={colorInputRef}
                        className="colorPickerInput"
                        type="color"
                        value={activeNodeColor}
                        onChange={(e) => selectPendingNodeColor(e.target.value)}
                        aria-label="Избери цвят за node"
                      />
                      <button
                        type="button"
                        className="colorConfirmBtn"
                        onClick={confirmPendingNodeColor}
                        title="Потвърди избрания цвят"
                      >
                        Потвърди
                      </button>
                    </div>
                  </div>
                  <div className="contextItem" onClick={deleteNodeFromMenu}>🗑 Изтрий възел</div>
                  <div className="contextItem" onClick={closeNodeMenu}>✖️ Затвори</div>
                </>
              )}
            </div>
          ) : null}

          {toast ? <div className="toast">{toast}</div> : null}
        </div>
      </div>
      {showRenameModal ? (
        <div className="page-overlay" style={{ zIndex: 1400 }} onMouseDown={() => setShowRenameModal(false)}>
          <div className="page" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(480px, 92vw)' }}>
            <h3 style={{ marginBottom: 10 }}>Преименуване на възел</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                ref={renameModalInputRef}
                className="input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRenameSelected();
                  if (e.key === 'Escape') cancelRenameSelected();
                }}
                placeholder="Ново име на възела..."
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={cancelRenameSelected}>Отмени</button>
                <button className="btn primary" onClick={commitRenameSelected}>OK</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showAdmin ? <AdminPanel onClose={() => setShowAdmin(false)} /> : null}
    </>
  );
}
