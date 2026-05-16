import { BrowserWindow } from "electron";

export default function createMainWindow(url, options = {}) {
    const window = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 980,
        minHeight: 680,
        title: "STFC Community Mod Companion",
        backgroundColor: "#050609",
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: options.preloadPath,
            sandbox: true,
        },
    });

    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(({ url: requestedUrl }) => {
        const requested = new URL(requestedUrl);
        const current = new URL(url);
        if (requested.origin !== current.origin) {
            void options.shell.openExternal(requestedUrl);
            return { action: "deny" };
        }

        return { action: "allow" };
    });
    window.webContents.on("before-input-event", (event, input) => {
        const key = String(input.key ?? "").toLowerCase();
        const reloadRequested = key === "f5" || (key === "r" && (input.control || input.meta));
        if (!reloadRequested) {
            return;
        }

        event.preventDefault();
        window.webContents.reload();
    });

    void window.loadURL(url);
    return window;
}
