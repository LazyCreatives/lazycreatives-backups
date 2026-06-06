const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("ablebackup", { ready: true });
