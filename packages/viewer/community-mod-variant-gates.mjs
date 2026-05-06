import {
    buildCommunityModProfileCapabilities,
    isKnownCommunityModProfile,
    normalizeCommunityModProfile,
} from "./community-mod-profiles.mjs";

const CAPABILITY_NAMES = Object.freeze(["settings", "installStatus", "battleLog", "eventStore"]);
const RUNTIME_CAPABILITY_NAMES = Object.freeze(["battleLog", "eventStore"]);

export function buildCommunityModVariantGateContext(options = {}) {
    const selectedProfile = normalizeCommunityModProfile(options.selectedProfile);
    const installed = normalizeInstalledProfile(options.install);
    const selectedCapabilities = buildCommunityModProfileCapabilities(selectedProfile);
    const installedCapabilities = buildInstalledCapabilities(installed);
    const mismatchKind = mismatchKindFor(installed, selectedProfile);
    const capabilityReasons = Object.fromEntries(CAPABILITY_NAMES.map((capability) => [capability, []]));
    const capabilityBits = {};

    for (const capability of CAPABILITY_NAMES) {
        const enabled = capabilityEnabled(capability, selectedCapabilities, installedCapabilities);
        capabilityBits[capability] = enabled ? 1 : 0;
        if (!enabled) {
            capabilityReasons[capability] = disabledCapabilityReasons({
                capability,
                installed,
                installedCapabilities,
                selectedProfile,
                selectedCapabilities,
            });
        }
    }

    return {
        ok: true,
        selectedProfile,
        installedProfile: installed.profile,
        installedState: installed.state,
        installedConfidence: installed.confidence,
        mismatchKind,
        mismatchAction: mismatchActionFor(mismatchKind),
        capabilities: Object.fromEntries(
            CAPABILITY_NAMES.map((capability) => [capability, capabilityBits[capability] === 1]),
        ),
        capabilityBits,
        capabilityReasons,
    };
}

function normalizeInstalledProfile(install) {
    if (!install || install.ok === false) {
        return { state: "unavailable", profile: "unknown", confidence: "low" };
    }

    if (["unselected", "none", "unsupported_platform"].includes(install.state)) {
        return { state: install.state, profile: "none", confidence: "high" };
    }

    if (install.state !== "installed") {
        return { state: String(install.state ?? "unavailable"), profile: "unknown", confidence: "low" };
    }

    const profile = isKnownCommunityModProfile(install.classification) ? install.classification : "unknown";
    if (profile === "unknown") {
        return { state: "installed", profile, confidence: "low" };
    }

    return {
        state: "installed",
        profile,
        confidence: install.manifest?.profile === profile || install.matchedRelease ? "high" : "medium",
    };
}

function buildInstalledCapabilities(installed) {
    if (!isKnownCommunityModProfile(installed.profile)) {
        return {
            settings: true,
            installStatus: true,
            battleLog: false,
            eventStore: false,
        };
    }

    return buildCommunityModProfileCapabilities(installed.profile);
}

function capabilityEnabled(capability, selectedCapabilities, installedCapabilities) {
    if (!RUNTIME_CAPABILITY_NAMES.includes(capability)) {
        return Boolean(selectedCapabilities[capability]);
    }

    return Boolean(selectedCapabilities[capability] && installedCapabilities[capability]);
}

function disabledCapabilityReasons(options) {
    const reasons = [];
    if (!options.selectedCapabilities[options.capability]) {
        reasons.push(`selected_profile_${options.selectedProfile}_does_not_support_${options.capability}`);
    }

    if (RUNTIME_CAPABILITY_NAMES.includes(options.capability)) {
        if (options.installed.profile === "none") {
            reasons.push("installed_dll_missing");
        } else if (options.installed.profile === "unknown") {
            reasons.push("installed_dll_unknown");
        } else if (!options.installedCapabilities[options.capability]) {
            reasons.push(`installed_profile_${options.installed.profile}_does_not_support_${options.capability}`);
        }
    }

    return reasons;
}

function mismatchKindFor(installed, selectedProfile) {
    if (installed.profile === "none") {
        return "no_install";
    }

    if (installed.profile === "unknown") {
        return "unknown_installed";
    }

    if (installed.profile !== selectedProfile) {
        return "selected_differs_from_installed";
    }

    return "none";
}

function mismatchActionFor(mismatchKind) {
    switch (mismatchKind) {
        case "no_install":
            return "install_selected_profile";
        case "unknown_installed":
            return "replace_unknown_or_inspect";
        case "selected_differs_from_installed":
            return "replace_profile_or_switch_selection";
        default:
            return "none";
    }
}