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
import SidebarWorkflowGroup from "./SidebarWorkflowGroup";
import { formatSofiaDateTime, formatSofiaTime, getSofiaNowTime } from "./time";
import "./styles/sidebar-sections.css";

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
const HISTORY_AUTOSAVE_INTERVAL_MS = 20000;

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

const CHAT_FLOATING_POSITION_KEY = "mindmapr.chatFloating.position";
const MOBILE_PANEL_BTN_POSITION_KEY = "mindmapr.mobilePanelBtn.position";

function safeLocalStorageGet(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function ChatFloating({ chatMessages, chatText, setChatText, sendChat, participants, formatSofiaTime }) {
  const [open, setOpen] = React.useState(false);
  const [panelRendered, setPanelRendered] = React.useState(false);
  const [panelVisible, setPanelVisible] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [position, setPosition] = React.useState(() => {
    if (typeof window === 'undefined') return { x: 24, y: 88 };
    try {
      const raw = window.localStorage.getItem(CHAT_FLOATING_POSITION_KEY);
      if (!raw) return { x: 24, y: 88 };
      const parsed = JSON.parse(raw);
      const x = Number(parsed?.x);
      const y = Number(parsed?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 24, y: 88 };
      return { x, y };
    } catch {
      return { x: 24, y: 88 };
    }
  });
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const prevLen = React.useRef(chatMessages.length);
  const dragRef = React.useRef({ startX: 0, startY: 0, originX: 24, originY: 88 });
  const suppressToggleRef = React.useRef(false);

  React.useEffect(() => {
    if (!open && chatMessages.length > prevLen.current) {
      setUnread((u) => u + (chatMessages.length - prevLen.current));
    }
    prevLen.current = chatMessages.length;
  }, [chatMessages.length, open]);

  React.useEffect(() => {
    if (open) {
      setUnread(0);
      // scroll to bottom
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [open, chatMessages.length]);

  React.useEffect(() => {
    if (open) {
      setPanelRendered(true);
      const frameId = window.requestAnimationFrame(() => {
        setPanelVisible(true);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    setPanelVisible(false);
    const timer = window.setTimeout(() => {
      setPanelRendered(false);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  React.useEffect(() => {
    if (!panelRendered) {
      setPanelVisible(false);
    }
  }, [panelRendered]);

  const clampPosition = React.useCallback((nextPosition) => {
    const width = containerRef.current?.offsetWidth || (open ? 320 : 48);
    const height = containerRef.current?.offsetHeight || (open ? 420 : 48);
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);

    return {
      x: Math.min(Math.max(8, nextPosition.x), maxX),
      y: Math.min(Math.max(8, nextPosition.y), maxY),
    };
  }, [open]);

  React.useEffect(() => {
    if (!dragging) return undefined;

    function onMouseMove(event) {
      const deltaX = event.clientX - dragRef.current.startX;
      const deltaY = event.clientY - dragRef.current.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        suppressToggleRef.current = true;
      }
      setPosition(clampPosition({
        x: dragRef.current.originX + deltaX,
        y: dragRef.current.originY + deltaY,
      }));
    }

    function onMouseUp() {
      setDragging(false);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [clampPosition, dragging]);

  React.useEffect(() => {
    function onResize() {
      setPosition((current) => clampPosition(current));
    }

    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [clampPosition]);

  React.useEffect(() => {
    setPosition((current) => clampPosition(current));
  }, [clampPosition, open]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CHAT_FLOATING_POSITION_KEY, JSON.stringify(position));
    } catch {
      // ignore storage failures
    }
  }, [position]);

  const startDrag = React.useCallback((event) => {
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    suppressToggleRef.current = false;
    setDragging(true);
  }, [position.x, position.y]);

  const toggleOpen = React.useCallback((event) => {
    if (suppressToggleRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressToggleRef.current = false;
      return;
    }
    setOpen((value) => !value);
  }, []);

  return (
    <div
      ref={containerRef}
      className="chatFloating"
      style={{ top: position.y, left: position.x }}
    >
      {panelRendered && (
        <div className={`chatFloatingPanel ${panelVisible ? 'is-open' : 'is-hidden'}`}>
          <div
            className={`chatFloatingHeader ${dragging ? 'is-dragging' : ''}`}
            onMouseDown={startDrag}
          >
            <span className="chatFloatingTitle">💬 Чат на стаята</span>
            <div className="chatFloatingHeaderMeta">
              <span className="chatFloatingOnlineCount">{participants.length} онлайн</span>
              <button
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setOpen(false)}
                className="chatFloatingCloseBtn"
                type="button"
              >
                ✕
              </button>
            </div>
          </div>

          <div ref={bodyRef} className="chatFloatingBody">
            {chatMessages.length === 0 && <div className="chatFloatingEmpty">Няма съобщения още.</div>}
            {chatMessages.map((m) => (
              <div key={m.id || m.at || Math.random()} className="chatFloatingMessage">
                <span className="chatFloatingMessageTime">[{formatSofiaTime(m.at)}]</span>{' '}
                <b className="chatFloatingMessageAuthor">{m.name || 'guest'}:</b>{' '}
                <span className="chatFloatingMessageText">{m.text}</span>
              </div>
            ))}
          </div>

          <div className="chatFloatingInputRow">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  sendChat();
                }
              }}
              placeholder="Съобщение…"
              className="chatFloatingInput"
            />
            <button
              onClick={sendChat}
              className="chatFloatingSendBtn"
              type="button"
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <button
        onMouseDown={startDrag}
        onClick={toggleOpen}
        className={`chatFloatingToggle ${dragging ? 'is-dragging' : ''}`}
        title="Чат"
        type="button"
      >
        💬
        {unread > 0 && (
          <span className="chatFloatingUnread">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
    </div>
  );
}

export default function EditorApp() {
  const [showMapList, setShowMapList] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [mobilePanelBtnPosition, setMobilePanelBtnPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 14, y: 72 };
    try {
      const raw = window.localStorage.getItem(MOBILE_PANEL_BTN_POSITION_KEY);
      if (!raw) return { x: 14, y: Math.max(72, window.innerHeight - 66) };
      const parsed = JSON.parse(raw);
      const x = Number(parsed?.x);
      const y = Number(parsed?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { x: 14, y: Math.max(72, window.innerHeight - 66) };
      }
      return { x, y };
    } catch {
      return { x: 14, y: Math.max(72, window.innerHeight - 66) };
    }
  });
  const [draggingMobilePanelBtn, setDraggingMobilePanelBtn] = useState(false);
  const mobilePanelBtnDragRef = useRef({
    startX: 0,
    startY: 0,
    originX: 14,
    originY: 72,
  });
  const suppressMobilePanelBtnClickRef = useRef(false);

  const clampMobilePanelBtnPosition = useCallback((nextPosition) => {
    const btnSize = 48;
    const margin = 8;
    const headerBottom = Math.max(
      54,
      Math.round(document.querySelector('.header')?.getBoundingClientRect()?.bottom || 54)
    );
    const minX = margin;
    const maxX = Math.max(minX, window.innerWidth - btnSize - margin);
    const minY = Math.min(window.innerHeight - btnSize - margin, headerBottom + 6);
    const maxY = Math.max(minY, window.innerHeight - btnSize - margin);

    return {
      x: Math.min(Math.max(minX, Number(nextPosition?.x) || minX), maxX),
      y: Math.min(Math.max(minY, Number(nextPosition?.y) || minY), maxY),
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setMobilePanelBtnPosition((current) => clampMobilePanelBtnPosition(current));
  }, [clampMobilePanelBtnPosition, isMobile]);

  useEffect(() => {
    if (!draggingMobilePanelBtn) return undefined;

    const onMouseMove = (event) => {
      const deltaX = event.clientX - mobilePanelBtnDragRef.current.startX;
      const deltaY = event.clientY - mobilePanelBtnDragRef.current.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        suppressMobilePanelBtnClickRef.current = true;
      }
      setMobilePanelBtnPosition(clampMobilePanelBtnPosition({
        x: mobilePanelBtnDragRef.current.originX + deltaX,
        y: mobilePanelBtnDragRef.current.originY + deltaY,
      }));
    };

    const onTouchMove = (event) => {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const deltaX = touch.clientX - mobilePanelBtnDragRef.current.startX;
      const deltaY = touch.clientY - mobilePanelBtnDragRef.current.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        suppressMobilePanelBtnClickRef.current = true;
      }
      setMobilePanelBtnPosition(clampMobilePanelBtnPosition({
        x: mobilePanelBtnDragRef.current.originX + deltaX,
        y: mobilePanelBtnDragRef.current.originY + deltaY,
      }));
      event.preventDefault();
    };

    const stopDrag = () => {
      setDraggingMobilePanelBtn(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
    window.addEventListener('touchcancel', stopDrag);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stopDrag);
      window.removeEventListener('touchcancel', stopDrag);
    };
  }, [clampMobilePanelBtnPosition, draggingMobilePanelBtn]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MOBILE_PANEL_BTN_POSITION_KEY, JSON.stringify(mobilePanelBtnPosition));
    } catch {
      // ignore storage failures
    }
  }, [mobilePanelBtnPosition]);

  useEffect(() => {
    const onResize = () => {
      setMobilePanelBtnPosition((current) => clampMobilePanelBtnPosition(current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampMobilePanelBtnPosition]);

  const startMobilePanelBtnDrag = useCallback((clientX, clientY) => {
    mobilePanelBtnDragRef.current = {
      startX: clientX,
      startY: clientY,
      originX: mobilePanelBtnPosition.x,
      originY: mobilePanelBtnPosition.y,
    };
    suppressMobilePanelBtnClickRef.current = false;
    setDraggingMobilePanelBtn(true);
  }, [mobilePanelBtnPosition.x, mobilePanelBtnPosition.y]);

  const onMobilePanelBtnClick = useCallback((event) => {
    if (suppressMobilePanelBtnClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressMobilePanelBtnClickRef.current = false;
      return;
    }
    setShowMobilePanel(true);
  }, []);

  const { user, token, isAuthenticated, isAdmin, login, register, logout, changePassword } = useAuth();
  const [room, setRoom] = useState(getRoomFromUrl());
  const [name, setName] = useState(() => safeLocalStorageGet("mm_name") || "guest");
  const [status, setStatus] = useState("offline"); // online/offline
  const [lastSync, setLastSync] = useState(null);
  const [clockTime, setClockTime] = useState(() => getSofiaNowTime());
  const [toast, setToast] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameModalInputRef = useRef(null);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [authForm, setAuthForm] = useState({ email: "", password: "", username: "" });
  const [authError, setAuthError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const onboardingBootKeyRef = useRef(null);

  const onboardingSteps = useMemo(() => [
    {
      title: "Добре дошъл в MindMapr",
      body: "Това е разширен стартов тур. Ще минем през целия поток: проект, редакция, споделяне, история и импорт/експорт.",
      points: [
        "Можеш да прекъснеш с Пропусни и да продължиш по-късно.",
        "Турът се показва автоматично само при първи вход.",
        "Може да го стартираш отново от секцията Профил."
      ],
      shortcuts: ["Esc: затвори тура", "← / →: предишна или следваща стъпка"]
    },
    {
      title: "1) Настрой стаята",
      body: "Горе в секцията „Стая за екипна работа“ избираш room-id. Това е общото пространство за съвместна работа.",
      points: [
        "Смени room-id, за да преминеш в друга карта.",
        "С „Копирай линк“ пращаш точната стая на екипа.",
        "Името/никът се вижда в чата и присъствието."
      ]
    },
    {
      title: "2) Създай личен проект",
      body: "Ползвай „Мой проект“ или „Нов личен проект“, за да създадеш лична стая с уникален идентификатор.",
      points: [
        "Това е добрата отправна точка за всяка нова карта.",
        "После натисни „Запази“, за да запишеш snapshot в базата.",
        "Без вход не може постоянен запис."
      ]
    },
    {
      title: "3) Бързо редактиране",
      body: "Работиш директно на canvas: добавяш възли, местиш ги и правиш връзки между тях.",
      points: [
        "Десен клик върху възел: преименуване, форма, цвят, изтриване.",
        "„Свържи избраните 2 възела“ прави ръчна връзка.",
        "„Авто връзка към главната тема“ ускорява структурата."
      ],
      shortcuts: ["Ctrl+K: нова идея", "F2: преименувай избрания възел", "Delete: изтрий избраното"]
    },
    {
      title: "4) Колаборация и роли",
      body: "Сподели линка към стаята. За частни стаи достъпът минава през одобрение от ръководител на стаята.",
      points: [
        "Viewer: вижда карта, няма право на редакция.",
        "Editor: пълна редакция в реално време.",
        "Owner/Admin: вижда заявки и решава одобрение/отказ."
      ]
    },
    {
      title: "5) Запис, история и възстановяване",
      body: "Използвай „Запази/Зареди“ за текущ snapshot, „Списък карти“ за личните карти и „История“ за версии.",
      points: [
        "Историята помага да се върнеш към предишна версия.",
        "При възстановяване се изпраща актуализация към участниците.",
        "„Онлайн карти“ показва публично одобрени карти."
      ]
    },
    {
      title: "6) Импорт и експорт",
      body: "Можеш да изнасяш карта като JSON или PNG QR и после да я върнеш с Import.",
      points: [
        "JSON е най-надежден за големи карти.",
        "PNG QR е удобен за споделяне в презентации.",
        "При проблем с голям QR, използвай Export JSON."
      ]
    },
    {
      title: "Готово: стартов checklist",
      body: "Преди да започнеш реална работа, мини през тези 4 бързи точки.",
      points: [
        "Създай или избери правилния room-id.",
        "Направи първи запис с „Запази“.",
        "Покани екипа с „Копирай линк“.",
        "Пусни турa отново от Профил, ако нещо е неясно."
      ]
    }
  ], []);

  const onboardingStorageKey = useMemo(() => {
    const identity = user?.id || user?.email || user?.username;
    if (!identity) return null;
    return `mm_onboarding_seen_${String(identity).toLowerCase()}`;
  }, [user]);

  const PANEL_MIN = 240;
  const PANEL_MAX = 560;
  const [panelWidth, setPanelWidth] = useState(() => {
    const raw = safeLocalStorageGet("mm_panelWidth");
    const n = Number(raw);
    if (Number.isFinite(n) && n >= PANEL_MIN && n <= PANEL_MAX) return n;
    return 320;
  });
  const mainRef = useRef(null);
  const panelScrollRef = useRef(null);
  const workflowSectionRefs = useRef({});
  const resizingRef = useRef(false);
  const [activeWorkflowTab, setActiveWorkflowTab] = useState("create");

  useEffect(() => {
    safeLocalStorageSet("mm_panelWidth", String(panelWidth));
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
  const lastSavedSnapshotRef = useRef("");

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
    safeLocalStorageSet("mm_name", name);
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

  const finishOnboarding = useCallback((showDoneToast = true) => {
    if (onboardingStorageKey) {
      safeLocalStorageSet(onboardingStorageKey, '1');
    }
    setShowOnboarding(false);
    if (showDoneToast) {
      showToast('Готово. Успешен старт в MindMapr.');
    }
  }, [onboardingStorageKey, showToast]);

  const skipOnboarding = useCallback(() => {
    finishOnboarding(false);
  }, [finishOnboarding]);

  const nextOnboardingStep = useCallback(() => {
    if (onboardingStep >= onboardingSteps.length - 1) {
      finishOnboarding(true);
      return;
    }
    setOnboardingStep((prev) => Math.min(onboardingSteps.length - 1, prev + 1));
  }, [onboardingStep, onboardingSteps.length, finishOnboarding]);

  const prevOnboardingStep = useCallback(() => {
    setOnboardingStep((prev) => Math.max(0, prev - 1));
  }, []);

  const openOnboardingTutorial = useCallback((step = 0) => {
    const index = Number.isFinite(Number(step)) ? Number(step) : 0;
    const clamped = Math.max(0, Math.min(onboardingSteps.length - 1, index));
    setOnboardingStep(clamped);
    setShowOnboarding(true);
  }, [onboardingSteps.length]);

  useEffect(() => {
    const bootKey = isAuthenticated && onboardingStorageKey ? onboardingStorageKey : null;
    if (onboardingBootKeyRef.current === bootKey) return;
    onboardingBootKeyRef.current = bootKey;

    if (!bootKey) {
      setShowOnboarding(false);
      setOnboardingStep(0);
      return;
    }

    const hasSeen = safeLocalStorageGet(bootKey) === '1';
    if (!hasSeen) {
      setOnboardingStep(0);
      setShowOnboarding(true);
    }
  }, [isAuthenticated, onboardingStorageKey]);

  useEffect(() => {
    if (!showOnboarding) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') skipOnboarding();
      if (e.key === 'ArrowRight') nextOnboardingStep();
      if (e.key === 'ArrowLeft') prevOnboardingStep();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showOnboarding, nextOnboardingStep, prevOnboardingStep, skipOnboarding]);

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

  const isAdminLevelRole = String(myRole || '').toLowerCase() === 'admin';
  const canManageGuests = isAuthenticated && (myRole === 'owner' || isAdminLevelRole);

  const manageRoomGuest = useCallback((guest, action, role = 'viewer') => {
    if (!canManageGuests) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) {
      showToast('Няма връзка със сървъра.');
      return;
    }

    const targetUserId = Number(guest?.userId);
    if (!Number.isFinite(targetUserId)) {
      showToast('Този участник не може да се управлява.');
      return;
    }

    if (action === 'remove') {
      const ok = window.confirm(`Да премахна ли ${guest?.name || 'потребителя'} от тази стая?`);
      if (!ok) return;
    }

    ws.send(JSON.stringify({
      type: 'room-member-manage',
      room,
      action: action === 'remove' ? 'remove' : 'set-role',
      userId: targetUserId,
      role: role === 'editor' ? 'editor' : 'viewer',
    }));
  }, [canManageGuests, room, showToast]);

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
  const nodeContextMenuRef = useRef(null);
  const renameInputRef = useRef(null);
  const colorInputRef = useRef(null);
  const [previewShape, setPreviewShape] = useState(null);

  const clampNodeContextMenuPosition = useCallback((x, y, menuWidth = 320, menuHeight = 420) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x, y };
    const rect = canvas.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, rect.width - menuWidth - margin);
    const maxY = Math.max(margin, rect.height - menuHeight - margin);

    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }, []);

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
      const isSelected = !!edge?.selected;
      const strokeColor = isSelected ? "#ffd166" : (isMapCompletedView ? "#26d1a7" : "#8ea0d8");
      const strokeWidth = isSelected ? 4.5 : (isMapCompletedView ? 3.2 : 2);
      const base = {
        ...edge,
        className: `${isMapCompletedView ? "edge-completed" : "edge-normal"}${isSelected ? " edge-selected" : ""}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: strokeColor,
        },
      };

      if (!isMapCompletedView) {
        return {
          ...base,
          animated: true,
          style: {
            ...(edge?.style || {}),
            stroke: strokeColor,
            strokeWidth,
          },
        };
      }

      return {
        ...base,
        animated: false,
        style: {
          ...(edge?.style || {}),
          stroke: strokeColor,
          strokeWidth,
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

  const openNodeMenuAtEvent = (ev, node) => {
    if (!canEdit) return;
    try {
      ev.preventDefault();
    } catch {}
    try { console.log('[openNodeMenuAtEvent] nodeId=', node?.id, 'canEdit=', canEdit); } catch {}
    const rect = canvasRef.current?.getBoundingClientRect();
    const rawX = rect ? ev.clientX - rect.left : ev.clientX;
    const rawY = rect ? ev.clientY - rect.top : ev.clientY;
    const expectedMenuWidth = Math.min(320, Math.max(240, window.innerWidth - 24));
    const expectedMenuHeight = 420;
    const { x, y } = clampNodeContextMenuPosition(rawX, rawY, expectedMenuWidth, expectedMenuHeight);
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

  useEffect(() => {
    if (!nodeContextMenu) return;
    const menuEl = nodeContextMenuRef.current;
    if (!menuEl) return;

    const menuWidth = menuEl.offsetWidth || 320;
    const menuHeight = menuEl.offsetHeight || 420;
    const clamped = clampNodeContextMenuPosition(nodeContextMenu.x, nodeContextMenu.y, menuWidth, menuHeight);
    if (clamped.x !== nodeContextMenu.x || clamped.y !== nodeContextMenu.y) {
      setNodeContextMenu((prev) => (prev ? { ...prev, x: clamped.x, y: clamped.y } : prev));
    }
  }, [clampNodeContextMenuPosition, nodeContextMenu, nodeContextMenu?.editing]);

  useEffect(() => {
    if (!nodeContextMenu) return undefined;
    const onResize = () => {
      const menuEl = nodeContextMenuRef.current;
      const menuWidth = menuEl?.offsetWidth || 320;
      const menuHeight = menuEl?.offsetHeight || 420;
      const clamped = clampNodeContextMenuPosition(nodeContextMenu.x, nodeContextMenu.y, menuWidth, menuHeight);
      setNodeContextMenu((prev) => (prev ? { ...prev, x: clamped.x, y: clamped.y } : prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampNodeContextMenuPosition, nodeContextMenu]);

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
      const menuEl = nodeContextMenuRef.current;
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
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (!selectedIds.size && !selectedEdgeIds.size) return alert("Маркирай възел(и) или връзка и опитай пак.");
    if (selectedIds.has("root")) return alert("Главната тема не може да се изтрие.");
    const nextNodes = nodes.filter((n) => !selectedIds.has(n.id));
    const nextEdges = edges.filter((e) => {
      if (selectedEdgeIds.has(e.id)) return false;
      if (selectedIds.has(e.source) || selectedIds.has(e.target)) return false;
      return true;
    });
    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
  }, [canEdit, nodes, edges, scheduleBroadcast]);

  const deleteSelectedByButton = useCallback(() => {
    if (!canEdit) return;
    const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!selectedIds.size) return alert("Маркирай възел(и) и опитай пак.");
    if (selectedIds.has("root")) return alert("Главната тема не може да се изтрие.");
    const ok = window.confirm(`Да изтрия ли избраните възли (${selectedIds.size})?`);
    if (!ok) return;
    const nextNodes = nodes.filter((n) => !selectedIds.has(n.id));
    const nextEdges = edges.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target));
    setNodes(nextNodes);
    setEdges(nextEdges);
    scheduleBroadcast(nextNodes, nextEdges);
    showToast("Избраните възли са изтрити.");
  }, [canEdit, nodes, edges, scheduleBroadcast, showToast]);

  const deleteSelectedEdgesByButton = useCallback(() => {
    if (!canEdit) return;
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (!selectedEdgeIds.size) {
      showToast("Маркирай връзка и опитай пак.");
      return;
    }
    const ok = window.confirm(`Да изтрия ли избраните връзки (${selectedEdgeIds.size})?`);
    if (!ok) return;
    const nextEdges = edges.filter((e) => !selectedEdgeIds.has(e.id));
    setEdges(nextEdges);
    scheduleBroadcast(nodes, nextEdges);
    showToast("Избраните връзки са изтрити.");
  }, [canEdit, edges, nodes, scheduleBroadcast, showToast]);

  const buildSnapshotSignature = useCallback((roomId, snapshotNodes, snapshotEdges) => {
    try {
      return `${String(roomId || "")}::${JSON.stringify(snapshotNodes || [])}::${JSON.stringify(snapshotEdges || [])}`;
    } catch {
      return "";
    }
  }, []);

  const persistSnapshot = useCallback(async ({ silent = false } = {}) => {
    if (!isAuthenticated) {
      if (!silent) showToast("Трябва да сте влезли в системата, за да запазите.");
      return false;
    }

    try {
      await mapsAPI.save(room, nodes, edges);
      lastSavedSnapshotRef.current = buildSnapshotSignature(room, nodes, edges);
      if (!silent) showToast("Запазено в базата данни.");
      return true;
    } catch (error) {
      if (!silent) {
        showToast("Грешка при запис: " + (error.response?.data?.error || error.message));
      }
      return false;
    }
  }, [isAuthenticated, room, nodes, edges, showToast, buildSnapshotSignature]);

  const saveSnapshot = useCallback(async () => {
    await persistSnapshot({ silent: false });
  }, [persistSnapshot]);

  useEffect(() => {
    if (!isAuthenticated) {
      lastSavedSnapshotRef.current = "";
      return;
    }
    lastSavedSnapshotRef.current = buildSnapshotSignature(room, nodes, edges);
    // Baseline for autosave after room/session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !canEdit) return undefined;

    const autosaveTimerId = window.setInterval(async () => {
      if (status !== "online") return;

      const currentSignature = buildSnapshotSignature(room, nodes, edges);
      if (!currentSignature) return;
      if (currentSignature === lastSavedSnapshotRef.current) return;

      await persistSnapshot({ silent: true });
    }, HISTORY_AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(autosaveTimerId);
  }, [isAuthenticated, canEdit, status, room, nodes, edges, buildSnapshotSignature, persistSnapshot]);

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

  const requestMapPublication = useCallback(async () => {
    if (!isAuthenticated) {
      showToast("Трябва да си влезнал(а), за да изпратиш заявка за публикуване.");
      return;
    }
    setMetaBusy(true);
    try {
      await roomsAPI.updateMeta(room, meta);
      await roomsAPI.requestPublish(room);
      showToast("Заявката за публикуване е изпратена успешно.");
    } catch (err) {
      const apiError = err?.response?.data?.error;
      if (apiError === "forbidden") showToast("Нямаш права да изпратиш заявка за тази стая.");
      else showToast("Грешка при изпращане на заявката.");
    } finally {
      setMetaBusy(false);
    }
  }, [isAuthenticated, meta, room, showToast]);

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

  const openPasswordModal = useCallback(() => {
    setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordError('');
    setShowPasswordModal(true);
  }, []);

  const closePasswordModal = useCallback(() => {
    setShowPasswordModal(false);
    setPasswordBusy(false);
    setPasswordError('');
  }, []);

  const submitPasswordChange = useCallback(async () => {
    if (passwordBusy) return;
    const oldPassword = String(passwordForm.oldPassword || '');
    const newPassword = String(passwordForm.newPassword || '');
    const confirmPassword = String(passwordForm.confirmPassword || '');

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError('Попълни всички полета.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Новата парола трябва да е поне 6 символа.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Потвърждението не съвпада.');
      return;
    }

    setPasswordBusy(true);
    setPasswordError('');
    const result = await changePassword(oldPassword, newPassword);
    setPasswordBusy(false);

    if (!result.success) {
      setPasswordError(result.error || 'Грешка при смяна на парола.');
      return;
    }

    setShowPasswordModal(false);
    showToast('Паролата е сменена успешно.');
  }, [passwordBusy, passwordForm, changePassword, showToast]);

  // AI features removed: runAI and generateMindMap disabled

  const shareLink = useMemo(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("room", room);
    return u.toString();
  }, [room]);

  const roomGuests = useMemo(() => {
    const list = Array.isArray(participants) ? participants : [];
    return list
      .filter((p) => p && p.clientId)
      .map((p) => {
        const role = String(p.role || 'guest').toLowerCase();
        const userId = Number.isFinite(Number(p.userId)) ? Number(p.userId) : null;
        const isMe = myClientId && p.clientId === myClientId;
        const canBeManaged = !isMe && userId != null && !['owner', 'admin'].includes(role);
        return {
          clientId: p.clientId,
          userId,
          name: p.name || p.username || 'guest',
          role,
          isMe,
          canBeManaged,
        };
      })
      .sort((a, b) => {
        if (a.isMe && !b.isMe) return -1;
        if (!a.isMe && b.isMe) return 1;
        return String(a.name).localeCompare(String(b.name), 'bg');
      });
  }, [participants, myClientId]);

  const activeOnboardingStep = onboardingSteps[onboardingStep] || onboardingSteps[0];
  const onboardingProgress = ((onboardingStep + 1) / onboardingSteps.length) * 100;

  const focusWorkflowTab = useCallback((tabKey) => {
    setActiveWorkflowTab(tabKey);
    const container = panelScrollRef.current;
    const section = workflowSectionRefs.current?.[tabKey];
    if (!container || !section) return;

    const nextTop = Math.max(0, section.offsetTop - 64);
    container.scrollTo({ top: nextTop, behavior: "smooth" });
  }, []);

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
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="pill" title="Състояние на връзката за екипна работа">
            <span className={"dot " + (status === "online" ? "ok" : "bad")} />
            {status === "online" ? "онлайн" : "офлайн"}
          </span>
          {!isMobile ? (
            <span className="pill" title={lastSync ? `Последна синхронизация: ${formatSofiaDateTime(lastSync)}` : "Текущ час в България"}>
              ⏱ {clockTime}
            </span>
          ) : null}
          {isAdmin ? (
            <button className="btn ghost" onClick={() => setShowAdmin(true)}>
              ⚙️ Admin
            </button>
          ) : null}
        </div>
      </div>

      <div className="main" ref={mainRef} style={isMobile ? { gridTemplateColumns: '1fr' } : { gridTemplateColumns: `${panelWidth}px 12px 1fr` }}>
        <div
          ref={panelScrollRef}
          className={`panel${isMobile ? ' mobile-side-panel' : ''}${isMobile && showMobilePanel ? ' mobile-open' : ''}`}
        >
          {isMobile ? (
            <div className="mobilePanelClose">
              <h4>🧠 Меню</h4>
              <button className="btn ghost" style={{ width: 'auto', padding: '8px 12px', fontSize: 18 }} onClick={() => setShowMobilePanel(false)}>✕</button>
            </div>
          ) : null}
          <div className="workflowTabs" role="tablist" aria-label="Бърз достъп до секции">
            <button
              type="button"
              role="tab"
              aria-selected={activeWorkflowTab === "create"}
              className={`workflowTabBtn ${activeWorkflowTab === "create" ? "is-active" : ""}`}
              onClick={() => focusWorkflowTab("create")}
            >
              Създаване
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeWorkflowTab === "edit"}
              className={`workflowTabBtn ${activeWorkflowTab === "edit" ? "is-active" : ""}`}
              onClick={() => focusWorkflowTab("edit")}
            >
              Редакция
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeWorkflowTab === "publish"}
              className={`workflowTabBtn ${activeWorkflowTab === "publish" ? "is-active" : ""}`}
              onClick={() => focusWorkflowTab("publish")}
            >
              Публикуване
            </button>
          </div>
          <div ref={(el) => { workflowSectionRefs.current.create = el; }}>
          <SidebarWorkflowGroup
            title="1) Създаване на карта"
            description="Създай стая, настрой идентичност и подготви начална структура на нова карта."
          >
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
                <button className="btn ghost" onClick={() => openOnboardingTutorial(0)}>
                  📘 Tutorial
                </button>
                <button className="btn ghost" onClick={openPasswordModal}>
                  🔐 Смени парола
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

          <div className="section">
            <h3>Room Guests</h3>
            <div className="roomGuestsHeader">
              <span className="small">Онлайн в тази стая</span>
              <span className="pill" title="Активни участници в стаята">{roomGuests.length}</span>
            </div>
            <div className="roomGuestsList">
              {roomGuests.length ? roomGuests.map((guest) => (
                <div key={guest.clientId} className="roomGuestItem">
                  <div className="roomGuestMain">
                    <span className="roomGuestName">{guest.name}</span>
                    {guest.isMe ? <span className="roomGuestMe">ти</span> : null}
                  </div>
                  <div className="roomGuestMeta">
                    <span className="roomGuestRole">{guest.role}</span>
                    {canManageGuests ? (
                      <div className="roomGuestActions">
                        <button
                          className="btn ghost roomGuestActionBtn"
                          disabled={!guest.canBeManaged || guest.role === 'viewer'}
                          onClick={() => manageRoomGuest(guest, 'set-role', 'viewer')}
                        >
                          Viewer
                        </button>
                        <button
                          className="btn ghost roomGuestActionBtn"
                          disabled={!guest.canBeManaged || guest.role === 'editor'}
                          onClick={() => manageRoomGuest(guest, 'set-role', 'editor')}
                        >
                          Editor
                        </button>
                        <button
                          className="btn warn roomGuestActionBtn"
                          disabled={!guest.canBeManaged}
                          onClick={() => manageRoomGuest(guest, 'remove')}
                        >
                          Премахни
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )) : (
                <div className="small">Няма активни гости в момента.</div>
              )}
            </div>
            {canManageGuests ? (
              <div className="small" style={{ marginTop: 10 }}>
                Можеш да променяш роля Viewer/Editor или да премахваш участници от стаята.
              </div>
            ) : null}
          </div>

          </SidebarWorkflowGroup>
          </div>

          <div ref={(el) => { workflowSectionRefs.current.edit = el; }}>
          <SidebarWorkflowGroup
            title="2) Редакция на карта"
            description="Работи върху съдържанието: възли, връзки, версии, импорт и експорт."
          >

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
                <button className="btn ghost" onClick={deleteSelectedByButton}>
                  🗑 Изтрий <span className="small">(Del)</span>
                </button>
                <button className="btn ghost" onClick={deleteSelectedEdgesByButton}>
                  ✂️ Изтрий връзка
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

          </SidebarWorkflowGroup>
          </div>

          <div ref={(el) => { workflowSectionRefs.current.publish = el; }}>
          <SidebarWorkflowGroup
            title="3) Изпращане на заявка за публикуване"
            description="Подготви метаданните и изпрати карта за одобрение от администратор."
          >

          {isAuthenticated && (myRole === 'owner' || isAdminLevelRole) && joinRequests.length > 0 ? (
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
              <div className="publishCtaRow">
                <button className="btn warn" onClick={requestMapPublication} disabled={metaBusy}>
                  📤 Изпрати заявка за публикуване
                </button>
              </div>
              <div className="publishStatusHint">
                След изпращане картата влиза в статус "чака одобрение" и се преглежда от администратор.
              </div>
              <div className="small">Името/описанието се виждат и в „Онлайн карти“ (ако стаята е одобрена).</div>
            </div>
          </div>

          </SidebarWorkflowGroup>
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

        {!isMobile ? (
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
        ) : null}

        <div className="canvasWrap" ref={canvasRef}>
          {isMobile ? (
            <button
              className={`mobilePanelBtn ${draggingMobilePanelBtn ? 'is-dragging' : ''}`}
              title="Отвори менюто"
              type="button"
              style={{ left: mobilePanelBtnPosition.x, top: mobilePanelBtnPosition.y, bottom: 'auto' }}
              onMouseDown={(event) => startMobilePanelBtnDrag(event.clientX, event.clientY)}
              onTouchStart={(event) => {
                const touch = event.touches && event.touches[0];
                if (!touch) return;
                startMobilePanelBtnDrag(touch.clientX, touch.clientY);
              }}
              onClick={onMobilePanelBtnClick}
            >
              ☰
            </button>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={presentedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfRef.current = inst; }}
            nodeTypes={nodeTypes}
            onNodeContextMenu={openNodeMenuAtEvent}
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
              ref={nodeContextMenuRef}
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

          {/* Floating chat panel */}
          <ChatFloating
            chatMessages={chatMessages}
            chatText={chatText}
            setChatText={setChatText}
            sendChat={sendChat}
            participants={participants}
            formatSofiaTime={formatSofiaTime}
          />
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
      {showPasswordModal ? (
        <div className="page-overlay" style={{ zIndex: 1450 }} onMouseDown={closePasswordModal}>
          <div className="page" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(520px, 92vw)' }}>
            <h3 style={{ marginBottom: 10 }}>Смяна на парола</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="input"
                type="password"
                value={passwordForm.oldPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, oldPassword: e.target.value }))}
                placeholder="Текуща парола"
              />
              <input
                className="input"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                placeholder="Нова парола"
              />
              <input
                className="input"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                placeholder="Потвърди новата парола"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitPasswordChange();
                  if (e.key === 'Escape') closePasswordModal();
                }}
              />
              {passwordError ? <div className="small" style={{ color: '#ff8f8f' }}>{passwordError}</div> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={closePasswordModal} disabled={passwordBusy}>Отмени</button>
                <button className="btn primary" onClick={submitPasswordChange} disabled={passwordBusy}>
                  {passwordBusy ? 'Запазване...' : 'Смени парола'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showOnboarding && isAuthenticated ? (
        <div className="page-overlay tutorialOverlay" style={{ zIndex: 1500 }}>
          <div className="page tutorialCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="tutorialHeader">
              <div>
                <div className="tutorialStepMeta">Стъпка {onboardingStep + 1} от {onboardingSteps.length}</div>
                <h3>{activeOnboardingStep?.title}</h3>
              </div>
              <button className="btn ghost tutorialSkipBtn" onClick={skipOnboarding}>Пропусни</button>
            </div>

            <div className="tutorialProgressBar">
              <div className="tutorialProgressFill" style={{ width: `${onboardingProgress}%` }} />
            </div>

            <div className="tutorialStepNav">
              {onboardingSteps.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  className={`tutorialStepChip ${index === onboardingStep ? 'active' : ''}`}
                  onClick={() => openOnboardingTutorial(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>

            <p className="tutorialBody">{activeOnboardingStep?.body}</p>

            <div className="tutorialTips">
              {(activeOnboardingStep?.points || []).map((tip) => (
                <div key={tip} className="tutorialTipItem">• {tip}</div>
              ))}
            </div>

            {(activeOnboardingStep?.shortcuts || []).length > 0 ? (
              <div className="tutorialShortcutGrid">
                {activeOnboardingStep.shortcuts.map((item) => (
                  <div key={item} className="tutorialShortcutItem">{item}</div>
                ))}
              </div>
            ) : null}

            <div className="tutorialHint">Съвет: можеш да използваш цифрите горе, за да прескачаш между стъпките.</div>

            <div className="tutorialActions">
              <button className="btn ghost" disabled={onboardingStep === 0} onClick={prevOnboardingStep}>Назад</button>
              <button className="btn primary" onClick={nextOnboardingStep}>
                {onboardingStep === onboardingSteps.length - 1 ? 'Започни работа' : 'Напред'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showAdmin ? <AdminPanel onClose={() => setShowAdmin(false)} /> : null}
    </>
  );
}
