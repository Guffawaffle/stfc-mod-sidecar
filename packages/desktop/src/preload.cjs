const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stfcDesktop", {
    getBootstrap: () => ipcRenderer.invoke("sidecar-bootstrap:get"),
    setDeveloperMode: (enabled) => ipcRenderer.invoke("sidecar-bootstrap:set-developer-mode", enabled),
    setModProfile: (profile) => ipcRenderer.invoke("sidecar-bootstrap:set-mod-profile", profile),
    getDeveloperToolsStatus: () => ipcRenderer.invoke("sidecar-devtools:get-status"),
    selectGameDirectory: () => ipcRenderer.invoke("sidecar-bootstrap:select-game-directory"),
    openGameDirectory: () => ipcRenderer.invoke("sidecar-bootstrap:open-game-directory"),
});