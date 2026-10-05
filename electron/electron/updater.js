const fs = require("fs");
const path = require("path");
const { app, dialog, shell, net, ipcMain } = require("electron");
const { isNewer } = require("./version");
const { changelogSection, releaseSection, parseNotes, notesText } = require("./notes");

// Keeps the installed app up to date from the public repo's GitHub Releases.
//
// Windows and Linux (AppImage): electron-updater downloads the new version in the
// background, then we offer "Restart the app" (only the app, never the computer); if
// the person picks "Later" it installs the next time they quit. Nothing ever restarts
// without them asking.
//
// macOS: an app can only replace itself when it is signed with an Apple Developer
// ID, which our builds are not. So on a Mac we only check the latest release and
// offer a button that opens the download page. Unpacked Linux builds and dev runs
// do the same.
//
// The "Check for updates" row in Settings runs the same check on demand and shows
// the result in place, through the update-* calls registered below.
//
// Every update message lists what's new in that version, taken from its GitHub
// Release text. The app's own CHANGELOG.md is bundled too (see "extraResources" in
// package.json), so the "What's new in <version>" panel works offline.
//
// Same file in both apps; only the options passed in from main.js differ.

const FIRST_CHECK_MS = 15 * 1000;        // let startup settle first
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const OFFLINE = "Couldn't reach the update server. Check your internet connection and try again.";

// This version's notes from the CHANGELOG.md that ships inside the app.
function bundledNotes() {
  const places = [
    process.resourcesPath && path.join(process.resourcesPath, "CHANGELOG.md"), // installed app
    path.join(__dirname, "..", "..", "CHANGELOG.md"),                          // dev run
  ].filter(Boolean);
  for (const p of places) {
    try { return parseNotes(changelogSection(fs.readFileSync(p, "utf8"), app.getVersion())); } catch { /* next */ }
  }
  return [];
}

// The message box text: what's new (when we have it), then what to do next.
const withNotes = (notes, action) => (notes && notes.length ? `What's new\n\n${notesText(notes)}\n\n${action}` : action);

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
  const api = (p) => net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${p}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": appName },
  });
  // A release's what's-new list, or [] if it can't be fetched (the update still works).
  const notesFor = new Map();
  const fetchNotes = async (version) => {
    if (notesFor.has(version)) return notesFor.get(version);
    try {
      const res = await api(`tags/v${version}`);
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const notes = parseNotes(releaseSection((await res.json()).body));
      notesFor.set(version, notes);
      return notes;
    } catch (err) {
      console.error("[updater] couldn't read the release notes:", err.message);
      return [];
    }
  };

  let check;  // (manual) => Promise<void>
  let apply = async () => {};

  if (!selfUpdate) {
    check = async (manual) => {
      if (manual) setStatus({ state: "checking" });
      try {
        const res = await api("latest");
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const release = await res.json();
        const latest = String(release.tag_name || "").replace(/^v/, "");
        if (!latest || !isNewer(latest, app.getVersion())) {
          setStatus({ state: "latest" });
          return;
        }
        const notes = parseNotes(releaseSection(release.body));
        setStatus({ state: "available", latest, action: "download", notes });
        onMenuItem({ label: `Download version ${latest}…`, click: openPage });
        if (manual) { offered.add(latest); return; } // the Settings row already shows it
        const choice = await ask(latest, {
          message: `${appName} ${latest} is available`,
          detail: withNotes(notes, `You have ${app.getVersion()}. Download the new version and drag it into Applications to replace this one. Your settings and data stay as they are.`),
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
    autoUpdater.on("update-available", async (info) => {
      setStatus({ state: "downloading", latest: info.version, percent: 0 });
      const notes = await fetchNotes(info.version);
      if (status.latest === info.version) setStatus({ ...status, notes });
    });
    autoUpdater.on("download-progress", (p) => {
      if (status.state === "downloading") setStatus({ ...status, percent: Math.round(p.percent || 0) });
    });
    autoUpdater.on("update-downloaded", async (info) => {
      ready = true;
      const notes = await fetchNotes(info.version);
      setStatus({ state: "ready", latest: info.version, action: "restart", notes });
      onMenuItem({ label: `Restart the app to update to ${info.version}`, click: restart });
      if (manual) { offered.add(info.version); return; } // the Settings row already shows it
      const choice = await ask(info.version, {
        message: `${appName} ${info.version} is ready to install`,
        detail: withNotes(notes, `Restart the app to finish updating. Only ${appName} closes and opens again; your computer does not restart. Or pick Later and it updates the next time you quit the app.`),
        buttons: ["Restart the app", "Later"],
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
  // The "What's new in <version>" panel: this version's notes from the bundled changelog.
  ipcMain.handle("whats-new", () => ({ version: app.getVersion(), groups: bundledNotes() }));

  // Automatic checks only in the installed app; dev runs check when asked.
  if (!app.isPackaged || disabled) return;
  setTimeout(() => check(false), FIRST_CHECK_MS);
  setInterval(() => check(false), CHECK_EVERY_MS);
}

module.exports = { startUpdater };
