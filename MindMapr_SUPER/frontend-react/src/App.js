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

// Wake Render backend on app load to minimize cold-start CORS errors.
async function wakeBackend() {
  try {
    await api.get("/health");
  } catch (_) {}
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
    wakeBackend().then(() => syncTheme());
  }, [syncTheme]);

  useEffect(() => {
    let installPrompt = null;

    // Listen for beforeinstallprompt event
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      installPrompt = event;
      
      // Show custom install prompt/banner
      const banner = document.createElement('div');
      banner.id = 'install-banner';
      banner.className = 'install-banner';
      
      const textDiv = document.createElement('div');
      textDiv.textContent = '📲 Инсталирай MindMapr като приложение';
      textDiv.className = 'install-banner-text';
      
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'install-banner-buttons';
      
      const installBtn = document.createElement('button');
      installBtn.textContent = 'Инсталирай';
      installBtn.className = 'install-banner-btn primary';
      installBtn.onclick = async () => {
        if (installPrompt) {
          installPrompt.prompt();
          const { outcome } = await installPrompt.userChoice;
          console.log(`User response to the install prompt: ${outcome}`);
          installPrompt = null;
          banner.remove();
          document.body.classList.remove('has-install-banner');
        }
      };
      
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.className = 'install-banner-btn close';
      closeBtn.onclick = () => {
        banner.remove();
        document.body.classList.remove('has-install-banner');
      };
      
      buttonContainer.appendChild(installBtn);
      buttonContainer.appendChild(closeBtn);
      banner.appendChild(textDiv);
      banner.appendChild(buttonContainer);
      document.body.appendChild(banner);
      document.body.classList.add('has-install-banner');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

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
