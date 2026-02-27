import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import EditorApp from "./EditorApp";
import OnlineMapsPage from "./OnlineMapsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EditorApp />} />
      <Route path="/online" element={<OnlineMapsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
