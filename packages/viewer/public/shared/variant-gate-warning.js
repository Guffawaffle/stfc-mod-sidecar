const WARNING_MISMATCH_KINDS = new Set(["selected_differs_from_installed", "unknown_installed"]);

export function hasVariantGateReviewState(variantGate) {
    return Boolean(variantGateWarningKey(variantGate));
}

export function shouldShowVariantGateWarning(variantGate, ignoredKey = "") {
    const key = variantGateWarningKey(variantGate);
    if (!key) {
        return false;
    }

    if (variantGate?.unsafeOverrides?.active) {
        return true;
    }

    return Boolean(key !== ignoredKey && WARNING_MISMATCH_KINDS.has(variantGate?.mismatchKind));
}

export function variantGateWarningKey(variantGate) {
    const warnableMismatch = WARNING_MISMATCH_KINDS.has(variantGate?.mismatchKind);
    if (!variantGate?.mismatchKind || (!warnableMismatch && !variantGate?.unsafeOverrides?.active)) {
        return "";
    }

    return [
        variantGate?.unsafeOverrides?.active ? "unsafe_override_active" : "standard",
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

    if (variantGate?.unsafeOverrides?.active) {
        return {
            title: "Unsafe DLL override is active",
            compactSummary: `Unrecognized version.dll allowed by local override for ${selectedProfile}. Review setup.`,
            summary: `The Companion still cannot identify the installed version.dll, but the local sidecar override is allowing ${selectedProfile} runtime surfaces to stay visible. Treat the current DLL as unsafe until it is replaced or recognized.`,
            details: [
                `Selected profile: ${selectedProfile}`,
                `Installed DLL: ${installedProfile} (${installedState})`,
                "Unsafe override: unsafeAllowUnrecognizedInstalledDll = true",
            ],
            fixLabel: "Open STFC Mod Setup",
            fixHref: "/about/?surface=setup",
            persistent: true,
        };
    }

    if (variantGate?.mismatchKind === "unknown_installed") {
        return {
            title: "Installed DLL needs review",
            compactSummary: "Installed version.dll is unrecognized. Review setup before using runtime surfaces.",
            summary: `The Companion cannot identify the installed version.dll. Runtime features stay blocked until it is replaced or recognized.`,
            details: [
                `Installed DLL: ${installedProfile} (${installedState})`,
                ...reasons,
            ],
            fixLabel: "Open STFC Mod Setup",
            fixHref: "/about/?surface=setup",
            persistent: false,
        };
    }

    return {
        title: "Selected profile and installed DLL differ",
        compactSummary: `${selectedProfile} selected; installed DLL is ${installedProfile}. Review setup.`,
        summary: `The Companion is using ${selectedProfile} intent, but the installed DLL is ${installedProfile}. Runtime features stay blocked when either side does not support them.`,
        details: [
            `Selected profile: ${selectedProfile}`,
            `Installed DLL: ${installedProfile} (${installedState})`,
            ...reasons,
        ],
        fixLabel: "Open STFC Mod Setup",
        fixHref: "/about/?surface=setup",
        persistent: false,
    };
}

export function variantGateCapabilityUnavailableSummary(variantGate, capability) {
    const reasons = Array.isArray(variantGate?.capabilityReasons?.[capability])
        ? variantGate.capabilityReasons[capability]
        : [];

    if (reasons.includes("installed_dll_unknown")) {
        return "Installed version.dll unrecognized. Review STFC Mod Setup.";
    }

    if (reasons.includes("installed_dll_missing")) {
        return "No Community Mod DLL installed. Finish STFC Mod Setup.";
    }

    if (reasons.some((reason) => reason.startsWith("selected_profile_"))) {
        return `Selected profile lacks ${capabilityLabel(capability)}. Review STFC Mod Setup.`;
    }

    if (reasons.some((reason) => reason.startsWith("installed_profile_"))) {
        return `Installed DLL lacks ${capabilityLabel(capability)}. Review STFC Mod Setup.`;
    }

    return `${capabilityLabel(capability)} is unavailable for the active Community Mod variant gate.`;
}

export function isVariantGateCapabilityReviewOnly(variantGate, capability, options = {}) {
    const reasons = Array.isArray(variantGate?.capabilityReasons?.[capability])
        ? variantGate.capabilityReasons[capability]
        : [];
    if (!reasons.includes("installed_dll_unknown")) {
        return false;
    }

    return Boolean(options.developerMode) || profileSupportsCapability(variantGate?.selectedProfile, capability);
}

export function variantGateCapabilityReviewSummary(variantGate, capability, options = {}) {
    if (isVariantGateCapabilityReviewOnly(variantGate, capability, options)) {
        return `${capabilityLabel(capability)} is available for read-only review, but the installed DLL is unrecognized. Confirm setup before trusting runtime output.`;
    }

    return variantGateCapabilityUnavailableSummary(variantGate, capability);
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

function capabilityLabel(capability) {
    if (capability === "battleLog") {
        return "Battle Log";
    }

    if (capability === "eventStore") {
        return "the event store";
    }

    return labelFromToken(capability ?? "capability");
}

function profileSupportsCapability(profile, capability) {
    if (capability === "battleLog") {
        return profile === "waffle-advanced" || profile === "guff-advanced";
    }

    return false;
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
