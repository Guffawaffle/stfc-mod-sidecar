import {
    isKnownCommunityModProfile,
    normalizeCommunityModProfile,
} from "./community-mod-profiles.mjs";

export function classifyInstalledCommunityModDll(options = {}) {
    const state = normalizeInstallState(options.installState, options.dllExists);
    if (state !== "installed") {
        return buildDllStatus({
            state,
            status: "missing",
            profile: "none",
            confidence: state === "none" ? "high" : "low",
            matchSource: "missing",
            dllSha256: "",
        });
    }

    const dllSha256 = normalizeSha256(options.dllSha256);
    if (!dllSha256) {
        return buildDllStatus({
            state,
            status: "hash_unavailable",
            profile: "unknown",
            confidence: "low",
            matchSource: "hash_unavailable",
            dllSha256: "",
        });
    }

    const manifestMatch = matchManifestProfile(options.manifest, dllSha256);
    if (manifestMatch) {
        return buildDllStatus({
            state,
            status: "known_match",
            profile: manifestMatch.profile,
            confidence: "high",
            matchSource: "manifest",
            dllSha256,
        });
    }

    const matchedRelease = normalizeMatchedRelease(options.matchedRelease, dllSha256);
    if (matchedRelease) {
        return buildDllStatus({
            state,
            status: "known_match",
            profile: matchedRelease.profile,
            confidence: "high",
            matchSource: "release_fingerprint",
            dllSha256,
        });
    }

    const configuredOverride = findConfiguredInstalledDllOverride(
        dllSha256,
        options.localConfig?.recognizedInstalledDlls ?? options.recognizedInstalledDlls,
        options.localConfig?.path ?? options.configPath ?? "",
    );
    if (configuredOverride) {
        return buildDllStatus({
            state,
            status: "config_override_match",
            profile: configuredOverride.profile,
            confidence: "medium",
            matchSource: "config_override",
            dllSha256,
            configOverrideLabel: configuredOverride.label,
            configOverrideConfigPath: configuredOverride.configPath,
        });
    }

    return buildDllStatus({
        state,
        status: "unknown_hash",
        profile: "unknown",
        confidence: "low",
        matchSource: "unknown_hash",
        dllSha256,
    });
}

export function resolveInstalledCommunityModDllStatus(options = {}) {
    const selectedProfile = normalizeCommunityModProfile(options.selectedProfile);
    const base = normalizeStoredDllStatus(options.install?.dllMatch, options.install);
    const unsafeOverrideActive = Boolean(options.unsafeAllowUnrecognizedInstalledDll)
        && base.state === "installed"
        && base.status === "unknown_hash"
        && isKnownCommunityModProfile(selectedProfile);

    if (!unsafeOverrideActive) {
        return {
            ...base,
            configOverrideConfigPath: base.configOverrideConfigPath || options.unsafeOverrideConfigPath || "",
            unsafeOverrideActive: false,
        };
    }

    return buildDllStatus({
        ...base,
        status: "unsafe_override_allowed",
        effectiveProfile: selectedProfile,
        confidence: "low",
        matchSource: "unsafe_override",
        configOverrideConfigPath: options.unsafeOverrideConfigPath ?? base.configOverrideConfigPath ?? "",
        unsafeOverrideActive: true,
    });
}

function matchManifestProfile(manifest, dllSha256) {
    if (!isRecord(manifest) || manifest.exists !== true || manifest.parseError) {
        return null;
    }

    const profile = normalizeKnownProfile(manifest.profile);
    const manifestSha256 = normalizeSha256(manifest.dllSha256);
    if (!profile || !manifestSha256 || manifestSha256 !== dllSha256) {
        return null;
    }

    return { profile };
}

function normalizeMatchedRelease(matchedRelease, dllSha256) {
    if (!isRecord(matchedRelease)) {
        return null;
    }

    const profile = normalizeKnownProfile(matchedRelease.profile);
    const matchedSha256 = normalizeSha256(matchedRelease.dllSha256 ?? dllSha256);
    if (!profile || !matchedSha256 || matchedSha256 !== dllSha256) {
        return null;
    }

    return { profile };
}

function findConfiguredInstalledDllOverride(dllSha256, overrides, configPath) {
    return normalizeConfiguredInstalledDllOverrides(overrides, configPath)
        .find((entry) => entry.dllSha256 === dllSha256) ?? null;
}

function normalizeConfiguredInstalledDllOverrides(overrides, configPath) {
    if (!Array.isArray(overrides)) {
        return [];
    }

    return overrides
        .map((value) => normalizeConfiguredInstalledDllOverride(value, configPath))
        .filter(isDefined);
}

function normalizeConfiguredInstalledDllOverride(value, configPath) {
    if (!isRecord(value)) {
        return null;
    }

    const profile = normalizeKnownProfile(value.profile);
    const dllSha256 = normalizeSha256(value.dllSha256 ?? value.sha256);
    if (!profile || !dllSha256) {
        return null;
    }

    return {
        profile,
        dllSha256,
        label: normalizeOptionalText(value.label),
        configPath: typeof configPath === "string" ? configPath : "",
    };
}

function normalizeStoredDllStatus(value, install) {
    if (isRecord(value)) {
        return buildDllStatus({
            state: normalizeInstallState(value.state, install?.dll?.exists),
            status: normalizeStatus(value.status),
            profile: normalizeStoredProfile(value.profile),
            effectiveProfile: normalizeStoredProfile(value.effectiveProfile ?? value.profile),
            confidence: normalizeConfidence(value.confidence),
            matchSource: normalizeOptionalText(value.matchSource),
            dllSha256: normalizeSha256(value.dllSha256),
            configOverrideLabel: normalizeOptionalText(value.configOverrideLabel),
            configOverrideConfigPath: normalizeOptionalText(value.configOverrideConfigPath),
            unsafeOverrideActive: value.unsafeOverrideActive === true,
        });
    }

    const state = normalizeInstallState(install?.state, install?.dll?.exists);
    if (state !== "installed") {
        return buildDllStatus({
            state,
            status: "missing",
            profile: "none",
            confidence: state === "none" ? "high" : "low",
            matchSource: "legacy_missing",
            dllSha256: "",
        });
    }

    const profile = normalizeStoredProfile(install?.classification ?? install?.profile);
    if (profile === "unknown") {
        return buildDllStatus({
            state,
            status: "unknown_hash",
            profile,
            confidence: "low",
            matchSource: "legacy_unknown",
            dllSha256: normalizeSha256(install?.dll?.sha256),
        });
    }

    return buildDllStatus({
        state,
        status: "known_match",
        profile,
        confidence: install?.matchedRelease || install?.manifest?.profile === profile ? "high" : "medium",
        matchSource: "legacy_profile",
        dllSha256: normalizeSha256(install?.dll?.sha256),
    });
}

function buildDllStatus(value) {
    const profile = normalizeStoredProfile(value.profile);
    const effectiveProfile = normalizeStoredProfile(value.effectiveProfile ?? profile);

    return {
        state: normalizeInstallState(value.state, true),
        status: normalizeStatus(value.status),
        profile,
        effectiveProfile,
        confidence: normalizeConfidence(value.confidence),
        matchSource: normalizeOptionalText(value.matchSource),
        dllSha256: normalizeSha256(value.dllSha256),
        configOverrideLabel: normalizeOptionalText(value.configOverrideLabel),
        configOverrideConfigPath: normalizeOptionalText(value.configOverrideConfigPath),
        unsafeOverrideActive: value.unsafeOverrideActive === true,
    };
}

function normalizeInstallState(value, dllExists) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "installed") {
        return "installed";
    }

    if (["unselected", "unsupported_platform", "error", "unavailable"].includes(normalized)) {
        return normalized;
    }

    if (normalized === "none" || dllExists === false) {
        return "none";
    }

    return normalized || "none";
}

function normalizeStoredProfile(value) {
    const literal = String(value ?? "").trim().toLowerCase();
    if (literal === "none" || literal === "unknown") {
        return literal;
    }

    const normalized = normalizeKnownProfile(value);
    if (normalized) {
        return normalized;
    }

    return "unknown";
}

function normalizeKnownProfile(value) {
    const literal = String(value ?? "").trim().toLowerCase();
    if (!literal || literal === "none" || literal === "unknown") {
        return null;
    }

    return normalizeCommunityModProfile(value, { fallback: null });
}

function normalizeStatus(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return [
        "missing",
        "known_match",
        "config_override_match",
        "unsafe_override_allowed",
        "unknown_hash",
        "hash_unavailable",
    ].includes(normalized)
        ? normalized
        : "unknown_hash";
}

function normalizeConfidence(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return ["high", "medium", "low"].includes(normalized) ? normalized : "low";
}

function normalizeSha256(value) {
    const normalized = String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
    return /^[0-9A-F]{64}$/u.test(normalized) ? normalized : "";
}

function normalizeOptionalText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined(value) {
    return value !== null && value !== undefined;
}