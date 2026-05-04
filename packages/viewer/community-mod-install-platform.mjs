export function buildCommunityModInstallPlatformCapability(options = {}) {
    const platform = normalizePlatform(options.platform ?? process.platform);
    const displayName = platformDisplayName(platform);
    const supported = platform === "win32";
    const unsupportedReason = supported
        ? ""
        : platform === "darwin"
            ? "macOS Community Mod install/update is not implemented yet."
            : `${displayName} Community Mod install/update is not supported.`;

    return {
        ok: true,
        platform,
        displayName,
        status: supported ? "supported" : "unsupported_platform",
        supported,
        installPlanningSupported: supported,
        installExecutionSupported: supported,
        gameProcessDetectionSupported: supported,
        gameProcessName: "prime.exe",
        targetFileName: "version.dll",
        summary: supported
            ? "Windows Community Mod version.dll install/update planning is supported."
            : unsupportedReason,
        unsupportedReason,
    };
}

export function platformUnsupportedInstallSummary(platformCapability) {
    const capability = platformCapability ?? buildCommunityModInstallPlatformCapability();
    return capability.unsupportedReason || `${capability.displayName} Community Mod install/update is not supported.`;
}

function normalizePlatform(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized || "unknown";
}

function platformDisplayName(platform) {
    switch (platform) {
        case "win32":
            return "Windows";
        case "darwin":
            return "macOS";
        case "linux":
            return "Linux";
        default:
            return platform || "Unknown platform";
    }
}