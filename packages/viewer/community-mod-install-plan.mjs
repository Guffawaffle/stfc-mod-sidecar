import { normalizeCommunityModReleaseProfile } from "./community-mod-release-catalog.mjs";
import { compareReleaseVersions } from "./release-update.mjs";

export function buildCommunityModInstallPlan(options = {}) {
    const profile = normalizeCommunityModReleaseProfile(options.profile ?? options.catalog?.profile);
    const install = options.install ?? null;
    const catalog = options.catalog ?? null;
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const base = {
        ok: true,
        checkedAt,
        profile,
        install,
        catalog,
        current: currentInstallSummary(install),
        target: targetReleaseSummary(catalog),
        safety: installPlanSafety(),
        execution: installPlanExecution(),
        warnings: [],
    };

    if (!install || install.ok === false) {
        return installPlanResult(base, {
            status: "install_status_unavailable",
            action: "inspect",
            summary: String(install?.error ?? "Community Mod install status is unavailable."),
        });
    }

    if (install.state === "unselected") {
        return installPlanResult(base, {
            status: "game_directory_required",
            action: "select_directory",
            summary: "Select the STFC game directory before planning an install or update.",
        });
    }

    if (!catalog || catalog.ok === false || catalog.status === "error") {
        return installPlanResult(base, {
            status: "release_status_unavailable",
            action: "check_release",
            summary: String(catalog?.error ?? "Community Mod release status is unavailable."),
        });
    }

    if (catalog.status !== "ready") {
        return installPlanResult(base, {
            status: "release_not_ready",
            action: "none",
            summary: releaseNotReadySummary(catalog),
        });
    }

    if (!catalog.installSupported) {
        return installPlanResult(base, {
            status: "profile_unsupported",
            action: "none",
            summary: catalog.unsupportedReason ?? "Install is not supported for this profile.",
        });
    }

    if (install.state === "none" || install.classification === "none") {
        return installPlanResult(base, {
            status: "install_available",
            action: "install",
            summary: "No version.dll was found; the selected release can be installed after confirmation.",
        });
    }

    if (install.state !== "installed") {
        return installPlanResult(base, {
            status: "install_status_unavailable",
            action: "inspect",
            summary: "Community Mod install status is unavailable.",
        });
    }

    if (install.classification === "unknown") {
        return installPlanResult(base, {
            status: "unknown_install_detected",
            action: "replace_unknown",
            summary: "An unknown version.dll is installed; replacement would require explicit confirmation and backup.",
            warnings: ["Unknown installed DLL provenance."],
        });
    }

    if (install.classification !== profile) {
        return installPlanResult(base, {
            status: "profile_mismatch",
            action: "replace_profile",
            summary: "The installed Community Mod profile differs from the selected profile.",
            warnings: [`Installed profile is ${install.classification}.`],
        });
    }

    const currentTag = currentInstallTag(install);
    const targetVersion = catalog.release?.version ?? catalog.release?.tagName ?? "";
    if (!currentTag) {
        return installPlanResult(base, {
            status: "reinstall_available",
            action: "reinstall",
            summary: "Installed DLL matches the selected profile, but release provenance is incomplete.",
            warnings: ["Current release tag is unknown."],
        });
    }

    const comparison = compareReleaseVersions(targetVersion, currentTag);
    if (comparison > 0) {
        return installPlanResult(base, {
            status: "update_available",
            action: "update",
            summary: `${catalog.release.tagName} is newer than installed ${currentTag}.`,
        });
    }

    if (comparison < 0) {
        return installPlanResult(base, {
            status: "newer_install_detected",
            action: "none",
            summary: `Installed ${currentTag} is newer than selected release ${catalog.release.tagName}.`,
            warnings: ["Installed release appears newer than selected catalog release."],
        });
    }

    return installPlanResult(base, {
        status: "current",
        action: "none",
        summary: `${catalog.release.tagName} is already installed.`,
    });
}

function installPlanResult(base, result) {
    return {
        ...base,
        ...result,
        actionLabel: installPlanActionLabel(result.action),
        warnings: [...base.warnings, ...(result.warnings ?? [])],
    };
}

function installPlanActionLabel(action) {
    switch (action) {
        case "install":
            return "Install available";
        case "update":
            return "Update available";
        case "reinstall":
            return "Reinstall available";
        case "replace_unknown":
            return "Replace unknown DLL";
        case "replace_profile":
            return "Replace installed profile";
        case "select_directory":
            return "Select game directory";
        case "check_release":
            return "Check release metadata";
        case "inspect":
            return "Inspect install status";
        default:
            return "No install action";
    }
}

function currentInstallSummary(install) {
    return {
        state: install?.state ?? "unknown",
        classification: install?.classification ?? "unknown",
        tag: currentInstallTag(install),
        assetName: install?.matchedRelease?.assetName || install?.manifest?.assetName || "",
        dllSha256: install?.dll?.sha256 ?? "",
    };
}

function targetReleaseSummary(catalog) {
    return {
        repository: catalog?.repository ?? "",
        tag: catalog?.release?.tagName ?? "",
        version: catalog?.release?.version ?? "",
        assetName: catalog?.windowsAsset?.name ?? "",
        assetDigest: catalog?.windowsAsset?.digest ?? "",
    };
}

function currentInstallTag(install) {
    return install?.matchedRelease?.tag || install?.manifest?.tag || "";
}

function installPlanSafety() {
    return {
        dryRun: true,
        writesGameDirectory: false,
        userConfirmationRequired: true,
        backupBeforeReplace: true,
        hashVerificationRequired: true,
    };
}

function installPlanExecution() {
    return {
        enabled: false,
        reason: "Install execution is not enabled in this build.",
    };
}

function releaseNotReadySummary(catalog) {
    if (catalog.status === "missing_windows_asset") {
        return "No supported Windows mod asset was found for the selected release.";
    }

    if (catalog.status === "no_release") {
        return "No eligible release was found for the selected profile.";
    }

    if (catalog.status === "unavailable") {
        return catalog.error ?? "Release metadata is unavailable.";
    }

    return "Selected release is not ready for install planning.";
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}