const { app, dialog, shell, net } = require("electron");
const { isNewer } = require("./version");

// Keeps the installed app up to date from the public repo's GitHub Releases.
//
// Windows and Linux (AppImage): electron-updater downloads the new version in the
// background, then we offer "Restart now"; if the person picks "Later" it installs
// the next time they quit. Nothing ever restarts without them asking.
//
// macOS: an app can only replace itself when it is signed with an Apple Developer
// ID, which our builds are not. So on a Mac we only check the latest release and
// offer a button that opens the download page.
//
// Same file in both apps; only the options passed in from main.js differ.

const FIRST_CHECK_MS = 15 * 1000;        // let startup settle first
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function startUpdater({ appName, owner, repo, downloadPage, getWindow, onMenuItem }) {
  if (!app.isPackaged || process.env.LAZYCREATIVES_NO_UPDATES) return;

  const offered = new Set(); // versions we already popped up a message for this run
  const ask = async (version, opts) => {
    if (offered.has(version)) return 1; // already asked: "Later"
    offered.add(version);
    const w = getWindow();
    const box = { type: "info", defaultId: 0, cancelId: 1, noLink: true, title: appName, ...opts };
    const r = w && !w.isDestroyed() && w.isVisible()
      ? await dialog.showMessageBox(w, box)
      : await dialog.showMessageBox(box);
    return r.response;
  };

  if (process.platform === "darwin") {
    const check = async () => {
      try {
        const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": appName },
        });
        if (!res.ok) return;
        const latest = String((await res.json()).tag_name || "").replace(/^v/, "");
        if (!latest || !isNewer(latest, app.getVersion())) return;
        const open = () => shell.openExternal(downloadPage);
        onMenuItem({ label: `Download version ${latest}…`, click: open });
        const choice = await ask(latest, {
          message: `${appName} ${latest} is available`,
          detail: `You have ${app.getVersion()}. Download the new version and drag it into Applications to replace this one. Your settings and data stay as they are.`,
          buttons: ["Open download page", "Later"],
        });
        if (choice === 0) open();
      } catch (err) {
        console.error("[updater] check failed:", err.message);
      }
    };
    setTimeout(check, FIRST_CHECK_MS);
    setInterval(check, CHECK_EVERY_MS);
    return;
  }

  // Linux builds other than the AppImage (e.g. running from an unpacked folder)
  // can't replace themselves; electron-updater would only log an error.
  if (process.platform === "linux" && !process.env.APPIMAGE) return;

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "Later" means: install when they next quit
  autoUpdater.logger = {
    info: (m) => console.log("[updater]", m),
    warn: (m) => console.warn("[updater]", m),
    error: (m) => console.error("[updater]", m),
    debug: () => {},
  };

  let ready = false;
  const restart = () => {
    // Our before-quit handler stops the sidecar first, then the installer runs.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  };
  autoUpdater.on("update-downloaded", async (info) => {
    ready = true;
    onMenuItem({ label: `Restart to update to ${info.version}`, click: restart });
    const choice = await ask(info.version, {
      message: `${appName} ${info.version} is ready`,
      detail: "Restart now to finish updating, or carry on and it will update the next time you quit.",
      buttons: ["Restart now", "Later"],
    });
    if (choice === 0) restart();
  });
  autoUpdater.on("error", (err) => console.error("[updater] error:", err && err.message));

  const check = () => {
    if (ready) return;
    autoUpdater.checkForUpdates().catch((err) => console.error("[updater] check failed:", err.message));
  };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { startUpdater };
