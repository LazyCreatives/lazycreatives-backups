const { app, dialog, shell, net, ipcMain } = require("electron");
const { isNewer } = require("./version");

// Keeps the installed app up to date from the public repo's GitHub Releases.
//
// Windows and Linux (AppImage): electron-updater downloads the new version in the
// background, then we offer "Restart now"; if the person picks "Later" it installs
// the next time they quit. Nothing ever restarts without them asking.
//
// macOS: an app can only replace itself when it is signed with an Apple Developer
// ID, which our builds are not. So on a Mac we only check the latest release and
// offer a button that opens the download page. Unpacked Linux builds and dev runs
// do the same.
//
// The "Check for updates" row in Settings runs the same check on demand and shows
// the result in place, through the update-* calls registered below.
//
// Same file in both apps; only the options passed in from main.js differ.

const FIRST_CHECK_MS = 15 * 1000;        // let startup settle first
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const OFFLINE = "Couldn't reach the update server. Check your internet connection and try again.";

function startUpdater({ appName, owner, repo, downloadPage, getWindow, onMenuItem }) {
  const disabled = !!process.env.LAZYCREATIVES_NO_UPDATES;
  // Only installed copies on Windows and the Linux AppImage can replace themselves.
  const selfUpdate = app.isPackaged && !disabled &&
    (process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE));

  // What the Settings row shows. state: idle | checking | latest | downloading |
  // available | ready | error | off. action: what its button does, if anything.
  let status = { current: app.getVersion(), state: disabled ? "off" : "idle" };
  const setStatus = (next) => {
    status = { current: app.getVersion(), ...next };
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send("update-status", status);
  };

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
  const openPage = () => shell.openExternal(downloadPage);

  let check;  // (manual) => Promise<void>
  let apply = async () => {};

  if (!selfUpdate) {
    check = async (manual) => {
      if (manual) setStatus({ state: "checking" });
      try {
        const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": appName },
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const latest = String((await res.json()).tag_name || "").replace(/^v/, "");
        if (!latest || !isNewer(latest, app.getVersion())) {
          setStatus({ state: "latest" });
          return;
        }
        setStatus({ state: "available", latest, action: "download" });
        onMenuItem({ label: `Download version ${latest}…`, click: openPage });
        if (manual) { offered.add(latest); return; } // the Settings row already shows it
        const choice = await ask(latest, {
          message: `${appName} ${latest} is available`,
          detail: `You have ${app.getVersion()}. Download the new version and drag it into Applications to replace this one. Your settings and data stay as they are.`,
          buttons: ["Open download page", "Later"],
        });
        if (choice === 0) openPage();
      } catch (err) {
        console.error("[updater] check failed:", err.message);
        if (manual) setStatus({ state: "error", message: OFFLINE });
      }
    };
    apply = async () => { if (status.action === "download") openPage(); };
  } else {
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
    let manual = false; // the last check came from the Settings button
    const restart = () => {
      // Our before-quit handler stops the sidecar first, then the installer runs.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    };
    autoUpdater.on("update-not-available", () => setStatus({ state: "latest" }));
    autoUpdater.on("update-available", (info) => setStatus({ state: "downloading", latest: info.version, percent: 0 }));
    autoUpdater.on("download-progress", (p) => {
      if (status.state === "downloading") setStatus({ ...status, percent: Math.round(p.percent || 0) });
    });
    autoUpdater.on("update-downloaded", async (info) => {
      ready = true;
      setStatus({ state: "ready", latest: info.version, action: "restart" });
      onMenuItem({ label: `Restart to update to ${info.version}`, click: restart });
      if (manual) { offered.add(info.version); return; } // the Settings row already shows it
      const choice = await ask(info.version, {
        message: `${appName} ${info.version} is ready`,
        detail: "Restart now to finish updating, or carry on and it will update the next time you quit.",
        buttons: ["Restart now", "Later"],
      });
      if (choice === 0) restart();
    });
    autoUpdater.on("error", (err) => {
      console.error("[updater] error:", err && err.message);
      if (status.state === "checking" || status.state === "downloading") setStatus({ state: "error", message: OFFLINE });
    });

    check = async (isManual) => {
      if (ready || status.state === "downloading") return;
      manual = isManual;
      if (isManual) setStatus({ state: "checking" });
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        console.error("[updater] check failed:", err.message);
        if (isManual) setStatus({ state: "error", message: OFFLINE });
      }
    };
    apply = async () => { if (ready) restart(); };
  }

  ipcMain.handle("update-status", () => status);
  ipcMain.handle("update-check", async () => {
    if (!disabled && status.state !== "checking") await check(true);
    return status;
  });
  ipcMain.handle("update-apply", () => apply());

  // Automatic checks only in the installed app; dev runs check when asked.
  if (!app.isPackaged || disabled) return;
  setTimeout(() => check(false), FIRST_CHECK_MS);
  setInterval(() => check(false), CHECK_EVERY_MS);
}

module.exports = { startUpdater };
