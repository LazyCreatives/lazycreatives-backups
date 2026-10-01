const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");

function createTray({ onShow, onQuit }) {
  // tray.png + tray@2x.png (44/88px); nativeImage auto-picks @2x on retina.
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "tray.png"));
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("LazyCreatives Backups");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: onShow },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]));
  tray.on("click", onShow);
  return tray;
}

module.exports = { createTray };
