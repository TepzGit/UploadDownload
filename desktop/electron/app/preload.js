// The title bar's buttons talk to main.js through this, and nothing else.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("geek4u", {
  act: (what) => ipcRenderer.send("geek4u", what),
  on: (fn) => ipcRenderer.on("geek4u", (_e, kind, value) => fn(kind, value)),
  platform: process.platform,
});
