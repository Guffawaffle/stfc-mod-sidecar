export function communityModInstallLabel(install) {
    if (!install) {
        return "Status unavailable";
    }

    if (install.ok === false) {
        return "Status error";
    }

    if (install.state === "unselected") {
        return "Directory not selected";
    }

    if (install.state === "none" || install.classification === "none") {
        return "Not installed";
    }

    if (install.state === "installed") {
        if (install.classification === "netniv-basic") {
            return "Official Basic installed";
        }

        if (install.classification === "guff-advanced") {
            return "Advanced Alpha installed";
        }

        return "Unknown version.dll installed";
    }

    return "Status unavailable";
}

export function communityModInstallSummary(install) {
    if (!install) {
        return "Community Mod install status has not loaded yet.";
    }

    if (install.ok === false) {
        return String(install.error ?? "Unable to read Community Mod install status.");
    }

    if (install.state === "unselected") {
        return "Select the STFC game directory to inspect version.dll.";
    }

    if (install.state === "none" || install.classification === "none") {
        return "No version.dll was found in the selected game directory.";
    }

    if (install.state !== "installed") {
        return "Community Mod install status is unavailable.";
    }

    const parts = [];
    if (install.matchedRelease?.tag) {
        parts.push(`${install.matchedRelease.owner}/${install.matchedRelease.repo} ${install.matchedRelease.tag}`);
    } else if (install.manifest?.repo && install.manifest?.tag) {
        parts.push(`${install.manifest.repo} ${install.manifest.tag}`);
    }

    if (install.dll?.versionInfo?.fileVersion) {
        parts.push(`File ${install.dll.versionInfo.fileVersion}`);
    }

    if (install.dll?.sha256) {
        parts.push(`SHA-256 ${shortSha256(install.dll.sha256)}`);
    }

    if (install.manifest?.parseError) {
        parts.push("manifest unreadable");
    }

    return parts.length > 0 ? parts.join(" | ") : communityModInstallLabel(install);
}

export function communityModInstallTone(install) {
    if (!install || install.ok === false || install.manifest?.parseError) {
        return "warning";
    }

    if (install.classification === "unknown") {
        return "warning";
    }

    if (install.state === "installed") {
        return "info";
    }

    return "off";
}

export function communityModReleaseLabel(catalog) {
    if (!catalog) {
        return "Release check not run";
    }

    if (catalog.ok === false || catalog.status === "error") {
        return "Release check failed";
    }

    if (catalog.status === "ready") {
        return catalog.installSupported
            ? `${catalog.release?.version ?? catalog.release?.tagName ?? "Release"} ready`
            : `${modProfileLabel(catalog.profile)} metadata ready`;
    }

    if (catalog.status === "missing_windows_asset") {
        return "No Windows mod asset found";
    }

    if (catalog.status === "no_release") {
        return "No release found";
    }

    if (catalog.status === "unavailable") {
        return "Release metadata unavailable";
    }

    return "Release status unavailable";
}

export function communityModReleaseSummary(catalog) {
    if (!catalog) {
        return "Use Check Mod Release to read GitHub release metadata.";
    }

    if (catalog.ok === false) {
        return String(catalog.error ?? "Community Mod release check failed.");
    }

    if (catalog.status === "ready") {
        const asset = catalog.windowsAsset?.name ? ` | ${catalog.windowsAsset.name}` : "";
        const digest = catalog.windowsAsset?.digest ? ` | ${catalog.windowsAsset.digest}` : "";
        const suffix = catalog.installSupported ? "" : ` | ${catalog.unsupportedReason ?? "Install disabled"}`;
        return `${catalog.repository} ${catalog.release?.tagName ?? "release"}${asset}${digest}${suffix}`;
    }

    if (catalog.status === "missing_windows_asset") {
        return catalog.repository
            ? `${catalog.repository} did not publish a supported Windows mod asset.`
            : "No supported Windows mod asset was found.";
    }

    if (catalog.status === "no_release") {
        return catalog.repository
            ? `${catalog.repository} has no eligible release for this profile.`
            : "No eligible release was found.";
    }

    if (catalog.status === "unavailable") {
        return String(catalog.error ?? "Release metadata unavailable.");
    }

    return "Community Mod release status is unavailable.";
}

export function communityModInstallPlanLabel(plan) {
    if (!plan) {
        return "Install plan not checked";
    }

    if (plan.ok === false || plan.status === "error") {
        return "Install plan unavailable";
    }

    if (plan.status === "current") {
        return "Installed release is current";
    }

    return plan.actionLabel ?? "Install plan unavailable";
}

export function communityModInstallPlanSummary(plan) {
    if (!plan) {
        return "Check Mod Release to prepare a safe install/update plan.";
    }

    if (plan.ok === false) {
        return String(plan.error ?? "Community Mod install plan is unavailable.");
    }

    const target = plan.target?.tag && plan.target?.assetName
        ? ` | Target ${plan.target.tag} ${plan.target.assetName}`
        : "";
    const warnings = Array.isArray(plan.warnings) && plan.warnings.length > 0
        ? ` | ${plan.warnings.join(" | ")}`
        : "";
    const execution = plan.execution?.enabled === false && plan.action !== "none"
        ? " | Manual confirmation path not enabled yet"
        : "";
    return `${plan.summary ?? "Install plan unavailable."}${target}${warnings}${execution}`;
}

export function communityModArtifactVerificationLabel(verification) {
    if (!verification) {
        return "Artifact not verified";
    }

    if (verification.ok === false || verification.status === "error") {
        return "Artifact verification failed";
    }

    switch (verification.status) {
        case "verified":
            return "Artifact verified";
        case "hash_mismatch":
            return "Artifact hash mismatch";
        case "missing_expected_dll":
            return "version.dll missing from artifact";
        case "unsafe_zip_entries":
            return "Unsafe zip entries detected";
        case "profile_unsupported":
            return "Artifact verification unsupported";
        case "release_not_ready":
            return "Release not ready";
        default:
            return "Artifact verification unavailable";
    }
}

export function communityModArtifactVerificationSummary(verification) {
    if (!verification) {
        return "Verify Artifact downloads to the sidecar cache and checks SHA-256 before any install path exists.";
    }

    if (verification.ok === false) {
        return String(verification.error ?? "Community Mod artifact verification failed.");
    }

    const sha = verification.artifact?.actualSha256
        ? ` | SHA-256 ${shortSha256(verification.artifact.actualSha256)}`
        : "";
    const dll = verification.artifact?.inspection?.dllEntry ? ` | ${verification.artifact.inspection.dllEntry}` : "";
    const cache = verification.cache?.reused ? " | cache reused" : verification.cache ? " | cached" : "";
    return `${verification.summary ?? "Artifact verification unavailable."}${sha}${dll}${cache}`;
}

export function modProfileLabel(profile) {
    return normalizeModProfile(profile) === "netniv-basic" ? "Official Basic" : "Advanced Alpha";
}

export function normalizeModProfile(profile) {
    return String(profile ?? "").toLowerCase() === "netniv-basic" ? "netniv-basic" : "guff-advanced";
}

function shortSha256(value) {
    const normalized = String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
    return normalized.length > 12 ? `${normalized.slice(0, 12)}...` : normalized;
}