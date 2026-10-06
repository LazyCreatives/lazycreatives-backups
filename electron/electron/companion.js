// The narrow window: a slim, always-on-top window the producer keeps beside their
// music program, showing the same app at a glance. SHARED FILE: the same file lives
// in Backups and Uploader (electron/electron/companion.js); change both together.
//   - one narrow window at a time; opening it again brings it forward
//   - it reopens where it was last left, at the size it was left at
//   - the pin keeps it above other windows (on by default); the page can switch it
//   - View > Narrow window (Cmd/Ctrl+Shift+N) opens or closes it, as does the tray
//   - closing it never quits the app, and Cmd/Ctrl+W closes it rather than the main window
// It loads the same page as the main window with #companion, so it has the same look.
const { app, BrowserWindow, Menu, MenuItem, ipcMain, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { onAScreen } = require("./desktop");

const SIZE = { width: 340, height: 620 };
const MIN = { width: 300, height: 420 };
const MAX_WIDTH = 420;
const MARGIN = 16;
const ACCELERATOR = "CmdOrCtrl+Shift+N";
const LABEL = "Narrow window";

// Where the narrow window opens: where it was left if that is still on a screen,
// else against the right edge of the screen the main window is on.
function companionBounds(saved, displays, near) {
  const s = saved || {};
  const width = Math.min(MAX_WIDTH, Math.max(MIN.width, Math.round(s.width) || SIZE.width));
  const height = Math.max(MIN.height, Math.round(s.height) || SIZE.height);
  if (Number.isFinite(s.x) && Number.isFinite(s.y) && onAScreen({ x: s.x, y: s.y, width, height }, displays)) {
    return { x: Math.round(s.x), y: Math.round(s.y), width, height };
  }
  const centre = near ? { x: near.x + near.width / 2, y: near.y + near.height / 2 } : null;
  const display = (centre && displays.find(({ workArea: w }) =>
    centre.x >= w.x && centre.x < w.x + w.width && centre.y >= w.y && centre.y < w.y + w.height)) || displays[0];
  if (!display) return { width, height };
  const w = display.workArea;
  const h = Math.min(height, w.height - MARGIN * 2);
  return { x: w.x + w.width - width - MARGIN, y: w.y + Math.round((w.height - h) / 2), width, height: h };
}

function createCompanion({ getMainWindow, showMain, windowOptions, load }) {
  let win = null;
  const stateFile = () => path.join(app.getPath("userData"), "companion-state.json");
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")) || {}; } catch { return {}; } };
  const writeState = (patch) => {
    const next = { ...readState(), ...patch };
    try { fs.writeFileSync(stateFile(), JSON.stringify(next)); } catch { /* read-only disk: skip */ }
  };
  const pinnedNow = () => readState().pinned !== false;  // pinned unless turned off

  function applyPin(on) {
    if (!win || win.isDestroyed()) return;
    // "floating" sits over ordinary windows; a Mac also keeps it over a full-screen music program
    win.setAlwaysOnTop(on, "floating");
    if (process.platform === "darwin") win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on });
  }

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      return win;
    }
    const main = getMainWindow();
    const near = main && !main.isDestroyed() ? main.getBounds() : null;
    const bounds = companionBounds(readState(), screen.getAllDisplays(), near);
    const opts = windowOptions();
    win = new BrowserWindow({
      ...opts, ...bounds,
      minWidth: MIN.width, maxWidth: MAX_WIDTH, minHeight: MIN.height,
      title: LABEL, fullscreenable: false, maximizable: false, show: false,
    });
    applyPin(pinnedNow());
    win.once("ready-to-show", () => { if (win && !win.isDestroyed()) win.show(); });
    let timer = null;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win || win.isDestroyed() || win.isMinimized()) return;
        writeState(win.getBounds());
      }, 300);
    };
    win.on("resize", save);
    win.on("move", save);
    win.on("close", () => { if (!win.isMinimized()) writeState(win.getBounds()); });
    win.on("closed", () => { win = null; });
    // the page never navigates away or opens other windows (as in the main window)
    win.webContents.on("will-navigate", (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    load(win);
    return win;
  }

  function close() { if (win && !win.isDestroyed()) win.close(); }
  const isOpen = () => !!win && !win.isDestroyed();
  // The menu item and the shortcut: open it, or close it when it is already in front.
  function toggle() {
    if (isOpen() && win.isVisible() && win.isFocused()) close();
    else open();
  }
  const owns = (sender) => isOpen() && sender === win.webContents;

  ipcMain.handle("companion-open", () => { open(); });
  ipcMain.handle("companion-close", (e) => { if (owns(e.sender)) close(); });
  ipcMain.handle("companion-pinned", () => pinnedNow());
  ipcMain.handle("companion-pin", (_e, on) => {
    const next = !!on;
    writeState({ pinned: next });
    applyPin(next);
    return next;
  });
  // "Open the full app" and the like: bring the main window forward, then tell its page
  // what to show ({ go: "home" }, { go: "project", name }, { go: "upload", paths }).
  ipcMain.handle("companion-show-main", (_e, cmd) => {
    showMain();
    const main = getMainWindow();
    if (cmd && typeof cmd === "object" && main && !main.isDestroyed()) {
      main.webContents.send("companion-command", JSON.parse(JSON.stringify(cmd)));
    }
  });

  // View > Narrow window, added to the menu bar desktop.js builds. Cmd/Ctrl+W (File >
  // Close window) closes the narrow window when that is the one in front.
  function addToMenu() {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    const view = menu.items.find((m) => m.label === "View");
    if (view && view.submenu && !view.submenu.items.some((m) => m.label === LABEL)) {
      view.submenu.insert(0, new MenuItem({ type: "separator" }));
      view.submenu.insert(0, new MenuItem({ label: LABEL, accelerator: ACCELERATOR, click: toggle }));
    }
    const file = menu.items.find((m) => m.label === "File");
    const closeItem = file && file.submenu && file.submenu.items.find((m) => m.label === "Close window");
    if (closeItem && !closeItem.companionAware) {
      const hideMain = closeItem.click;
      closeItem.click = (...args) => {
        if (isOpen() && win.isFocused()) close();
        else hideMain(...args);
      };
      closeItem.companionAware = true;
    }
    Menu.setApplicationMenu(menu);
  }

  return { open, close, toggle, isOpen, addToMenu, menuItem: { label: LABEL, click: () => open() } };
}

module.exports = { createCompanion, companionBounds, COMPANION_SIZE: SIZE, COMPANION_MIN: MIN, COMPANION_MAX_WIDTH: MAX_WIDTH, COMPANION_ACCELERATOR: ACCELERATOR };
