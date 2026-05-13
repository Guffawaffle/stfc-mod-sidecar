import { spawn } from "node:child_process";
import fs from "node:fs";

import {
    WINDOWS_APPS_FEATURES_URI,
    buildCompanionAppUninstallStatus,
    isDirectChildPath,
} from "./companion-uninstall.mjs";
import { normalizeDesktopSettings, normalizeModProfile } from "./desktop-settings.mjs";

export function registerDesktopIpc(options) {
    options.ipcMain.handle("sidecar-bootstrap:get", () => options.bootstrapSnapshot());
    options.ipcMain.handle("sidecar-companion-uninstall:get-status", () => buildDesktopCompanionAppUninstallStatus(options));
    options.ipcMain.handle("sidecar-companion-uninstall:open-windows-settings", () => openWindowsUninstallSettings(options));
    options.ipcMain.handle("sidecar-companion-uninstall:show-install-folder", () => showCompanionInstallFolder(options));
    options.ipcMain.handle("sidecar-companion-uninstall:run", () => runCompanionUninstaller(options));
    options.ipcMain.handle("sidecar-bootstrap:set-developer-mode", async (_event, enabled) => {
        const desktopSettings = options.getDesktopSettings();
        const developerMode = Boolean(enabled);
        if (desktopSettings.developerMode === developerMode) {
            return options.bootstrapSnapshot();
        }

        const updatedSettings = normalizeDesktopSettings({
            ...desktopSettings,
            developerMode,
        });
        options.setDesktopSettings(updatedSettings);
        options.saveDesktopSettings(updatedSettings);
        await options.restartSidecarServer();
        return options.bootstrapSnapshot();
    });
    options.ipcMain.handle("sidecar-bootstrap:set-mod-profile", async (_event, profile) => {
        const desktopSettings = options.getDesktopSettings();
        const modProfile = normalizeModProfile(profile);
        if (desktopSettings.modProfile === modProfile) {
            return options.bootstrapSnapshot();
        }

        const updatedSettings = normalizeDesktopSettings({
            ...desktopSettings,
            modProfile,
        });
        options.setDesktopSettings(updatedSettings);
        options.saveDesktopSettings(updatedSettings);
        await options.restartSidecarServer();
        return options.bootstrapSnapshot();
    });
    options.ipcMain.handle("sidecar-devtools:get-status", () => {
        if (!options.getDesktopSettings().developerMode) {
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
    options.ipcMain.handle("sidecar-bootstrap:select-game-directory", async () => {
        const result = await options.dialog.showOpenDialog(options.getMainWindow() ?? undefined, {
            title: "Select STFC game directory",
            buttonLabel: "Use Directory",
            properties: ["openDirectory"],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return options.bootstrapSnapshot();
        }

        const validation = await options.validateStfcGameDirectory(result.filePaths[0]);
        if (!validation.ok) {
            options.writeLog("warn", `[sidecar-desktop] rejected game directory reason=${validation.code} path=${sanitizeLogValue(result.filePaths[0])}`);
            return options.bootstrapSnapshot({ ok: false, error: validation.error });
        }

        const desktopSettings = options.getDesktopSettings();
        const updatedSettings = {
            ...desktopSettings,
            gameDirectory: validation.gameDirectory,
            profileGameDirectories: {
                ...desktopSettings.profileGameDirectories,
                [desktopSettings.modProfile]: validation.gameDirectory,
            },
        };
        options.setDesktopSettings(updatedSettings);
        options.setBootstrapWarning("");
        options.saveDesktopSettings(updatedSettings);
        await options.restartSidecarServer();
        return options.bootstrapSnapshot();
    });
    options.ipcMain.handle("sidecar-bootstrap:open-game-directory", async () => {
        const gameDirectory = activeProfileGameDirectory(options.getDesktopSettings());
        if (!gameDirectory) {
            return { ok: false, error: "No game directory is selected." };
        }

        const validation = await options.validateStfcGameDirectory(gameDirectory);
        if (!validation.ok) {
            return { ok: false, error: validation.error };
        }

        const error = await options.shell.openPath(validation.gameDirectory);
        return error ? { ok: false, error } : { ok: true };
    });
}

export function buildDesktopCompanionAppUninstallStatus(options) {
    return buildCompanionAppUninstallStatus({
        platform: options.process.platform,
        packaged: options.app.isPackaged,
        productName: options.app.getName(),
        executablePath: options.process.execPath,
        env: options.process.env,
        userDataPath: options.app.getPath("userData"),
        pathExists: fs.existsSync,
    });
}

async function openWindowsUninstallSettings(options) {
    if (options.process.platform !== "win32") {
        return { ok: false, error: "Windows Apps & Features is available only on Windows." };
    }

    await options.shell.openExternal(WINDOWS_APPS_FEATURES_URI);
    return { ok: true, opened: WINDOWS_APPS_FEATURES_URI };
}

async function showCompanionInstallFolder(options) {
    const status = buildDesktopCompanionAppUninstallStatus(options);
    if (!status.installDirectory) {
        return { ok: false, error: "No Companion install folder is available for this run." };
    }

    const error = await options.shell.openPath(status.installDirectory);
    return error ? { ok: false, error } : { ok: true, path: status.installDirectory };
}

async function runCompanionUninstaller(options) {
    const status = buildDesktopCompanionAppUninstallStatus(options);
    if (!status.canRunUninstaller || !status.uninstallerPath) {
        return {
            ok: false,
            status: status.mode,
            error: "This Companion run does not expose an installed app uninstaller.",
            companionAppUninstall: status,
        };
    }

    if (!isDirectChildPath(status.installDirectory, status.uninstallerPath)) {
        return {
            ok: false,
            status: "unsafe_uninstaller_path",
            error: "Refusing to launch an uninstaller outside the Companion install folder.",
            companionAppUninstall: status,
        };
    }

    try {
        const stats = fs.statSync(status.uninstallerPath);
        if (!stats.isFile()) {
            return {
                ok: false,
                status: "uninstaller_not_file",
                error: "The detected Companion uninstaller is not a file.",
                companionAppUninstall: status,
            };
        }

        const child = spawn(status.uninstallerPath, [], {
            cwd: status.installDirectory,
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        options.writeLog("log", `[sidecar-desktop] launched companion uninstaller path=${sanitizeLogValue(status.uninstallerPath)}`);
        setTimeout(() => options.app.quit(), 250);
        return {
            ok: true,
            status: "launched_uninstaller",
            uninstallerPath: status.uninstallerPath,
            userDataPolicy: status.userDataPolicy,
        };
    } catch (error) {
        return {
            ok: false,
            status: "uninstaller_launch_failed",
            error: error instanceof Error ? error.message : String(error),
            companionAppUninstall: status,
        };
    }
}

function activeProfileGameDirectory(desktopSettings) {
    return desktopSettings.profileGameDirectories?.[desktopSettings.modProfile] ?? desktopSettings.gameDirectory ?? "";
}

function sanitizeLogValue(value) {
    return String(value ?? "").replace(/[\r\n\t]/g, " ");
}
