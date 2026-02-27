import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { mapsAPI } from "./api";

export default function OnlineMapsPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(200);
  const [onlyWithSaves, setOnlyWithSaves] = useState(true);
  const [sortKey, setSortKey] = useState("last_saved_at");
  const [sortDir, setSortDir] = useState("desc");
  const [pageSize, setPageSize] = useState(12);
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await mapsAPI.publicRooms(limit);
      setRooms(res.data.rooms || []);
    } catch {
      setError("Грешка при зареждане на онлайн картите.");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [q, onlyWithSaves, sortKey, sortDir, pageSize]);

  useEffect(() => {
    refresh();
  }, [limit, refresh]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = rooms;
    if (onlyWithSaves) list = list.filter((r) => Number(r.saves_count || 0) > 0);
    if (!query) return list;
    return list.filter((r) => {
      const roomId = (r.room_id || "").toString().toLowerCase();
      const name = (r.name || "").toString().toLowerCase();
      const createdBy = (r.created_by_email || r.created_by_username || "").toString().toLowerCase();
      return roomId.includes(query) || name.includes(query) || createdBy.includes(query);
    });
  }, [rooms, q, onlyWithSaves]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const score = (r) => {
      if (sortKey === "room_id") return (r.room_id || "").toString().toLowerCase();
      if (sortKey === "name") return (r.name || "").toString().toLowerCase();
      if (sortKey === "saves_count") return Number(r.saves_count || 0);
      if (sortKey === "last_saved_at") return r.last_saved_at ? new Date(r.last_saved_at).getTime() : 0;
      return 0;
    };
    const list = [...filtered];
    list.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (typeof sa === "string" && typeof sb === "string") return sa.localeCompare(sb) * dir;
      return (sa - sb) * dir;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = useMemo(() => {
    const t = Math.ceil(sorted.length / pageSize);
    return Math.max(1, Number.isFinite(t) ? t : 1);
  }, [sorted.length, pageSize]);

  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, currentPage, pageSize]);

  const openRoom = (roomId) => {
    const qp = new URLSearchParams();
    qp.set("room", roomId);
    navigate("/?" + qp.toString());
  };

  const openRoomNewTab = (roomId) => {
    const qp = new URLSearchParams();
    qp.set("room", roomId);
    window.open("/?" + qp.toString(), "_blank", "noopener,noreferrer");
  };

  const copyText = async (text, fallbackMessage) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      setError(fallbackMessage || "Не успях да копирам. Опитай пак.");
    }
  };

  const sortLabel = {
    last_saved_at: "Последно",
    saves_count: "Записи",
    room_id: "Room",
    name: "Име"
  };

  return (
    <>
      <div className="header">
        <div className="brand">
          <span style={{ fontSize: 18 }}>🧠 MindMapr</span>
          <span className="badge">Online</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <button className="btn ghost" onClick={refresh} disabled={loading}>
            ↻ Обнови
          </button>
          <Link className="btn ghost" to="/">
            ← Назад
          </Link>
        </div>
      </div>

      <div className="online-main">
        <div className="page online-card" role="main" aria-label="Онлайн карти">
          <div className="page-header">
            <h3>🌐 Онлайн карти (одобрени)</h3>
            <div className="row" style={{ gap: 10 }}>
              <span className="pill" title="Показани / налични">
                {sorted.length} / {rooms.length}
              </span>
              <button className="btn ghost" onClick={() => navigate(-1)}>
                ✖ Затвори
              </button>
            </div>
          </div>

          <div className="online-toolbar">
            <div className="online-toolbarRow">
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Търси по room / име / автор"
              />

              <div className="online-controls">
                <label className="online-field" title="Колко записа да се заредят от сървъра">
                  <span className="small">Лимит</span>
                  <select
                    className="select"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                </label>

                <label className="online-field" title="Сортиране">
                  <span className="small">Сортиране</span>
                  <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                    <option value="last_saved_at">Последно</option>
                    <option value="saves_count">Записи</option>
                    <option value="room_id">Room</option>
                    <option value="name">Име</option>
                  </select>
                </label>

                <button
                  className="btn ghost"
                  title="Смени посоката на сортиране"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                >
                  {sortDir === "asc" ? "↑" : "↓"} {sortLabel[sortKey] || ""}
                </button>

                <label className="online-check">
                  <input
                    type="checkbox"
                    checked={onlyWithSaves}
                    onChange={(e) => setOnlyWithSaves(e.target.checked)}
                  />
                  <span className="small">само с записи</span>
                </label>

                <label className="online-field" title="Колко карти на страница">
                  <span className="small">На стр.</span>
                  <select
                    className="select"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    <option value={8}>8</option>
                    <option value={12}>12</option>
                    <option value={20}>20</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="online-toolbarRow online-pager">
              <div className="small">Страница: {currentPage} / {totalPages}</div>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn ghost" onClick={() => setPage(1)} disabled={currentPage === 1}>
                  ⏮
                </button>
                <button className="btn ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                  ◀
                </button>
                <button className="btn ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                  ▶
                </button>
                <button className="btn ghost" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
                  ⏭
                </button>
              </div>
            </div>
          </div>

          {loading ? <div className="small" style={{ marginTop: 10 }}>Зарежда...</div> : null}
          {error ? <div className="dialog-error">{error}</div> : null}

          <div className="online-grid">
            {sorted.length === 0 && !loading ? <div className="small">Няма одобрени карти.</div> : null}

            {pageItems.map((r) => (
              <div key={r.room_id} className="online-cardItem">
                <div className="online-cardTitle">
                  <div className="page-room">{r.room_id}</div>
                  <div className="pill" title="Брой записи">🧾 {r.saves_count ?? 0}</div>
                </div>

                <div className="small" style={{ opacity: 0.92 }}>
                  {r.name ? <div><b>{r.name}</b></div> : null}
                  {r.description ? <div style={{ opacity: 0.9 }}>{r.description}</div> : null}
                  {r.tags ? <div>Тагове: {r.tags}</div> : null}
                  {r.created_by_email || r.created_by_username ? (
                    <div>Автор: {r.created_by_email || r.created_by_username}</div>
                  ) : null}
                  {r.last_saved_at ? <div>Последно: {new Date(r.last_saved_at).toLocaleString()}</div> : <div>Последно: —</div>}
                </div>

                <div className="online-actions">
                  <button className="btn primary" onClick={() => openRoom(r.room_id)}>
                    Отвори
                  </button>
                  <button className="btn ghost" onClick={() => openRoomNewTab(r.room_id)} title="Отвори в нов таб">
                    ⇱
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => copyText(String(r.room_id), "Не успях да копирам room id.")}
                    title="Копирай room id"
                  >
                    ⎘ Room
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => copyText(`${window.location.origin}/?room=${encodeURIComponent(r.room_id)}`, "Не успях да копирам линк.")}
                    title="Копирай линк към редактора"
                  >
                    🔗 Линк
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="small" style={{ marginTop: 12 }}>
            Тези карти са публични и одобрени от администратор.
          </div>
        </div>
      </div>
    </>
  );
}
