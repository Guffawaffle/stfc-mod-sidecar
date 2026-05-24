import {
    buildCommunityModProfileCapabilities,
    isKnownCommunityModProfile,
    normalizeCommunityModProfile,
    profileFamiliesMatch,
} from "./community-mod-profiles.mjs";
import { resolveInstalledCommunityModDllStatus } from "./community-mod-dll-classification.mjs";

const CAPABILITY_NAMES = Object.freeze(["settings", "installStatus", "notifications", "battleLog", "eventStore"]);
const RUNTIME_CAPABILITY_NAMES = Object.freeze(["battleLog", "eventStore"]);

export function buildCommunityModVariantGateContext(options = {}) {
    const selectedProfile = normalizeCommunityModProfile(options.selectedProfile);
    const installed = resolveInstalledCommunityModDllStatus({
        install: options.install,
        selectedProfile,
        unsafeAllowUnrecognizedInstalledDll: options.unsafeAllowUnrecognizedInstalledDll,
        unsafeOverrideConfigPath: options.unsafeOverrideConfigPath,
    });
    const selectedCapabilities = buildCommunityModProfileCapabilities(selectedProfile);
    const unsafeAllowUnrecognizedInstalledDll = Boolean(options.unsafeAllowUnrecognizedInstalledDll);
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
        installedEffectiveProfile: installed.effectiveProfile,
        installedState: installed.state,
        installedConfidence: installed.confidence,
        installedDllStatus: installed.status,
        installedDllMatchSource: installed.matchSource,
        mismatchKind,
        mismatchAction: mismatchActionFor(mismatchKind),
        unsafeOverrides: {
            allowUnrecognizedInstalledDll: unsafeAllowUnrecognizedInstalledDll,
            active: installed.unsafeOverrideActive,
            configPath: options.unsafeOverrideConfigPath ?? "",
        },
        capabilities: Object.fromEntries(
            CAPABILITY_NAMES.map((capability) => [capability, capabilityBits[capability] === 1]),
        ),
        capabilityBits,
        capabilityReasons,
    };
}

function buildInstalledCapabilities(installed) {
    if (!isKnownCommunityModProfile(installed.effectiveProfile)) {
        return {
            settings: true,
            installStatus: true,
            battleLog: false,
            eventStore: false,
        };
    }

    if (profileFamiliesMatch(installed.effectiveProfile, "waffle-advanced")) {
        return buildCommunityModProfileCapabilities("waffle-advanced");
    }

    return buildCommunityModProfileCapabilities(installed.effectiveProfile);
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
        } else if (options.installed.status === "hash_unavailable") {
            reasons.push("installed_dll_hash_unavailable");
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

    if (installed.profile !== selectedProfile && !profileFamiliesMatch(installed.profile, selectedProfile)) {
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