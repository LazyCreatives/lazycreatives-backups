const { contextBridge, ipcRenderer, webFrame, webUtils } = require("electron");

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.slice(flag.length + 1) : "";
}

contextBridge.exposeInMainWorld("ablebackup", {
  // Easier reading's text size: the whole window scales, so columns stay lined up (src/reading.ts).
  setZoom: (f) => { if (typeof f === "number" && f >= 1 && f <= 1.5) webFrame.setZoomFactor(f); },
  token: argValue("--ablebackup-token"),
  port: argValue("--ablebackup-port"),
  // "vibrancy" (Mac), "mica" (Windows 11) or "none": see windowMaterial in desktop.js.
  material: argValue("--lc-material") || "none",
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  pickFile: () => ipcRenderer.invoke("pick-file"),
  pickImage: () => ipcRenderer.invoke("pick-image"),
  readImage: (p) => ipcRenderer.invoke("read-image", p),
  revealPath: (target) => ipcRenderer.invoke("reveal-path", target),
  openProject: (target) => ipcRenderer.invoke("open-project", target),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  reportProblem: () => ipcRenderer.invoke("report-problem"),
  openFdaSettings: () => ipcRenderer.invoke("open-fda-settings"),
  platform: process.platform,
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("set-open-at-login", enabled),
  // "Check for updates" in Settings (see updater.js).
  updateStatus: () => ipcRenderer.invoke("update-status"),
  checkForUpdates: () => ipcRenderer.invoke("update-check"),
  applyUpdate: () => ipcRenderer.invoke("update-apply"),
  whatsNew: () => ipcRenderer.invoke("whats-new"),
  // Back/forward from the mouse's side buttons (see nav.ts).
  onNavCommand: (cb) => {
    const h = (_e, dir) => cb(dir);
    ipcRenderer.on("nav-command", h);
    return () => ipcRenderer.removeListener("nav-command", h);
  },
  // Everyday desktop helpers (see desktop.js / src/desktop.ts).
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  setProgress: (value) => ipcRenderer.invoke("set-progress", value),
  openAppMenu: (x, y) => ipcRenderer.invoke("open-app-menu", x, y),
  pathKinds: (paths) => ipcRenderer.invoke("path-kinds", paths),
  relaunch: () => ipcRenderer.invoke("relaunch-app"),
  // Light or dark (Settings > Look): the window and title strip follow it (desktop.js).
  setTheme: (choice, theme) => ipcRenderer.invoke("set-theme", choice, theme),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ""; } catch { return ""; } },
  // Settings > "Pause when minimized" (see sendWindowMinimized in desktop.js).
  onWindowMinimized: (cb) => {
    const h = () => cb();
    ipcRenderer.on("window-minimized", h);
    return () => ipcRenderer.removeListener("window-minimized", h);
  },
  onMenuCommand: (cb) => {
    const h = (_e, cmd) => cb(cmd);
    ipcRenderer.on("menu-command", h);
    return () => ipcRenderer.removeListener("menu-command", h);
  },
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("update-status", h);
    return () => ipcRenderer.removeListener("update-status", h);
  },
  // The narrow window beside the music program (see companion.js).
  openCompanion: () => ipcRenderer.invoke("companion-open"),
  closeCompanion: () => ipcRenderer.invoke("companion-close"),
  companionPinned: () => ipcRenderer.invoke("companion-pinned"),
  setCompanionPinned: (on) => ipcRenderer.invoke("companion-pin", on),
  showMain: (cmd) => ipcRenderer.invoke("companion-show-main", cmd),
  onCompanionCommand: (cb) => {
    const h = (_e, cmd) => cb(cmd);
    ipcRenderer.on("companion-command", h);
    return () => ipcRenderer.removeListener("companion-command", h);
  },
});
