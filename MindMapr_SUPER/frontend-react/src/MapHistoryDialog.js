import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapsAPI } from "./api";
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

export default function MapHistoryDialog({ open, onClose, room, onRestore }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // { id, nodes, edges }
  const previewRef = useRef(null);

  const hexToRgba = (hex, alpha = 1) => {
    if (!hex || typeof hex !== "string") return null;
    let value = hex.replace("#", "").trim();
    if (value.length === 3) value = value.split("").map((char) => char + char).join("");
    if (value.length !== 6) return null;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const getCircleDiameterPx = (label) => {
    const text = String(label || "").trim();
    if (!text) return 92;
    const words = text.split(/\s+/).filter(Boolean);
    const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);
    return Math.max(92, Math.min(168, longestWordLength * 12 + 44, 168));
  };

  const getDiamondSizePx = (label) => {
    const text = String(label || "").trim();
    if (!text) return 96;
    const words = text.split(/\s+/).filter(Boolean);
    const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);
    const lineCount = Math.max(1, Math.min(words.length || 1, 3));
    const widthDriven = longestWordLength * 14 + 30;
    const heightDriven = lineCount * 24 + 50;
    return Math.max(96, Math.min(172, Math.max(widthDriven, heightDriven)));
  };

  const normalizePreviewNodes = useCallback((list) => {
    if (!Array.isArray(list)) return [];
    return list.map((node) => {
      const rawStyle = node.style || {};
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
        ...node,
        type: "idea",
        style: Object.keys(cleanStyle).length ? cleanStyle : undefined,
        data: {
          ...(node.data || {}),
          shape: (node.data && node.data.shape) || "rect",
        },
      };
    });
  }, []);

  const HistoryIdeaNode = ({ data }) => {
    const displayShape = (data && data.shape) || "rect";
    const displayColor = data && data.color;
    const style = {};

    if (displayColor) {
      style.backgroundColor = displayColor;
      style.color = "#fff";
      style.boxShadow = `0 10px 30px ${hexToRgba(displayColor, 0.16) || "rgba(0,0,0,.16)"}`;
    }

    const shapeInline = {};
    if (displayShape === "circle") {
      const circleSize = getCircleDiameterPx(data?.label);
      shapeInline.width = `${circleSize}px`;
      shapeInline.height = `${circleSize}px`;
      shapeInline.minWidth = `${circleSize}px`;
      shapeInline.minHeight = `${circleSize}px`;
      shapeInline.padding = "10px";
      shapeInline.display = "flex";
      shapeInline.alignItems = "center";
      shapeInline.justifyContent = "center";
      shapeInline.borderRadius = "999px";
      shapeInline.overflow = "hidden";
    } else if (displayShape === "pill") {
      shapeInline.borderRadius = "999px";
      shapeInline.paddingLeft = "22px";
      shapeInline.paddingRight = "22px";
      shapeInline.paddingTop = "10px";
      shapeInline.paddingBottom = "10px";
      shapeInline.minHeight = "50px";
    } else if (displayShape === "diamond") {
      const diamondSize = getDiamondSizePx(data?.label);
      shapeInline.width = `${diamondSize}px`;
      shapeInline.height = `${diamondSize}px`;
      shapeInline.minWidth = `${diamondSize}px`;
      shapeInline.minHeight = `${diamondSize}px`;
      shapeInline.padding = "8px";
      shapeInline.display = "flex";
      shapeInline.alignItems = "center";
      shapeInline.justifyContent = "center";
      shapeInline.transform = "rotate(45deg)";
      shapeInline.overflow = "hidden";
    } else {
      shapeInline.borderRadius = "8px";
      shapeInline.minWidth = "88px";
      shapeInline.paddingTop = "12px";
      shapeInline.paddingBottom = "12px";
    }

    return (
      <div className={`customNode shape-${displayShape}`} style={{ ...style, ...shapeInline }}>
        <div className="nodeLabel" style={displayShape === "diamond" ? { transform: "rotate(-45deg)" } : undefined}>
          {data?.label}
        </div>
      </div>
    );
  };

  const nodeTypes = useMemo(() => ({ idea: HistoryIdeaNode }), []);
  const previewNodes = useMemo(() => normalizePreviewNodes(preview?.nodes || []), [normalizePreviewNodes, preview?.nodes]);
  const previewEdges = useMemo(() => (Array.isArray(preview?.edges) ? preview.edges : []), [preview?.edges]);

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
              nodes={previewNodes}
              edges={previewEdges}
              nodeTypes={nodeTypes}
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
