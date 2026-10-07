// Everyday desktop conveniences. SHARED FILE: the same file lives in Backups and
// Uploader (electron/electron/desktop.js); change both together.
//   - the window reopens at the size and place it was closed at
//   - a proper menu bar (File, Edit, View, Window, Help) listing the shortcuts
//   - copy to the clipboard, progress on the dock / taskbar icon, and telling a
//     dropped file from a dropped folder, for the page
//   - on Windows, no white title bar: the page draws its own top strip (TitleBar in
//     src/components/Desktop.tsx) and Windows draws its buttons over it
//   - Cut / Copy / Paste (and spelling fixes) when right-clicking text
//   - window glass: the sidebar lets the desktop show through, frosted (Mac) or
//     tinted by the wallpaper (Windows 11's Mica)
//   - light or dark: the page's theme (Settings > Look) also colours the window, the
//     Windows title strip and the system's own menus and glass
const { app, Menu, clipboard, ipcMain, nativeTheme, screen, shell } = require("electron");
const fs = require("fs");
const os = require("os");
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

// ── Windows title bar ─────────────────────────────────────────────────────────

// Windows' own title bar and menu row are light grey whatever the app looks like.
// There the window gets no title bar; the page's strip takes its place in the app's
// ink colour, and Windows still draws minimise / maximise / close (with snapping) on
// it. The colour matches --bg in lazy-ui.css. Mac and Linux keep their usual frame.
const INK = "#0B0E12";
const PAPER = "#EDEAE4";  // --bg in light mode (lazy-ui.css, html[data-theme="light"])
const CLEAR = "#00000000";
const TITLE_BAR = { color: INK, symbolColor: "#AAB4C0", height: 36 };
const TITLE_BAR_LIGHT = { color: PAPER, symbolColor: "#3A424C", height: 36 };

// ── light or dark ─────────────────────────────────────────────────────────────

// The page picks Dark, Light or Match my computer (look.ts) and tells this side, so the
// window opens in the right colour next time and the system's own pieces follow it.
const themeFile = () => path.join(app.getPath("userData"), "theme.json");
const CHOICES = ["dark", "light", "system"];

// { choice, theme }: what was picked, and what it came out as ("light" or "dark").
function savedTheme() {
  try {
    const s = JSON.parse(fs.readFileSync(themeFile(), "utf8"));
    return { choice: CHOICES.includes(s.choice) ? s.choice : "dark", theme: s.theme === "light" ? "light" : "dark" };
  } catch {
    return { choice: "dark", theme: "dark" };
  }
}

// The Windows title strip's colours for a theme, see-through when the window is glass.
function titleBarFor(theme, glass) {
  const bar = theme === "light" ? TITLE_BAR_LIGHT : TITLE_BAR;
  return { ...bar, color: glass ? CLEAR : bar.color };
}

// ── window glass ──────────────────────────────────────────────────────────────

// Which see-through material the window gets: "vibrancy" on a Mac, "mica" on Windows 11
// (build 22621 and later; older Windows has no Mica), "none" elsewhere. The page is told
// (--lc-material, data-material on <html>) and only then makes the sidebar and the title
// strip see-through; everything else stays solid ink. Turning off transparency in the
// system settings makes both materials plain again, with no change needed here.
function windowMaterial(platform = process.platform, release = os.release()) {
  if (platform === "darwin") return "vibrancy";
  if (platform === "win32" && Number(String(release).split(".")[2] || 0) >= 22621) return "mica";
  return "none";
}

function windowChromeOptions(platform = process.platform, material = windowMaterial(platform), theme = savedTheme().theme) {
  const glass = material !== "none";
  const opts = { backgroundColor: glass ? CLEAR : theme === "light" ? PAPER : INK };
  if (platform === "win32") {
    opts.titleBarStyle = "hidden";
    opts.titleBarOverlay = titleBarFor(theme, glass);
  }
  if (material === "mica") opts.backgroundMaterial = "mica";
  if (material === "vibrancy") Object.assign(opts, { vibrancy: "sidebar", visualEffectState: "followWindow" });
  return opts;
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
        { label: "Find anything…", ...pageKey("CmdOrCtrl+K"), click: send("palette") },
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
        { label: "Report a problem", click: () => require("./report").reportProblem() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── right-click in text ──────────────────────────────────────────────────────

// Right-clicking a text box or selected text gives the usual Cut / Copy / Paste menu,
// with spelling fixes for a misspelt word. The page's own menus (projects, tracks)
// stop the click first, so this only shows where the page has none.
function textMenuTemplate(params, isMac = process.platform === "darwin") {
  const { isEditable, selectionText = "", misspelledWord = "", dictionarySuggestions = [], editFlags = {} } = params;
  const hasText = selectionText.trim().length > 0;
  if (!isEditable && !hasText) return [];
  const items = [];
  if (isEditable && misspelledWord) {
    for (const word of dictionarySuggestions.slice(0, 4)) items.push({ label: word, replace: word });
    items.push({ label: "Add to dictionary", learn: misspelledWord }, { type: "separator" });
  }
  if (isEditable) items.push({ role: "cut", enabled: !!editFlags.canCut });
  items.push({ role: "copy", enabled: !!editFlags.canCopy || hasText });
  if (isEditable) items.push({ role: "paste", enabled: !!editFlags.canPaste }, { type: "separator" }, { role: "selectAll" });
  if (hasText && isMac) items.push({ type: "separator" }, { label: `Look up “${selectionText.trim().slice(0, 24)}”`, lookUp: true });
  return items;
}

function installTextMenu(win) {
  win.webContents.on("context-menu", (_e, params) => {
    const template = textMenuTemplate(params).map((it) => {
      if (it.replace) return { label: it.label, click: () => win.webContents.replaceMisspelling(it.replace) };
      if (it.learn) return { label: it.label, click: () => win.webContents.session.addWordToSpellCheckerDictionary(it.learn) };
      if (it.lookUp) return { label: it.label, click: () => win.webContents.showDefinitionForSelection() };
      return it;
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
}

// ── helpers the page calls ────────────────────────────────────────────────────

function registerDesktopIpc(getWindow) {
  // Light or dark (Settings > Look): the system's menus, glass and dialogs follow it,
  // and on Windows the title strip's colours too. Remembered for the next launch.
  try { nativeTheme.themeSource = savedTheme().choice; } catch { /* before ready on old Electron: the page sends it again */ }
  ipcMain.handle("set-theme", (_e, choice, theme) => {
    const c = CHOICES.includes(choice) ? choice : "dark";
    const t = theme === "light" ? "light" : "dark";
    nativeTheme.themeSource = c;
    try { fs.writeFileSync(themeFile(), JSON.stringify({ choice: c, theme: t })); } catch { /* read-only disk: skip */ }
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const glass = windowMaterial() !== "none";
    if (!glass) win.setBackgroundColor(t === "light" ? PAPER : INK);
    if (process.platform === "win32" && typeof win.setTitleBarOverlay === "function") {
      try { win.setTitleBarOverlay(titleBarFor(t, glass)); } catch { /* no overlay on this window */ }
    }
  });
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
  // The ☰ button in the Windows strip opens the menu bar's menus under it.
  ipcMain.handle("open-app-menu", (_e, x, y) => {
    const win = getWindow();
    const menu = Menu.getApplicationMenu();
    if (!win || win.isDestroyed() || !menu) return;
    menu.popup({ window: win, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) });
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

// Tells the page when the window is minimized, so Settings > "Pause when minimized"
// can pause the music. Only minimizing: hiding to the tray or switching apps doesn't count.
function sendWindowMinimized(win) {
  win.on("minimize", () => { if (!win.isDestroyed()) win.webContents.send("window-minimized"); });
}

// A window that was hidden to the tray comes back where it was.
function showWindow(win) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

module.exports = { windowMaterial, windowChromeOptions, titleBarFor, savedTheme, textMenuTemplate, installTextMenu, windowStateOptions, savedWindowState, onAScreen, installAppMenu, registerDesktopIpc, sendWindowMinimized, showWindow };
