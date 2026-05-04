import path from "node:path";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
} from "./community-mod-install.mjs";

export function buildCommunityModInstallConfirmation(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const preflight = options.preflight ?? null;
    const artifactStaging = options.artifactStaging ?? null;
    const installPlan = options.installPlan ?? preflight?.installPlan ?? null;
    const install = installPlan?.install ?? null;
    const installAction = installPlan?.action ?? preflight?.confirmation?.action ?? "none";
    const action = preflight?.status === "ready_for_confirmation" ? installAction : preflight?.action ?? installAction;
    const backupRequired = requiresBackupForAction(installAction, install);
    const gameDirectory = install?.gameDirectory ?? "";
    const destinationPath = gameDirectory ? path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE) : "";
    const backupPath = backupRequired ? plannedBackupPath(gameDirectory, install, checkedAt) : "";
    const manifestPath = gameDirectory ? communityModInstallManifestPath(gameDirectory) : "";
    const base = {
        ok: true,
        checkedAt,
        profile: installPlan?.profile ?? preflight?.profile ?? "unknown",
        action,
        installAction,
        actionLabel: preflight?.confirmation?.title ?? installPlan?.actionLabel ?? "No install action",
        installPlan,
        preflight,
        artifactStaging,
        target: {
            gameDirectory,
            destinationPath,
            backupPath,
            manifestPath,
        },
        staged: artifactStaging?.staged ?? null,
        safety: confirmationSafety({ artifactStaging, backupRequired }),
        execution: confirmationExecution(),
        warnings: [...(preflight?.warnings ?? [])],
    };

    if (!preflight || preflight.ok === false) {
        return confirmationResult(base, {
            status: "preflight_unavailable",
            summary: String(preflight?.error ?? "Community Mod install preflight is unavailable."),
            warnings: ["Install preflight did not complete."],
        });
    }

    if (preflight.status !== "ready_for_confirmation") {
        return confirmationResult(base, {
            status: preflight.status ?? "preflight_blocked",
            summary: preflight.summary ?? "Community Mod install preflight is blocked.",
            warnings: ["Install confirmation is blocked by preflight."],
        });
    }

    if (!artifactStaging || artifactStaging.status !== "staged") {
        return confirmationResult(base, {
            status: artifactStaging?.status ?? "artifact_not_staged",
            summary: artifactStaging?.summary ?? "Stage version.dll before preparing install confirmation.",
            warnings: ["Staged version.dll is not available."],
        });
    }

    if (artifactStaging.safety?.writesGameDirectory) {
        return confirmationResult(base, {
            status: "unsafe_artifact_staging",
            summary: "Artifact staging reported a game-directory write path; confirmation is blocked.",
            warnings: ["Artifact staging safety boundary changed unexpectedly."],
        });
    }

    if (!destinationPath) {
        return confirmationResult(base, {
            status: "game_directory_unavailable",
            summary: "Selected game directory is unavailable; confirmation is blocked.",
            warnings: ["No destination path is available."],
        });
    }

    if (backupRequired && !backupPath) {
        return confirmationResult(base, {
            status: "backup_path_unavailable",
            summary: "A backup is required, but no backup path could be planned.",
            warnings: ["Backup path is unavailable."],
        });
    }

    return confirmationResult(base, {
        status: "ready_for_confirmation",
        summary: confirmationSummary(action, backupRequired),
        confirmation: {
            required: true,
            enabled: false,
            action,
            title: preflight.confirmation.title,
            primaryActionLabel: "Install execution not enabled",
            acknowledgement: confirmationAcknowledgement(action, backupRequired),
            checks: confirmationChecks({ preflight, artifactStaging, destinationPath, backupPath, backupRequired }),
        },
    });
}

function confirmationResult(base, result) {
    return {
        ...base,
        ...result,
        confirmation: result.confirmation ?? {
            required: false,
            enabled: false,
            action: base.action,
            title: "Install confirmation unavailable",
            primaryActionLabel: "Unavailable",
            acknowledgement: "Resolve the blockers before confirming an install action.",
            checks: confirmationChecks({
                preflight: base.preflight,
                artifactStaging: base.artifactStaging,
                destinationPath: base.target.destinationPath,
                backupPath: base.target.backupPath,
                backupRequired: Boolean(base.target.backupPath),
            }),
        },
        warnings: [...base.warnings, ...(result.warnings ?? [])],
    };
}

function confirmationSafety({ artifactStaging, backupRequired }) {
    return {
        dryRun: true,
        writesGameDirectory: false,
        writesSidecarCache: artifactStaging?.safety?.writesSidecarCache === true,
        userConfirmationRequired: true,
        backupBeforeReplace: backupRequired,
        executionTimeGameProcessCheckRequired: true,
        postCopyHashVerificationRequired: true,
        manifestWriteRequired: true,
    };
}

function requiresBackupForAction(action, install) {
    if (!install?.dll?.exists) {
        return false;
    }

    return ["update", "reinstall", "replace_unknown", "replace_profile"].includes(action);
}

function confirmationExecution() {
    return {
        enabled: false,
        reason: "Install confirmation contract is prepared, but DLL copy execution is not enabled in this build.",
    };
}

function confirmationChecks(options) {
    const preflight = options.preflight ?? null;
    const staging = options.artifactStaging ?? null;
    const backupRequired = Boolean(options.backupRequired);
    return [
        {
            id: "game_closed",
            label: "STFC closed",
            passed: preflight?.gameProcess?.checked === true && preflight.gameProcess.running === false,
        },
        {
            id: "artifact_staged",
            label: "version.dll staged in sidecar cache",
            passed: staging?.status === "staged" && Boolean(staging.staged?.dllSha256),
        },
        {
            id: "destination_planned",
            label: "Destination version.dll path planned",
            passed: Boolean(options.destinationPath),
        },
        {
            id: "backup_planned",
            label: backupRequired ? "Backup path planned" : "Backup not required for fresh install",
            passed: backupRequired ? Boolean(options.backupPath) : true,
        },
        {
            id: "execution_disabled",
            label: "DLL copy execution remains disabled",
            passed: true,
        },
    ];
}

function confirmationSummary(action, backupRequired) {
    const backup = backupRequired ? " A backup path has been planned." : " No existing DLL backup is required.";
    return `${actionLabel(action)} is ready for explicit user confirmation before any copy path exists.${backup} No files have been changed.`;
}

function confirmationAcknowledgement(action, backupRequired) {
    const backup = backupRequired
        ? "I understand the existing version.dll must be backed up before replacement."
        : "I understand no existing version.dll backup is required for this install.";
    return `${backup} I understand ${actionLabel(action).toLowerCase()} is not executed by this build yet.`;
}

function actionLabel(action) {
    switch (action) {
        case "install":
            return "Install Community Mod";
        case "update":
            return "Update Community Mod";
        case "reinstall":
            return "Reinstall Community Mod";
        case "replace_unknown":
            return "Replace unknown version.dll";
        case "replace_profile":
            return "Replace installed profile";
        default:
            return "Community Mod install action";
    }
}

function plannedBackupPath(gameDirectory, install, checkedAt) {
    if (!gameDirectory || !install?.dll?.exists) {
        return "";
    }

    const timestamp = checkedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/-+$/, "");
    const sha = String(install.dll.sha256 ?? "unknown").slice(0, 12) || "unknown";
    return path.join(gameDirectory, ".stfc-sidecar", "backups", `version.dll.${timestamp}.${sha}.bak`);
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}