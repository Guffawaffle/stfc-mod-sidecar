import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BrowserWindow } = require("electron");

export function attachWindowVisibilityHandlers(window) {
    let shown = false;

    const showWindow = () => {
        if (shown || window.isDestroyed()) {
            return;
        }

        shown = true;
        window.show();
    };

    window.once("ready-to-show", showWindow);
    window.webContents.once("did-finish-load", () => {
        setTimeout(() => {
            if (shown || window.isDestroyed()) {
                return;
            }

            showWindow();
        }, 250);
    });
}

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

    attachWindowVisibilityHandlers(window);
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
