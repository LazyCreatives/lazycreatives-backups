// Crash reports to Sentry (Settings > Privacy > Send crash reports). Same file in both apps.
//
// Only the installed app sends them; development runs and the picture tests never do.
// When something breaks in the main process, the window or the engine, Sentry gets the
// error, the app version and the computer type, including any file paths in the error.
// The person's on/off choice lives in crash-reports.json and is checked for every
// report, so switching it off stops them straight away. The engine reads the same file
// (backend crashreports.py). The GitHub "Report a problem" form (report.js) is separate.

const { app, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

let Sentry = null;
let on = null;

const prefFile = () => path.join(app.getPath("userData"), "crash-reports.json");

function crashReportsOn() {
  if (on === null) {
    try { on = JSON.parse(fs.readFileSync(prefFile(), "utf8")).on !== false; } catch { on = true; }
  }
  return on;
}

function setCrashReports(value) {
  on = !!value;
  try { fs.writeFileSync(prefFile(), JSON.stringify({ on })); } catch (err) { console.error("[crash-reports] save:", err.message); }
  return on;
}

// Call before the app is ready. LC_SENTRY_TEST=1 sends from a development run, to check
// that reports arrive (they are marked "test" in Sentry).
function startCrashReports({ dsn, slug }) {
  const testing = process.env.LC_SENTRY_TEST === "1";
  if (!dsn || (!app.isPackaged && !testing)) return;
  try {
    Sentry = require("@sentry/electron/main");
    const release = `${slug}@${app.getVersion()}`;
    const environment = testing ? "test" : "production";
    Sentry.init({
      dsn, release, environment,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // No usage pings ("sessions"), so switching reports off means nothing is sent.
      integrations: (all) => all.filter((i) => i.name !== "MainProcessSession"),
      beforeSend: (event) => (crashReportsOn() ? event : null),
    });
    // The engine is started later and inherits these (crashreports.py).
    Object.assign(process.env, {
      LC_SENTRY_DSN: dsn, LC_SENTRY_RELEASE: release, LC_SENTRY_ENV: environment, LC_CRASH_PREF: prefFile(),
    });
  } catch (err) {
    Sentry = null;
    console.error("[crash-reports] start:", err.message);
  }
}

// Errors from the window arrive here (preload reportError), so the window needs no Sentry code.
function reportWindowError(info) {
  if (!Sentry || !info) return;
  const err = new Error(String(info.message || "Window error").slice(0, 500));
  if (info.stack) err.stack = String(info.stack).slice(0, 8000);
  Sentry.captureException(err, { tags: { where: "window" } });
}

// A note from main.js when the window or engine stops (report.recordProblem's cases).
function reportStopped(where, text) {
  if (!Sentry) return;
  Sentry.captureMessage(String(text).slice(0, 4000), { level: "error", tags: { where } });
}

ipcMain.handle("get-crash-reports", () => crashReportsOn());
ipcMain.handle("set-crash-reports", (_e, value) => setCrashReports(value));
ipcMain.on("window-error", (_e, info) => reportWindowError(info));

module.exports = { startCrashReports, reportStopped, crashReportsOn, setCrashReports };
