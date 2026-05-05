import path from "node:path";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
} from "./community-mod-install.mjs";
import {
    buildCommunityModInstallPlatformCapability,
    platformUnsupportedInstallSummary,
} from "./community-mod-install-platform.mjs";

const REPLACEMENT_ACTIONS = new Set(["update", "reinstall", "replace_unknown", "replace_profile"]);
const COMMUNITY_MOD_CLEANUP_FILES = [
    "community_patch_settings.toml",
    "community_patch_runtime.vars",
    "community_patch.log",
    "community_patch_battle_feed.jsonl",
    "community_patch_battle_probe.jsonl",
    "community_patch_battle_probe_segments.jsonl",
    "community_patch_battle_probe_summary.jsonl",
];

export function buildCommunityModUninstallPlan(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const install = options.install ?? null;
    const platform = options.platformCapability
        ?? install?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const base = {
        ok: true,
        checkedAt,
        platform,
        install,
        current: currentInstallSummary(install),
        target: uninstallTarget(install),
        settings: uninstallSettingsRetention(install),
        safety: uninstallPlanSafety(),
        execution: uninstallPlanExecution(platform),
        warnings: [],
    };

    if (!install || install.ok === false) {
        return uninstallPlanResult(base, {
            status: "install_status_unavailable",
            action: "inspect",
            summary: String(install?.error ?? "Community Mod install status is unavailable."),
        });
    }

    if (install.state === "unselected") {
        return uninstallPlanResult(base, {
            status: "game_directory_required",
            action: "select_directory",
            summary: "Select the STFC game directory before planning Community Mod uninstall.",
        });
    }

    if (!platform.installPlanningSupported) {
        return uninstallPlanResult(base, {
            status: "platform_unsupported",
            action: "none",
            summary: platformUnsupportedInstallSummary(platform).replace("install/update", "uninstall"),
            warnings: [platform.unsupportedReason],
        });
    }

    if (install.state === "none" || install.classification === "none" || install.dll?.exists === false) {
        return uninstallPlanResult(base, {
            status: "no_install_detected",
            action: "none",
            summary: "No version.dll was found in the selected game directory.",
        });
    }

    if (install.state !== "installed") {
        return uninstallPlanResult(base, {
            status: "install_status_unavailable",
            action: "inspect",
            summary: "Community Mod install status is unavailable.",
        });
    }

    if (install.manifest?.parseError) {
        return uninstallPlanResult(base, {
            status: "manifest_unreadable",
            action: "manual_uninstall",
            summary: "The sidecar install manifest could not be read; uninstall remains manual.",
            warnings: ["Install manifest is unreadable."],
        });
    }

    if (manifestHashMismatch(install)) {
        return uninstallPlanResult(base, {
            status: "stale_manifest",
            action: "none",
            summary: "The installed version.dll hash differs from the sidecar manifest; automated uninstall is blocked.",
            warnings: ["Sidecar manifest does not match the current DLL hash."],
        });
    }

    if (install.classification === "unknown") {
        return uninstallPlanResult(base, {
            status: "unknown_install_removable",
            action: "remove_unknown",
            summary: "Unknown or manually installed version.dll can be removed after explicit confirmation.",
            warnings: ["Unknown DLL provenance."],
        });
    }

    if (!isSidecarOwnedInstall(install)) {
        return uninstallPlanResult(base, {
            status: "manual_install_removable",
            action: "remove_unknown",
            summary: "version.dll was not installed by this companion; it can be removed after explicit confirmation.",
            warnings: ["No trusted sidecar install manifest was found."],
        });
    }

    if (install.manifest.action === "install") {
        return uninstallPlanResult(base, {
            status: "fresh_install_removable",
            action: "remove_fresh_install",
            summary: "Sidecar-owned fresh install can be removed after explicit confirmation.",
        });
    }

    if (REPLACEMENT_ACTIONS.has(install.manifest.action)) {
        if (hasTrustedBackupMetadata(install.manifest)) {
            return uninstallPlanResult(base, {
                status: "replacement_restore_available",
                action: "restore_backup",
                summary: "Sidecar-owned replacement can restore the backed-up previous DLL after explicit confirmation.",
            });
        }

        return uninstallPlanResult(base, {
            status: "backup_metadata_unavailable",
            action: "none",
            summary: "This sidecar-owned replacement does not have enough backup metadata for automated rollback.",
            warnings: ["Backup path and SHA-256 are required before rollback can be planned."],
        });
    }

    return uninstallPlanResult(base, {
        status: "uninstall_metadata_incomplete",
        action: "none",
        summary: "The sidecar manifest is trusted, but it does not record a supported uninstall action yet.",
        warnings: ["Install manifest action is missing or unsupported."],
    });
}

function uninstallPlanResult(base, result) {
    return {
        ...base,
        ...result,
        actionLabel: uninstallPlanActionLabel(result.action),
        warnings: [...base.warnings, ...(result.warnings ?? [])],
    };
}

function uninstallPlanActionLabel(action) {
    switch (action) {
        case "remove_fresh_install":
            return "Remove sidecar install";
        case "restore_backup":
            return "Restore previous DLL";
        case "remove_unknown":
            return "Remove DLL";
        case "manual_uninstall":
            return "Manual uninstall required";
        case "select_directory":
            return "Select game directory";
        case "inspect":
            return "Inspect install status";
        default:
            return "No uninstall action";
    }
}

function currentInstallSummary(install) {
    return {
        state: install?.state ?? "unknown",
        classification: install?.classification ?? "unknown",
        profile: install?.profile ?? "unknown",
        dllSha256: install?.dll?.sha256 ?? "",
        manifestDllSha256: install?.manifest?.dllSha256 ?? "",
        manifestAction: install?.manifest?.action ?? "",
    };
}

function uninstallTarget(install) {
    const gameDirectory = install?.gameDirectory ?? "";
    const manifestBackup = install?.manifest?.backup ?? null;
    return {
        gameDirectory,
        destinationPath: gameDirectory ? path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE) : "",
        manifestPath: gameDirectory ? communityModInstallManifestPath(gameDirectory) : "",
        backupPath: manifestBackup?.path ?? "",
        backupSha256: manifestBackup?.sha256 ?? "",
    };
}

function uninstallPlanSafety() {
    return {
        dryRun: true,
        writesGameDirectory: false,
        userConfirmationRequired: true,
        settingsFilesPreserved: true,
        optionalSettingsAndLogsCleanup: true,
        gameProcessMustBeStopped: true,
        currentHashVerificationRequired: true,
        staleManifestBlocked: true,
        backupBeforeUnknownRemoval: false,
        unknownRemovalCreatesBackup: false,
    };
}

function uninstallPlanExecution(platform) {
    return {
        enabled: false,
        reason: platform?.installExecutionSupported === false
            ? platformUnsupportedInstallSummary(platform).replace("install/update", "uninstall")
            : "Uninstall execution is gated by confirmation and the local execution endpoint.",
    };
}

function uninstallSettingsRetention(install) {
    const gameDirectory = install?.gameDirectory ?? "";
    return {
        policy: "leave_in_place",
        preserve: true,
        delete: false,
        supported: true,
        label: "Also delete settings and logs",
        files: gameDirectory
            ? COMMUNITY_MOD_CLEANUP_FILES.map((name) => ({ name, path: path.join(gameDirectory, name), action: "leave_in_place" }))
            : [],
    };
}

function isSidecarOwnedInstall(install) {
    return install.manifest?.exists === true
        && !install.manifest.parseError
        && Boolean(install.manifest.profile)
        && Boolean(install.manifest.dllSha256)
        && normalizeSha256(install.manifest.dllSha256) === normalizeSha256(install.dll?.sha256);
}

function manifestHashMismatch(install) {
    return install.manifest?.exists === true
        && !install.manifest.parseError
        && Boolean(install.manifest.dllSha256)
        && Boolean(install.dll?.sha256)
        && normalizeSha256(install.manifest.dllSha256) !== normalizeSha256(install.dll.sha256);
}

function hasTrustedBackupMetadata(manifest) {
    return manifest?.backup?.created === true
        && Boolean(manifest.backup.path)
        && Boolean(manifest.backup.sha256);
}

function normalizeSha256(value) {
    return String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}
