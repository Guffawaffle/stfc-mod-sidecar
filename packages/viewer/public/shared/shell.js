import { visibleViewerPages } from "./pages.js";
import {
    shouldShowVariantGateWarning,
    variantGateWarningKey,
    variantGateWarningViewModel,
} from "./variant-gate-warning.js";

const defaultViewerState = Object.freeze({
    developerMode: false,
    capabilities: { battleLog: false },
    variantGate: null,
});
const VARIANT_GATE_WARNING_SESSION_KEY = "stfc.variantGateWarning.ignoredKey";
const VIEWER_STATE_SESSION_KEY = "stfc.viewerState.v1";
const VIEWER_STATE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

let currentViewerStateKey = "";

applyViewerState(readCachedViewerState() ?? defaultViewerState, { force: true });
void refreshViewerState({ retries: 6 });
window.addEventListener("stfc:mode-changed", (event) => {
    const state = normalizeViewerState({
        developerMode: Boolean(event.detail?.developerMode),
        capabilities: event.detail?.capabilities ?? {},
        variantGate: event.detail?.variantGate ?? null,
    });
    writeCachedViewerState(state);
    applyViewerState(state);
});
window.addEventListener("pageshow", () => void refreshViewerState());
window.addEventListener("focus", () => void refreshViewerState());
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshViewerState();
    }
});

function renderNavigation(nav, state) {
    const currentPage = nav.dataset.currentPage ?? "";
    const pages = visibleViewerPages(state);
    const signature = `${currentPage}:${pages.map((page) => page.id).join("|")}`;
    if (nav.dataset.renderedPages === signature) {
        return;
    }

    nav.dataset.renderedPages = signature;
    nav.textContent = "";

    for (const page of pages) {
        const link = document.createElement("a");
        link.className = page.id === currentPage ? "site-nav__link site-nav__link--active" : "site-nav__link";
        link.href = page.href;
        link.textContent = page.label;
        nav.appendChild(link);
    }
}

async function refreshViewerState(options = {}) {
    const retries = options.retries ?? 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetch("/api/health", { cache: "no-store" });
            if (response.ok) {
                const health = await response.json();
                const state = normalizeViewerState({
                    developerMode: Boolean(health.developerMode),
                    capabilities: health.capabilities ?? {},
                    variantGate: health.variantGate ?? null,
                });
                writeCachedViewerState(state);
                applyViewerState(state);
                return;
            }
        } catch {
            // The bundled server can be briefly unavailable while mode changes restart it.
        }

        if (attempt < retries) {
            await delay(350);
        }
    }

    if (!readCachedViewerState()) {
        applyViewerState(defaultViewerState);
    }
}

function applyViewerState(state, options = {}) {
    const normalizedState = normalizeViewerState(state);
    const stateKey = viewerStateKey(normalizedState);
    if (!options.force && stateKey === currentViewerStateKey) {
        return;
    }

    currentViewerStateKey = stateKey;
    for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
        renderNavigation(nav, normalizedState);
    }

    for (const element of document.querySelectorAll("[data-developer-only]")) {
        element.hidden = !normalizedState.developerMode;
    }

    for (const element of document.querySelectorAll("[data-capability]")) {
        element.hidden = normalizedState.capabilities?.[element.dataset.capability] !== true;
    }

    renderVariantGateWarning(normalizedState.variantGate);
}

function normalizeViewerState(state = {}) {
    return {
        developerMode: Boolean(state.developerMode),
        capabilities: { ...(state.capabilities ?? {}) },
        variantGate: state.variantGate ?? null,
    };
}

function viewerStateKey(state) {
    return JSON.stringify({
        developerMode: Boolean(state.developerMode),
        capabilities: state.capabilities ?? {},
        variantGate: state.variantGate ?? null,
    });
}

function renderVariantGateWarning(variantGate) {
    if (document.querySelector("[data-variant-gate-warning-suppressed]")) {
        document.querySelector("[data-variant-gate-warning]")?.remove();
        return;
    }

    const ignoredKey = readSessionValue(VARIANT_GATE_WARNING_SESSION_KEY);
    const warningKey = variantGateWarningKey(variantGate);
    let warning = document.querySelector("[data-variant-gate-warning]");

    if (!shouldShowVariantGateWarning(variantGate, ignoredKey)) {
        warning?.remove();
        return;
    }

    if (!warning) {
        warning = document.createElement("section");
        warning.className = "variant-gate-warning";
        warning.dataset.variantGateWarning = "";
        warning.setAttribute("role", "alert");
        insertAfterNavigation(warning);
    }

    const view = variantGateWarningViewModel(variantGate);
    warning.textContent = "";

    const copy = document.createElement("div");
    copy.className = "variant-gate-warning__copy";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Security Is Paramount";
    const title = document.createElement("h2");
    title.textContent = view.title;
    const summary = document.createElement("p");
    summary.className = "page-copy";
    summary.textContent = view.summary;
    const details = document.createElement("ul");
    details.className = "module-list";
    for (const detail of view.details) {
        const item = document.createElement("li");
        item.textContent = detail;
        details.appendChild(item);
    }
    copy.append(eyebrow, title, summary, details);

    const actions = document.createElement("div");
    actions.className = "variant-gate-warning__actions";
    const settingsLink = document.createElement("a");
    settingsLink.className = "link-button";
    settingsLink.href = view.fixHref;
    settingsLink.textContent = view.fixLabel;
    const ignoreButton = document.createElement("button");
    ignoreButton.type = "button";
    ignoreButton.className = "button-secondary";
    ignoreButton.textContent = "Ignore This Time";
    ignoreButton.addEventListener("click", () => {
        writeSessionValue(VARIANT_GATE_WARNING_SESSION_KEY, warningKey);
        warning.remove();
    }, { once: true });
    actions.append(settingsLink, ignoreButton);

    warning.append(copy, actions);
}

function insertAfterNavigation(element) {
    const shell = document.querySelector(".site-shell") ?? document.body;
    const nav = shell.querySelector("[data-viewer-nav]");
    if (nav?.parentElement === shell) {
        nav.insertAdjacentElement("afterend", element);
        return;
    }

    shell.prepend(element);
}

function readSessionValue(key) {
    try {
        return window.sessionStorage?.getItem(key) ?? "";
    } catch {
        return "";
    }
}

function writeSessionValue(key, value) {
    try {
        window.sessionStorage?.setItem(key, value);
    } catch {
        return;
    }
}

function readCachedViewerState() {
    try {
        const cached = JSON.parse(window.sessionStorage?.getItem(VIEWER_STATE_SESSION_KEY) ?? "null");
        if (!cached || Date.now() - Number(cached.savedAt ?? 0) > VIEWER_STATE_CACHE_MAX_AGE_MS) {
            return null;
        }

        return normalizeViewerState(cached.state);
    } catch {
        return null;
    }
}

function writeCachedViewerState(state) {
    try {
        window.sessionStorage?.setItem(VIEWER_STATE_SESSION_KEY, JSON.stringify({
            savedAt: Date.now(),
            state: normalizeViewerState(state),
        }));
    } catch {
        return;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
