const { app, BrowserWindow } = require("electron");
const path = require("path");

const isDev = !!process.env.ABLEBACKUP_DEV;
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: "#0e0f13",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
