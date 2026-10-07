const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { startSidecar, stopSidecar, killGroup } = require("./sidecar");
const { createTray } = require("./tray");
const { createCompanion } = require("./companion");
const { isOpenAtLogin, setOpenAtLogin, initOpenAtLogin } = require("./startup");
const { startUpdater } = require("./updater");
const report = require("./report");
const { windowMaterial, windowChromeOptions, installTextMenu, windowStateOptions, installAppMenu, registerDesktopIpc, sendWindowMinimized, showWindow } = require("./desktop");

const isDev = !!process.env.ABLEBACKUP_DEV;
let win = null;
let sidecar = null;
let tray = null;
let companion = null; // the narrow window beside the music program (companion.js)
let isQuitting = false;
let stopping = null; // set to the shutdown promise once a quit begins

// Crashes are noted on this computer only; the app then offers a filled-in report
// the person reads and sends themselves (report.js). Must start before "ready".
report.startCrashCatcher({ appName: "LazyCreatives Backups", repo: "lazycreatives-backups" });

// Never ask the Mac's Keychain for anything. The window's own storage would
// otherwise keep its key there, and because the installers are unsigned, macOS treats
// every update as a new app and asks for your keychain password. Nothing secret lives
// in the window's storage, so a fixed local key is enough.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");

// Single-instance: opening the app again brings the running window forward rather
// than starting a second copy (which would fight over the same catalog), as Uploader does.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow(win));
}

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

function webPreferences(material) {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true, nodeIntegration: false,
    additionalArguments: [
      `--ablebackup-token=${sidecar.token}`,
      `--ablebackup-port=${sidecar.port}`,
      `--lc-material=${material}`,
    ],
  };
}

// The page, or with hash "companion" the narrow window's view of it.
function loadPage(w, hash) {
  if (isDev) w.loadURL(`http://localhost:5173/${hash ? `#${hash}` : ""}`);
  else w.loadFile(path.join(__dirname, "..", "dist", "index.html"), hash ? { hash } : undefined);
}

function createWindow() {
  // Reopens at the size and place it was last closed at (see desktop.js).
  const placement = windowStateOptions();
  const material = windowMaterial();
  win = new BrowserWindow({
    ...placement.options, ...windowChromeOptions(process.platform, material),
    ...(hasIcon() ? { icon: ICON } : {}),
    webPreferences: webPreferences(material),
  });
  placement.track(win);
  installTextMenu(win);
  sendWindowMinimized(win);
  if (process.platform === "darwin" && app.dock && hasIcon()) {
    try { app.dock.setIcon(ICON); } catch (err) { console.error("[main] dock icon:", err.message); }
  }
  loadPage(win);

  // The renderer must never navigate away or open remote windows — it only ever
  // talks to the localhost sidecar. External links go through the open-external IPC.
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Forward renderer console + crashes to stdout so they land in the run log
  // (renderer errors are otherwise only visible in the in-window devtools).
  win.webContents.on("console-message", ({ level, message }) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer GONE]", JSON.stringify(details));
    if (isQuitting || details.reason === "clean-exit") return;
    report.recordProblem("window", `The window stopped (${details.reason}, exit code ${details.exitCode}).`);
    // Bring the window back once, then offer the report.
    if (!win.__reloaded) { win.__reloaded = true; loadPage(win); }
    report.offerReport(win);
  });
  // A problem noted last time (or a sudden close) is offered once the window is up.
  win.webContents.once("did-finish-load", () => setTimeout(() => report.offerReport(win), 1500));

  // Side mouse buttons and the keyboard's Back/Forward keys reach Windows and Linux
  // apps as window commands; the page treats them like its own back/forward.
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") win.webContents.send("nav-command", "back");
    else if (cmd === "browser-forward") win.webContents.send("nav-command", "forward");
  });

  win.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
}

// File pickers open where the user last picked something. Electron 43+ would
// otherwise start every picker in Downloads instead of the last-used folder.
let lastPickedDir;
async function pick(options) {
  const r = await dialog.showOpenDialog(win, { defaultPath: lastPickedDir, ...options });
  if (r.canceled || !r.filePaths.length) return null;
  const picked = r.filePaths[0];
  lastPickedDir = options.properties.includes("openDirectory") ? picked : path.dirname(picked);
  return picked;
}

registerDesktopIpc(() => win);

ipcMain.handle("pick-folder", () => pick({ properties: ["openDirectory"] }));

// Pick a single audio file — used by "Point to file…" to hand-map one missing sample
// to its exact replacement. Filtered to audio so the relink stays a media file.
ipcMain.handle("pick-file", () => pick({
  properties: ["openFile"],
  filters: [
    { name: "Audio", extensions: [
      "wav", "aif", "aiff", "aifc", "flac", "mp3", "ogg", "oga", "opus", "m4a",
      "aac", "alac", "wma", "wv", "caf", "ape", "rex", "rx2", "w64", "au", "snd",
    ] },
    { name: "All files", extensions: ["*"] },
  ],
}));

// Pick a picture for a cover (Settings, Covers; Change cover), then read it into a data
// URL; the page shrinks it and hands it to the sidecar, which keeps its own copy.
ipcMain.handle("pick-image", () => pick({
  properties: ["openFile"],
  filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp"] }],
}));
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
ipcMain.handle("read-image", async (_e, target) => {
  try {
    if (typeof target !== "string" || !target) return null;
    const mime = IMAGE_MIME[path.extname(target).toLowerCase()];
    if (!mime) return null;
    const stat = await fs.promises.stat(target);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const buf = await fs.promises.readFile(target);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
});

ipcMain.handle("reveal-path", (_e, target) => {
  if (target) shell.showItemInFolder(target);
});

// Open a project in its DAW (OS default app). Allowlisted to project extensions so
// this channel can never be used to launch arbitrary files.
// Logic projects are folders (macOS packages) that open like a file.
const OPENABLE_PROJECT = /\.(als|flp|rpp|dawproject|aup3|aup|logicx|logic|song|bwproject)$/i;
ipcMain.handle("open-project", (_e, target) => {
  if (typeof target === "string" && OPENABLE_PROJECT.test(target)) {
    return shell.openPath(target); // resolves to "" on success, error string otherwise
  }
  return "not a project file";
});

ipcMain.handle("report-problem", () => report.reportProblem());

// If the engine stops on its own (not because the app is quitting), note why and offer
// the report. Its last few error lines say what went wrong.
function watchSidecar(sc) {
  let tail = "";
  sc.proc.stderr.on("data", (d) => {
    const useful = d.toString().split("\n").filter((l) => l.trim() && !/^INFO:/.test(l)).join("\n");
    if (useful) tail = (tail + "\n" + useful).slice(-1500);
  });
  sc.proc.on("exit", (code, signal) => {
    if (isQuitting || stopping) return;
    report.recordProblem("engine", `The engine stopped (${signal ? `signal ${signal}` : `exit code ${code}`}).\n${tail.trim()}`);
    report.offerReport(win);
  });
}

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
  if (!gotTheLock) return; // a copy is already running: it was brought forward
  try {
    // Packaged builds: lock the renderer down with a strict CSP (dev uses Vite HMR,
    // which a strict script-src would break, so only apply it when packaged).
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({ responseHeaders: { ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "connect-src http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:; " +
            "img-src 'self' data: http://127.0.0.1:*; " +  // your cover pictures, served by the sidecar
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
    watchSidecar(sidecar);
    createWindow();
    installAppMenu({ appName: "LazyCreatives Backups", website: "https://lazycreatives.github.io/", getWindow: () => win });
    companion = createCompanion({
      getMainWindow: () => win,
      showMain: () => showWindow(win),
      windowOptions: () => ({
        ...windowChromeOptions(process.platform, "none"),
        ...(hasIcon() ? { icon: ICON } : {}),
        webPreferences: webPreferences("none"),
      }),
      load: (w) => { installTextMenu(w); loadPage(w, "companion"); },
    });
    companion.addToMenu();
    tray = createTray({
      appName: "LazyCreatives Backups",
      items: [companion.menuItem],
      onShow: () => showWindow(win),
      onQuit: () => { isQuitting = true; app.quit(); },
    });
    initOpenAtLogin();
    startUpdater({
      appName: "LazyCreatives Backups",
      owner: "LazyCreatives", repo: "lazycreatives-backups",
      downloadPage: "https://lazycreatives.github.io/#download",
      getWindow: () => win,
      onMenuItem: (item) => { if (tray) tray.setUpdateItem(item); },
    });
    console.log("[main] app ready"); // the installers check waits for this line
  } catch (err) {
    // A dead-silent launch (sidecar spawn failed / health timed out) is the worst
    // failure for a paid app — surface it instead of showing nothing.
    report.startFailed(err);
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
  report.recordProblem("error", String((err && err.stack) || err));
  if (app.isReady()) report.offerReport(win);
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
