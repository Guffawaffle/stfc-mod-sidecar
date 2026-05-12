const WARNING_MISMATCH_KINDS = new Set(["selected_differs_from_installed", "unknown_installed"]);

export function shouldShowVariantGateWarning(variantGate, ignoredKey = "") {
    const key = variantGateWarningKey(variantGate);
    return Boolean(key && key !== ignoredKey && WARNING_MISMATCH_KINDS.has(variantGate?.mismatchKind));
}

export function variantGateWarningKey(variantGate) {
    if (!variantGate?.mismatchKind || !WARNING_MISMATCH_KINDS.has(variantGate.mismatchKind)) {
        return "";
    }

    return [
        variantGate.mismatchKind,
        variantGate.selectedProfile ?? "unknown",
        variantGate.installedProfile ?? "unknown",
        variantGate.installedState ?? "unknown",
    ].join("|");
}

export function variantGateWarningViewModel(variantGate) {
    const selectedProfile = profileLabel(variantGate?.selectedProfile);
    const installedProfile = profileLabel(variantGate?.installedProfile);
    const installedState = labelFromToken(variantGate?.installedState ?? "unknown");
    const reasons = battleLogReasons(variantGate);

    if (variantGate?.mismatchKind === "unknown_installed") {
        return {
            title: "Installed DLL needs review",
            summary: `The Companion cannot identify the installed version.dll. Runtime features stay blocked until it is replaced or recognized.`,
            details: [
                `Installed DLL: ${installedProfile} (${installedState})`,
                ...reasons,
            ],
            fixLabel: "Open General",
            fixHref: "/settings/#general",
        };
    }

    return {
        title: "Selected profile and installed DLL differ",
        summary: `The Companion is using ${selectedProfile} intent, but the installed DLL is ${installedProfile}. Runtime features stay blocked when either side does not support them.`,
        details: [
            `Selected profile: ${selectedProfile}`,
            `Installed DLL: ${installedProfile} (${installedState})`,
            ...reasons,
        ],
        fixLabel: "Open General",
        fixHref: "/settings/#general",
    };
}

function battleLogReasons(variantGate) {
    const reasons = Array.isArray(variantGate?.capabilityReasons?.battleLog)
        ? variantGate.capabilityReasons.battleLog
        : [];
    return reasons.map(friendlyGateReason);
}

function friendlyGateReason(reason) {
    switch (reason) {
        case "selected_profile_netniv-basic_does_not_support_battleLog":
            return "Basic selection does not include Battle Log.";
        case "selected_profile_waffle-basic_does_not_support_battleLog":
            return "Waffle Basic selection does not include Battle Log.";
        case "selected_profile_waffle-advanced_does_not_support_battleLog":
            return "Selected profile does not include Battle Log.";
        case "installed_profile_netniv-basic_does_not_support_battleLog":
            return "Installed Basic DLL does not include Battle Log.";
        case "installed_dll_unknown":
            return "Installed DLL is unknown.";
        case "installed_dll_missing":
            return "No Community Mod DLL is installed.";
        default:
            return `Gate reason: ${labelFromToken(reason)}`;
    }
}

function profileLabel(profile) {
    if (profile === "netniv-basic") {
        return "Basic";
    }

    if (profile === "waffle-basic") {
        return "Waffle Basic";
    }

    if (profile === "waffle-advanced" || profile === "guff-advanced") {
        return "Waffle Advanced";
    }

    if (profile === "none") {
        return "No DLL";
    }

    return "Unknown";
}

function labelFromToken(value) {
    return String(value ?? "unknown")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .replaceAll("Dll", "DLL")
        .replaceAll("Netniv", "netniV");
}