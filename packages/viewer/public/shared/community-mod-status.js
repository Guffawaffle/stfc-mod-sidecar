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

    if (install.state === "unsupported_platform") {
        return "Platform unsupported";
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

    if (install.state === "unsupported_platform") {
        return install.summary ?? install.platform?.unsupportedReason ?? "Community Mod install/update is not supported on this platform.";
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

    if (install.state === "unsupported_platform") {
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

    if (plan.status === "platform_unsupported") {
        return "Platform unsupported";
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

export function communityModArtifactStagingLabel(staging) {
    if (!staging) {
        return "version.dll not staged";
    }

    if (staging.ok === false || staging.status === "error") {
        return "Staging failed";
    }

    switch (staging.status) {
        case "staged":
            return "version.dll staged";
        case "artifact_not_verified":
            return "Artifact not verified";
        case "artifact_cache_mismatch":
            return "Cached artifact mismatch";
        case "unsafe_zip_entries":
            return "Unsafe zip entries detected";
        case "missing_expected_dll":
            return "version.dll missing from artifact";
        default:
            return "Staging unavailable";
    }
}

export function communityModArtifactStagingSummary(staging) {
    if (!staging) {
        return "Prepare Confirmation stages the verified version.dll in the sidecar cache.";
    }

    if (staging.ok === false) {
        return String(staging.error ?? "Community Mod artifact staging failed.");
    }

    const sha = staging.staged?.dllSha256 ? ` | DLL SHA-256 ${shortSha256(staging.staged.dllSha256)}` : "";
    const bytes = Number.isFinite(staging.staged?.bytes) ? ` | ${staging.staged.bytes} bytes` : "";
    const sidecarOnly = staging.safety?.writesGameDirectory === false ? " | sidecar cache only" : "";
    return `${staging.summary ?? "Artifact staging unavailable."}${sha}${bytes}${sidecarOnly}`;
}

export function communityModInstallConfirmationLabel(confirmation) {
    if (!confirmation) {
        return "Confirmation not prepared";
    }

    if (confirmation.ok === false || confirmation.status === "error") {
        return "Confirmation failed";
    }

    switch (confirmation.status) {
        case "ready_for_confirmation":
            return "Confirmation ready";
        case "game_running":
            return "Close STFC first";
        case "artifact_not_staged":
        case "artifact_cache_mismatch":
            return "Staged DLL required";
        case "game_directory_unavailable":
            return "Game directory required";
        case "platform_unsupported":
            return "Platform unsupported";
        default:
            return "Confirmation blocked";
    }
}

export function communityModInstallConfirmationSummary(confirmation) {
    if (!confirmation) {
        return "Prepare Confirmation builds the final review text without copying files.";
    }

    if (confirmation.ok === false) {
        return String(confirmation.error ?? "Community Mod install confirmation failed.");
    }

    const staged = confirmation.staged?.dllSha256 ? ` | Staged SHA-256 ${shortSha256(confirmation.staged.dllSha256)}` : "";
    const destination = confirmation.target?.destinationPath ? ` | Destination ${confirmation.target.destinationPath}` : "";
    const backup = confirmation.target?.backupPath ? ` | Backup ${confirmation.target.backupPath}` : "";
    const execution = confirmation.execution?.enabled === false ? " | copy disabled" : "";
    return `${confirmation.summary ?? "Install confirmation unavailable."}${staged}${destination}${backup}${execution}`;
}

export function communityModInstallExecutionLabel(execution) {
    if (!execution) {
        return "Execution not run";
    }

    if (execution.ok === false || execution.status === "error" || execution.status === "execution_failed") {
        return "Execution failed";
    }

    switch (execution.status) {
        case "installed":
            return "Community Mod installed";
        case "replaced":
            return "version.dll replaced";
        case "server_execution_disabled":
        case "execution_disabled":
            return "Execution disabled";
        case "game_running":
            return "Close STFC first";
        case "acknowledgement_required":
        case "staged_hash_confirmation_required":
        case "destination_confirmation_required":
            return "Confirmation required";
        case "staged_hash_mismatch":
        case "post_copy_hash_mismatch":
            return "Hash verification failed";
        case "unsafe_target_path":
            return "Target path blocked";
        case "platform_unsupported":
            return "Platform unsupported";
        case "destination_exists_for_install":
        case "destination_missing_for_backup":
        case "backup_path_unavailable":
            return "Destination blocked";
        default:
            return "Execution blocked";
    }
}

export function communityModInstallExecutionSummary(execution) {
    if (!execution) {
        return "Execute Install is available only after confirmation and remains disabled unless the local endpoint is explicitly enabled.";
    }

    if (execution.ok === false && execution.error) {
        return String(execution.error);
    }

    const destination = execution.receipt?.destination?.dllSha256
        ? ` | Installed SHA-256 ${shortSha256(execution.receipt.destination.dllSha256)}`
        : execution.target?.destinationPath
            ? ` | Destination ${execution.target.destinationPath}`
            : "";
    const backup = execution.receipt?.backup?.created && execution.receipt.backup.path
        ? ` | Backup ${execution.receipt.backup.path}`
        : "";
    const manifest = execution.receipt?.manifest?.written && execution.receipt.manifest.path
        ? ` | Manifest ${execution.receipt.manifest.path}`
        : "";
    const writes = execution.safety?.writesGameDirectory === false || execution.execution?.writesAttempted === false
        ? " | no game-directory write attempted"
        : "";
    return `${execution.summary ?? "Install execution status unavailable."}${destination}${backup}${manifest}${writes}`;
}

export function communityModInstallExecutionRecoverySummary(execution) {
    if (!execution) {
        return "No recovery action is needed before execution runs.";
    }

    if (execution.execution?.writesAttempted === false || execution.safety?.writesGameDirectory === false) {
        return "No files were changed. Resolve the blocker, refresh status, and prepare confirmation again.";
    }

    const rollback = execution.rollback ?? execution.receipt?.rollback ?? null;
    if (rollback?.error) {
        const backup = execution.target?.backupPath ? ` Restore backup ${execution.target.backupPath} over the destination after closing STFC.` : "";
        return `Rollback needs manual attention: ${rollback.error}.${backup}`;
    }

    if (rollback?.restoredBackup) {
        return "Rollback restored the previous version.dll. Review the failure before retrying.";
    }

    if (rollback?.removedDestination) {
        return "Rollback removed the partial version.dll. Refresh status before retrying.";
    }

    if (execution.status === "replaced" && execution.receipt?.backup?.path) {
        return `Rollback available: close STFC and restore backup ${execution.receipt.backup.path} over the destination version.dll.`;
    }

    if (execution.status === "installed") {
        return "Rollback available: close STFC, remove version.dll, and remove the sidecar install manifest.";
    }

    return "If files changed, close STFC and use the execution receipt before retrying.";
}

export function communityModUninstallPlanLabel(plan) {
    if (!plan) {
        return "Uninstall plan not checked";
    }

    if (plan.ok === false || plan.status === "error") {
        return "Uninstall plan unavailable";
    }

    switch (plan.status) {
        case "fresh_install_removable":
            return "Sidecar install removable";
        case "replacement_restore_available":
            return "Rollback available";
        case "unknown_install_removable":
        case "manual_install_removable":
            return "Removal available";
        case "game_directory_required":
            return "Game directory required";
        case "no_install_detected":
            return "Nothing to uninstall";
        case "game_running":
            return "Close STFC first";
        case "stale_manifest":
            return "Manifest stale";
        case "platform_unsupported":
            return "Platform unsupported";
        default:
            return plan.actionLabel ?? "No uninstall action";
    }
}

export function communityModUninstallPlanSummary(plan) {
    if (!plan) {
        return "Check Uninstall Plan to inspect removable Community Mod state.";
    }

    if (plan.ok === false) {
        return String(plan.error ?? "Community Mod uninstall plan is unavailable.");
    }

    const destination = plan.target?.destinationPath ? ` | Destination ${plan.target.destinationPath}` : "";
    const backup = plan.target?.backupPath ? ` | Backup ${plan.target.backupPath}` : "";
    const settings = settingsRetentionSummary(plan.settings);
    const warnings = Array.isArray(plan.warnings) && plan.warnings.length > 0 ? ` | ${plan.warnings.join(" | ")}` : "";
    return `${plan.summary ?? "Uninstall plan unavailable."}${destination}${backup}${settings}${warnings}`;
}

export function communityModUninstallConfirmationLabel(confirmation) {
    if (!confirmation) {
        return "Uninstall confirmation not prepared";
    }

    if (confirmation.ok === false || confirmation.status === "error") {
        return "Uninstall confirmation failed";
    }

    switch (confirmation.status) {
        case "ready_for_confirmation":
            return "Uninstall confirmation ready";
        case "game_running":
            return "Close STFC first";
        case "target_unavailable":
            return "Uninstall target unavailable";
        case "backup_path_unavailable":
        case "backup_hash_unavailable":
            return "Backup required";
        case "platform_unsupported":
            return "Platform unsupported";
        default:
            return "Uninstall confirmation blocked";
    }
}

export function communityModUninstallConfirmationSummary(confirmation) {
    if (!confirmation) {
        return "Prepare Uninstall builds the final review text without changing files.";
    }

    if (confirmation.ok === false) {
        return String(confirmation.error ?? "Community Mod uninstall confirmation failed.");
    }

    const current = confirmation.current?.dllSha256 ? ` | Current SHA-256 ${shortSha256(confirmation.current.dllSha256)}` : "";
    const destination = confirmation.target?.destinationPath ? ` | Destination ${confirmation.target.destinationPath}` : "";
    const backup = confirmation.target?.backupPath ? ` | Backup ${confirmation.target.backupPath}` : "";
    const settings = settingsRetentionSummary(confirmation.settings);
    return `${confirmation.summary ?? "Uninstall confirmation unavailable."}${current}${destination}${backup}${settings}`;
}

export function communityModUninstallExecutionLabel(execution) {
    if (!execution) {
        return "Uninstall execution not run";
    }

    if (execution.ok === false || execution.status === "error" || execution.status === "execution_failed") {
        return "Uninstall failed";
    }

    switch (execution.status) {
        case "removed":
            return "Community Mod removed";
        case "restored_backup":
            return "Previous DLL restored";
        case "server_execution_disabled":
        case "execution_disabled":
            return "Uninstall disabled";
        case "game_running":
            return "Close STFC first";
        case "acknowledgement_required":
        case "current_hash_confirmation_required":
        case "destination_confirmation_required":
        case "settings_cleanup_confirmation_required":
            return "Confirmation required";
        case "current_hash_mismatch":
        case "backup_hash_mismatch":
        case "post_restore_hash_mismatch":
            return "Hash verification failed";
        case "unsafe_target_path":
            return "Target path blocked";
        case "unsafe_settings_cleanup_path":
            return "Cleanup path blocked";
        case "platform_unsupported":
            return "Platform unsupported";
        default:
            return "Uninstall blocked";
    }
}

export function communityModUninstallExecutionSummary(execution) {
    if (!execution) {
        return "Execute Uninstall is available after confirmation and endpoint enablement.";
    }

    if (execution.ok === false && execution.error) {
        return String(execution.error);
    }

    const destination = execution.receipt?.destination?.dllSha256
        ? ` | DLL SHA-256 ${shortSha256(execution.receipt.destination.dllSha256)}`
        : execution.target?.destinationPath
            ? ` | Destination ${execution.target.destinationPath}`
            : "";
    const backup = execution.receipt?.backup?.path ? ` | Backup ${execution.receipt.backup.path}` : "";
    const settings = settingsRetentionSummary(execution.receipt?.settings ?? execution.settings);
    const writes = execution.safety?.writesGameDirectory === false || execution.execution?.writesAttempted === false
        ? " | no game-directory write attempted"
        : "";
    return `${execution.summary ?? "Uninstall execution status unavailable."}${destination}${backup}${settings}${writes}`;
}

export function communityModUninstallExecutionRecoverySummary(execution) {
    if (!execution) {
        return "No uninstall recovery action is needed before execution runs.";
    }

    if (execution.execution?.writesAttempted === false || execution.safety?.writesGameDirectory === false) {
        return "No files were changed. Resolve the blocker, refresh status, and prepare uninstall again.";
    }

    if (execution.status === "restored_backup") {
        return "Previous version.dll was restored. Refresh status before another install or uninstall action.";
    }

    if (execution.status === "removed") {
        return "Fresh sidecar install was removed. Reinstall from the companion when needed.";
    }

    return "If files changed, close STFC and use the execution receipt before retrying.";
}

export function modProfileLabel(profile) {
    return normalizeModProfile(profile) === "netniv-basic" ? "Official Basic" : "Advanced Alpha";
}

export function normalizeModProfile(profile) {
    return String(profile ?? "").toLowerCase() === "netniv-basic" ? "netniv-basic" : "guff-advanced";
}

function settingsRetentionSummary(settings) {
    if (!settings) {
        return "";
    }

    if (settings.deleted === true || settings.delete === true || settings.policy === "delete_settings_and_logs") {
        const count = Number.isFinite(settings.deletedCount) && settings.deletedCount > 0 ? ` (${settings.deletedCount} files)` : "";
        return ` | Settings/logs deleted${count}`;
    }

    return " | Settings/logs left untouched";
}

function shortSha256(value) {
    const normalized = String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
    return normalized.length > 12 ? `${normalized.slice(0, 12)}...` : normalized;
}