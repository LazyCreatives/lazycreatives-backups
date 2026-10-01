import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { EntitlementProvider } from "./entitlement";
// Bundled fonts so the app looks the same on every computer.
import "@fontsource/caveat-brush";  // heading font (OFL)
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./theme.css";

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
