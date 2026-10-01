const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { startSidecar, stopSidecar, killGroup } = require("./sidecar");
const { createTray } = require("./tray");
const { isOpenAtLogin, setOpenAtLogin, initOpenAtLogin } = require("./startup");

const isDev = !!process.env.ABLEBACKUP_DEV;
let win = null;
let sidecar = null;
let tray = null;
let isQuitting = false;
let stopping = null; // set to the shutdown promise once a quit begins

function backendDir() {
  // dev: repo backend/. packaged: resourcesPath/backend (set up at packaging time).
  return isDev
    ? path.join(__dirname, "..", "..", "backend")
    : path.join(process.resourcesPath, "backend");
}

function dbPath() {
  // Honor an explicit override (handy for demos/tests); default to userData.
  return process.env.ABLEBACKUP_DB || path.join(app.getPath("userData"), "catalog.db");
}

// The app icon (build/icon.png). Packaged builds carry it inside app.asar; if it is
// ever missing, run without it rather than fail to start (dock.setIcon throws).
const ICON = path.join(__dirname, "..", "build", "icon.png");
const hasIcon = () => fs.existsSync(ICON);

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: "#0A0B0D",
    ...(hasIcon() ? { icon: ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      additionalArguments: [
        `--ablebackup-token=${sidecar.token}`,
        `--ablebackup-port=${sidecar.port}`,
      ],
    },
  });
  if (process.platform === "darwin" && app.dock && hasIcon()) {
    try { app.dock.setIcon(ICON); } catch (err) { console.error("[main] dock icon:", err.message); }
  }
  if (isDev) win.loadURL("http://localhost:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // The renderer must never navigate away or open remote windows — it only ever
  // talks to the localhost sidecar. External links go through the open-external IPC.
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Forward renderer console + crashes to stdout so they land in the run log
  // (renderer errors are otherwise only visible in the in-window devtools).
  const LEVELS = ["log", "info", "warn", "error"];
  win.webContents.on("console-message", (_e, level, message) => {
    console.log(`[renderer:${LEVELS[level] || level}] ${message}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer GONE]", JSON.stringify(details));
  });

  win.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
}

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

// Pick a single audio file — used by "Point to file…" to hand-map one missing sample
// to its exact replacement. Filtered to audio so the relink stays a media file.
ipcMain.handle("pick-file", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [
      { name: "Audio", extensions: [
        "wav", "aif", "aiff", "aifc", "flac", "mp3", "ogg", "oga", "opus", "m4a",
        "aac", "alac", "wma", "wv", "caf", "ape", "rex", "rx2", "w64", "au", "snd",
      ] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("reveal-path", (_e, target) => {
  if (target) shell.showItemInFolder(target);
});

// Open a project in its DAW (OS default app). Allowlisted to project extensions so
// this channel can never be used to launch arbitrary files.
const OPENABLE_PROJECT = /\.(als|flp|rpp|dawproject|aup3|aup)$/i;
ipcMain.handle("open-project", (_e, target) => {
  if (typeof target === "string" && OPENABLE_PROJECT.test(target)) {
    return shell.openPath(target); // resolves to "" on success, error string otherwise
  }
  return "not a project file";
});

ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// Deep-link to the macOS Full Disk Access pane so the user can grant the app access
// to TCC-protected folders (Documents/Desktop/Downloads) that even root can't read.
ipcMain.handle("open-fda-settings", () => {
  if (process.platform === "darwin") {
    shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
  }
});

// Settings → "Start with your computer".
ipcMain.handle("get-open-at-login", () => isOpenAtLogin());
ipcMain.handle("set-open-at-login", (_e, enabled) => setOpenAtLogin(enabled));

app.whenReady().then(async () => {
  try {
    // Packaged builds: lock the renderer down with a strict CSP (dev uses Vite HMR,
    // which a strict script-src would break, so only apply it when packaged).
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({ responseHeaders: { ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "connect-src http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:; " +
            "media-src http://127.0.0.1:*",  // the in-app player streams exports from the sidecar
          ] } });
      });
    }

    let sidecarOpts;
    if (app.isPackaged) {
      // Packaged: run the bundled PyInstaller sidecar binary (no system Python needed).
      const exe = process.platform === "win32" ? "ablebackup-sidecar.exe" : "ablebackup-sidecar";
      const bin = path.join(process.resourcesPath, "sidecar", exe);
      if (!fs.existsSync(bin)) {
        dialog.showErrorBox("LazyCreatives Backups — backend missing",
          `The backup engine wasn't found at:\n\n${bin}\n\nReinstalling the app should fix this.`);
        isQuitting = true; app.quit(); return;
      }
      sidecarOpts = { backendDir: path.dirname(bin), dbPath: dbPath(), command: bin, args: [] };
      // Cloud copies use the rclone shipped in Resources/rclone (see scripts/fetch-rclone.sh).
      const rclone = path.join(process.resourcesPath, "rclone",
        process.platform === "win32" ? "rclone.exe" : "rclone");
      if (!process.env.ABLEBACKUP_RCLONE && fs.existsSync(rclone)) process.env.ABLEBACKUP_RCLONE = rclone;
    } else {
      // Dev: macOS/Linux usually expose `python3` (no bare `python`); Windows uses `python`.
      const pythonCmd = process.env.ABLEBACKUP_PYTHON
        || (process.platform === "win32" ? "python" : "python3");
      sidecarOpts = { backendDir: backendDir(), dbPath: dbPath(), pythonCmd };
    }
    sidecar = await startSidecar(sidecarOpts);
    createWindow();
    tray = createTray({
      onShow: () => { win.show(); },
      onQuit: () => { isQuitting = true; app.quit(); },
    });
    initOpenAtLogin();
    console.log("[main] app ready"); // the installers check waits for this line
  } catch (err) {
    // A dead-silent launch (sidecar spawn failed / health timed out) is the worst
    // failure for a paid app — surface it instead of showing nothing.
    dialog.showErrorBox("LazyCreatives Backups couldn't start",
      "The backup engine failed to start.\n\n" +
      String((err && (err.stack || err.message)) || err) +
      "\n\nIf this persists, please reinstall.");
    isQuitting = true; app.quit();
  }
});

app.on("window-all-closed", () => { /* stay alive in tray */ });

// Hold the quit until the sidecar is actually gone, then exit for real. before-quit
// fires from the tray (app.quit) and from our signal handlers below.
app.on("before-quit", (e) => {
  isQuitting = true;
  if (sidecar && !sidecar.stopped && !stopping) {
    e.preventDefault();
    stopping = stopSidecar(sidecar).finally(() => app.exit(0));
  }
});

// Don't let a stray rejection/exception kill the process silently.
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  try { if (app.isReady()) dialog.showErrorBox("LazyCreatives Backups error", String((err && err.stack) || err)); } catch { /* ignore */ }
});

// Last-resort *synchronous* kill on any node exit path we did not anticipate.
process.on("exit", () => { if (sidecar) killGroup(sidecar.proc, "SIGKILL"); });

// Dev: `concurrently -k` (Ctrl-C on `npm start`) signals the Electron main process,
// which does not reliably run before-quit for a bare signal — so handle it ourselves.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = stopSidecar(sidecar).finally(() => app.exit(0));
  });
}
