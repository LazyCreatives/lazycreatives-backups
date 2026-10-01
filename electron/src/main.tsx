import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { EntitlementProvider } from "./entitlement";
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
