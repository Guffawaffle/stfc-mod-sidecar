import path from "node:path";

export const WINDOWS_APPS_FEATURES_URI = "ms-settings:appsfeatures";

const PORTABLE_ENV_KEYS = [
    "PORTABLE_EXECUTABLE_DIR",
    "PORTABLE_EXECUTABLE_FILE",
    "PORTABLE_EXECUTABLE_APP_FILENAME",
];

export function buildCompanionAppUninstallStatus(options = {}) {
    const platform = stringOrEmpty(options.platform) || process.platform;
    const packaged = options.packaged === true;
    const productName = stringOrEmpty(options.productName) || "STFC Community Mod Companion";
    const executablePath = stringOrEmpty(options.executablePath);
    const installDirectory = stringOrEmpty(options.installDirectory) || (executablePath ? path.dirname(executablePath) : "");
    const env = options.env && typeof options.env === "object" ? options.env : {};
    const userDataPath = stringOrEmpty(options.userDataPath);
    const uninstallerCandidates = companionUninstallerCandidates({ installDirectory, productName });
    const uninstallerPath = uninstallerCandidates.find((candidate) => pathExists(candidate, options.pathExists)) ?? "";
    const portable = isPortableLaunch(env) || looksLikePortableExecutable(executablePath);
    const canOpenWindowsApps = platform === "win32";
    const base = {
        ok: true,
        platform,
        packaged,
        productName,
        executablePath,
        installDirectory,
        userDataPath,
        userDataPolicy: "preserve",
        canOpenWindowsApps,
        canShowInstallFolder: Boolean(installDirectory),
        canRunUninstaller: false,
        uninstallerPath: "",
        uninstallerCandidates,
        warnings: [],
    };

    if (!packaged) {
        return {
            ...base,
            mode: "source",
            label: "Source/dev Companion",
            summary: "Source and development runs do not have an app uninstaller.",
        };
    }

    if (portable) {
        return {
            ...base,
            mode: "portable",
            label: "Portable Companion",
            summary: "Portable runs can be removed by deleting the portable executable after closing the app.",
        };
    }

    if (platform !== "win32") {
        return {
            ...base,
            mode: "packaged_unsupported",
            label: "Packaged Companion",
            summary: "Companion app uninstall handoff is currently implemented for Windows builds only.",
            warnings: ["Non-Windows app uninstall handoff is not implemented yet."],
        };
    }

    if (uninstallerPath) {
        return {
            ...base,
            mode: "installed",
            label: "Installed Companion",
            summary: "Windows installer state detected. The Companion can hand off to its uninstaller.",
            canRunUninstaller: true,
            uninstallerPath,
        };
    }

    return {
        ...base,
        mode: "packaged_unknown",
        label: "Packaged Companion",
        summary: "Packaged app is running, but no installer uninstaller was found beside the app executable.",
        warnings: ["Use Windows Apps & Features if this copy was installed."],
    };
}

export function companionUninstallerCandidates(options = {}) {
    const installDirectory = stringOrEmpty(options.installDirectory);
    const productName = stringOrEmpty(options.productName) || "STFC Community Mod Companion";
    if (!installDirectory) {
        return [];
    }

    return dedupe([
        path.join(installDirectory, `Uninstall ${productName}.exe`),
        path.join(installDirectory, `${productName} Uninstaller.exe`),
        path.join(installDirectory, "Uninstall.exe"),
        path.join(installDirectory, "uninstall.exe"),
    ]);
}

export function isPortableLaunch(env = {}) {
    return PORTABLE_ENV_KEYS.some((key) => Boolean(stringOrEmpty(env[key])));
}

export function isDirectChildPath(parent, child) {
    return Boolean(parent && child) && path.dirname(path.resolve(child)) === path.resolve(parent);
}

function looksLikePortableExecutable(executablePath) {
    const basename = path.basename(stringOrEmpty(executablePath)).toLowerCase();
    return basename.includes("portable");
}

function pathExists(filePath, exists) {
    return typeof exists === "function" ? exists(filePath) === true : false;
}

function dedupe(values) {
    return [...new Set(values.filter(Boolean))];
}

function stringOrEmpty(value) {
    return typeof value === "string" ? value.trim() : "";
}