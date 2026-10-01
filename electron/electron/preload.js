const { contextBridge, ipcRenderer } = require("electron");

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.slice(flag.length + 1) : "";
}

contextBridge.exposeInMainWorld("ablebackup", {
  token: argValue("--ablebackup-token"),
  port: argValue("--ablebackup-port"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  pickFile: () => ipcRenderer.invoke("pick-file"),
  revealPath: (target) => ipcRenderer.invoke("reveal-path", target),
  openProject: (target) => ipcRenderer.invoke("open-project", target),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openFdaSettings: () => ipcRenderer.invoke("open-fda-settings"),
});
