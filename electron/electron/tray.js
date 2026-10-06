const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

// The tray / menu bar icon: reopen the window, open the narrow window, or quit.
// SHARED FILE: the same file lives in Backups and Uploader (electron/electron/tray.js);
// change both together.
// tray.png + tray@2x.png (44/88px); nativeImage picks @2x on sharp screens. The icon
// is optional in dev: if it is missing the app still runs.
// items: more entries under "Open …" (the narrow window: see companion.js).
function createTray({ appName, onShow, onQuit, items = [] }) {
  const iconPath = path.join(__dirname, "..", "build", "tray.png");
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  let tray;
  try {
    tray = new Tray(img);
  } catch {
    return null; // some platforms refuse an empty tray image: skip it in dev
  }
  tray.setToolTip(appName);
  // updateItem: "Restart to update…" / "Download version…" once the updater finds one.
  const build = (updateItem) => tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${appName}`, click: onShow },
    ...items,
    ...(updateItem ? [updateItem] : []),
    { type: "separator" },
    { label: `Quit ${appName}`, click: onQuit },
  ]));
  build(null);
  tray.setUpdateItem = build;
  tray.on("click", onShow);
  return tray;
}

module.exports = { createTray };
