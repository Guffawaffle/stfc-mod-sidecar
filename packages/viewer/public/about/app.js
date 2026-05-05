import {
    communityModInstallLabel,
    communityModInstallSummary,
    communityModReleaseLabel,
    communityModReleaseSummary,
    communityModInstallPlanLabel,
    communityModInstallPlanSummary,
    communityModArtifactVerificationLabel,
    communityModArtifactVerificationSummary,
    communityModArtifactStagingLabel,
    communityModArtifactStagingSummary,
    communityModInstallConfirmationLabel,
    communityModInstallConfirmationSummary,
    communityModInstallExecutionLabel,
    communityModInstallExecutionSummary,
    communityModInstallExecutionRecoverySummary,
    communityModUninstallPlanLabel,
    communityModUninstallPlanSummary,
    communityModUninstallConfirmationLabel,
    communityModUninstallConfirmationSummary,
    communityModUninstallExecutionLabel,
    communityModUninstallExecutionSummary,
    communityModUninstallExecutionRecoverySummary,
} from "../shared/community-mod-status.js";

const state = {
    bootstrap: null,
    modeChanging: false,
    pendingDeveloperMode: null,
    modReleaseCatalog: null,
    modInstallPlan: null,
    modArtifactVerification: null,
    modArtifactStaging: null,
    modInstallConfirmation: null,
    modInstallExecution: null,
    modUninstallPlan: null,
    modUninstallConfirmation: null,
    modUninstallExecution: null,
    modUninstallDeleteSettingsAndLogs: false,
    githubNetworkConsent: false,
    modReleaseChecking: false,
    modArtifactVerifying: false,
    modInstallConfirming: false,
    modInstallExecuting: false,
    modUninstallChecking: false,
    modUninstallConfirming: false,
    modUninstallExecuting: false,
};

const elements = {
    developerModeOption: document.querySelector("#about-developer-mode-option"),
    developerModeToggle: document.querySelector("#about-developer-mode-toggle"),
    developerModeState: document.querySelector("#about-developer-mode-state"),
    releaseVersion: document.querySelector("#about-release-version"),
    releaseChannel: document.querySelector("#about-release-channel"),
    signaturePolicy: document.querySelector("#about-signature-policy"),
    updateMode: document.querySelector("#about-update-mode"),
    releaseUpdateState: document.querySelector("#about-release-update-state"),
    checkReleaseUpdate: document.querySelector("#check-release-update"),
    releaseUpdateLink: document.querySelector("#about-release-update-link"),
    modInstallTitle: document.querySelector("#about-mod-install-title"),
    modInstallState: document.querySelector("#about-mod-install-state"),
    modInstallDetail: document.querySelector("#about-mod-install-detail"),
    modReleaseState: document.querySelector("#about-mod-release-state"),
    modReleaseDetail: document.querySelector("#about-mod-release-detail"),
    modPlanState: document.querySelector("#about-mod-plan-state"),
    modPlanDetail: document.querySelector("#about-mod-plan-detail"),
    modArtifactState: document.querySelector("#about-mod-artifact-state"),
    modArtifactDetail: document.querySelector("#about-mod-artifact-detail"),
    modStagingState: document.querySelector("#about-mod-staging-state"),
    modStagingDetail: document.querySelector("#about-mod-staging-detail"),
    modConfirmationState: document.querySelector("#about-mod-confirmation-state"),
    modConfirmationDetail: document.querySelector("#about-mod-confirmation-detail"),
    modExecutionState: document.querySelector("#about-mod-execution-state"),
    modExecutionDetail: document.querySelector("#about-mod-execution-detail"),
    modRecoveryDetail: document.querySelector("#about-mod-recovery-detail"),
    modUninstallPlanState: document.querySelector("#about-mod-uninstall-plan-state"),
    modUninstallPlanDetail: document.querySelector("#about-mod-uninstall-plan-detail"),
    modUninstallConfirmationState: document.querySelector("#about-mod-uninstall-confirmation-state"),
    modUninstallConfirmationDetail: document.querySelector("#about-mod-uninstall-confirmation-detail"),
    modUninstallExecutionState: document.querySelector("#about-mod-uninstall-execution-state"),
    modUninstallExecutionDetail: document.querySelector("#about-mod-uninstall-execution-detail"),
    modUninstallRecoveryDetail: document.querySelector("#about-mod-uninstall-recovery-detail"),
    modUninstallDeleteSettingsAndLogs: document.querySelector("#about-mod-uninstall-delete-settings-logs"),
    refreshModStatus: document.querySelector("#refresh-mod-status"),
    checkModRelease: document.querySelector("#check-mod-release"),
    verifyModArtifact: document.querySelector("#verify-mod-artifact"),
    prepareModConfirmation: document.querySelector("#prepare-mod-confirmation"),
    executeModInstall: document.querySelector("#execute-mod-install"),
    checkModUninstall: document.querySelector("#check-mod-uninstall"),
    prepareModUninstall: document.querySelector("#prepare-mod-uninstall"),
    executeModUninstall: document.querySelector("#execute-mod-uninstall"),
    modReleaseLink: document.querySelector("#about-mod-release-link"),
    diagnosticsState: document.querySelector("#diagnostics-state"),
    diagnosticsPreview: document.querySelector("#diagnostics-preview"),
    previewDiagnostics: document.querySelector("#preview-diagnostics"),
    copyDiagnostics: document.querySelector("#copy-diagnostics"),
    downloadDiagnostics: document.querySelector("#download-diagnostics"),
    confirmationDialog: document.querySelector("#about-confirmation-dialog"),
    confirmationDialogTitle: document.querySelector("#about-confirmation-dialog-title"),
    confirmationDialogMessage: document.querySelector("#about-confirmation-dialog-message"),
    confirmationDialogChecks: document.querySelector("#about-confirmation-dialog-checks"),
    confirmationDialogConfirm: document.querySelector("#about-confirmation-dialog-confirm"),
};

elements.developerModeToggle?.addEventListener("change", () => void setDeveloperMode(elements.developerModeToggle.checked));
elements.previewDiagnostics?.addEventListener("click", () => void previewDiagnostics());
elements.copyDiagnostics?.addEventListener("click", () => void copyDiagnostics());
elements.downloadDiagnostics?.addEventListener("click", () => void downloadDiagnostics());
elements.checkReleaseUpdate?.addEventListener("click", () => void checkReleaseUpdate());
elements.refreshModStatus?.addEventListener("click", () => void refreshModStatus());
elements.checkModRelease?.addEventListener("click", () => void checkModRelease());
elements.verifyModArtifact?.addEventListener("click", () => void verifyModArtifact());
elements.prepareModConfirmation?.addEventListener("click", () => void prepareModInstallConfirmation());
elements.executeModInstall?.addEventListener("click", () => void executeModInstall());
elements.checkModUninstall?.addEventListener("click", () => void checkModUninstall());
elements.prepareModUninstall?.addEventListener("click", () => void prepareModUninstallConfirmation());
elements.executeModUninstall?.addEventListener("click", () => void executeModUninstall());
elements.modUninstallDeleteSettingsAndLogs?.addEventListener("change", () => {
    state.modUninstallDeleteSettingsAndLogs = elements.modUninstallDeleteSettingsAndLogs.checked;
    state.modUninstallConfirmation = null;
    state.modUninstallExecution = null;
    renderCommunityModStatus();
});

await loadMode();

async function loadMode() {
    try {
        state.bootstrap = window.stfcDesktop?.getBootstrap ? await window.stfcDesktop.getBootstrap() : await loadServerMode();
    } catch (error) {
        state.bootstrap = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    renderMode();
    renderRelease();
    renderCommunityModStatus();
}

async function loadServerMode() {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
        return null;
    }

    const health = await response.json();
    return {
        desktop: false,
        developerMode: Boolean(health.developerMode),
        companionMode: health.companionMode,
        modeLabel: modeLabel(health.developerMode),
        modProfile: health.modProfile,
        settingsProfile: health.settingsProfile,
        communityModInstall: health.communityModInstall,
        release: health.release,
    };
}

async function setDeveloperMode(enabled) {
    const previous = Boolean(state.bootstrap?.developerMode);
    if (!window.stfcDesktop?.setDeveloperMode) {
        renderMode();
        return;
    }

    if (enabled && !previous) {
        const confirmed = window.confirm("Enable Developer Tools? Advanced diagnostics and raw event surfaces will be visible until you turn them off.");
        if (!confirmed) {
            renderMode();
            return;
        }
    }

    state.modeChanging = true;
    state.pendingDeveloperMode = enabled;
    renderMode();

    try {
        const bootstrap = await window.stfcDesktop.setDeveloperMode(enabled);
        state.bootstrap = bootstrap;
        window.dispatchEvent(new CustomEvent("stfc:mode-changed", { detail: bootstrap }));
    } catch (error) {
        state.bootstrap = {
            ...state.bootstrap,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modeChanging = false;
        state.pendingDeveloperMode = null;
        renderMode();
    }
}

function renderMode() {
    const developerMode = state.pendingDeveloperMode ?? Boolean(state.bootstrap?.developerMode);
    const canPersistMode = Boolean(window.stfcDesktop?.setDeveloperMode);

    elements.developerModeOption.hidden = !canPersistMode;
    elements.developerModeToggle.checked = developerMode;
    elements.developerModeToggle.disabled = !canPersistMode || state.modeChanging;

    if (state.bootstrap?.error) {
        elements.developerModeState.textContent = state.bootstrap.error;
        return;
    }

    elements.developerModeState.textContent = state.modeChanging
        ? "Applying mode change..."
        : canPersistMode
            ? modeLabel(developerMode)
            : `${modeLabel(developerMode)} active`;
}

function modeLabel(developerMode) {
    return developerMode ? "Developer Tools" : "Standard Companion";
}

function renderRelease() {
    const release = state.bootstrap?.release;
    elements.releaseVersion.textContent = release?.version ? `Version ${release.version}` : "Version unknown";
    elements.releaseChannel.textContent = release?.channelLabel ? `${release.channelLabel} channel` : "Channel unknown";
    elements.signaturePolicy.textContent = release?.signatureLabel ?? "Signature expectation unknown";
    elements.updateMode.textContent = release?.updateLabel ?? "Update mode unknown";
}

async function refreshModStatus() {
    elements.refreshModStatus.disabled = true;
    try {
        await loadMode();
    } finally {
        elements.refreshModStatus.disabled = false;
    }
}

function renderCommunityModStatus() {
    const install = state.bootstrap?.communityModInstall;
    elements.modInstallTitle.textContent = communityModInstallLabel(install);
    elements.modInstallState.textContent = communityModInstallLabel(install);
    elements.modInstallDetail.textContent = communityModInstallSummary(install);
    elements.modReleaseState.textContent = communityModReleaseLabel(state.modReleaseCatalog);
    elements.modReleaseDetail.textContent = communityModReleaseSummary(state.modReleaseCatalog);
    elements.modPlanState.textContent = communityModInstallPlanLabel(state.modInstallPlan);
    elements.modPlanDetail.textContent = communityModInstallPlanSummary(state.modInstallPlan);
    elements.modArtifactState.textContent = communityModArtifactVerificationLabel(state.modArtifactVerification);
    elements.modArtifactDetail.textContent = communityModArtifactVerificationSummary(state.modArtifactVerification);
    elements.modStagingState.textContent = communityModArtifactStagingLabel(state.modArtifactStaging);
    elements.modStagingDetail.textContent = communityModArtifactStagingSummary(state.modArtifactStaging);
    elements.modConfirmationState.textContent = communityModInstallConfirmationLabel(state.modInstallConfirmation);
    elements.modConfirmationDetail.textContent = communityModInstallConfirmationSummary(state.modInstallConfirmation);
    elements.modExecutionState.textContent = communityModInstallExecutionLabel(state.modInstallExecution);
    elements.modExecutionDetail.textContent = communityModInstallExecutionSummary(state.modInstallExecution);
    elements.modRecoveryDetail.textContent = communityModInstallExecutionRecoverySummary(state.modInstallExecution);
    elements.modUninstallPlanState.textContent = communityModUninstallPlanLabel(state.modUninstallPlan);
    elements.modUninstallPlanDetail.textContent = communityModUninstallPlanSummary(state.modUninstallPlan);
    elements.modUninstallConfirmationState.textContent = communityModUninstallConfirmationLabel(state.modUninstallConfirmation);
    elements.modUninstallConfirmationDetail.textContent = communityModUninstallConfirmationSummary(state.modUninstallConfirmation);
    elements.modUninstallExecutionState.textContent = communityModUninstallExecutionLabel(state.modUninstallExecution);
    elements.modUninstallExecutionDetail.textContent = communityModUninstallExecutionSummary(state.modUninstallExecution);
    elements.modUninstallRecoveryDetail.textContent = communityModUninstallExecutionRecoverySummary(state.modUninstallExecution);
    elements.modUninstallDeleteSettingsAndLogs.checked = state.modUninstallDeleteSettingsAndLogs;
    elements.modUninstallDeleteSettingsAndLogs.disabled = state.modUninstallChecking
        || state.modUninstallConfirming
        || state.modUninstallExecuting;
    setModReleaseLink(state.modReleaseCatalog?.release?.htmlUrl);
    elements.checkModRelease.disabled = state.modReleaseChecking;
    elements.verifyModArtifact.disabled = state.modReleaseChecking
        || state.modArtifactVerifying
        || !state.modInstallPlan?.target?.assetName;
    elements.prepareModConfirmation.disabled = state.modReleaseChecking
        || state.modArtifactVerifying
        || state.modInstallConfirming
        || !state.modInstallPlan?.target?.assetName;
    elements.executeModInstall.disabled = state.modReleaseChecking
        || state.modArtifactVerifying
        || state.modInstallConfirming
        || state.modInstallExecuting
        || !isInstallExecutionReady(state.modInstallConfirmation);
    elements.checkModUninstall.disabled = state.modUninstallChecking;
    elements.prepareModUninstall.disabled = state.modUninstallChecking
        || state.modUninstallConfirming
        || !isUninstallPlanActionable(state.modUninstallPlan);
    elements.executeModUninstall.disabled = state.modUninstallChecking
        || state.modUninstallConfirming
        || state.modUninstallExecuting
        || !isUninstallExecutionReady(state.modUninstallConfirmation);
}

async function checkModRelease() {
    if (!await ensureGithubNetworkConsent()) {
        return;
    }

    state.modReleaseChecking = true;
    state.modReleaseCatalog = null;
    state.modInstallPlan = null;
    state.modArtifactVerification = null;
    state.modArtifactStaging = null;
    state.modInstallConfirmation = null;
    state.modInstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modInstallPlan = await fetchModInstallPlan();
        state.modReleaseCatalog = state.modInstallPlan.catalog ?? null;
    } catch (error) {
        state.modInstallPlan = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modReleaseChecking = false;
        renderCommunityModStatus();
    }
}

async function fetchModInstallPlan() {
    const profile = encodeURIComponent(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile ?? "");
    const response = await fetch(`/api/mod/install-plan?profile=${profile}`, modFetchOptions({ network: true }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod install plan failed: ${result.error}`
            : `Mod install plan failed: ${response.status}`);
    }

    return result;
}

function setModReleaseLink(url) {
    const safeUrl = safeGithubUrl(url);
    elements.modReleaseLink.hidden = !safeUrl;
    elements.modReleaseLink.href = safeUrl || "#";
}

async function checkReleaseUpdate() {
    if (!await ensureGithubNetworkConsent()) {
        setReleaseUpdateState("Update check cancelled");
        return;
    }

    elements.checkReleaseUpdate.disabled = true;
    setReleaseUpdateState("Checking updates...");
    setReleaseUpdateLink("");

    try {
        const result = await fetchReleaseUpdateCheck();
        renderReleaseUpdate(result);
    } catch (error) {
        setReleaseUpdateState(error instanceof Error ? error.message : String(error));
    } finally {
        elements.checkReleaseUpdate.disabled = false;
    }
}

async function fetchReleaseUpdateCheck() {
    const response = await fetch("/api/release/check", modFetchOptions({ network: true }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error ? `Update check failed: ${result.error}` : `Update check failed: ${response.status}`);
    }

    return result;
}

function renderReleaseUpdate(result) {
    if (result.status === "update_available") {
        setReleaseUpdateState(`${result.latest?.version ?? "New version"} available`);
        setReleaseUpdateLink(result.latest?.htmlUrl);
        return;
    }

    if (result.status === "up_to_date") {
        setReleaseUpdateState(`Current version is latest: ${result.latest?.version ?? "unknown"}`);
        setReleaseUpdateLink(result.latest?.htmlUrl);
        return;
    }

    if (result.status === "no_release") {
        setReleaseUpdateState("No release found for this channel");
        return;
    }

    if (result.status === "unavailable") {
        setReleaseUpdateState(result.error ?? "Release metadata unavailable");
        return;
    }

    setReleaseUpdateState("Update status unavailable");
}

function setReleaseUpdateState(message) {
    elements.releaseUpdateState.textContent = message;
}

function setReleaseUpdateLink(url) {
    const safeUrl = safeGithubUrl(url);
    elements.releaseUpdateLink.hidden = !safeUrl;
    elements.releaseUpdateLink.href = safeUrl || "#";
}

function safeGithubUrl(value) {
    const url = String(value ?? "").trim();
    return /^https:\/\/github\.com\/[^\s]+$/i.test(url) ? url : "";
}

async function previewDiagnostics() {
    setDiagnosticsState("Generating preview...");
    try {
        const bundle = await fetchDiagnosticsJson();
        elements.diagnosticsPreview.textContent = JSON.stringify(bundle, null, 2);
        elements.diagnosticsPreview.hidden = false;
        setDiagnosticsState("Preview ready");
    } catch (error) {
        setDiagnosticsState(error instanceof Error ? error.message : String(error));
    }
}

async function copyDiagnostics() {
    setDiagnosticsState("Generating Markdown...");
    try {
        const markdown = await fetchDiagnosticsMarkdown();
        await navigator.clipboard.writeText(markdown);
        setDiagnosticsState("Markdown copied");
    } catch (error) {
        setDiagnosticsState(error instanceof Error ? error.message : String(error));
    }
}

async function downloadDiagnostics() {
    setDiagnosticsState("Preparing download...");
    try {
        const bundle = await fetchDiagnosticsJson();
        const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `stfc-sidecar-diagnostics-${safeTimestamp(bundle.generatedAt)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setDiagnosticsState("Download ready");
    } catch (error) {
        setDiagnosticsState(error instanceof Error ? error.message : String(error));
    }
}

async function fetchDiagnosticsJson() {
    const response = await fetch("/api/diagnostics/bundle", { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Diagnostics request failed: ${response.status}`);
    }

    return response.json();
}

async function fetchDiagnosticsMarkdown() {
    const response = await fetch("/api/diagnostics/bundle?format=markdown", { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Diagnostics request failed: ${response.status}`);
    }

    return response.text();
}

function setDiagnosticsState(message) {
    elements.diagnosticsState.textContent = message;
}

function safeTimestamp(value) {
    return String(value ?? new Date().toISOString()).replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}

async function verifyModArtifact() {
    if (!await ensureGithubNetworkConsent()) {
        return;
    }

    state.modArtifactVerifying = true;
    state.modArtifactVerification = null;
    renderCommunityModStatus();

    try {
        state.modArtifactVerification = await fetchModArtifactVerification();
    } catch (error) {
        state.modArtifactVerification = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modArtifactVerifying = false;
        renderCommunityModStatus();
    }
}

async function fetchModArtifactVerification() {
    const profile = encodeURIComponent(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile ?? "");
    const response = await fetch(`/api/mod/verify-artifact?profile=${profile}`, modFetchOptions({ method: "POST", network: true }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod artifact verification failed: ${result.error}`
            : `Mod artifact verification failed: ${response.status}`);
    }

    return result;
}

async function prepareModInstallConfirmation() {
    if (!await ensureGithubNetworkConsent()) {
        return;
    }

    state.modInstallConfirming = true;
    state.modArtifactStaging = null;
    state.modInstallConfirmation = null;
    state.modInstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modInstallConfirmation = await fetchModInstallConfirmation();
        state.modArtifactStaging = state.modInstallConfirmation.artifactStaging ?? null;
        const verification = state.modArtifactStaging?.artifactVerification;
        if (verification) {
            state.modArtifactVerification = verification;
        }
    } catch (error) {
        state.modInstallConfirmation = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modInstallConfirming = false;
        renderCommunityModStatus();
    }
}

async function fetchModInstallConfirmation() {
    const profile = encodeURIComponent(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile ?? "");
    const response = await fetch(`/api/mod/install-confirmation?profile=${profile}`, modFetchOptions({ method: "POST", network: true }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod install confirmation failed: ${result.error}`
            : `Mod install confirmation failed: ${response.status}`);
    }

    return result;
}

async function executeModInstall() {
    if (!isInstallExecutionReady(state.modInstallConfirmation)) {
        return;
    }

    if (!await ensureGithubNetworkConsent()) {
        return;
    }

    const confirmed = await showActionDialog({
        title: "Execute Community Mod install",
        message: state.modInstallConfirmation.summary ?? "Install the prepared version.dll now.",
        checks: confirmationCheckLabels(state.modInstallConfirmation.confirmation?.checks),
        confirmLabel: "Execute install",
        danger: true,
    });
    if (!confirmed) {
        return;
    }

    state.modInstallExecuting = true;
    state.modInstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modInstallExecution = await fetchModInstallExecution(state.modInstallConfirmation);
        if (state.modInstallExecution.confirmation) {
            state.modInstallConfirmation = state.modInstallExecution.confirmation;
        }
        if (state.modInstallExecution.status === "installed" || state.modInstallExecution.status === "replaced") {
            await loadMode();
        }
    } catch (error) {
        state.modInstallExecution = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modInstallExecuting = false;
        renderCommunityModStatus();
    }
}

async function fetchModInstallExecution(confirmation) {
    const profile = encodeURIComponent(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile ?? "");
    const response = await fetch(`/api/mod/install-execution?profile=${profile}`, modFetchOptions({
        method: "POST",
        network: true,
        body: {
            enableExecution: true,
            acknowledgement: confirmation.confirmation?.acknowledgement ?? "",
            confirmedStagedSha256: confirmation.staged?.dllSha256 ?? "",
            confirmedDestinationPath: confirmation.target?.destinationPath ?? "",
        },
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod install execution failed: ${result.error}`
            : `Mod install execution failed: ${response.status}`);
    }

    return result;
}

function isInstallExecutionReady(confirmation) {
    return confirmation?.status === "ready_for_confirmation"
        && Boolean(confirmation.confirmation?.acknowledgement)
        && Boolean(confirmation.staged?.dllSha256)
        && Boolean(confirmation.target?.destinationPath);
}

async function checkModUninstall() {
    state.modUninstallChecking = true;
    state.modUninstallPlan = null;
    state.modUninstallConfirmation = null;
    state.modUninstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modUninstallPlan = await fetchModUninstallPlan();
    } catch (error) {
        state.modUninstallPlan = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modUninstallChecking = false;
        renderCommunityModStatus();
    }
}

async function fetchModUninstallPlan() {
    const response = await fetch("/api/mod/uninstall-plan", modFetchOptions());
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod uninstall plan failed: ${result.error}`
            : `Mod uninstall plan failed: ${response.status}`);
    }

    return result;
}

async function prepareModUninstallConfirmation() {
    state.modUninstallConfirming = true;
    state.modUninstallConfirmation = null;
    state.modUninstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modUninstallConfirmation = await fetchModUninstallConfirmation();
        state.modUninstallPlan = state.modUninstallConfirmation.uninstallPlan ?? state.modUninstallPlan;
    } catch (error) {
        state.modUninstallConfirmation = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modUninstallConfirming = false;
        renderCommunityModStatus();
    }
}

async function fetchModUninstallConfirmation() {
    const response = await fetch("/api/mod/uninstall-confirmation", modFetchOptions({
        method: "POST",
        body: { deleteSettingsAndLogs: state.modUninstallDeleteSettingsAndLogs },
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod uninstall confirmation failed: ${result.error}`
            : `Mod uninstall confirmation failed: ${response.status}`);
    }

    return result;
}

async function executeModUninstall() {
    if (!isUninstallExecutionReady(state.modUninstallConfirmation)) {
        return;
    }

    const confirmed = await showActionDialog({
        title: "Execute Community Mod uninstall",
        message: state.modUninstallConfirmation.summary ?? "Remove or restore version.dll now.",
        checks: [
            ...confirmationCheckLabels(state.modUninstallConfirmation.confirmation?.checks),
            state.modUninstallDeleteSettingsAndLogs ? "Settings and logs will be deleted" : "Settings and logs will be left untouched",
        ],
        confirmLabel: "Execute uninstall",
        danger: true,
    });
    if (!confirmed) {
        return;
    }

    state.modUninstallExecuting = true;
    state.modUninstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modUninstallExecution = await fetchModUninstallExecution(state.modUninstallConfirmation);
        if (state.modUninstallExecution.confirmation) {
            state.modUninstallConfirmation = state.modUninstallExecution.confirmation;
        }
        if (["removed", "restored_backup"].includes(state.modUninstallExecution.status)) {
            await loadMode();
        }
    } catch (error) {
        state.modUninstallExecution = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modUninstallExecuting = false;
        renderCommunityModStatus();
    }
}

async function fetchModUninstallExecution(confirmation) {
    const response = await fetch("/api/mod/uninstall-execution", modFetchOptions({
        method: "POST",
        body: {
            enableExecution: true,
            acknowledgement: confirmation.confirmation?.acknowledgement ?? "",
            confirmedCurrentSha256: confirmation.current?.dllSha256 ?? "",
            confirmedDestinationPath: confirmation.target?.destinationPath ?? "",
            deleteSettingsAndLogs: confirmation.settings?.delete === true && state.modUninstallDeleteSettingsAndLogs,
        },
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod uninstall execution failed: ${result.error}`
            : `Mod uninstall execution failed: ${response.status}`);
    }

    return result;
}

function isUninstallPlanActionable(plan) {
    return ["remove_fresh_install", "restore_backup", "remove_unknown"].includes(plan?.action);
}

function isUninstallExecutionReady(confirmation) {
    return confirmation?.status === "ready_for_confirmation"
        && Boolean(confirmation.confirmation?.acknowledgement)
        && Boolean(confirmation.current?.dllSha256)
        && Boolean(confirmation.target?.destinationPath);
}

function modFetchOptions(options = {}) {
    const headers = {};
    const token = state.bootstrap?.modOperationToken;
    if (token) {
        headers.authorization = `Bearer ${token}`;
    }

    if (options.network) {
        headers["x-sidecar-network-consent"] = "github-release";
    }

    if (options.body !== undefined) {
        headers["content-type"] = "application/json";
    }

    return {
        cache: "no-store",
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    };
}

async function ensureGithubNetworkConsent() {
    if (state.githubNetworkConsent) {
        return true;
    }

    const confirmed = await showActionDialog({
        title: "Allow GitHub connection",
        message: "This action connects to GitHub to read release metadata or download the selected release artifact.",
        checks: ["Use GitHub release URLs only", "Cache downloads locally before install", "Verify SHA-256 metadata before staging"],
        confirmLabel: "Allow GitHub",
        danger: false,
    });
    state.githubNetworkConsent = confirmed;
    return confirmed;
}

function confirmationCheckLabels(checks) {
    return Array.isArray(checks)
        ? checks.map((check) => `${check.passed ? "Ready" : "Blocked"}: ${check.label ?? check.id ?? "check"}`)
        : [];
}

function showActionDialog(options = {}) {
    if (!elements.confirmationDialog?.showModal) {
        const lines = [options.title, options.message, ...(options.checks ?? [])].filter(Boolean);
        return Promise.resolve(typeof window.confirm === "function" ? window.confirm(lines.join("\n\n")) : true);
    }

    elements.confirmationDialogTitle.textContent = options.title ?? "Confirm Action";
    elements.confirmationDialogMessage.textContent = options.message ?? "Confirm this action.";
    elements.confirmationDialogChecks.replaceChildren(...(options.checks ?? []).map((label) => {
        const item = document.createElement("li");
        item.textContent = label;
        return item;
    }));
    elements.confirmationDialogConfirm.textContent = options.confirmLabel ?? "Confirm";
    elements.confirmationDialogConfirm.classList.toggle("button-secondary", !options.danger);

    return new Promise((resolve) => {
        const handleClose = () => {
            elements.confirmationDialog.removeEventListener("close", handleClose);
            resolve(elements.confirmationDialog.returnValue === "confirm");
        };
        elements.confirmationDialog.addEventListener("close", handleClose);
        elements.confirmationDialog.showModal();
    });
}