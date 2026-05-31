import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./AuthContext";
import "./styles/app.css";
import "reactflow/dist/style.css";

function safeSessionGet(key) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  >
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        console.log('Service Worker registered:', registration);
        
        // Show welcome notification on app open
        if (!safeSessionGet('mindmapr-welcome-shown')) {
          safeSessionSet('mindmapr-welcome-shown', 'true');
          
          // Request notification permission and show welcome
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Добре дошъл в MindMapr!', {
              body: 'Твоят помощник за съвместно планиране на идеи.',
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%237c5cff" width="100" height="100" rx="20"/><text x="50" y="65" font-size="70" text-anchor="middle">🧠</text></svg>',
              badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%237c5cff" width="100" height="100"/><text x="50" y="65" font-size="70" text-anchor="middle">🧠</text></svg>'
            });
          } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then((permission) => {
              if (permission === 'granted') {
                new Notification('Добре дошъл в MindMapr!', {
                  body: 'Твоят помощник за съвместно планиране на идеи.',
                  icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%237c5cff" width="100" height="100" rx="20"/><text x="50" y="65" font-size="70" text-anchor="middle">🧠</text></svg>',
                  badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%237c5cff" width="100" height="100"/><text x="50" y="65" font-size="70" text-anchor="middle">🧠</text></svg>'
                });
              }
            });
          }
        }
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });
}
