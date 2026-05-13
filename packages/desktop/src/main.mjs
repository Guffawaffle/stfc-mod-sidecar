import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { DEFAULT_MOD_PROFILE, initialDeveloperModeFromSources, normalizeDesktopSettings } from "./desktop-settings.mjs";
import { buildDesktopCompanionAppUninstallStatus, registerDesktopIpc } from "./desktop-ipc.mjs";
import { SECURITY_MOTTO, STFC_GAME_EXECUTABLE, detectDefaultStfcGameDirectory, validateStfcGameDirectory } from "./game-directory.mjs";
import createMainWindow from "./main-window.mjs";
import { createSidecarServerProcess } from "./sidecar-server-process.mjs";
import { appendBoundedLogLineSync } from "../../viewer/bounded-log-file.mjs";
import { buildReleaseInfo } from "../../viewer/release-info.mjs";

const DEFAULT_FEED_FILE = "community_patch_battle_feed.jsonl";
const DEFAULT_SETTINGS_FILE = "community_patch_settings.toml";
const DESKTOP_SETTINGS_FILE = "desktop-settings.json";
const DESKTOP_INITIAL_SETTINGS_FILE = "desktop-initial-settings.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopPackageJsonPath = path.resolve(__dirname, "..", "package.json");
const preloadPath = path.join(__dirname, "preload.cjs");

let mainWindow = null;
let logPath = "";
let desktopSettingsPath = "";
let bootstrapWarning = "";
let desktopSettings = normalizeDesktopSettings();
const sidecarServer = createSidecarServerProcess({
    app,
    dirname: __dirname,
    getCompanionMode: companionMode,
    getDesktopSettings: () => desktopSettings,
    getGameDirectoryForStartup: validatedDesktopGameDirectoryForStartup,
    getReleaseInfo: desktopReleaseInfo,
    writeLog,
});

app.setName("STFC Community Mod Companion");

app.whenReady().then(async () => {
    logPath = path.join(app.getPath("userData"), "desktop.log");
    desktopSettingsPath = path.join(app.getPath("userData"), DESKTOP_SETTINGS_FILE);
    desktopSettings = loadDesktopSettings();
    registerDesktopIpc({
        app,
        bootstrapSnapshot,
        dialog,
        getDesktopSettings: () => desktopSettings,
        getMainWindow: () => mainWindow,
        ipcMain,
        process,
        restartSidecarServer,
        saveDesktopSettings,
        setBootstrapWarning: (value) => {
            bootstrapWarning = value;
        },
        setDesktopSettings: (settings) => {
            desktopSettings = settings;
        },
        shell,
        validateStfcGameDirectory,
        writeLog,
    });
    writeLog("log", `[sidecar-desktop] starting packaged=${app.isPackaged} execPath=${process.execPath}`);

    try {
        const server = await sidecarServer.ensureSidecarServer();
        mainWindow = createMainWindow(server.url, { preloadPath, shell });
    } catch (error) {
        writeLog("error", `[sidecar-desktop] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && sidecarServer.url) {
        mainWindow = createMainWindow(sidecarServer.url, { preloadPath, shell });
    }
});

app.on("window-all-closed", () => {
    mainWindow = null;
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", (event) => {
    if (!sidecarServer.shouldStopOnQuit()) {
        return;
    }

    event.preventDefault();
    void sidecarServer.stopSidecarServer().finally(() => app.exit(0));
});

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
        appendBoundedLogLineSync(logPath, line);
    } catch {
        // Logging must never prevent the companion app from starting.
    }
}

async function restartSidecarServer() {
    const previousPath = currentWindowPath("/settings/");
    if (sidecarServer.isRunning()) {
        await sidecarServer.stopSidecarServer();
    }

    const server = await sidecarServer.startSidecarServer(sidecarServer.defaultUrl());
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
    const health = sidecarServer.url ? await sidecarServer.fetchHealth(sidecarServer.url, 800) : null;
    const selectedGameDirectory = activeProfileGameDirectory() || health?.gameDir || "";
    const selectedPaths = resolveSelectedGamePaths(selectedGameDirectory);
    return {
        ok: options.ok ?? true,
        desktop: true,
        gameDirectory: selectedGameDirectory,
        gameDirectorySelected: Boolean(activeProfileGameDirectory()),
        profileGameDirectories: desktopSettings.profileGameDirectories ?? {},
        feedPath: health?.feedPath ?? selectedPaths.feedPath,
        settingsPath: health?.settingsPath ?? selectedPaths.settingsPath,
        serverUrl: sidecarServer.url,
        healthOk: Boolean(health?.ok),
        logPath,
        developerMode: Boolean(desktopSettings.developerMode),
        companionMode: companionMode(),
        modeLabel: desktopSettings.developerMode ? "Developer Tools" : "Standard Companion",
        modProfile: desktopSettings.modProfile || health?.modProfile || DEFAULT_MOD_PROFILE,
        settingsProfile: desktopSettings.modProfile || health?.settingsProfile || DEFAULT_MOD_PROFILE,
        capabilities: health?.capabilities ?? {},
        capabilityBits: health?.capabilityBits ?? {},
        variantGate: health?.variantGate ?? null,
        communityModInstall: health?.communityModInstall ?? null,
        release: desktopReleaseInfo(health?.release),
        modOperationToken: sidecarServer.modToken,
        companionAppUninstall: buildDesktopCompanionAppUninstallStatus({ app, process }),
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
    const gameDirectory = activeProfileGameDirectory();
    if (!gameDirectory) {
        desktopSettings = normalizeDesktopSettings(desktopSettings);
        const detected = await detectDefaultStfcGameDirectory();
        if (detected?.ok) {
            desktopSettings = {
                ...desktopSettings,
                gameDirectory: detected.gameDirectory,
                profileGameDirectories: {
                    ...desktopSettings.profileGameDirectories,
                    [desktopSettings.modProfile]: detected.gameDirectory,
                },
            };
            bootstrapWarning = "";
            saveDesktopSettings(desktopSettings);
            writeLog("log", `[sidecar-desktop] detected game directory source=${detected.source} path=${sanitizeLogValue(detected.gameDirectory)}`);
            return detected.gameDirectory;
        }

        return "";
    }

    const validation = await validateStfcGameDirectory(gameDirectory);
    if (validation.ok) {
        if (gameDirectory !== validation.gameDirectory || desktopSettings.gameDirectory !== validation.gameDirectory) {
            desktopSettings = {
                ...desktopSettings,
                gameDirectory: validation.gameDirectory,
                profileGameDirectories: {
                    ...desktopSettings.profileGameDirectories,
                    [desktopSettings.modProfile]: validation.gameDirectory,
                },
            };
            saveDesktopSettings(desktopSettings);
        }

        return validation.gameDirectory;
    }

    bootstrapWarning = validation.error;
    writeLog("warn", `[sidecar-desktop] ignoring saved game directory reason=${validation.code} profile=${desktopSettings.modProfile} path=${sanitizeLogValue(gameDirectory)}`);
    const profileGameDirectories = { ...(desktopSettings.profileGameDirectories ?? {}) };
    delete profileGameDirectories[desktopSettings.modProfile];
    desktopSettings = {
        ...desktopSettings,
        gameDirectory: "",
        profileGameDirectories,
    };
    saveDesktopSettings(desktopSettings);
    return "";
}

function activeProfileGameDirectory() {
    return desktopSettings.profileGameDirectories?.[desktopSettings.modProfile] ?? desktopSettings.gameDirectory ?? "";
}

function sanitizeLogValue(value) {
    return String(value ?? "").replace(/[\r\n\t]/g, " ");
}

function companionMode() {
    return desktopSettings.developerMode ? "developer" : "standard";
}

function desktopReleaseInfo(serverRelease = {}) {
    return buildReleaseInfo({
        version: desktopReleaseVersion(serverRelease),
        channel: process.env.STFC_SIDECAR_RELEASE_CHANNEL ?? serverRelease.channel,
        updateMode: process.env.STFC_SIDECAR_UPDATE_MODE ?? serverRelease.updateMode,
        signaturePolicy: process.env.STFC_SIDECAR_SIGNATURE_POLICY ?? serverRelease.signaturePolicy,
        packaged: app.isPackaged,
    });
}

function desktopReleaseVersion(serverRelease = {}) {
    if (app.isPackaged) {
        return app.getVersion() || serverRelease.version;
    }

    return readDesktopPackageVersion() || serverRelease.version;
}

function readDesktopPackageVersion() {
    try {
        const parsed = JSON.parse(fs.readFileSync(desktopPackageJsonPath, "utf8"));
        return typeof parsed.version === "string" ? parsed.version : "";
    } catch {
        return "";
    }
}
