const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");

function createTray({ onShow, onQuit }) {
  // tray.png + tray@2x.png (44/88px); nativeImage auto-picks @2x on retina.
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "tray.png"));
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("LazyCreatives Backups");
  // updateItem: "Restart to update…" / "Download version…" once the updater finds one.
  const build = (updateItem) => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: onShow },
    ...(updateItem ? [updateItem] : []),
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]));
  build(null);
  tray.setUpdateItem = build;
  tray.on("click", onShow);
  return tray;
}

module.exports = { createTray };
