import {
    DEFAULT_COMMUNITY_MOD_PROFILE,
    normalizeCommunityModProfile,
} from "../../viewer/community-mod-profiles.mjs";

export const DEFAULT_MOD_PROFILE = DEFAULT_COMMUNITY_MOD_PROFILE;

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
    gameDirectory: "",
    developerMode: false,
    localSidecarSyncToken: "",
    modProfile: DEFAULT_MOD_PROFILE,
    profileGameDirectories: Object.freeze({}),
});

export function normalizeDesktopSettings(input = {}, options = {}) {
    const parsed = isRecord(input) ? input : {};
    const modProfile = normalizeModProfile(parsed.modProfile);
    const legacyGameDirectory = typeof parsed.gameDirectory === "string" ? parsed.gameDirectory : "";
    const profileGameDirectories = normalizeProfileGameDirectories(parsed.profileGameDirectories);
    if (legacyGameDirectory && Object.keys(profileGameDirectories).length === 0) {
        profileGameDirectories[modProfile] = legacyGameDirectory;
    }

    return {
        gameDirectory: profileGameDirectories[modProfile] ?? "",
        developerMode: typeof parsed.developerMode === "boolean"
            ? parsed.developerMode
            : parseDeveloperModeValue(options.initialDeveloperMode),
        localSidecarSyncToken: typeof parsed.localSidecarSyncToken === "string" ? parsed.localSidecarSyncToken.trim() : "",
        modProfile,
        profileGameDirectories,
    };
}

export function normalizeModProfile(value) {
    return normalizeCommunityModProfile(value, { fallback: DEFAULT_MOD_PROFILE });
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

function normalizeProfileGameDirectories(value) {
    const rawProfiles = isRecord(value) ? value : {};
    const profileGameDirectories = {};
    for (const [rawProfile, rawDirectory] of Object.entries(rawProfiles)) {
        const profile = normalizeModProfile(rawProfile);
        if (typeof rawDirectory === "string" && rawDirectory.trim()) {
            profileGameDirectories[profile] = rawDirectory;
        }
    }

    return profileGameDirectories;
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}