const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stfcDesktop", {
    getBootstrap: () => ipcRenderer.invoke("sidecar-bootstrap:get"),
    setDeveloperMode: (enabled) => ipcRenderer.invoke("sidecar-bootstrap:set-developer-mode", enabled),
    setModProfile: (profile) => ipcRenderer.invoke("sidecar-bootstrap:set-mod-profile", profile),
    getDeveloperToolsStatus: () => ipcRenderer.invoke("sidecar-devtools:get-status"),
    selectGameDirectory: () => ipcRenderer.invoke("sidecar-bootstrap:select-game-directory"),
    openGameDirectory: () => ipcRenderer.invoke("sidecar-bootstrap:open-game-directory"),
    getCompanionUninstallStatus: () => ipcRenderer.invoke("sidecar-companion-uninstall:get-status"),
    openWindowsUninstallSettings: () => ipcRenderer.invoke("sidecar-companion-uninstall:open-windows-settings"),
    showCompanionInstallFolder: () => ipcRenderer.invoke("sidecar-companion-uninstall:show-install-folder"),
    runCompanionUninstaller: () => ipcRenderer.invoke("sidecar-companion-uninstall:run"),
});