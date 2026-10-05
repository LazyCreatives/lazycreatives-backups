// Everyday desktop conveniences. SHARED FILE: the same file lives in Backups and
// Uploader (electron/electron/desktop.js); change both together.
//   - the window reopens at the size and place it was closed at
//   - a proper menu bar (File, Edit, View, Window, Help) listing the shortcuts
//   - copy to the clipboard, progress on the dock / taskbar icon, and telling a
//     dropped file from a dropped folder, for the page
const { app, Menu, clipboard, ipcMain, screen, shell } = require("electron");
const fs = require("fs");
const path = require("path");

// ── window size and place ─────────────────────────────────────────────────────

const DEFAULT_SIZE = { width: 1100, height: 760 };
const MIN_SIZE = { width: 760, height: 520 };
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

// Saved bounds are only used when most of the window still lands on a screen that
// exists now (a second monitor may have been unplugged since).
function onAScreen(b, displays) {
  return displays.some(({ workArea: w }) => {
    const x = Math.max(b.x, w.x), y = Math.max(b.y, w.y);
    const r = Math.min(b.x + b.width, w.x + w.width), btm = Math.min(b.y + b.height, w.y + w.height);
    return r - x >= Math.min(200, b.width) && btm - y >= Math.min(120, b.height);
  });
}

function savedWindowState(displays) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const width = Math.max(MIN_SIZE.width, Math.round(s.width) || DEFAULT_SIZE.width);
    const height = Math.max(MIN_SIZE.height, Math.round(s.height) || DEFAULT_SIZE.height);
    const placed = Number.isFinite(s.x) && Number.isFinite(s.y)
      && onAScreen({ x: s.x, y: s.y, width, height }, displays || screen.getAllDisplays());
    return { width, height, ...(placed ? { x: Math.round(s.x), y: Math.round(s.y) } : {}), maximized: !!s.maximized };
  } catch {
    return { ...DEFAULT_SIZE, maximized: false };
  }
}

// The options to open the window with, and a function that starts saving changes.
function windowStateOptions() {
  const s = savedWindowState();
  const { maximized, ...bounds } = s;
  return {
    options: { ...bounds, minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height },
    track(win) {
      if (maximized) win.maximize();
      let timer = null;
      const save = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
          const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
          try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch { /* read-only disk: skip */ }
        }, 400);
      };
      for (const ev of ["resize", "move", "maximize", "unmaximize", "close"]) win.on(ev, save);
    },
  };
}

// ── menu bar ──────────────────────────────────────────────────────────────────

// Shortcuts the page itself listens for (search, Settings, back/forward) are shown
// in the menu but left to the page on Windows and Linux, so typing in a box keeps
// working. On a Mac the menu owns them and tells the page through "menu-command".
function installAppMenu({ appName, website, getWindow }) {
  const isMac = process.platform === "darwin";
  const send = (cmd) => () => {
    const win = getWindow();
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.webContents.send("menu-command", cmd);
  };
  const pageKey = (accelerator) => ({ accelerator, registerAccelerator: isMac });
  const settings = { label: isMac ? "Settings…" : "Settings", ...pageKey("CmdOrCtrl+,"), click: send("settings") };
  const template = [
    ...(isMac ? [{
      label: appName,
      submenu: [
        { role: "about", label: `About ${appName}` },
        { type: "separator" }, settings, { type: "separator" },
        { role: "services" }, { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" }, { role: "quit", label: `Quit ${appName}` },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        ...(isMac ? [] : [settings, { type: "separator" }]),
        { label: "Close window", accelerator: "CmdOrCtrl+W", click: () => getWindow()?.hide() },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit", label: "Quit", accelerator: "Ctrl+Q" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        { type: "separator" },
        { label: "Find", ...pageKey("CmdOrCtrl+F"), click: send("find") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Back", ...pageKey(isMac ? "Cmd+[" : "Alt+Left"), click: send("back") },
        { label: "Forward", ...pageKey(isMac ? "Cmd+]" : "Alt+Right"), click: send("forward") },
        { type: "separator" },
        { role: "resetZoom", label: "Actual size" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "What's new", click: send("whats-new") },
        { label: "Keyboard shortcuts", click: send("shortcuts") },
        { type: "separator" },
        { label: "Lazy Creatives website", click: () => shell.openExternal(website) },
        { label: "Report a problem", click: () => shell.openExternal(`${website}#contact`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── helpers the page calls ────────────────────────────────────────────────────

function registerDesktopIpc(getWindow) {
  ipcMain.handle("copy-text", (_e, text) => {
    if (typeof text !== "string" || !text) return false;
    clipboard.writeText(text);
    return true;
  });
  // A fraction from 0 to 1 shows a bar on the dock / taskbar icon; anything else clears it.
  ipcMain.handle("set-progress", (_e, value) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const v = typeof value === "number" && value >= 0 && value <= 1 ? value : -1;
    win.setProgressBar(v);
  });
  // "Restart the app" on the could-not-start screen: a fresh start of the app and its engine.
  ipcMain.handle("relaunch-app", () => { app.relaunch(); app.quit(); });
  // Dropped items: which are folders and which are files.
  ipcMain.handle("path-kinds", async (_e, paths) => {
    if (!Array.isArray(paths)) return [];
    return Promise.all(paths.slice(0, 50).map(async (p) => {
      try {
        const st = await fs.promises.stat(p);
        return { path: p, kind: st.isDirectory() ? "folder" : "file" };
      } catch { return { path: p, kind: "missing" }; }
    }));
  });
}

// A window that was hidden to the tray comes back where it was.
function showWindow(win) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

module.exports = { windowStateOptions, savedWindowState, onAScreen, installAppMenu, registerDesktopIpc, showWindow };
