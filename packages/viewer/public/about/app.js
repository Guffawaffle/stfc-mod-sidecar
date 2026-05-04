import {
    communityModInstallLabel,
    communityModInstallSummary,
    communityModReleaseLabel,
    communityModReleaseSummary,
} from "../shared/community-mod-status.js";

const state = {
    bootstrap: null,
    modeChanging: false,
    pendingDeveloperMode: null,
    modReleaseCatalog: null,
    modReleaseChecking: false,
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
    refreshModStatus: document.querySelector("#refresh-mod-status"),
    checkModRelease: document.querySelector("#check-mod-release"),
    modReleaseLink: document.querySelector("#about-mod-release-link"),
    diagnosticsState: document.querySelector("#diagnostics-state"),
    diagnosticsPreview: document.querySelector("#diagnostics-preview"),
    previewDiagnostics: document.querySelector("#preview-diagnostics"),
    copyDiagnostics: document.querySelector("#copy-diagnostics"),
    downloadDiagnostics: document.querySelector("#download-diagnostics"),
};

elements.developerModeToggle?.addEventListener("change", () => void setDeveloperMode(elements.developerModeToggle.checked));
elements.previewDiagnostics?.addEventListener("click", () => void previewDiagnostics());
elements.copyDiagnostics?.addEventListener("click", () => void copyDiagnostics());
elements.downloadDiagnostics?.addEventListener("click", () => void downloadDiagnostics());
elements.checkReleaseUpdate?.addEventListener("click", () => void checkReleaseUpdate());
elements.refreshModStatus?.addEventListener("click", () => void refreshModStatus());
elements.checkModRelease?.addEventListener("click", () => void checkModRelease());

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
    setModReleaseLink(state.modReleaseCatalog?.release?.htmlUrl);
    elements.checkModRelease.disabled = state.modReleaseChecking;
}

async function checkModRelease() {
    state.modReleaseChecking = true;
    state.modReleaseCatalog = null;
    renderCommunityModStatus();

    try {
        state.modReleaseCatalog = await fetchModReleaseCatalog();
    } catch (error) {
        state.modReleaseCatalog = {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        state.modReleaseChecking = false;
        renderCommunityModStatus();
    }
}

async function fetchModReleaseCatalog() {
    const profile = encodeURIComponent(state.bootstrap?.modProfile ?? state.bootstrap?.settingsProfile ?? "");
    const response = await fetch(`/api/mod/release-catalog?profile=${profile}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error
            ? `Mod release check failed: ${result.error}`
            : `Mod release check failed: ${response.status}`);
    }

    return result;
}

function setModReleaseLink(url) {
    const safeUrl = safeGithubUrl(url);
    elements.modReleaseLink.hidden = !safeUrl;
    elements.modReleaseLink.href = safeUrl || "#";
}

async function checkReleaseUpdate() {
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
    const response = await fetch("/api/release/check", { cache: "no-store" });
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