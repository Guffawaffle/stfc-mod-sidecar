/**
 * Electron main process for the STFC Sidecar shell.
 *
 * Role: open a BrowserWindow pointed at the local sidecar server.
 * Non-goals: no IPC, no Node API exposure to the renderer. The renderer
 * loads the same UI that runs in Overwolf or a browser tab.
 *
 * Server lifecycle: this groundwork commit does NOT yet spawn the server
 * automatically. Run the server separately during development.
 *
 *   Terminal A: npm --workspace @stfc-mod-sidecar/server start
 *   Terminal B: npm --workspace @stfc-mod-sidecar/ui dev
 *   Terminal C: npm --workspace @stfc-mod-sidecar/desktop dev
 */

import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import path from "node:path";

const SIDECAR_URL =
  process.env.STFC_SIDECAR_URL ??
  (process.env.ELECTRON_DEV === "1"
    ? "http://127.0.0.1:43128"
    : "http://127.0.0.1:43127");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(SIDECAR_URL);
}

function createTray(): void {
  // Placeholder transparent icon; real LCARS asset lands with the visual pass.
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("STFC Sidecar");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show",
        click: () => {
          if (!mainWindow) createMainWindow();
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: "Always on top",
        type: "checkbox",
        checked: false,
        click: (item) => {
          mainWindow?.setAlwaysOnTop(item.checked);
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

void app.whenReady().then(() => {
  createMainWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep alive in tray on all platforms; user explicitly quits.
});

// Avoid unused var lints in strict mode.
void path;
