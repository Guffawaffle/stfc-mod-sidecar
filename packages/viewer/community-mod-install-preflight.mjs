import { spawn } from "node:child_process";
import path from "node:path";

import {
    buildCommunityModInstallPlatformCapability,
    platformUnsupportedInstallSummary,
} from "./community-mod-install-platform.mjs";

const ACTIONS_REQUIRING_PREFLIGHT = new Set([
    "install",
    "update",
    "reinstall",
    "replace_unknown",
    "replace_profile",
]);

export function buildCommunityModInstallPreflight(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const installPlan = options.installPlan ?? null;
    const artifactVerification = options.artifactVerification ?? null;
    const platform = options.platformCapability
        ?? installPlan?.platform
        ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const gameProcess = normalizeGameProcessStatus(options.gameProcess);
    const base = {
        ok: true,
        checkedAt,
        profile: installPlan?.profile ?? "unknown",
        platform,
        installPlan,
        artifactVerification,
        gameProcess,
        safety: installPreflightSafety(),
        execution: installPreflightExecution(platform),
        warnings: [...(installPlan?.warnings ?? [])],
    };

    if (!installPlan || installPlan.ok === false) {
        return installPreflightResult(base, {
            status: "install_plan_unavailable",
            action: "inspect",
            summary: String(installPlan?.error ?? "Community Mod install plan is unavailable."),
        });
    }

    if (!platform.installExecutionSupported) {
        return installPreflightResult(base, {
            status: "platform_unsupported",
            action: "none",
            summary: platformUnsupportedInstallSummary(platform),
            warnings: base.warnings.includes(platform.unsupportedReason) ? [] : [platform.unsupportedReason],
        });
    }

    if (!ACTIONS_REQUIRING_PREFLIGHT.has(installPlan.action)) {
        return installPreflightResult(base, {
            status: "no_install_action",
            action: installPlan.action ?? "none",
            summary: installPlan.summary ?? "No Community Mod install action is currently available.",
        });
    }

    if (!gameProcess.checked) {
        return installPreflightResult(base, {
            status: "game_process_check_unavailable",
            action: "inspect",
            summary: gameProcess.error
                ? `STFC process status could not be checked: ${gameProcess.error}`
                : "STFC process status could not be checked; install cannot proceed.",
            warnings: ["Game process status is unknown."],
        });
    }

    if (gameProcess.running) {
        return installPreflightResult(base, {
            status: "game_running",
            action: "stop_game",
            summary: "Close Star Trek Fleet Command before installing or replacing version.dll.",
            warnings: ["prime.exe is running."],
        });
    }

    if (!artifactVerification || artifactVerification.status !== "verified") {
        return installPreflightResult(base, {
            status: "artifact_not_verified",
            action: "verify_artifact",
            summary: artifactVerification?.summary
                ?? "Verify the Community Mod artifact before install preflight can proceed.",
            warnings: artifactVerification?.status ? [`Artifact status is ${artifactVerification.status}.`] : [],
        });
    }

    if (artifactVerification.safety?.writesGameDirectory) {
        return installPreflightResult(base, {
            status: "unsafe_artifact_verification",
            action: "inspect",
            summary: "Artifact verification reported a game-directory write path; install cannot proceed.",
            warnings: ["Artifact verification safety boundary changed unexpectedly."],
        });
    }

    return installPreflightResult(base, {
        status: "ready_for_confirmation",
        action: installPlan.action,
        summary: `${installPlan.actionLabel} is ready for explicit confirmation. No files have been changed.`,
        confirmation: {
            required: true,
            action: installPlan.action,
            title: installPlan.actionLabel,
            backupRequired: installPlan.action !== "install",
        },
    });
}

export async function detectStfcGameProcess(options = {}) {
    const targetExecutablePath = targetGameExecutablePath(options.gameDirectory ?? options.gameDir ?? options.targetGameDirectory);

    if (typeof options.detectGameProcess === "function") {
        return normalizeGameProcessStatus(await options.detectGameProcess({ targetExecutablePath }), { targetExecutablePath });
    }

    const platform = buildCommunityModInstallPlatformCapability({ platform: options.platform });
    if (!platform.gameProcessDetectionSupported) {
        return normalizeGameProcessStatus({
            checked: false,
            running: false,
            processName: platform.gameProcessName,
            error: `${platform.displayName} STFC process detection is not implemented yet.`,
        }, { targetExecutablePath });
    }

    const command = `
$matches = @(Get-Process -Name prime -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path)
[pscustomobject]@{
  checked = $true
  running = $matches.Count -gt 0
  processName = 'prime.exe'
  matches = $matches
} | ConvertTo-Json -Compress -Depth 4
`.trim();

    try {
        const output = await runPowerShell(command);
        const parsed = JSON.parse(output);
        return normalizeGameProcessStatus(parsed, { targetExecutablePath });
    } catch (error) {
        return normalizeGameProcessStatus({
            checked: false,
            running: false,
            processName: "prime.exe",
            error: error instanceof Error ? error.message : String(error),
        }, { targetExecutablePath });
    }
}

function installPreflightResult(base, result) {
    return {
        ...base,
        ...result,
        confirmation: result.confirmation ?? {
            required: false,
            action: result.action ?? "none",
            title: "No confirmation available",
            backupRequired: false,
        },
        warnings: [...base.warnings, ...(result.warnings ?? [])],
    };
}

function installPreflightSafety() {
    return {
        dryRun: true,
        writesGameDirectory: false,
        userConfirmationRequired: true,
        gameProcessMustBeStopped: true,
        backupBeforeReplace: true,
        hashVerificationRequired: true,
    };
}

function installPreflightExecution(platform) {
    return {
        enabled: false,
        reason: platform?.installExecutionSupported === false
            ? platformUnsupportedInstallSummary(platform)
            : "Install execution is gated by confirmation and the local execution endpoint.",
    };
}

function normalizeGameProcessStatus(value = {}, options = {}) {
    const rawMatches = Array.isArray(value.matches)
        ? value.matches
        : value.matches && typeof value.matches === "object"
            ? [value.matches]
            : [];
    const allMatches = rawMatches.map(normalizeProcessMatch);
    const targetExecutablePath = stringOrEmpty(options.targetExecutablePath)
        || stringOrEmpty(value.targetExecutablePath)
        || stringOrEmpty(value.targetPath);
    const scopedToTarget = Boolean(targetExecutablePath);
    const scopedMatches = scopedToTarget
        ? allMatches.filter((match) => sameExecutablePath(match.path, targetExecutablePath))
        : allMatches;
    const scopedCheckMissingPath = scopedToTarget
        && (allMatches.some((match) => !match.path) || (Boolean(value.running) && allMatches.length === 0));
    const checked = Boolean(value.checked) && !scopedCheckMissingPath;
    const error = scopedCheckMissingPath
        ? "One or more prime.exe processes did not expose an executable path; scoped process status cannot be checked safely."
        : typeof value.error === "string" ? value.error : "";

    return {
        checked,
        running: checked
            ? scopedToTarget ? scopedMatches.length > 0 : Boolean(value.running)
            : false,
        processName: typeof value.processName === "string" ? value.processName : "prime.exe",
        matches: scopedMatches,
        scopedToTarget,
        targetPath: targetExecutablePath,
        candidateCount: allMatches.length,
        error,
    };
}

function targetGameExecutablePath(gameDirectory) {
    const normalizedGameDirectory = stringOrEmpty(gameDirectory);
    return normalizedGameDirectory ? path.join(path.resolve(normalizedGameDirectory), "prime.exe") : "";
}

function sameExecutablePath(left, right) {
    return normalizeProcessPathForCompare(left) === normalizeProcessPathForCompare(right);
}

function normalizeProcessPathForCompare(value) {
    return stringOrEmpty(value).replaceAll("/", "\\").replace(/\\+$/g, "").toLowerCase();
}

function normalizeProcessMatch(match = {}) {
    const entry = match && typeof match === "object" ? match : {};
    return {
        pid: Number.isInteger(entry.pid) ? entry.pid : Number.isInteger(entry.Id) ? entry.Id : null,
        name: stringOrEmpty(entry.name) || stringOrEmpty(entry.ProcessName),
        path: stringOrEmpty(entry.path) || stringOrEmpty(entry.Path),
    };
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}

function runPowerShell(command) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
            { windowsHide: true },
        );
        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
            }
        });
    });
}

function stringOrEmpty(value) {
    return typeof value === "string" ? value : "";
}