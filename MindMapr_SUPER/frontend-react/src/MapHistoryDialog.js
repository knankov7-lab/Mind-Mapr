import React, { useCallback, useEffect, useState } from "react";
import { mapsAPI } from "./api";

export default function MapHistoryDialog({ open, onClose, room, onRestore }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!room) return;
    setLoading(true);
    setError("");
    try {
      const res = await mapsAPI.history(room, 100);
      setItems(res.data.saves || []);
    } catch (err) {
      const status = err?.response?.status;
      const apiError = err?.response?.data?.error;
      if (status === 403 || apiError === "forbidden") setError("Нямаш права да виждаш историята на тази стая.");
      else setError("Грешка при зареждане на историята.");
    } finally {
      setLoading(false);
    }
  }, [room]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="История на картата">
        <h3>🕘 История на стая: {room}</h3>
        {loading ? <div className="small">Зарежда...</div> : null}
        {error ? <div className="dialog-error">{error}</div> : null}

        <ul className="dialog-list">
          {items.map((sv) => (
            <li key={sv.id} className="dialog-listItem">
              <div className="dialog-listRow">
                <button
                  className="btn ghost dialog-listButton"
                  onClick={() => onRestore?.(sv.id)}
                  title="Възстанови тази версия"
                >
                  Версия #{sv.id} <span className="small">({new Date(sv.created_at).toLocaleString()})</span>
                </button>
                <button
                  className="btn ghost dialog-deleteButton"
                  onClick={async () => {
                    try {
                      await navigator.clipboard?.writeText(String(sv.id));
                    } catch {
                      setError("Не успях да копирам ID.");
                    }
                  }}
                  title="Копирай ID"
                >
                  ⎘ ID
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="btn ghost" onClick={refresh} disabled={loading}>
            ↻ Обнови
          </button>
          <button className="btn" onClick={onClose}>
            Затвори
          </button>
        </div>
      </div>
    </div>
  );
}
