const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { startSidecar } = require("./sidecar");
const { createTray } = require("./tray");

const isDev = !!process.env.ABLEBACKUP_DEV;
let win = null;
let sidecar = null;
let tray = null;
let isQuitting = false;

function backendDir() {
  // dev: repo backend/. packaged: resourcesPath/backend (set up at packaging time).
  return isDev
    ? path.join(__dirname, "..", "..", "backend")
    : path.join(process.resourcesPath, "backend");
}

function dbPath() {
  return path.join(app.getPath("userData"), "catalog.db");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: "#0e0f13",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      additionalArguments: [
        `--ablebackup-token=${sidecar.token}`,
        `--ablebackup-port=${sidecar.port}`,
      ],
    },
  });
  if (isDev) win.loadURL("http://localhost:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  win.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
}

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

app.whenReady().then(async () => {
  // macOS/Linux usually expose `python3` (no bare `python`); Windows uses `python`.
  const pythonCmd = process.env.ABLEBACKUP_PYTHON
    || (process.platform === "win32" ? "python" : "python3");
  sidecar = await startSidecar({ backendDir: backendDir(), dbPath: dbPath(), pythonCmd });
  createWindow();
  tray = createTray({
    onShow: () => { win.show(); },
    onQuit: () => { isQuitting = true; app.quit(); },
  });
  app.setLoginItemSettings({ openAtLogin: true });
});

app.on("window-all-closed", () => { /* stay alive in tray */ });

app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => { if (sidecar?.proc) sidecar.proc.kill(); });
