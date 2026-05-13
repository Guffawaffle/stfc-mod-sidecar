import {
    communityModInstallLabel,
    communityModProfileCapabilitySummary,
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
    modProfileLabel,
    normalizeModProfile,
} from "../shared/community-mod-status.js";
import {
    buildSettingsTroubleshootingPrompt,
    buildSettingsTroubleshootingSummary,
    collectSettingsWarnings,
} from "../settings/troubleshooting.js";

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
    settingsSnapshot: null,
    diagnosticSnapshot: null,
    notificationSnapshot: null,
    settingsError: "",
    modUninstallDeleteSettingsAndLogs: false,
    companionUninstallStatus: null,
    companionActionMessage: "",
    companionActionBusy: false,
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
    developerModeState: document.querySelector("#about-developer-mode-state"),
    settingsConfigState: document.querySelector("#about-settings-config-state"),
    settingsWarningCount: document.querySelector("#about-settings-warning-count"),
    settingsCoachSummary: document.querySelector("#about-settings-coach-summary"),
    settingsCoachState: document.querySelector("#about-settings-coach-state"),
    settingsPromptPreview: document.querySelector("#about-settings-prompt-preview"),
    previewSettingsPrompt: document.querySelector("#preview-settings-prompt"),
    copySettingsPrompt: document.querySelector("#copy-settings-prompt"),
    releaseVersion: document.querySelector("#about-release-version"),
    releaseChannel: document.querySelector("#about-release-channel"),
    signaturePolicy: document.querySelector("#about-signature-policy"),
    updateMode: document.querySelector("#about-update-mode"),
    releaseUpdateState: document.querySelector("#about-release-update-state"),
    checkReleaseUpdate: document.querySelector("#check-release-update"),
    releaseUpdateLink: document.querySelector("#about-release-update-link"),
    companionInstallState: document.querySelector("#about-companion-install-state"),
    companionInstallDetail: document.querySelector("#about-companion-install-detail"),
    runCompanionUninstall: document.querySelector("#run-companion-uninstall"),
    openWindowsUninstallSettings: document.querySelector("#open-windows-uninstall-settings"),
    showCompanionInstallFolder: document.querySelector("#show-companion-install-folder"),
    modInstallTitle: document.querySelector("#about-mod-install-title"),
    modInstallState: document.querySelector("#about-mod-install-state"),
    modInstallDetail: document.querySelector("#about-mod-install-detail"),
    modProfileState: document.querySelector("#about-mod-profile-state"),
    modGameDirectoryState: document.querySelector("#about-mod-game-directory-state"),
    modDllState: document.querySelector("#about-mod-dll-state"),
    modReleaseSummaryState: document.querySelector("#about-mod-release-summary-state"),
    modInstallGuideSummary: document.querySelector("#about-mod-install-guide-summary"),
    modInstallGuide: document.querySelector("#about-mod-install-guide"),
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
    modUninstallOptions: document.querySelector("#about-mod-uninstall-options"),
    selectModGameDirectory: document.querySelector("#select-mod-game-directory"),
    refreshModStatus: document.querySelector("#refresh-mod-status"),
    runModInstall: document.querySelector("#run-mod-install"),
    runModUninstall: document.querySelector("#run-mod-uninstall"),
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

elements.previewSettingsPrompt?.addEventListener("click", previewSettingsPrompt);
elements.copySettingsPrompt?.addEventListener("click", () => void copySettingsPrompt());
elements.previewDiagnostics?.addEventListener("click", () => void previewDiagnostics());
elements.copyDiagnostics?.addEventListener("click", () => void copyDiagnostics());
elements.downloadDiagnostics?.addEventListener("click", () => void downloadDiagnostics());
elements.checkReleaseUpdate?.addEventListener("click", () => void checkReleaseUpdate());
elements.runCompanionUninstall?.addEventListener("click", () => void runCompanionUninstall());
elements.openWindowsUninstallSettings?.addEventListener("click", () => void openWindowsUninstallSettings());
elements.showCompanionInstallFolder?.addEventListener("click", () => void showCompanionInstallFolder());
elements.selectModGameDirectory?.addEventListener("click", () => void selectModGameDirectory());
elements.refreshModStatus?.addEventListener("click", () => void refreshModStatus());
elements.runModInstall?.addEventListener("click", () => void runModInstall());
elements.runModUninstall?.addEventListener("click", () => void runModUninstall());
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
await loadSettingsContext();

async function loadMode() {
    try {
        state.bootstrap = window.stfcDesktop?.getBootstrap ? await window.stfcDesktop.getBootstrap() : await loadServerMode();
    } catch (error) {
        state.bootstrap = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    state.companionUninstallStatus = state.bootstrap?.companionAppUninstall ?? state.companionUninstallStatus;
    renderMode();
    renderRelease();
    renderCompanionInstall();
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
        gameDirectory: health.gameDir,
        feedPath: health.feedPath,
        settingsPath: health.settingsPath,
        capabilities: health.capabilities ?? {},
        variantGate: health.variantGate ?? null,
        release: health.release,
    };
}

async function loadSettingsContext() {
    renderSettingsContext();
    try {
        const [settingsSnapshot, notificationSnapshot, diagnosticSnapshot] = await Promise.all([
            fetchJsonIfOk("/api/settings/hotkeys"),
            fetchJsonIfOk("/api/settings/notifications"),
            fetchJsonIfOk("/api/settings/diagnostics", { optionalStatuses: [403, 404] }),
        ]);

        state.settingsSnapshot = settingsSnapshot;
        state.notificationSnapshot = notificationSnapshot;
        state.diagnosticSnapshot = diagnosticSnapshot;
        state.settingsError = "";
    } catch (error) {
        state.settingsSnapshot = null;
        state.notificationSnapshot = null;
        state.diagnosticSnapshot = null;
        state.settingsError = error instanceof Error ? error.message : String(error);
    }

    renderSettingsContext();
}

async function fetchJsonIfOk(url, options = {}) {
    const response = await fetch(url, { cache: "no-store" });
    if ((options.optionalStatuses ?? []).includes(response.status)) {
        return null;
    }

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed: ${response.status}`);
    }

    return payload;
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

    if (state.bootstrap?.error) {
        elements.developerModeState.textContent = state.bootstrap.error;
        return;
    }

    elements.developerModeState.textContent = state.modeChanging
        ? "Applying mode change..."
        : `${modeLabel(developerMode)} active`;
}

function renderSettingsContext() {
    if (state.settingsError) {
        elements.settingsConfigState.textContent = "Unavailable";
        elements.settingsWarningCount.textContent = "0";
        elements.settingsCoachSummary.textContent = state.settingsError;
        return;
    }

    if (!state.settingsSnapshot) {
        elements.settingsConfigState.textContent = "Loading...";
        elements.settingsWarningCount.textContent = "0";
        elements.settingsCoachSummary.textContent = "Loading settings context.";
        return;
    }

    const input = settingsTroubleshootingInput();
    const warnings = collectSettingsWarnings(input);
    elements.settingsConfigState.textContent = state.settingsSnapshot.parseError
        ? "Invalid TOML"
        : state.settingsSnapshot.exists ? "Found" : "Not found";
    elements.settingsWarningCount.textContent = String(warnings.length);
    elements.settingsCoachSummary.textContent = buildSettingsTroubleshootingSummary(input);
}

function previewSettingsPrompt() {
    const prompt = buildSettingsTroubleshootingPrompt(settingsTroubleshootingInput());
    elements.settingsPromptPreview.textContent = prompt;
    elements.settingsPromptPreview.hidden = false;
    setSettingsCoachState("Preview ready");
}

async function copySettingsPrompt() {
    const prompt = buildSettingsTroubleshootingPrompt(settingsTroubleshootingInput());
    elements.settingsPromptPreview.textContent = prompt;
    elements.settingsPromptPreview.hidden = false;
    setSettingsCoachState("Copying prompt...");

    try {
        await navigator.clipboard.writeText(prompt);
        setSettingsCoachState("Prompt copied");
    } catch (error) {
        setSettingsCoachState(error instanceof Error ? error.message : String(error));
    }
}

function setSettingsCoachState(message) {
    elements.settingsCoachState.textContent = message;
}

function settingsTroubleshootingInput() {
    const snapshot = state.settingsSnapshot;
    return {
        snapshot,
        diagnosticSnapshot: state.diagnosticSnapshot,
        notificationSnapshot: state.notificationSnapshot,
        bootstrap: state.bootstrap,
        draftBindings: new Map((snapshot?.actions ?? []).map((action) => [action.id, [...action.bindings]])),
        draftHardSettings: new Map((snapshot?.hardSettings ?? []).map((setting) => [setting.id, setting.value])),
        conflicts: [],
    };
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

function renderCompanionInstall() {
    const status = state.companionUninstallStatus ?? state.bootstrap?.companionAppUninstall;
    const desktopBridge = window.stfcDesktop ?? null;
    const desktopAvailable = Boolean(desktopBridge);
    elements.companionInstallState.textContent = companionInstallLabel(status, desktopAvailable);
    elements.companionInstallDetail.textContent = state.companionActionMessage || companionInstallSummary(status, desktopAvailable);

    const canRunUninstaller = desktopAvailable && status?.canRunUninstaller === true;
    const canOpenWindowsApps = desktopAvailable
        && status?.canOpenWindowsApps === true
        && ["installed", "packaged_unknown"].includes(status?.mode);
    const canShowInstallFolder = desktopAvailable
        && status?.canShowInstallFolder === true
        && status?.mode !== "source";

    elements.runCompanionUninstall.hidden = !canRunUninstaller;
    elements.runCompanionUninstall.disabled = state.companionActionBusy || !canRunUninstaller;
    elements.openWindowsUninstallSettings.hidden = !canOpenWindowsApps;
    elements.openWindowsUninstallSettings.disabled = state.companionActionBusy || !canOpenWindowsApps;
    elements.showCompanionInstallFolder.hidden = !canShowInstallFolder;
    elements.showCompanionInstallFolder.disabled = state.companionActionBusy || !canShowInstallFolder;
}

function companionInstallLabel(status, desktopAvailable) {
    if (!desktopAvailable) {
        return "Browser viewer";
    }

    return status?.label ?? "Companion app status unavailable";
}

function companionInstallSummary(status, desktopAvailable) {
    if (!desktopAvailable) {
        return "Open the desktop Companion for app installer and uninstaller actions.";
    }

    if (!status) {
        return "Companion app install status is unavailable.";
    }

    const userData = status.userDataPolicy === "preserve" ? " Companion settings and logs are preserved by default." : "";
    return `${status.summary ?? "Companion app install status is unavailable."}${userData}`;
}

async function refreshCompanionInstallStatus() {
    if (!window.stfcDesktop?.getCompanionUninstallStatus) {
        return state.companionUninstallStatus;
    }

    state.companionUninstallStatus = await window.stfcDesktop.getCompanionUninstallStatus();
    renderCompanionInstall();
    return state.companionUninstallStatus;
}

async function runCompanionUninstall() {
    const status = await refreshCompanionInstallStatus();
    if (!status?.canRunUninstaller || !window.stfcDesktop?.runCompanionUninstaller) {
        state.companionActionMessage = "This Companion run does not expose an installed app uninstaller.";
        renderCompanionInstall();
        return;
    }

    const confirmed = await showActionDialog({
        title: "Uninstall Companion",
        message: "Open the installed Companion uninstaller now.",
        checks: [
            "Community Mod files stay untouched",
            "Companion settings and logs are preserved",
            "The Companion app will close",
        ],
        confirmLabel: "Uninstall Companion",
        danger: true,
    });
    if (!confirmed) {
        return;
    }

    state.companionActionBusy = true;
    state.companionActionMessage = "Launching Companion uninstaller...";
    renderCompanionInstall();

    try {
        const result = await window.stfcDesktop.runCompanionUninstaller();
        state.companionActionMessage = result?.ok
            ? "Companion uninstaller launched. The app will close."
            : result?.error ?? "Companion uninstaller could not be launched.";
    } catch (error) {
        state.companionActionMessage = error instanceof Error ? error.message : String(error);
    } finally {
        state.companionActionBusy = false;
        renderCompanionInstall();
    }
}

async function openWindowsUninstallSettings() {
    if (!window.stfcDesktop?.openWindowsUninstallSettings) {
        return;
    }

    state.companionActionBusy = true;
    state.companionActionMessage = "Opening Windows Apps...";
    renderCompanionInstall();

    try {
        const result = await window.stfcDesktop.openWindowsUninstallSettings();
        state.companionActionMessage = result?.ok
            ? "Windows Apps opened."
            : result?.error ?? "Windows Apps could not be opened.";
    } catch (error) {
        state.companionActionMessage = error instanceof Error ? error.message : String(error);
    } finally {
        state.companionActionBusy = false;
        renderCompanionInstall();
    }
}

async function showCompanionInstallFolder() {
    if (!window.stfcDesktop?.showCompanionInstallFolder) {
        return;
    }

    state.companionActionBusy = true;
    state.companionActionMessage = "Opening Companion folder...";
    renderCompanionInstall();

    try {
        const result = await window.stfcDesktop.showCompanionInstallFolder();
        state.companionActionMessage = result?.ok
            ? "Companion folder opened."
            : result?.error ?? "Companion folder could not be opened.";
    } catch (error) {
        state.companionActionMessage = error instanceof Error ? error.message : String(error);
    } finally {
        state.companionActionBusy = false;
        renderCompanionInstall();
    }
}

async function refreshModStatus() {
    elements.refreshModStatus.disabled = true;
    try {
        await loadMode();
    } finally {
        elements.refreshModStatus.disabled = false;
    }
}

async function selectModGameDirectory() {
    await ensureGameDirectorySelected({ force: true });
}

function renderCommunityModStatus() {
    const install = state.bootstrap?.communityModInstall;
    const profileHint = communityModProfileCapabilitySummary(install, state.bootstrap?.modProfile, state.bootstrap?.capabilities);
    elements.modInstallTitle.textContent = communityModInstallLabel(install);
    elements.modInstallState.textContent = communityModInstallLabel(install);
    elements.modInstallDetail.textContent = [communityModInstallSummary(install), profileHint].filter(Boolean).join(" ");
    elements.modProfileState.textContent = modProfileLabel(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile);
    elements.modGameDirectoryState.textContent = state.bootstrap?.gameDirectory || "Not selected";
    elements.modDllState.textContent = communityModDllStateLabel(install);
    elements.modReleaseSummaryState.textContent = communityModReleaseLabel(state.modReleaseCatalog);
    renderModInstallGuide(buildModInstallGuideSteps(install));
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
    elements.modUninstallOptions.hidden = !isCommunityModInstalled(install) || !canRunModOperations();
    setModReleaseLink(state.modReleaseCatalog?.release?.htmlUrl);
    elements.selectModGameDirectory.hidden = !window.stfcDesktop?.selectGameDirectory;
    elements.selectModGameDirectory.textContent = state.bootstrap?.gameDirectory ? "Change STFC Folder" : "Select STFC Folder";
    elements.selectModGameDirectory.disabled = state.modReleaseChecking
        || state.modArtifactVerifying
        || state.modInstallConfirming
        || state.modInstallExecuting
        || state.modUninstallChecking
        || state.modUninstallConfirming
        || state.modUninstallExecuting;
    elements.runModInstall.textContent = installButtonLabel();
    elements.runModInstall.disabled = !canRunModOperations()
        || state.modReleaseChecking
        || state.modArtifactVerifying
        || state.modInstallConfirming
        || state.modInstallExecuting;
    elements.runModUninstall.textContent = uninstallButtonLabel();
    elements.runModUninstall.disabled = !canRunModOperations()
        || state.modUninstallChecking
        || state.modUninstallConfirming
        || state.modUninstallExecuting
        || !isCommunityModInstalled(install);
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

function communityModDllStateLabel(install) {
    if (!install) {
        return "Loading...";
    }

    if (install.ok === false) {
        return "Unavailable";
    }

    if (install.state === "unselected") {
        return "Select folder first";
    }

    if (install.state === "unsupported_platform") {
        return "Unsupported platform";
    }

    if (install.state === "none" || install.classification === "none") {
        return "Not installed";
    }

    if (install.state !== "installed") {
        return "Status unavailable";
    }

    if (install.classification === "unknown") {
        return "Unknown version.dll";
    }

    return communityModInstallLabel(install);
}

function buildModInstallGuideSteps(install) {
    const profile = modProfileLabel(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile);
    const hasDesktopInstall = canRunModOperations();
    const gameDirectory = state.bootstrap?.gameDirectory ?? "";
    const installed = isCommunityModInstalled(install);
    const compatible = installed
        && install.classification !== "unknown"
        && communityModProfilesCompatible(install.classification, state.bootstrap?.modProfile);
    const plan = state.modInstallPlan;
    const confirmation = state.modInstallConfirmation;
    const releaseLabel = communityModReleaseLabel(state.modReleaseCatalog);

    const directoryStep = gameDirectory
        ? guideStep("Choose STFC folder", "Ready", gameDirectory)
        : guideStep("Choose STFC folder", "Required", "Select the folder that contains prime.exe.");
    const dllStep = buildDllGuideStep(install, compatible, profile);
    const releaseWaitingDetail = hasDesktopInstall
        ? `Use ${installButtonLabel()} to check the selected ${profile} release and verify the DLL before install.`
        : "Open the desktop Companion to check releases and install or update version.dll.";
    const releaseStep = state.modReleaseCatalog
        ? guideStep("Prepare selected release", releaseLabel, communityModInstallPlanSummary(plan))
        : guideStep("Prepare selected release", "Waiting", releaseWaitingDetail);
    const confirmStep = isInstallExecutionReady(confirmation)
        ? guideStep("Confirm install", "Ready", communityModInstallConfirmationSummary(confirmation))
        : guideStep("Confirm install", "Waiting", installGuideConfirmationDetail(install, plan));

    return {
        summary: installGuideSummary(install, compatible, profile),
        steps: [directoryStep, dllStep, releaseStep, confirmStep],
    };
}

function buildDllGuideStep(install, compatible, profile) {
    if (!install) {
        return guideStep("Inspect version.dll", "Loading", "Checking the selected game directory.");
    }

    if (install.ok === false) {
        return guideStep("Inspect version.dll", "Blocked", String(install.error ?? "Install status is unavailable."));
    }

    if (install.state === "unselected") {
        return guideStep("Inspect version.dll", "Waiting", "The folder must be selected before version.dll can be inspected.");
    }

    if (install.state === "none" || install.classification === "none") {
        return guideStep("Install version.dll", "Required", `No Community Mod DLL is installed; install ${profile} for this folder.`);
    }

    if (install.classification === "unknown") {
        return guideStep("Review installed DLL", "Needs review", "An unknown version.dll is present; replacement requires explicit confirmation and backup.");
    }

    if (!compatible) {
        return guideStep("Match selected profile", "Needs review", `Installed ${modProfileLabel(install.classification)} differs from selected ${profile}.`);
    }

    return guideStep("Inspect version.dll", "Ready", communityModInstallSummary(install));
}

function installGuideConfirmationDetail(install, plan) {
    if (!canRunModOperations()) {
        return "Open the desktop Companion to prepare and execute Community Mod changes.";
    }

    if (!state.bootstrap?.gameDirectory) {
        return "Select the STFC folder before preparing confirmation.";
    }

    if (plan?.ok === false) {
        return String(plan.error ?? "Resolve the install plan before confirming.");
    }

    if (plan?.action === "none" && isCommunityModInstalled(install)) {
        return "No install action is currently required for the selected profile.";
    }

    return "The install button prepares release metadata, verifies the artifact, stages version.dll, and then asks for confirmation.";
}

function installGuideSummary(install, compatible, profile) {
    if (!canRunModOperations() && !state.bootstrap?.gameDirectory) {
        return `Open the desktop Companion to select the STFC game folder and install ${profile}.`;
    }

    if (!state.bootstrap?.gameDirectory) {
        return `Select the STFC game folder first, then install ${profile}.`;
    }

    if (!install || install.ok === false) {
        return "The selected folder needs a readable Community Mod install status before install can continue.";
    }

    if (install.state === "none" || install.classification === "none") {
        if (!canRunModOperations()) {
            return `This folder has no version.dll. Open the desktop Companion to install ${profile}.`;
        }

        return `This folder has no version.dll. Install ${profile} from the selected release.`;
    }

    if (install.classification === "unknown") {
        if (!canRunModOperations()) {
            return `This folder has an unknown version.dll. Open the desktop Companion before replacing it with ${profile}.`;
        }

        return `This folder has an unknown version.dll. Replace it with ${profile} only after reviewing the confirmation.`;
    }

    if (!compatible) {
        if (!canRunModOperations()) {
            return `This folder has ${modProfileLabel(install.classification)} installed. Open the desktop Companion to switch it to ${profile}.`;
        }

        return `This folder has ${modProfileLabel(install.classification)} installed. Switch it to ${profile} from the selected release.`;
    }

    if (!canRunModOperations()) {
        return `${modProfileLabel(install.classification)} is installed for this folder. Open the desktop Companion for install or update actions.`;
    }

    return `${modProfileLabel(install.classification)} is installed for this folder. Use the install action when a selected release update is available.`;
}

function guideStep(label, status, detail) {
    return { label, status, detail };
}

function renderModInstallGuide(result) {
    elements.modInstallGuideSummary.textContent = result.summary;
    elements.modInstallGuide.replaceChildren(...result.steps.map((step) => {
        const item = document.createElement("li");
        item.className = "setup-step";

        const heading = document.createElement("div");
        heading.className = "setup-step__heading";

        const label = document.createElement("strong");
        label.textContent = step.label;

        const status = document.createElement("span");
        status.className = "settings-chip";
        status.textContent = step.status;

        const detail = document.createElement("p");
        detail.className = "page-copy";
        detail.textContent = step.detail;

        heading.append(label, status);
        item.append(heading, detail);
        return item;
    }));
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
        setReleaseUpdateState("Companion update check cancelled");
        return;
    }

    elements.checkReleaseUpdate.disabled = true;
    setReleaseUpdateState("Checking Companion updates...");
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
        throw new Error(result.error ? `Companion update check failed: ${result.error}` : `Companion update check failed: ${response.status}`);
    }

    return result;
}

function renderReleaseUpdate(result) {
    if (result.status === "update_available") {
        setReleaseUpdateState(`Companion ${result.latest?.version ?? "update"} available`);
        setReleaseUpdateLink(result.latest?.htmlUrl);
        return;
    }

    if (result.status === "up_to_date") {
        setReleaseUpdateState(`Companion is current: ${result.latest?.version ?? "unknown"}`);
        setReleaseUpdateLink(result.latest?.htmlUrl);
        return;
    }

    if (result.status === "no_release") {
        setReleaseUpdateState("No Companion release found for this channel");
        return;
    }

    if (result.status === "unavailable") {
        setReleaseUpdateState(result.error ?? "Release metadata unavailable");
        return;
    }

    setReleaseUpdateState("Companion update status unavailable");
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

    await confirmAndExecuteModInstall();
}

async function runModInstall() {
    if (!canRunModOperations()) {
        state.modInstallPlan = {
            ok: false,
            status: "desktop_required",
            error: "Open the desktop Companion to install Community Mod.",
        };
        renderCommunityModStatus();
        return;
    }

    if (!await ensureGameDirectorySelected()) {
        return;
    }

    if (!await ensureGithubNetworkConsent()) {
        return;
    }

    state.modReleaseChecking = true;
    state.modArtifactVerifying = true;
    state.modInstallConfirming = true;
    state.modReleaseCatalog = null;
    state.modInstallPlan = null;
    state.modArtifactVerification = null;
    state.modArtifactStaging = null;
    state.modInstallConfirmation = null;
    state.modInstallExecution = null;
    renderCommunityModStatus();

    try {
        state.modInstallConfirmation = await fetchModInstallConfirmation();
        state.modInstallPlan = state.modInstallConfirmation.installPlan ?? state.modInstallPlan;
        state.modReleaseCatalog = state.modInstallConfirmation.installPlan?.catalog ?? state.modReleaseCatalog;
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
        return;
    } finally {
        state.modReleaseChecking = false;
        state.modArtifactVerifying = false;
        state.modInstallConfirming = false;
        renderCommunityModStatus();
    }

    await confirmAndExecuteModInstall();
}

async function ensureGameDirectorySelected(options = {}) {
    if (!options.force && state.bootstrap?.gameDirectory) {
        return true;
    }

    if (!window.stfcDesktop?.selectGameDirectory) {
        state.modInstallPlan = {
            ok: false,
            status: "game_directory_required",
            error: "Select the STFC game directory in the desktop Companion before installing Community Mod.",
        };
        renderCommunityModStatus();
        return false;
    }

    state.modInstallPlan = {
        ok: false,
        status: "game_directory_required",
        error: "Select the STFC game directory to continue.",
    };
    renderCommunityModStatus();

    const bootstrap = await window.stfcDesktop.selectGameDirectory();
    state.bootstrap = bootstrap;
    state.companionUninstallStatus = bootstrap?.companionAppUninstall ?? state.companionUninstallStatus;
    renderMode();
    renderRelease();
    renderCompanionInstall();
    renderCommunityModStatus();
    return Boolean(bootstrap?.gameDirectory);
}

async function confirmAndExecuteModInstall() {
    if (!isInstallExecutionReady(state.modInstallConfirmation)) {
        return;
    }

    const confirmed = await showActionDialog({
        title: "Execute Community Mod install",
        message: state.modInstallConfirmation.summary ?? "Install the prepared version.dll now.",
        checks: confirmationCheckLabels(state.modInstallConfirmation.confirmation?.checks),
        confirmLabel: installConfirmLabel(state.modInstallConfirmation),
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

async function runModUninstall() {
    if (!isCommunityModInstalled(state.bootstrap?.communityModInstall)) {
        return;
    }

    state.modUninstallChecking = true;
    state.modUninstallConfirming = true;
    state.modUninstallPlan = null;
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
        return;
    } finally {
        state.modUninstallChecking = false;
        state.modUninstallConfirming = false;
        renderCommunityModStatus();
    }

    await confirmAndExecuteModUninstall();
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

    await confirmAndExecuteModUninstall();
}

async function confirmAndExecuteModUninstall() {
    if (!isUninstallExecutionReady(state.modUninstallConfirmation)) {
        return;
    }

    const confirmed = await showActionDialog({
        title: "Uninstall Community Mod",
        message: state.modUninstallConfirmation.summary ?? "Remove or restore version.dll now.",
        checks: [
            ...confirmationCheckLabels(state.modUninstallConfirmation.confirmation?.checks),
            state.modUninstallDeleteSettingsAndLogs ? "Settings and logs will be deleted" : "Settings and logs will be left untouched",
        ],
        confirmLabel: "Uninstall",
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

function uninstallButtonLabel() {
    if (state.modUninstallExecuting) {
        return "Uninstalling...";
    }

    if (state.modUninstallChecking || state.modUninstallConfirming) {
        return "Preparing...";
    }

    return "Uninstall";
}

function installButtonLabel() {
    if (state.modInstallExecuting) {
        return "Installing...";
    }

    if (state.modReleaseChecking || state.modArtifactVerifying || state.modInstallConfirming) {
        return "Preparing...";
    }

    if (!state.bootstrap?.gameDirectory) {
        return "Select STFC Folder";
    }

    const install = state.bootstrap?.communityModInstall;
    if (isCommunityModInstalled(install)) {
        if (install.classification === "unknown") {
            return `Replace With ${modProfileLabel(state.bootstrap?.modProfile)}`;
        }

        if (!communityModProfilesCompatible(install.classification, state.bootstrap?.modProfile)) {
            return `Switch To ${modProfileLabel(state.bootstrap?.modProfile)}`;
        }

        return "Update Community Mod";
    }

    return `Install ${modProfileLabel(state.bootstrap?.modProfile)}`;
}

function communityModProfilesCompatible(left, right) {
    const leftProfile = normalizeModProfile(left);
    const rightProfile = normalizeModProfile(right);
    return leftProfile === rightProfile || (leftProfile.startsWith("waffle-") && rightProfile.startsWith("waffle-"));
}

function installConfirmLabel(confirmation) {
    switch (confirmation?.action) {
        case "update":
            return "Update";
        case "reinstall":
            return "Reinstall";
        case "replace_unknown":
        case "replace_profile":
            return "Replace";
        default:
            return "Install";
    }
}

function isCommunityModInstalled(install) {
    return install?.state === "installed" && install.classification !== "none";
}

function canRunModOperations() {
    return Boolean(state.bootstrap?.desktop && state.bootstrap?.modOperationToken);
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