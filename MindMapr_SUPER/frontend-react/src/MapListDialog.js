import React, { useEffect, useState } from "react";
import { mapsAPI } from "./api";

export default function MapListDialog({ open, onClose, onSelect }) {
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshList = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await mapsAPI.list();
      setMaps(res.data.saves || []);
    } catch {
      setError("Грешка при зареждане на списъка.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      refreshList();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Списък с карти">
        <h3>Избери карта за зареждане</h3>
        {loading ? <div>Зарежда...</div> : null}
        {error ? <div className="dialog-error">{error}</div> : null}
        <ul className="dialog-list">
          {maps.map(m => (
            <li key={m.id} className="dialog-listItem">
              <div className="dialog-listRow">
                <button
                  className="btn ghost dialog-listButton"
                  onClick={() => onSelect(m.room_id)}>
                  {m.room_id}{" "}
                  <span className="small">({new Date(m.created_at).toLocaleString()})</span>
                </button>

                <button
                  className="btn danger dialog-deleteButton"
                  onClick={async () => {
                    const ok = window.confirm(`Да изтрия ли тази карта?\n\n${m.room_id}`);
                    if (!ok) return;
                    try {
                      await mapsAPI.deleteSave(m.id);
                      await refreshList();
                    } catch (err) {
                      const status = err?.response?.status;
                      const apiError = err?.response?.data?.error;
                      if (status === 403 || apiError === "forbidden") {
                        setError("Нямаш права да изтриеш този запис.");
                      } else if (status === 404 || apiError === "not found") {
                        setError("Записът не е намерен (възможно е вече да е изтрит).");
                      } else if (apiError) {
                        setError(`Грешка при изтриване: ${apiError}`);
                      } else {
                        setError("Грешка при изтриване.");
                      }
                    }
                  }}
                  title="Изтрий записа">
                  Изтрий
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={onClose}>Затвори</button>
      </div>
    </div>
  );
}
