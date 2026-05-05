import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
} from "./community-mod-install.mjs";
import {
    buildCommunityModInstallPlatformCapability,
    platformUnsupportedInstallSummary,
} from "./community-mod-install-platform.mjs";

const REPLACE_ACTIONS = new Set(["update", "reinstall", "replace_unknown", "replace_profile"]);
export const COMMUNITY_MOD_INSTALL_EXECUTION_ACKNOWLEDGEMENT = "I understand this will modify version.dll in the selected STFC game directory.";

export function buildCommunityModInstallExecutionRequest(options = {}) {
    const payload = isRecord(options.payload) ? options.payload : {};
    const confirmation = options.confirmation ?? null;
    const platform = options.platformCapability
        ?? confirmation?.platform
        ?? confirmation?.installPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const env = options.env ?? process.env;
    const serverEnabled = parseBooleanFlag(env.STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION);
    const requested = payload.enableExecution === true;
    const acknowledgement = String(payload.acknowledgement ?? "").trim();
    const expectedAcknowledgement = confirmation?.confirmation?.acknowledgement
        || COMMUNITY_MOD_INSTALL_EXECUTION_ACKNOWLEDGEMENT;
    const confirmedStagedSha256 = normalizeSha256(payload.confirmedStagedSha256);
    const expectedStagedSha256 = normalizeSha256(confirmation?.staged?.dllSha256);
    const confirmedDestinationPath = String(payload.confirmedDestinationPath ?? "");
    const expectedDestinationPath = String(confirmation?.target?.destinationPath ?? "");

    const base = {
        ok: true,
        status: "ready",
        platform,
        requested,
        serverEnabled,
        acknowledgementAccepted: acknowledgement === expectedAcknowledgement,
        expectedAcknowledgement,
        confirmedStagedSha256,
        expectedStagedSha256,
        confirmedDestinationPath,
        expectedDestinationPath,
    };

    if (!platform.installExecutionSupported) {
        return executionRequestResult(base, {
            status: "platform_unsupported",
            summary: platformUnsupportedInstallSummary(platform),
            warnings: [platform.unsupportedReason],
        });
    }

    if (!serverEnabled) {
        return executionRequestResult(base, {
            status: "server_execution_disabled",
            summary: "Install execution endpoint is disabled for this process.",
            warnings: ["Set STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION=1 to enable this endpoint."],
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
            summary: "Install execution acknowledgement text did not match the prepared confirmation.",
            warnings: ["Exact acknowledgement text is required before execution."],
        });
    }

    if (!expectedStagedSha256 || confirmedStagedSha256 !== expectedStagedSha256) {
        return executionRequestResult(base, {
            status: "staged_hash_confirmation_required",
            summary: "Request must confirm the staged version.dll SHA-256 from the prepared confirmation.",
            warnings: ["Confirmed staged SHA-256 did not match."],
        });
    }

    if (!expectedDestinationPath || confirmedDestinationPath !== expectedDestinationPath) {
        return executionRequestResult(base, {
            status: "destination_confirmation_required",
            summary: "Request must confirm the destination version.dll path from the prepared confirmation.",
            warnings: ["Confirmed destination path did not match."],
        });
    }

    return executionRequestResult(base, { status: "ready", summary: "Install execution request is explicitly confirmed." });
}

export function buildCommunityModInstallExecutionBlocked(options = {}) {
    const confirmation = options.confirmation ?? null;
    const executionRequest = options.executionRequest ?? null;
    const platform = options.platformCapability
        ?? confirmation?.platform
        ?? executionRequest?.platform
        ?? confirmation?.installPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const backupRequired = confirmation?.safety?.backupBeforeReplace === true || REPLACE_ACTIONS.has(confirmation?.action);
    return {
        ok: true,
        checkedAt: normalizeIsoTimestamp(options.checkedAt),
        status: executionRequest?.status ?? "execution_request_blocked",
        action: confirmation?.action ?? "none",
        profile: confirmation?.profile ?? "unknown",
        platform,
        summary: executionRequest?.summary ?? "Install execution request is blocked.",
        confirmation,
        executionRequest,
        target: normalizeTarget(confirmation?.target),
        staged: normalizeStaged(confirmation?.staged ?? confirmation?.artifactStaging?.staged),
        safety: executionSafety({ backupRequired, writesGameDirectory: false }),
        execution: {
            enabled: false,
            writesAttempted: false,
            reason: "Install execution request was rejected before write handling.",
        },
        receipt: null,
        warnings: [...(confirmation?.warnings ?? []), ...(executionRequest?.warnings ?? [])],
    };
}

export async function executeCommunityModInstall(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const confirmation = options.confirmation ?? null;
    const platform = options.platformCapability
        ?? confirmation?.platform
        ?? confirmation?.installPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const gameProcess = normalizeGameProcessStatus(options.gameProcess);
    const executionEnabled = options.enableExecution === true;
    const target = normalizeTarget(confirmation?.target);
    const staged = normalizeStaged(confirmation?.staged ?? confirmation?.artifactStaging?.staged);
    const backupRequired = confirmation?.safety?.backupBeforeReplace === true || REPLACE_ACTIONS.has(confirmation?.action);
    const base = {
        ok: true,
        checkedAt,
        status: "not_started",
        action: confirmation?.action ?? "none",
        profile: confirmation?.profile ?? "unknown",
        platform,
        confirmation,
        gameProcess,
        target,
        staged,
        safety: executionSafety({ backupRequired, writesGameDirectory: false }),
        execution: {
            enabled: executionEnabled,
            writesAttempted: false,
            reason: executionEnabled
                ? "Execution explicitly enabled for this call."
                : "Install execution is disabled unless explicitly enabled by the caller.",
        },
        receipt: null,
        warnings: [...(confirmation?.warnings ?? [])],
    };

    const blocked = validateBeforeWrite({ base, confirmation, platform, gameProcess, executionEnabled, backupRequired });
    if (blocked) {
        return executionResult(base, blocked);
    }

    const stagedSha256 = await sha256File(staged.path);
    if (stagedSha256 !== normalizeSha256(staged.dllSha256)) {
        return executionResult(base, {
            status: "staged_hash_mismatch",
            summary: "Staged version.dll SHA-256 no longer matches the confirmation payload.",
            warnings: ["Staged DLL hash changed before execution."],
        });
    }

    const destinationExists = await fileExists(target.destinationPath);
    if (backupRequired && !destinationExists) {
        return executionResult(base, {
            status: "destination_missing_for_backup",
            summary: "A replacement backup is required, but the destination version.dll is missing.",
            warnings: ["Backup-required install action cannot proceed without an existing destination DLL."],
        });
    }

    if (!backupRequired && destinationExists) {
        return executionResult(base, {
            status: "destination_exists_for_install",
            summary: "A fresh install was requested, but destination version.dll already exists.",
            warnings: ["Fresh install cannot overwrite an existing DLL without a replacement confirmation."],
        });
    }

    let backupCreated = false;
    let destinationWritten = false;
    try {
        if (backupRequired) {
            await mkdir(path.dirname(target.backupPath), { recursive: true });
            await copyFile(target.destinationPath, target.backupPath);
            backupCreated = true;
        }

        await copyFile(staged.path, target.destinationPath);
        destinationWritten = true;
        const destinationSha256 = await sha256File(target.destinationPath);
        if (destinationSha256 !== stagedSha256) {
            const rollback = await rollbackDestination({ target, backupCreated, destinationWritten });
            return executionResult(base, {
                ok: false,
                status: "post_copy_hash_mismatch",
                summary: "Copied version.dll SHA-256 did not match the staged DLL.",
                rollback,
                warnings: ["Destination hash verification failed after copy."],
            });
        }

        const backupSha256 = backupCreated ? await sha256File(target.backupPath) : "";
        await mkdir(path.dirname(target.manifestPath), { recursive: true });
        const manifest = buildInstallManifest({
            confirmation,
            target,
            backupCreated,
            backupSha256,
            dllSha256: destinationSha256,
            installedAt: checkedAt,
        });
        await writeFile(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        return executionResult(base, {
            status: executionStatus(confirmation.action),
            summary: executionSummary(confirmation.action, backupCreated),
            safety: executionSafety({ backupRequired, writesGameDirectory: true }),
            execution: {
                enabled: true,
                writesAttempted: true,
                writesCompleted: true,
            },
            receipt: {
                destination: {
                    path: target.destinationPath,
                    dllSha256: destinationSha256,
                    bytes: (await stat(target.destinationPath)).size,
                },
                backup: {
                    required: backupRequired,
                    created: backupCreated,
                    path: backupCreated ? target.backupPath : "",
                },
                manifest: {
                    written: true,
                    path: target.manifestPath,
                },
                rollback: {
                    attempted: false,
                },
            },
        });
    } catch (error) {
        const rollback = await rollbackDestination({ target, backupCreated, destinationWritten });
        return executionResult(base, {
            ok: false,
            status: "execution_failed",
            summary: error instanceof Error ? error.message : String(error),
            rollback,
            warnings: ["Install execution failed; rollback was attempted."],
        });
    }
}

function validateBeforeWrite({ base, confirmation, platform, gameProcess, executionEnabled, backupRequired }) {
    if (!platform.installExecutionSupported) {
        return {
            status: "platform_unsupported",
            summary: platformUnsupportedInstallSummary(platform),
            warnings: base.warnings.includes(platform.unsupportedReason) ? [] : [platform.unsupportedReason],
        };
    }

    if (!confirmation || confirmation.status !== "ready_for_confirmation") {
        return {
            status: "confirmation_not_ready",
            summary: confirmation?.summary ?? "Install confirmation is not ready for execution.",
            warnings: ["Install confirmation must be prepared before execution."],
        };
    }

    if (!executionEnabled) {
        return {
            status: "execution_disabled",
            summary: "Install execution is disabled; no files were changed.",
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
            summary: "Close Star Trek Fleet Command before installing or replacing version.dll.",
            warnings: ["prime.exe is running."],
        };
    }

    if (!base.staged.path || !base.staged.dllSha256) {
        return {
            status: "staged_dll_unavailable",
            summary: "Staged version.dll path and SHA-256 are required before execution.",
            warnings: ["Staged DLL details are incomplete."],
        };
    }

    if (!isSafeTarget(base.target)) {
        return {
            status: "unsafe_target_path",
            summary: "Install target paths are not inside the selected game directory boundary.",
            warnings: ["Destination, backup, or manifest path failed safety validation."],
        };
    }

    if (backupRequired && !base.target.backupPath) {
        return {
            status: "backup_path_unavailable",
            summary: "A backup is required, but no backup path was provided.",
            warnings: ["Backup path is required before replacement."],
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

function executionSafety({ backupRequired, writesGameDirectory }) {
    return {
        writesGameDirectory,
        writesSidecarCache: false,
        executionTimeGameProcessCheckRequired: true,
        backupBeforeReplace: backupRequired,
        stagedHashVerificationRequired: true,
        postCopyHashVerificationRequired: true,
        manifestWriteRequired: true,
    };
}

function normalizeTarget(target = {}) {
    return {
        gameDirectory: stringOrEmpty(target.gameDirectory),
        destinationPath: stringOrEmpty(target.destinationPath),
        backupPath: stringOrEmpty(target.backupPath),
        manifestPath: stringOrEmpty(target.manifestPath),
    };
}

function normalizeStaged(staged = {}) {
    return {
        path: stringOrEmpty(staged.path),
        bytes: Number.isFinite(staged.bytes) ? staged.bytes : 0,
        dllSha256: normalizeSha256(staged.dllSha256),
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

function isSafeTarget(target) {
    if (!target.gameDirectory || !target.destinationPath || !target.manifestPath) {
        return false;
    }

    const gameDirectory = path.resolve(target.gameDirectory);
    const destinationPath = path.resolve(target.destinationPath);
    const expectedDestination = path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE);
    if (destinationPath !== expectedDestination) {
        return false;
    }

    const expectedManifestPath = communityModInstallManifestPath(gameDirectory);
    if (path.resolve(target.manifestPath) !== expectedManifestPath) {
        return false;
    }

    if (target.backupPath) {
        const backupRoot = path.join(gameDirectory, ".stfc-sidecar", "backups");
        return isInsideDirectory(backupRoot, target.backupPath);
    }

    return true;
}

function isInsideDirectory(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function rollbackDestination({ target, backupCreated, destinationWritten }) {
    const rollback = {
        attempted: backupCreated || destinationWritten,
        restoredBackup: false,
        removedDestination: false,
        error: "",
    };

    if (!rollback.attempted) {
        return rollback;
    }

    try {
        if (backupCreated) {
            await copyFile(target.backupPath, target.destinationPath);
            rollback.restoredBackup = true;
        } else if (destinationWritten) {
            await rm(target.destinationPath, { force: true });
            rollback.removedDestination = true;
        }
    } catch (error) {
        rollback.error = error instanceof Error ? error.message : String(error);
    }

    return rollback;
}

function buildInstallManifest({ confirmation, target, backupCreated, backupSha256, dllSha256, installedAt }) {
    const catalog = confirmation.artifactStaging?.catalog ?? confirmation.installPlan?.catalog ?? null;
    const previousInstall = confirmation.installPlan?.install ?? null;
    const backupRequired = confirmation.safety?.backupBeforeReplace === true || REPLACE_ACTIONS.has(confirmation.action);
    return {
        schemaVersion: 2,
        distribution: catalog?.distribution ?? distributionFromProfile(confirmation.profile),
        action: stringOrEmpty(confirmation.action),
        repo: catalog?.repository ?? "",
        tag: catalog?.release?.tagName ?? confirmation.installPlan?.target?.tag ?? "",
        assetName: catalog?.windowsAsset?.name ?? confirmation.installPlan?.target?.assetName ?? "",
        dllSha256,
        destinationPath: stringOrEmpty(target?.destinationPath),
        manifestPath: stringOrEmpty(target?.manifestPath),
        backup: {
            required: backupRequired,
            created: backupCreated === true,
            path: backupCreated ? stringOrEmpty(target?.backupPath) : "",
            sha256: normalizeSha256(backupSha256),
        },
        previous: {
            classification: stringOrEmpty(previousInstall?.classification),
            profile: stringOrEmpty(previousInstall?.profile),
            dllSha256: normalizeSha256(previousInstall?.dll?.sha256),
            tag: previousInstall?.matchedRelease?.tag || previousInstall?.manifest?.tag || "",
            assetName: previousInstall?.matchedRelease?.assetName || previousInstall?.manifest?.assetName || "",
        },
        sidecarVersion: stringOrEmpty(process.env.STFC_SIDECAR_APP_VERSION),
        installedAt,
    };
}

function distributionFromProfile(profile) {
    return profile === "guff-advanced" ? "advanced-alpha" : "official-basic";
}

function executionStatus(action) {
    return action === "install" ? "installed" : "replaced";
}

function executionSummary(action, backupCreated) {
    const backup = backupCreated ? " Existing version.dll was backed up first." : "";
    return `${action === "install" ? "Installed" : "Replaced"} Community Mod version.dll and verified the copied hash.${backup}`;
}

async function sha256File(filePath) {
    const hash = createHash("sha256");
    hash.update(await readFile(filePath));
    return hash.digest("hex").toUpperCase();
}

async function fileExists(filePath) {
    try {
        await access(filePath, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function normalizeSha256(value) {
    return String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
}

function parseBooleanFlag(value) {
    return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
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