import React, { useCallback, useEffect, useState, useRef } from "react";
import { mapsAPI } from "./api";
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

export default function MapHistoryDialog({ open, onClose, room, onRestore }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // { id, nodes, edges }
  const previewRef = useRef(null);

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

  const showPreview = async (id) => {
    try {
      const res = await mapsAPI.loadSave(id);
      setPreview({ id, nodes: res.data.nodes || [], edges: res.data.edges || [] });
      setTimeout(() => previewRef.current?.fitView?.(), 120);
    } catch {
      setPreview(null);
    }
  };

  const clearPreview = () => setPreview(null);

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
              <div
                className="dialog-card"
                onMouseEnter={() => showPreview(sv.id)}
                onMouseLeave={clearPreview}
              >
                <div className="dialog-cardMain">
                  <button
                    className="btn ghost dialog-listButton"
                    onClick={() => onRestore?.(sv.id)}
                    title="Възстанови тази версия"
                  >
                    <div className="dialog-room">Версия #{sv.id}</div>
                    <div className="dialog-meta small">{new Date(sv.created_at).toLocaleString()}</div>
                  </button>
                </div>
                <div className="dialog-cardActions">
                  <button
                    className="btn ghost dialog-deleteButton"
                    aria-label={`Копирай ID ${sv.id}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard?.writeText(String(sv.id));
                      } catch {
                        setError("Не успях да копирам ID.");
                      }
                    }}
                    title="Копирай ID"
                  >
                    ⎘ Копирай ID
                  </button>
                </div>
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
        {preview ? (
          <div className="history-preview">
            <ReactFlow
              nodes={preview.nodes}
              edges={preview.edges}
              fitView
              onInit={(inst) => { previewRef.current = inst; inst.fitView(); }}
              nodesDraggable={false}
              nodesConnectable={false}
              panOnScroll={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              panOnDrag={false}
            >
              <Background gap={12} />
            </ReactFlow>
          </div>
        ) : null}
      </div>
    </div>
  );
}
