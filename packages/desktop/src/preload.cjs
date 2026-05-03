const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stfcDesktop", {
    getBootstrap: () => ipcRenderer.invoke("sidecar-bootstrap:get"),
    selectGameDirectory: () => ipcRenderer.invoke("sidecar-bootstrap:select-game-directory"),
    openGameDirectory: () => ipcRenderer.invoke("sidecar-bootstrap:open-game-directory"),
});