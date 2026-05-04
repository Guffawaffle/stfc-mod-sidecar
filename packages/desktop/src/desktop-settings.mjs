export const DEFAULT_MOD_PROFILE = "guff-advanced";

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
    gameDirectory: "",
    developerMode: false,
    modProfile: DEFAULT_MOD_PROFILE,
});

export function normalizeDesktopSettings(input = {}, options = {}) {
    const parsed = isRecord(input) ? input : {};
    return {
        gameDirectory: typeof parsed.gameDirectory === "string" ? parsed.gameDirectory : "",
        developerMode: typeof parsed.developerMode === "boolean"
            ? parsed.developerMode
            : parseDeveloperModeValue(options.initialDeveloperMode),
        modProfile: normalizeModProfile(parsed.modProfile),
    };
}

export function normalizeModProfile(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["netniv-basic", "netniv", "official", "official-basic", "basic"].includes(normalized)) {
        return "netniv-basic";
    }

    if (["guff-advanced", "guff", "advanced", "alpha", "advanced-alpha"].includes(normalized)) {
        return "guff-advanced";
    }

    return DEFAULT_MOD_PROFILE;
}

export function initialDeveloperModeFromSources(options = {}) {
    if (options.environmentValue !== undefined) {
        return options.environmentValue;
    }

    const seedSettings = isRecord(options.seedSettings) ? options.seedSettings : {};
    return seedSettings.developerMode;
}

export function parseDeveloperModeValue(value) {
    if (typeof value === "boolean") {
        return value;
    }

    const normalized = String(value ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "on", "developer", "dev", "enabled"].includes(normalized);
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}