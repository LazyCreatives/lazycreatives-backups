import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { IS_COMPANION } from "./companion";
import { TitleBar } from "./components/Desktop";
import { EntitlementProvider } from "./entitlement";
// Bundled fonts so the app looks the same on every computer.
// Shared with Uploader: Schibsted Grotesk for everything, Bebas Neue for the app name and big titles.
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/500.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/schibsted-grotesk/700.css";
import "@fontsource/bebas-neue";
// Easier reading faces (Settings > Look), both under the SIL Open Font License.
// OpenDyslexic is loaded from reading.css, fitted to the app's line heights.
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./lazy-ui.css";  // shared look (same file in Uploader)
import "./theme.css";    // Backups-only bits
import "./flow.css";     // the step-by-step backup screens
import "./companion.css"; // the narrow window and its sidebar button; after the shared styles so it wins ties
import "./reading.css";   // Easier reading, last so it wins over every look
import { Companion } from "./screens/Companion";
import { fadeThemeChanges } from "./fade";
import { applyReading } from "./reading";

// Easier reading, and its text size on the window.
applyReading();

// Light / dark changes cross-fade (see fade.ts).
fadeThemeChanges();

// Surface uncaught renderer errors to the console (forwarded to the run log by main.js).
window.addEventListener("error", (e) =>
  console.error("[uncaught]", e.message, "at", e.filename + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) =>
  console.error("[unhandledrejection]", (e.reason && e.reason.message) || String(e.reason)));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TitleBar />
    <EntitlementProvider>
      {/* #companion: the narrow window beside the music program (see companion.js) */}
      {IS_COMPANION ? <Companion /> : <App />}
    </EntitlementProvider>
  </React.StrictMode>
);
