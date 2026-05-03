export const COMPANION_MODE_STANDARD = "standard";
export const COMPANION_MODE_DEVELOPER = "developer";

const DEVELOPER_ONLY_PUBLIC_PREFIXES = ["/battle-log/workbench"];
const DEVELOPER_ONLY_API_PREFIXES = ["/api/dev"];

export function parseDeveloperModeFlag(value) {
    if (typeof value === "boolean") {
        return value;
    }

    const normalized = String(value ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "on", "developer", "dev", "enabled"].includes(normalized);
}

export function companionModeFromDeveloperMode(developerMode) {
    return developerMode ? COMPANION_MODE_DEVELOPER : COMPANION_MODE_STANDARD;
}

export function isDeveloperOnlyPublicPath(pathname) {
    return matchesAnyPrefix(pathname, DEVELOPER_ONLY_PUBLIC_PREFIXES);
}

export function isDeveloperOnlyApiPath(pathname) {
    return matchesAnyPrefix(pathname, DEVELOPER_ONLY_API_PREFIXES);
}

export function developerModeRequiredPayload() {
    return {
        ok: false,
        code: "developer_mode_required",
        error: "Developer Tools are disabled.",
        developerMode: false,
        companionMode: COMPANION_MODE_STANDARD,
    };
}

function matchesAnyPrefix(pathname, prefixes) {
    const normalized = normalizePathname(pathname);
    return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function normalizePathname(pathname) {
    let decoded = String(pathname ?? "");
    try {
        decoded = decodeURIComponent(decoded);
    } catch {
        decoded = String(pathname ?? "");
    }

    const collapsed = decoded.replace(/\/{2,}/g, "/");
    return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}