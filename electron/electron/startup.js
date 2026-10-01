const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// "Start when the computer starts". The OS keeps the real on/off state (macOS
// Login Items, the Windows Run key, a Linux autostart entry), so a producer who
// switches it off in System Settings is never overridden. We only turn it on once,
// on the very first launch, and from then on change it only when the user asks.

const LINUX_ENTRY = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "autostart", "lazycreatives-backups.desktop");

function markerPath() {
  return path.join(app.getPath("userData"), "startup-initialised");
}

function linuxExec() {
  // An AppImage runs from a temporary mount; APPIMAGE is the file the user keeps.
  return process.env.APPIMAGE || process.execPath;
}

function isOpenAtLogin() {
  if (process.platform === "linux") return fs.existsSync(LINUX_ENTRY);
  return app.getLoginItemSettings().openAtLogin;
}

function setOpenAtLogin(enabled) {
  enabled = !!enabled;
  if (process.platform === "linux") {
    if (enabled) {
      fs.mkdirSync(path.dirname(LINUX_ENTRY), { recursive: true });
      fs.writeFileSync(LINUX_ENTRY, [
        "[Desktop Entry]",
        "Type=Application",
        "Name=LazyCreatives Backups",
        `Exec="${linuxExec().replace(/"/g, '\\"')}"`,
        "X-GNOME-Autostart-enabled=true",
        "",
      ].join("\n"));
    } else {
      fs.rmSync(LINUX_ENTRY, { force: true });
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
  return isOpenAtLogin();
}

// First launch of a packaged build: start with the computer by default, so
// automatic backups keep running. Dev runs never register a login item.
function initOpenAtLogin() {
  if (!app.isPackaged) return;
  const marker = markerPath();
  if (fs.existsSync(marker)) return;
  try {
    setOpenAtLogin(true);
    fs.writeFileSync(marker, new Date().toISOString());
  } catch (err) {
    console.error("[startup] couldn't set start-with-computer:", err);
  }
}

module.exports = { isOpenAtLogin, setOpenAtLogin, initOpenAtLogin };
