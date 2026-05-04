import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { initialDeveloperModeFromSources, normalizeDesktopSettings, normalizeModProfile } from "./desktop-settings.mjs";
import { SECURITY_MOTTO, STFC_GAME_EXECUTABLE, validateStfcGameDirectory } from "./game-directory.mjs";
import { buildReleaseInfo } from "../../viewer/release-info.mjs";

const DEFAULT_PORT = 43127;
const READY_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 5000;
const DEFAULT_FEED_FILE = "community_patch_battle_feed.jsonl";
const DEFAULT_SETTINGS_FILE = "community_patch_settings.toml";
const DESKTOP_SETTINGS_FILE = "desktop-settings.json";
const DESKTOP_INITIAL_SETTINGS_FILE = "desktop-initial-settings.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let sidecarProcess = null;
let sidecarShutdownToken = "";
let sidecarSyncToken = "";
let sidecarUrl = "";
let logPath = "";
let desktopSettingsPath = "";
let bootstrapWarning = "";
let desktopSettings = normalizeDesktopSettings();

app.setName("STFC Community Mod Companion");

app.whenReady().then(async () => {
    logPath = path.join(app.getPath("userData"), "desktop.log");
    desktopSettingsPath = path.join(app.getPath("userData"), DESKTOP_SETTINGS_FILE);
    desktopSettings = loadDesktopSettings();
    registerDesktopIpc();
    writeLog("log", `[sidecar-desktop] starting packaged=${app.isPackaged} execPath=${process.execPath}`);

    try {
        const server = await ensureSidecarServer();
        sidecarUrl = server.url;
        mainWindow = createMainWindow(server.url);
    } catch (error) {
        writeLog("error", `[sidecar-desktop] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && sidecarUrl) {
        mainWindow = createMainWindow(sidecarUrl);
    }
});

app.on("window-all-closed", () => {
    mainWindow = null;
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", (event) => {
    if (!sidecarProcess || !sidecarShutdownToken || !sidecarUrl) {
        return;
    }

    event.preventDefault();
    void stopSidecarServer().finally(() => app.exit(0));
});

function createMainWindow(url) {
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
            preload: path.join(__dirname, "preload.cjs"),
            sandbox: true,
        },
    });

    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(({ url: requestedUrl }) => {
        const requested = new URL(requestedUrl);
        const current = new URL(url);
        if (requested.origin !== current.origin) {
            void shell.openExternal(requestedUrl);
            return { action: "deny" };
        }

        return { action: "allow" };
    });

    void window.loadURL(url);
    return window;
}

async function ensureSidecarServer() {
    const port = Number.parseInt(process.env.STFC_SIDECAR_PORT ?? String(DEFAULT_PORT), 10);
    const url = `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_PORT}`;

    const existing = await fetchHealth(url, 800);
    if (existing?.ok) {
        writeLog("log", `[sidecar-desktop] using existing sidecar server at ${url}`);
        return { url, owned: false };
    }

    return startSidecarServer(url);
}

async function startSidecarServer(url) {
    const paths = resolveRuntimePaths();
    const gameDirectory = await validatedDesktopGameDirectoryForStartup();
    sidecarShutdownToken = randomUUID();
    sidecarSyncToken = process.env.STFC_SIDECAR_SYNC_TOKEN?.trim() || randomUUID();
    writeLog(
        "log",
        `[sidecar-desktop] starting server cwd=${paths.cwd} serverScript=${paths.serverScript} gameDirectory=${gameDirectory || "default"} mode=${companionMode()} serverExists=${fs.existsSync(paths.serverScript)}`,
    );

    const args = [paths.serverScript, "--port", new URL(url).port];
    if (gameDirectory) {
        args.push("--game-dir", gameDirectory);
    }

    sidecarProcess = spawn(process.execPath, args, {
        cwd: paths.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            STFC_SIDECAR_DESKTOP: "1",
            STFC_SIDECAR_DEVELOPER_MODE: desktopSettings.developerMode ? "1" : "0",
            STFC_SIDECAR_MOD_PROFILE: desktopSettings.modProfile,
            STFC_SIDECAR_CACHE_DIR: path.join(app.getPath("userData"), "cache"),
            ...releaseEnvironment(),
            STFC_SIDECAR_SHUTDOWN_TOKEN: sidecarShutdownToken,
            STFC_SIDECAR_SYNC_TOKEN: sidecarSyncToken,
        },
    });

    sidecarProcess.stdout?.on("data", (chunk) => writeLog("log", `[sidecar-server] ${chunk.toString().trimEnd()}`));
    sidecarProcess.stderr?.on("data", (chunk) => writeLog("error", `[sidecar-server] ${chunk.toString().trimEnd()}`));
    sidecarProcess.on("exit", (code, signal) => {
        writeLog("log", `[sidecar-desktop] sidecar server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
        sidecarProcess = null;
    });

    await waitForHealth(url, READY_TIMEOUT_MS);
    writeLog("log", `[sidecar-desktop] started sidecar server at ${url}`);
    return { url, owned: true };
}

function resolveRuntimePaths() {
    if (app.isPackaged) {
        return {
            cwd: process.resourcesPath,
            serverScript: path.join(process.resourcesPath, "viewer", "server.mjs"),
        };
    }

    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    return {
        cwd: repoRoot,
        serverScript: path.join(repoRoot, "packages", "viewer", "server.mjs"),
    };
}

async function waitForHealth(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            const health = await fetchHealth(url, 800);
            if (health?.ok) {
                return health;
            }
        } catch (error) {
            lastError = error;
        }

        await delay(250);
    }

    throw new Error(`sidecar server did not become ready at ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function fetchHealth(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${url}/api/health`, { signal: controller.signal });
        if (!response.ok) {
            return null;
        }

        return response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function stopSidecarServer() {
    const processToStop = sidecarProcess;
    if (!processToStop || !sidecarUrl || !sidecarShutdownToken) {
        return;
    }

    try {
        await fetch(`${sidecarUrl}/api/admin/shutdown`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${sidecarShutdownToken}`,
            },
        });
        await waitForExit(processToStop, SHUTDOWN_TIMEOUT_MS);
    } catch (error) {
        writeLog("warn", `[sidecar-desktop] graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        processToStop.kill();
    } finally {
        sidecarProcess = null;
        sidecarShutdownToken = "";
        sidecarSyncToken = "";
    }
}

function waitForExit(child, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for sidecar server exit")), timeoutMs);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeLog(level, message) {
    const line = `${new Date().toISOString()} ${message}\n`;
    if (level === "error") {
        console.error(message);
    } else if (level === "warn") {
        console.warn(message);
    } else {
        console.log(message);
    }

    if (!logPath) {
        return;
    }

    try {
        fs.appendFileSync(logPath, line, "utf8");
    } catch {
        // Logging must never prevent the companion app from starting.
    }
}

function registerDesktopIpc() {
    ipcMain.handle("sidecar-bootstrap:get", () => bootstrapSnapshot());
    ipcMain.handle("sidecar-bootstrap:set-developer-mode", async (_event, enabled) => {
        const developerMode = Boolean(enabled);
        if (desktopSettings.developerMode === developerMode) {
            return bootstrapSnapshot();
        }

        desktopSettings = normalizeDesktopSettings({
            ...desktopSettings,
            developerMode,
        });
        saveDesktopSettings(desktopSettings);
        await restartSidecarServer();
        return bootstrapSnapshot();
    });
    ipcMain.handle("sidecar-bootstrap:set-mod-profile", async (_event, profile) => {
        const modProfile = normalizeModProfile(profile);
        if (desktopSettings.modProfile === modProfile) {
            return bootstrapSnapshot();
        }

        desktopSettings = normalizeDesktopSettings({
            ...desktopSettings,
            modProfile,
        });
        saveDesktopSettings(desktopSettings);
        await restartSidecarServer();
        return bootstrapSnapshot();
    });
    ipcMain.handle("sidecar-devtools:get-status", () => {
        if (!desktopSettings.developerMode) {
            return {
                ok: false,
                code: "developer_mode_required",
                error: "Developer Tools are disabled.",
                developerMode: false,
                companionMode: "standard",
            };
        }

        return {
            ok: true,
            developerMode: true,
            companionMode: "developer",
        };
    });
    ipcMain.handle("sidecar-bootstrap:select-game-directory", async () => {
        const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
            title: "Select STFC game directory",
            buttonLabel: "Use Directory",
            properties: ["openDirectory"],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return bootstrapSnapshot();
        }

        const validation = await validateStfcGameDirectory(result.filePaths[0]);
        if (!validation.ok) {
            writeLog("warn", `[sidecar-desktop] rejected game directory reason=${validation.code} path=${sanitizeLogValue(result.filePaths[0])}`);
            return bootstrapSnapshot({ ok: false, error: validation.error });
        }

        desktopSettings = {
            ...desktopSettings,
            gameDirectory: validation.gameDirectory,
        };
        bootstrapWarning = "";
        saveDesktopSettings(desktopSettings);
        await restartSidecarServer();
        return bootstrapSnapshot();
    });
    ipcMain.handle("sidecar-bootstrap:open-game-directory", async () => {
        if (!desktopSettings.gameDirectory) {
            return { ok: false, error: "No game directory is selected." };
        }

        const validation = await validateStfcGameDirectory(desktopSettings.gameDirectory);
        if (!validation.ok) {
            return { ok: false, error: validation.error };
        }

        const error = await shell.openPath(validation.gameDirectory);
        return error ? { ok: false, error } : { ok: true };
    });
}

async function restartSidecarServer() {
    const previousPath = currentWindowPath("/settings/");
    if (sidecarProcess) {
        await stopSidecarServer();
    }

    const port = Number.parseInt(process.env.STFC_SIDECAR_PORT ?? String(DEFAULT_PORT), 10);
    const url = `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_PORT}`;
    const server = await startSidecarServer(url);
    sidecarUrl = server.url;
    if (mainWindow) {
        await mainWindow.loadURL(`${server.url}${currentWindowPath(previousPath)}`);
    }
}

function currentWindowPath(fallback) {
    try {
        const currentUrl = mainWindow?.webContents.getURL() ?? "";
        return currentUrl ? new URL(currentUrl).pathname : fallback;
    } catch {
        return fallback;
    }
}

async function bootstrapSnapshot(options = {}) {
    const health = sidecarUrl ? await fetchHealth(sidecarUrl, 800) : null;
    const selectedPaths = resolveSelectedGamePaths(desktopSettings.gameDirectory || health?.gameDir || "");
    return {
        ok: options.ok ?? true,
        desktop: true,
        gameDirectory: desktopSettings.gameDirectory || health?.gameDir || "",
        gameDirectorySelected: Boolean(desktopSettings.gameDirectory),
        feedPath: health?.feedPath ?? selectedPaths.feedPath,
        settingsPath: health?.settingsPath ?? selectedPaths.settingsPath,
        serverUrl: sidecarUrl,
        healthOk: Boolean(health?.ok),
        logPath,
        developerMode: Boolean(desktopSettings.developerMode),
        companionMode: companionMode(),
        modeLabel: desktopSettings.developerMode ? "Developer Tools" : "Standard Companion",
        modProfile: desktopSettings.modProfile || health?.modProfile || "guff-advanced",
        settingsProfile: desktopSettings.modProfile || health?.settingsProfile || "guff-advanced",
        communityModInstall: health?.communityModInstall ?? null,
        release: desktopReleaseInfo(health?.release),
        error: options.error ?? bootstrapWarning,
        requiredExecutable: STFC_GAME_EXECUTABLE,
        securityMotto: SECURITY_MOTTO,
    };
}

function resolveSelectedGamePaths(gameDirectory) {
    if (!gameDirectory) {
        return {
            feedPath: "",
            settingsPath: "",
        };
    }

    return {
        feedPath: path.join(gameDirectory, DEFAULT_FEED_FILE),
        settingsPath: path.join(gameDirectory, DEFAULT_SETTINGS_FILE),
    };
}

function loadDesktopSettings() {
    try {
        const parsed = JSON.parse(fs.readFileSync(desktopSettingsPath, "utf8"));
        return normalizeDesktopSettings(parsed);
    } catch {
        const initialSettings = readInitialDesktopSettings();
        return normalizeDesktopSettings({}, {
            initialDeveloperMode: initialDeveloperModeFromSources({
                environmentValue: process.env.STFC_SIDECAR_INITIAL_DEVELOPER_MODE,
                seedSettings: initialSettings,
            }),
        });
    }
}

function readInitialDesktopSettings() {
    const configuredPath = process.env.STFC_SIDECAR_INITIAL_SETTINGS_PATH;
    const initialSettingsPath = configuredPath
        ? path.resolve(configuredPath)
        : app.isPackaged
            ? path.join(process.resourcesPath, DESKTOP_INITIAL_SETTINGS_FILE)
            : "";

    if (!initialSettingsPath) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(initialSettingsPath, "utf8"));
    } catch {
        return {};
    }
}

function saveDesktopSettings(settings) {
    const normalized = normalizeDesktopSettings(settings);
    fs.mkdirSync(path.dirname(desktopSettingsPath), { recursive: true });
    fs.writeFileSync(desktopSettingsPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    writeLog("log", `[sidecar-desktop] saved desktop settings path=${desktopSettingsPath}`);
}

async function validatedDesktopGameDirectoryForStartup() {
    if (!desktopSettings.gameDirectory) {
        return "";
    }

    const validation = await validateStfcGameDirectory(desktopSettings.gameDirectory);
    if (validation.ok) {
        if (desktopSettings.gameDirectory !== validation.gameDirectory) {
            desktopSettings = {
                ...desktopSettings,
                gameDirectory: validation.gameDirectory,
            };
            saveDesktopSettings(desktopSettings);
        }

        return validation.gameDirectory;
    }

    bootstrapWarning = validation.error;
    writeLog("warn", `[sidecar-desktop] ignoring saved game directory reason=${validation.code} path=${sanitizeLogValue(desktopSettings.gameDirectory)}`);
    desktopSettings = {
        ...desktopSettings,
        gameDirectory: "",
    };
    saveDesktopSettings(desktopSettings);
    return "";
}

function sanitizeLogValue(value) {
    return String(value ?? "").replace(/[\r\n\t]/g, " ");
}

function companionMode() {
    return desktopSettings.developerMode ? "developer" : "standard";
}

function releaseEnvironment() {
    const release = desktopReleaseInfo();
    return {
        STFC_SIDECAR_APP_VERSION: release.version,
        STFC_SIDECAR_RELEASE_CHANNEL: release.channel,
        STFC_SIDECAR_UPDATE_MODE: release.updateMode,
        STFC_SIDECAR_SIGNATURE_POLICY: release.signaturePolicy,
    };
}

function desktopReleaseInfo(serverRelease = {}) {
    return buildReleaseInfo({
        version: app.getVersion() || serverRelease.version,
        channel: process.env.STFC_SIDECAR_RELEASE_CHANNEL ?? serverRelease.channel,
        updateMode: process.env.STFC_SIDECAR_UPDATE_MODE ?? serverRelease.updateMode,
        signaturePolicy: process.env.STFC_SIDECAR_SIGNATURE_POLICY ?? serverRelease.signaturePolicy,
        packaged: app.isPackaged,
    });
}
