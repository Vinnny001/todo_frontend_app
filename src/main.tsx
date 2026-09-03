import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./auth/auth.css";
import { AuthProvider } from "./auth/AuthContext";
import Root from "./Root.tsx";

// ── Text-selection / copy lock (web layer only — no native Android change) ──
// Disabling is done in CSS (see index.css); these listeners back it up for
// browsers/paths CSS alone doesn't cover (context menu, programmatic copy).
// Real form fields (inputs, textareas, contentEditable) are always exempt so
// typing and in-place editing keeps working everywhere in the app.
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable === true
  );
}

for (const eventName of ["contextmenu", "selectstart", "copy"] as const) {
  document.addEventListener(eventName, (e) => {
    if (!isEditableTarget(e.target)) e.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>,
);
