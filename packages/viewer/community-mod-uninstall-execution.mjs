import { createHash } from "node:crypto";
import { copyFile, lstat, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
} from "./community-mod-install.mjs";
import {
    buildCommunityModInstallPlatformCapability,
    platformUnsupportedInstallSummary,
} from "./community-mod-install-platform.mjs";

const EXECUTABLE_ACTIONS = new Set(["remove_fresh_install", "restore_backup", "remove_unknown"]);
const COMMUNITY_MOD_CLEANUP_FILES = [
    "community_patch_settings.toml",
    "community_patch_runtime.vars",
    "community_patch.log",
    "community_patch_battle_feed.jsonl",
    "community_patch_battle_probe.jsonl",
    "community_patch_battle_probe_segments.jsonl",
    "community_patch_battle_probe_summary.jsonl",
];
const COMMUNITY_MOD_CLEANUP_FILE_NAMES = new Set(COMMUNITY_MOD_CLEANUP_FILES.map((name) => name.toLowerCase()));
export const COMMUNITY_MOD_UNINSTALL_EXECUTION_ACKNOWLEDGEMENT = "I understand this will remove or restore version.dll in the selected STFC game directory.";

export function buildCommunityModUninstallConfirmation(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const uninstallPlan = options.uninstallPlan ?? null;
    const platform = options.platformCapability
        ?? uninstallPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const gameProcess = normalizeGameProcessStatus(options.gameProcess);
    const action = uninstallPlan?.action ?? "none";
    const backupRequired = false;
    const restoreBackup = action === "restore_backup";
    const target = normalizeTarget(uninstallPlan?.target);
    const settings = buildSettingsRetention({
        deleteSettingsAndLogs: options.deleteSettingsAndLogs,
        settingsFiles: options.settingsFiles ?? uninstallPlan?.settings?.files,
        target,
    });
    const base = {
        ok: true,
        checkedAt,
        status: "not_ready",
        action,
        actionLabel: uninstallPlan?.actionLabel ?? "No uninstall action",
        platform,
        uninstallPlan,
        gameProcess,
        current: normalizeCurrent(uninstallPlan?.current),
        target,
        settings,
        safety: confirmationSafety({ backupRequired, restoreBackup, settings }),
        execution: confirmationExecution(platform),
        warnings: [...(uninstallPlan?.warnings ?? [])],
    };

    if (!uninstallPlan || uninstallPlan.ok === false) {
        return confirmationResult(base, {
            status: "uninstall_plan_unavailable",
            summary: String(uninstallPlan?.error ?? "Community Mod uninstall plan is unavailable."),
            warnings: ["Uninstall plan did not complete."],
        });
    }

    if (!platform.installExecutionSupported) {
        return confirmationResult(base, {
            status: "platform_unsupported",
            summary: platformUnsupportedInstallSummary(platform).replace("install/update", "uninstall"),
            warnings: base.warnings.includes(platform.unsupportedReason) ? [] : [platform.unsupportedReason],
        });
    }

    if (!EXECUTABLE_ACTIONS.has(action)) {
        return confirmationResult(base, {
            status: uninstallPlan.status ?? "no_uninstall_action",
            summary: uninstallPlan.summary ?? "No Community Mod uninstall action is currently available.",
            warnings: ["Uninstall execution is blocked by the current plan."],
        });
    }

    if (!gameProcess.checked) {
        return confirmationResult(base, {
            status: "game_process_check_unavailable",
            summary: gameProcess.error
                ? `STFC process status could not be checked: ${gameProcess.error}`
                : "STFC process status could not be checked; uninstall cannot proceed.",
            warnings: ["Game process status is unknown."],
        });
    }

    if (gameProcess.running) {
        return confirmationResult(base, {
            status: "game_running",
            summary: "Close Star Trek Fleet Command before uninstalling or restoring version.dll.",
            warnings: ["prime.exe is running."],
        });
    }

    if (!base.target.destinationPath || !base.current.dllSha256) {
        return confirmationResult(base, {
            status: "target_unavailable",
            summary: "Destination version.dll path and current SHA-256 are required before uninstall confirmation.",
            warnings: ["Uninstall target details are incomplete."],
        });
    }

    if ((backupRequired || restoreBackup) && !base.target.backupPath) {
        return confirmationResult(base, {
            status: "backup_path_unavailable",
            summary: "A backup path is required before this uninstall action can proceed.",
            warnings: ["Backup path is unavailable."],
        });
    }

    if (restoreBackup && !base.target.backupSha256) {
        return confirmationResult(base, {
            status: "backup_hash_unavailable",
            summary: "The rollback backup SHA-256 is required before restore can proceed.",
            warnings: ["Backup SHA-256 is unavailable."],
        });
    }

    return confirmationResult(base, {
        status: "ready_for_confirmation",
        summary: confirmationSummary(action),
        confirmation: {
            required: true,
            enabled: false,
            action,
            title: uninstallPlan.actionLabel,
            primaryActionLabel: "Execute uninstall",
            acknowledgement: COMMUNITY_MOD_UNINSTALL_EXECUTION_ACKNOWLEDGEMENT,
            checks: confirmationChecks({ base, backupRequired, restoreBackup, settings }),
        },
    });
}

export function buildCommunityModUninstallExecutionRequest(options = {}) {
    const payload = isRecord(options.payload) ? options.payload : {};
    const confirmation = options.confirmation ?? null;
    const platform = options.platformCapability
        ?? confirmation?.platform
        ?? confirmation?.uninstallPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const env = options.env ?? process.env;
    const serverEnabled = parseBooleanFlag(env.STFC_SIDECAR_ENABLE_MOD_UNINSTALL_EXECUTION)
        || parseBooleanFlag(env.STFC_SIDECAR_ENABLE_MOD_WRITE_EXECUTION);
    const requested = payload.enableExecution === true;
    const acknowledgement = String(payload.acknowledgement ?? "").trim();
    const expectedAcknowledgement = confirmation?.confirmation?.acknowledgement
        || COMMUNITY_MOD_UNINSTALL_EXECUTION_ACKNOWLEDGEMENT;
    const confirmedCurrentSha256 = normalizeSha256(payload.confirmedCurrentSha256);
    const expectedCurrentSha256 = normalizeSha256(confirmation?.current?.dllSha256);
    const confirmedDestinationPath = String(payload.confirmedDestinationPath ?? "");
    const expectedDestinationPath = String(confirmation?.target?.destinationPath ?? "");
    const confirmedDeleteSettingsAndLogs = payload.deleteSettingsAndLogs === true;
    const expectedDeleteSettingsAndLogs = confirmation?.settings?.delete === true;
    const base = {
        ok: true,
        status: "ready",
        platform,
        requested,
        serverEnabled,
        acknowledgementAccepted: acknowledgement === expectedAcknowledgement,
        expectedAcknowledgement,
        confirmedCurrentSha256,
        expectedCurrentSha256,
        confirmedDestinationPath,
        expectedDestinationPath,
        confirmedDeleteSettingsAndLogs,
        expectedDeleteSettingsAndLogs,
    };

    if (!platform.installExecutionSupported) {
        return executionRequestResult(base, {
            status: "platform_unsupported",
            summary: platformUnsupportedInstallSummary(platform).replace("install/update", "uninstall"),
            warnings: [platform.unsupportedReason],
        });
    }

    if (!serverEnabled) {
        return executionRequestResult(base, {
            status: "server_execution_disabled",
            summary: "Uninstall execution endpoint is disabled for this process.",
            warnings: ["Set STFC_SIDECAR_ENABLE_MOD_UNINSTALL_EXECUTION=1 to enable this endpoint."],
        });
    }

    if (!requested) {
        return executionRequestResult(base, {
            status: "execution_not_requested",
            summary: "Request body must explicitly set enableExecution to true.",
            warnings: ["Execution request did not opt in."],
        });
    }

    if (acknowledgement !== expectedAcknowledgement) {
        return executionRequestResult(base, {
            status: "acknowledgement_required",
            summary: "Uninstall execution acknowledgement text did not match the prepared confirmation.",
            warnings: ["Exact acknowledgement text is required before execution."],
        });
    }

    if (!expectedCurrentSha256 || confirmedCurrentSha256 !== expectedCurrentSha256) {
        return executionRequestResult(base, {
            status: "current_hash_confirmation_required",
            summary: "Request must confirm the current version.dll SHA-256 from the prepared confirmation.",
            warnings: ["Confirmed current SHA-256 did not match."],
        });
    }

    if (!expectedDestinationPath || confirmedDestinationPath !== expectedDestinationPath) {
        return executionRequestResult(base, {
            status: "destination_confirmation_required",
            summary: "Request must confirm the destination version.dll path from the prepared confirmation.",
            warnings: ["Confirmed destination path did not match."],
        });
    }

    if (confirmedDeleteSettingsAndLogs !== expectedDeleteSettingsAndLogs) {
        return executionRequestResult(base, {
            status: "settings_cleanup_confirmation_required",
            summary: "Request must confirm the prepared settings and logs cleanup choice.",
            warnings: ["Settings/logs cleanup choice did not match the prepared confirmation."],
        });
    }

    return executionRequestResult(base, { status: "ready", summary: "Uninstall execution request is explicitly confirmed." });
}

export function buildCommunityModUninstallExecutionBlocked(options = {}) {
    const confirmation = options.confirmation ?? null;
    const executionRequest = options.executionRequest ?? null;
    const action = confirmation?.action ?? "none";
    return {
        ok: true,
        checkedAt: normalizeIsoTimestamp(options.checkedAt),
        status: executionRequest?.status ?? "execution_request_blocked",
        action,
        platform: confirmation?.platform ?? executionRequest?.platform ?? buildCommunityModInstallPlatformCapability({ platform: options.platform }),
        summary: executionRequest?.summary ?? "Uninstall execution request is blocked.",
        confirmation,
        executionRequest,
        current: normalizeCurrent(confirmation?.current),
        target: normalizeTarget(confirmation?.target),
        settings: normalizeSettingsRetention(confirmation?.settings),
        safety: executionSafety({ action, writesGameDirectory: false, settings: confirmation?.settings }),
        execution: {
            enabled: false,
            writesAttempted: false,
            reason: "Uninstall execution request was rejected before write handling.",
        },
        receipt: null,
        warnings: [...(confirmation?.warnings ?? []), ...(executionRequest?.warnings ?? [])],
    };
}

export async function executeCommunityModUninstall(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const confirmation = options.confirmation ?? null;
    const action = confirmation?.action ?? "none";
    const platform = options.platformCapability
        ?? confirmation?.platform
        ?? confirmation?.uninstallPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const gameProcess = normalizeGameProcessStatus(options.gameProcess);
    const executionEnabled = options.enableExecution === true;
    const current = normalizeCurrent(confirmation?.current);
    const target = normalizeTarget(confirmation?.target);
    const settings = normalizeSettingsRetention(confirmation?.settings);
    const base = {
        ok: true,
        checkedAt,
        status: "not_started",
        action,
        platform,
        confirmation,
        gameProcess,
        current,
        target,
        settings,
        safety: executionSafety({ action, writesGameDirectory: false, settings }),
        execution: {
            enabled: executionEnabled,
            writesAttempted: false,
            reason: executionEnabled
                ? "Execution explicitly enabled for this call."
                : "Uninstall execution is disabled unless explicitly enabled by the caller.",
        },
        receipt: null,
        warnings: [...(confirmation?.warnings ?? [])],
    };

    const blocked = validateBeforeWrite({ base, confirmation, platform, gameProcess, executionEnabled, action });
    if (blocked) {
        return executionResult(base, blocked);
    }

    const pathBlocked = await validateUninstallPathSafety({ target, settings, action });
    if (pathBlocked) {
        return executionResult(base, pathBlocked);
    }

    const currentSha256 = await sha256File(target.destinationPath).catch(() => "");
    if (!currentSha256) {
        return executionResult(base, {
            status: "destination_missing",
            summary: "Destination version.dll is missing; no files were changed.",
            warnings: ["Destination DLL was not found."],
        });
    }

    if (currentSha256 !== current.dllSha256) {
        return executionResult(base, {
            status: "current_hash_mismatch",
            summary: "Current version.dll SHA-256 no longer matches the uninstall confirmation.",
            warnings: ["Current DLL hash changed before execution."],
        });
    }

    try {
        if (action === "restore_backup") {
            return executionResult(base, await restoreBackup({ checkedAt, target, settings }));
        }

        if (action === "remove_unknown") {
            return executionResult(base, await removeUnknownInstall({ target, currentSha256, settings }));
        }

        return executionResult(base, await removeFreshInstall({ checkedAt, target, currentSha256, settings }));
    } catch (error) {
        return executionResult(base, {
            ok: false,
            status: "execution_failed",
            summary: error instanceof Error ? error.message : String(error),
            warnings: ["Uninstall execution failed."],
        });
    }
}

async function removeFreshInstall({ target, currentSha256, settings }) {
    await rm(target.destinationPath, { force: true });
    await rm(target.manifestPath, { force: true });
    const settingsCleanup = await applySettingsCleanup(settings, target.gameDirectory);
    return {
        status: "removed",
        summary: "Removed sidecar-owned Community Mod version.dll and install manifest.",
        safety: executionSafety({ action: "remove_fresh_install", writesGameDirectory: true, settings: settingsCleanup }),
        execution: { enabled: true, writesAttempted: true, writesCompleted: true },
        settings: settingsCleanup,
        receipt: {
            destination: { path: target.destinationPath, removed: true, dllSha256: currentSha256 },
            backup: { required: false, created: false, path: "", dllSha256: "" },
            manifest: { removed: true, path: target.manifestPath },
            settings: settingsReceipt(settingsCleanup),
        },
    };
}

async function removeUnknownInstall({ target, currentSha256, settings }) {
    await rm(target.destinationPath, { force: true });
    await rm(target.manifestPath, { force: true });
    const settingsCleanup = await applySettingsCleanup(settings, target.gameDirectory);
    return {
        status: "removed",
        summary: "Removed version.dll from the selected game directory.",
        safety: executionSafety({ action: "remove_unknown", writesGameDirectory: true, settings: settingsCleanup }),
        execution: { enabled: true, writesAttempted: true, writesCompleted: true },
        settings: settingsCleanup,
        receipt: {
            destination: { path: target.destinationPath, removed: true, dllSha256: currentSha256 },
            backup: { required: false, created: false, path: "", dllSha256: "" },
            manifest: { removed: true, path: target.manifestPath },
            settings: settingsReceipt(settingsCleanup),
        },
    };
}

async function restoreBackup({ target, settings }) {
    const backupSha256 = await sha256File(target.backupPath).catch(() => "");
    if (!backupSha256) {
        return {
            status: "backup_missing",
            summary: "The rollback backup is missing; no files were changed.",
            warnings: ["Backup DLL was not found."],
        };
    }

    if (backupSha256 !== target.backupSha256) {
        return {
            status: "backup_hash_mismatch",
            summary: "Rollback backup SHA-256 no longer matches the uninstall confirmation.",
            warnings: ["Backup hash changed before restore."],
        };
    }

    await copyFile(target.backupPath, target.destinationPath);
    const restoredSha256 = await sha256File(target.destinationPath);
    if (restoredSha256 !== target.backupSha256) {
        return {
            ok: false,
            status: "post_restore_hash_mismatch",
            summary: "Restored version.dll SHA-256 did not match the backup.",
            warnings: ["Destination hash verification failed after restore."],
        };
    }

    await rm(target.manifestPath, { force: true });
    const settingsCleanup = await applySettingsCleanup(settings, target.gameDirectory);
    return {
        status: "restored_backup",
        summary: "Restored the previous version.dll backup and removed the sidecar install manifest.",
        safety: executionSafety({ action: "restore_backup", writesGameDirectory: true, settings: settingsCleanup }),
        execution: { enabled: true, writesAttempted: true, writesCompleted: true },
        settings: settingsCleanup,
        receipt: {
            destination: { path: target.destinationPath, restored: true, dllSha256: restoredSha256, bytes: (await stat(target.destinationPath)).size },
            backup: { required: true, used: true, path: target.backupPath, dllSha256: backupSha256 },
            manifest: { removed: true, path: target.manifestPath },
            settings: settingsReceipt(settingsCleanup),
        },
    };
}

function validateBeforeWrite({ base, confirmation, platform, gameProcess, executionEnabled, action }) {
    if (!platform.installExecutionSupported) {
        return {
            status: "platform_unsupported",
            summary: platformUnsupportedInstallSummary(platform).replace("install/update", "uninstall"),
            warnings: base.warnings.includes(platform.unsupportedReason) ? [] : [platform.unsupportedReason],
        };
    }

    if (!confirmation || confirmation.status !== "ready_for_confirmation") {
        return {
            status: "confirmation_not_ready",
            summary: confirmation?.summary ?? "Uninstall confirmation is not ready for execution.",
            warnings: ["Uninstall confirmation must be prepared before execution."],
        };
    }

    if (!executionEnabled) {
        return {
            status: "execution_disabled",
            summary: "Uninstall execution is disabled; no files were changed.",
            warnings: ["Execution requires an explicit enable flag."],
        };
    }

    if (!gameProcess.checked) {
        return {
            status: "game_process_check_unavailable",
            summary: gameProcess.error
                ? `STFC process status could not be checked: ${gameProcess.error}`
                : "STFC process status could not be checked; no files were changed.",
            warnings: ["Execution-time game process status is unknown."],
        };
    }

    if (gameProcess.running) {
        return {
            status: "game_running",
            summary: "Close Star Trek Fleet Command before uninstalling or restoring version.dll.",
            warnings: ["prime.exe is running."],
        };
    }

    if (!EXECUTABLE_ACTIONS.has(action)) {
        return {
            status: "unsupported_uninstall_action",
            summary: "The prepared uninstall action is not executable.",
            warnings: ["Unsupported uninstall action."],
        };
    }

    if (!base.current.dllSha256) {
        return {
            status: "current_hash_unavailable",
            summary: "Current version.dll SHA-256 is required before execution.",
            warnings: ["Current DLL hash is unavailable."],
        };
    }

    if (!areSettingsCleanupPathsSafe(base.target.gameDirectory, base.settings)) {
        return {
            status: "unsafe_settings_cleanup_path",
            summary: "Settings/logs cleanup paths are not safe for automated deletion.",
            warnings: ["Settings/logs cleanup paths must be direct Community Mod artifacts inside the selected game directory."],
        };
    }

    if (!isSafeTarget(base.target, action)) {
        return {
            status: "unsafe_target_path",
            summary: "Uninstall target paths are not inside the selected game directory boundary.",
            warnings: ["Destination, backup, or manifest path failed safety validation."],
        };
    }

    return null;
}

function executionResult(base, result) {
    return {
        ...base,
        ...result,
        ok: result.ok ?? true,
        safety: result.safety ?? base.safety,
        execution: result.execution ?? base.execution,
        settings: result.settings ?? base.settings,
        warnings: [...base.warnings, ...(result.warnings ?? [])],
    };
}

function confirmationResult(base, result) {
    return {
        ...base,
        ...result,
        confirmation: result.confirmation ?? {
            required: false,
            enabled: false,
            action: base.action,
            title: "Uninstall confirmation unavailable",
            primaryActionLabel: "Unavailable",
            acknowledgement: "Resolve the blockers before confirming an uninstall action.",
            checks: confirmationChecks({ base, backupRequired: false, restoreBackup: false, settings: base.settings }),
        },
        warnings: [...base.warnings, ...(result.warnings ?? [])],
    };
}

function executionRequestResult(base, result) {
    return {
        ...base,
        ...result,
        ok: true,
        warnings: result.warnings ?? [],
    };
}

function confirmationSafety({ backupRequired, restoreBackup, settings }) {
    return {
        dryRun: true,
        writesGameDirectory: false,
        userConfirmationRequired: true,
        settingsFilesPreserved: settings?.preserve === true,
        settingsFilesTouched: settings?.touched === true,
        deleteSettingsAndLogs: settings?.delete === true,
        backupBeforeRemove: backupRequired,
        restoreBackup,
        executionTimeGameProcessCheckRequired: true,
        currentHashVerificationRequired: true,
        backupHashVerificationRequired: backupRequired || restoreBackup,
    };
}

function executionSafety({ action, writesGameDirectory, settings }) {
    return {
        writesGameDirectory,
        writesSidecarCache: false,
        settingsFilesPreserved: settings?.preserve === true,
        settingsFilesTouched: settings?.touched === true,
        deleteSettingsAndLogs: settings?.delete === true,
        executionTimeGameProcessCheckRequired: true,
        currentHashVerificationRequired: true,
        backupBeforeRemove: false,
        backupHashVerificationRequired: action === "restore_backup",
        manifestCleanupRequired: true,
    };
}

function confirmationExecution(platform) {
    return {
        enabled: false,
        reason: platform?.installExecutionSupported === false
            ? platformUnsupportedInstallSummary(platform).replace("install/update", "uninstall")
            : "Uninstall confirmation contract is prepared, but file execution remains endpoint-gated.",
    };
}

function confirmationChecks({ base, backupRequired, restoreBackup, settings }) {
    return [
        { id: "game_closed", label: "STFC closed", passed: base.gameProcess.checked === true && base.gameProcess.running === false },
        { id: "destination_planned", label: "Destination version.dll path planned", passed: Boolean(base.target.destinationPath) },
        { id: "current_hash", label: "Current version.dll hash captured", passed: Boolean(base.current.dllSha256) },
        {
            id: "settings_cleanup_choice",
            label: settings?.delete === true ? "Settings and logs selected for deletion" : "Settings and logs left untouched",
            passed: true,
        },
        {
            id: "backup_planned",
            label: backupRequired ? "Removal backup path planned" : restoreBackup ? "Rollback backup path planned" : "Backup not required",
            passed: backupRequired || restoreBackup ? Boolean(base.target.backupPath) : true,
        },
        {
            id: "backup_hash",
            label: restoreBackup ? "Rollback backup hash captured" : "Backup hash not required yet",
            passed: restoreBackup ? Boolean(base.target.backupSha256) : true,
        },
    ];
}

function buildSettingsRetention({ deleteSettingsAndLogs, settingsFiles, target }) {
    const deleteArtifacts = deleteSettingsAndLogs === true;
    return {
        policy: deleteArtifacts ? "delete_settings_and_logs" : "leave_in_place",
        preserve: !deleteArtifacts,
        delete: deleteArtifacts,
        supported: true,
        label: "Also delete settings and logs",
        files: normalizeSettingsFiles(settingsFiles, target?.gameDirectory, deleteArtifacts),
        touched: false,
    };
}

function normalizeSettingsRetention(value = {}) {
    const deleteArtifacts = value.delete === true || value.policy === "delete_settings_and_logs";
    return {
        policy: deleteArtifacts ? "delete_settings_and_logs" : "leave_in_place",
        preserve: !deleteArtifacts,
        delete: deleteArtifacts,
        supported: value.supported !== false,
        label: stringOrEmpty(value.label) || "Also delete settings and logs",
        files: normalizeSettingsFiles(value.files, "", deleteArtifacts),
        touched: value.touched === true,
        deletedCount: Number.isFinite(value.deletedCount) ? value.deletedCount : 0,
    };
}

function normalizeSettingsFiles(files, gameDirectory = "", deleteArtifacts = false) {
    if (Array.isArray(files) && files.length > 0) {
        return files
            .filter(isRecord)
            .map((file) => ({
                name: stringOrEmpty(file.name) || path.basename(stringOrEmpty(file.path)),
                path: stringOrEmpty(file.path),
                action: deleteArtifacts ? "delete" : "leave_in_place",
            }))
            .filter((file) => file.path);
    }

    if (!gameDirectory) {
        return [];
    }

    return COMMUNITY_MOD_CLEANUP_FILES.map((name) => ({
        name,
        path: path.join(gameDirectory, name),
        action: deleteArtifacts ? "delete" : "leave_in_place",
    }));
}

async function applySettingsCleanup(settings, gameDirectory) {
    const normalized = normalizeSettingsRetention(settings);
    if (!normalized.delete) {
        return {
            ...normalized,
            preserved: true,
            deleted: false,
            touched: false,
            files: normalized.files.map((file) => ({ ...file, action: "left_in_place", existed: false, deleted: false })),
        };
    }

    const files = await resolveSettingsCleanupFiles(normalized, gameDirectory);
    const results = [];
    for (const file of files) {
        if (await existingPathIsSymlink(file.path)) {
            throw new Error(`Refusing to delete symlinked Community Mod artifact: ${file.path}`);
        }

        const existed = await fileExists(file.path);
        await rm(file.path, { force: true });
        results.push({ ...file, action: "deleted", existed, deleted: existed });
    }

    return {
        ...normalized,
        preserved: false,
        deleted: true,
        touched: results.some((file) => file.deleted),
        deletedCount: results.filter((file) => file.deleted).length,
        files: results,
    };
}

async function resolveSettingsCleanupFiles(settings, gameDirectory) {
    const files = new Map();
    for (const file of normalizeSettingsFiles(settings.files, gameDirectory, true)) {
        if (isSafeCleanupFile(gameDirectory, file.path)) {
            files.set(path.resolve(file.path).toLowerCase(), file);
        }
    }

    for (const file of await discoverCommunityModCleanupFiles(gameDirectory)) {
        files.set(path.resolve(file.path).toLowerCase(), file);
    }

    return [...files.values()];
}

async function discoverCommunityModCleanupFiles(gameDirectory) {
    if (!gameDirectory) {
        return [];
    }

    const entries = await readdir(gameDirectory, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && isAllowedCleanupFileName(entry.name))
        .map((entry) => ({ name: entry.name, path: path.join(gameDirectory, entry.name), action: "delete" }));
}

function areSettingsCleanupPathsSafe(gameDirectory, settings) {
    const normalized = normalizeSettingsRetention(settings);
    return !normalized.delete || normalizeSettingsFiles(normalized.files, gameDirectory, true)
        .every((file) => isSafeCleanupFile(gameDirectory, file.path));
}

function isSafeCleanupFile(gameDirectory, filePath) {
    if (!gameDirectory || !filePath) {
        return false;
    }

    const resolvedGameDirectory = path.resolve(gameDirectory);
    const resolvedFilePath = path.resolve(filePath);
    return path.dirname(resolvedFilePath) === resolvedGameDirectory
        && isAllowedCleanupFileName(path.basename(resolvedFilePath));
}

function isAllowedCleanupFileName(name) {
    const lowerName = String(name ?? "").toLowerCase();
    return COMMUNITY_MOD_CLEANUP_FILE_NAMES.has(lowerName)
        || /^community_patch_.*\.(jsonl|toml|log)$/i.test(lowerName);
}

async function fileExists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

function settingsReceipt(settings) {
    const normalized = normalizeSettingsRetention(settings);
    return {
        policy: normalized.policy,
        preserved: normalized.preserve,
        deleted: normalized.delete,
        touched: normalized.touched,
        deletedCount: normalized.deletedCount,
        files: normalized.files,
    };
}

function confirmationSummary(action) {
    switch (action) {
        case "remove_fresh_install":
            return "Sidecar-owned version.dll removal is ready for explicit confirmation. No files have been changed.";
        case "restore_backup":
            return "Previous version.dll backup restore is ready for explicit confirmation. No files have been changed.";
        case "remove_unknown":
            return "version.dll removal is ready for explicit confirmation. No files have been changed.";
        default:
            return "Community Mod uninstall is ready for explicit confirmation. No files have been changed.";
    }
}

function isSafeTarget(target, action) {
    if (!target.gameDirectory || !target.destinationPath || !target.manifestPath) {
        return false;
    }

    const gameDirectory = path.resolve(target.gameDirectory);
    const destinationPath = path.resolve(target.destinationPath);
    if (destinationPath !== path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE)) {
        return false;
    }

    if (path.resolve(target.manifestPath) !== communityModInstallManifestPath(gameDirectory)) {
        return false;
    }

    if (action === "restore_backup") {
        const backupRoot = path.join(gameDirectory, ".stfc-sidecar", "backups");
        return Boolean(target.backupPath) && isInsideDirectory(backupRoot, target.backupPath);
    }

    return true;
}

function isInsideDirectory(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function validateUninstallPathSafety({ target, settings, action }) {
    try {
        const gameDirectory = await realpath(target.gameDirectory);
        if (!samePath(target.destinationPath, path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE))) {
            return pathSafetyBlocked("unsafe_target_path", "Destination version.dll is outside the real selected game directory boundary.");
        }

        if (!samePath(target.manifestPath, communityModInstallManifestPath(gameDirectory))) {
            return pathSafetyBlocked("unsafe_target_path", "Install manifest path is outside the real selected game directory boundary.");
        }

        if (await existingPathIsSymlink(target.destinationPath)) {
            return pathSafetyBlocked("unsafe_target_path", "Destination version.dll is a symlink; automated uninstall is blocked.");
        }

        if (await existingPathIsSymlink(target.manifestPath) || await existingPathIsSymlink(path.dirname(target.manifestPath))) {
            return pathSafetyBlocked("unsafe_target_path", "Install manifest path crosses a symlink; automated uninstall is blocked.");
        }

        if (action === "restore_backup") {
            const backupRoot = path.join(gameDirectory, ".stfc-sidecar", "backups");
            if (!isInsideDirectory(backupRoot, target.backupPath)) {
                return pathSafetyBlocked("unsafe_target_path", "Backup path is outside the real selected game directory boundary.");
            }

            if (await existingPathIsSymlink(target.backupPath) || await existingPathIsSymlink(path.dirname(target.backupPath))) {
                return pathSafetyBlocked("unsafe_target_path", "Backup path crosses a symlink; automated restore is blocked.");
            }
        }

        if (normalizeSettingsRetention(settings).delete) {
            for (const file of normalizeSettingsFiles(settings.files, gameDirectory, true)) {
                if (!isSafeCleanupFile(gameDirectory, file.path) || await existingPathIsSymlink(file.path)) {
                    return pathSafetyBlocked("unsafe_settings_cleanup_path", "Settings/log cleanup path is outside the real selected game directory boundary or crosses a symlink.");
                }
            }
        }

        return null;
    } catch (error) {
        return pathSafetyBlocked(
            "path_safety_check_failed",
            error instanceof Error ? error.message : String(error),
        );
    }
}

function pathSafetyBlocked(status, summary) {
    return {
        status,
        summary,
        warnings: ["Realpath/lstat safety validation blocked uninstall before any game-directory write."],
    };
}

async function existingPathIsSymlink(filePath) {
    try {
        return (await lstat(filePath)).isSymbolicLink();
    } catch (error) {
        if (error?.code === "ENOENT") {
            return false;
        }

        throw error;
    }
}

function samePath(left, right) {
    return normalizePathForCompare(path.resolve(left)) === normalizePathForCompare(path.resolve(right));
}

function normalizePathForCompare(value) {
    return process.platform === "win32" ? value.toLowerCase() : value;
}

function normalizeTarget(target = {}) {
    return {
        gameDirectory: stringOrEmpty(target.gameDirectory),
        destinationPath: stringOrEmpty(target.destinationPath),
        manifestPath: stringOrEmpty(target.manifestPath),
        backupPath: stringOrEmpty(target.backupPath),
        backupSha256: normalizeSha256(target.backupSha256),
    };
}

function normalizeCurrent(current = {}) {
    return {
        state: stringOrEmpty(current.state),
        classification: stringOrEmpty(current.classification),
        profile: stringOrEmpty(current.profile),
        dllSha256: normalizeSha256(current.dllSha256),
        manifestDllSha256: normalizeSha256(current.manifestDllSha256),
        manifestAction: stringOrEmpty(current.manifestAction),
    };
}

function normalizeGameProcessStatus(value = {}) {
    return {
        checked: Boolean(value.checked),
        running: Boolean(value.running),
        processName: typeof value.processName === "string" ? value.processName : "prime.exe",
        scopedToTarget: value.scopedToTarget === true,
        targetPath: stringOrEmpty(value.targetPath) || stringOrEmpty(value.targetExecutablePath),
        candidateCount: Number.isFinite(value.candidateCount) ? value.candidateCount : 0,
        error: typeof value.error === "string" ? value.error : "",
    };
}

async function sha256File(filePath) {
    const hash = createHash("sha256");
    hash.update(await readFile(filePath));
    return hash.digest("hex").toUpperCase();
}

function parseBooleanFlag(value) {
    return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function normalizeSha256(value) {
    return String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrEmpty(value) {
    return typeof value === "string" ? value : "";
}