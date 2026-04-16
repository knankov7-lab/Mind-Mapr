import React, { useCallback, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import EditorApp from "./EditorApp";
import OnlineMapsPage from "./OnlineMapsPage";
import api from "./api";

function normalizeTheme(theme) {
  return String(theme || "dark").toLowerCase() === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  const next = normalizeTheme(theme);
  document.documentElement.setAttribute("data-theme", next);
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(`theme-${next}`);
}

export default function App() {
  const syncTheme = useCallback(async () => {
    try {
      const response = await api.get("/settings/public");
      applyTheme(response.data?.theme);
    } catch (_err) {
      applyTheme("dark");
    }
  }, []);

  useEffect(() => {
    syncTheme();
  }, [syncTheme]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncTheme();
    };
    const onThemeChanged = (event) => {
      applyTheme(event?.detail?.theme);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("mindmapr-theme-changed", onThemeChanged);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("mindmapr-theme-changed", onThemeChanged);
    };
  }, [syncTheme]);

  return (
    <Routes>
      <Route path="/" element={<EditorApp />} />
      <Route path="/online" element={<OnlineMapsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
