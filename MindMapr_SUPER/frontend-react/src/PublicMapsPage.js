import React, { useEffect, useMemo, useState } from "react";
import { mapsAPI } from "./api";
import { formatSofiaDateTime } from "./time";

export default function PublicMapsPage({ open, onClose, onSelect }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await mapsAPI.publicRooms(200);
      setRooms(res.data.rooms || []);
    } catch {
      setError("Грешка при зареждане на онлайн картите.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rooms;
    return rooms.filter((r) => {
      const roomId = (r.room_id || "").toString().toLowerCase();
      const name = (r.name || "").toString().toLowerCase();
      const createdBy = (r.created_by_email || r.created_by_username || "").toString().toLowerCase();
      return roomId.includes(query) || name.includes(query) || createdBy.includes(query);
    });
  }, [rooms, q]);

  if (!open) return null;

  return (
    <div className="page-overlay" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <div className="page" role="dialog" aria-modal="true" aria-label="Онлайн карти">
        <div className="page-header">
          <h3>🌐 Онлайн карти (одобрени)</h3>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn ghost" onClick={refresh} disabled={loading}>↻ Обнови</button>
            <button className="btn ghost" onClick={onClose}>✖</button>
          </div>
        </div>

        <div className="row" style={{ alignItems: "stretch" }}>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Търси по room / име / автор"
          />
        </div>

        {loading ? <div className="small" style={{ marginTop: 10 }}>Зарежда...</div> : null}
        {error ? <div className="dialog-error">{error}</div> : null}

        <div className="page-list">
          {filtered.length === 0 && !loading ? (
            <div className="small">Няма одобрени карти.</div>
          ) : null}

          {filtered.map((r) => (
            <div key={r.room_id} className="page-item">
              <div className="page-itemMain">
                <div className="page-room">{r.room_id}</div>
                <div className="small" style={{ opacity: 0.9 }}>
                  {r.name ? <span>{r.name} • </span> : null}
                  {r.created_by_email || r.created_by_username ? (
                    <span>Автор: {r.created_by_email || r.created_by_username} • </span>
                  ) : null}
                  <span>Записи: {r.saves_count ?? 0}</span>
                  {r.last_saved_at ? (
                    <span> • Последно: {formatSofiaDateTime(r.last_saved_at)}</span>
                  ) : null}
                </div>
              </div>
              <div className="page-itemActions">
                <button className="btn primary" onClick={() => onSelect(r.room_id)}>Отвори</button>
              </div>
            </div>
          ))}
        </div>

        <div className="small" style={{ marginTop: 12 }}>
          Тези карти са публични и одобрени от администратор.
        </div>
      </div>
    </div>
  );
}
