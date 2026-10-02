import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { EntitlementProvider } from "./entitlement";
// Bundled fonts so the app looks the same on every computer.
// Shared with Uploader: Geist for text, Geist Mono for numbers, Bebas Neue for the app name and big titles.
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/bebas-neue";
import "./lazy-ui.css";  // shared look (same file in Uploader)
import "./theme.css";    // Backups-only bits
import "./flow.css";     // the step-by-step backup screens

// Surface uncaught renderer errors to the console (forwarded to the run log by main.js).
window.addEventListener("error", (e) =>
  console.error("[uncaught]", e.message, "at", e.filename + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) =>
  console.error("[unhandledrejection]", (e.reason && e.reason.message) || String(e.reason)));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EntitlementProvider>
      <App />
    </EntitlementProvider>
  </React.StrictMode>
);
