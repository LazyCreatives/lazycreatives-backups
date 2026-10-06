// Loaded into the Electron main process before electron/main.js (passed as
// `-r e2e/main-hook.cjs` by e2e/app.ts). Test runs only; the app never loads it.
//
//  - Keeps everything the app saves (window size, localStorage, the catalog) in a
//    throwaway folder, so a run never sees or changes your own app data.
//  - Starts the app the way `npm start` does (the backend runs from ../backend with
//    your Python), but loads the built page from dist/ instead of the Vite dev server
//    on port 5173, so nothing has to be running first and a dev server you already
//    have open is left alone.
const path = require("path");
const { app, BrowserWindow } = require("electron");

const userData = process.env.E2E_USER_DATA;
if (userData) app.setPath("userData", userData);

const DEV_SERVER = /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/;
const BUILT_PAGE = path.join(__dirname, "..", "dist", "index.html");
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = function (url, options) {
  if (DEV_SERVER.test(String(url))) return this.loadFile(BUILT_PAGE);
  return loadURL.call(this, url, options);
};
