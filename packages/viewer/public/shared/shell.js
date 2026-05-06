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

for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
    renderNavigation(nav, defaultViewerState);
}

applyViewerState(defaultViewerState);
void refreshViewerState({ retries: 6 });
window.addEventListener("stfc:mode-changed", (event) => {
    applyViewerState({
        developerMode: Boolean(event.detail?.developerMode),
        capabilities: event.detail?.capabilities ?? {},
        variantGate: event.detail?.variantGate ?? null,
    });
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
    nav.textContent = "";

    for (const page of visibleViewerPages(state)) {
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
                applyViewerState({
                    developerMode: Boolean(health.developerMode),
                    capabilities: health.capabilities ?? {},
                    variantGate: health.variantGate ?? null,
                });
                return;
            }
        } catch {
            // The bundled server can be briefly unavailable while mode changes restart it.
        }

        if (attempt < retries) {
            await delay(350);
        }
    }

    applyViewerState(defaultViewerState);
}

function applyViewerState(state) {
    for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
        renderNavigation(nav, state);
    }

    for (const element of document.querySelectorAll("[data-developer-only]")) {
        element.hidden = !state.developerMode;
    }

    for (const element of document.querySelectorAll("[data-capability]")) {
        element.hidden = state.capabilities?.[element.dataset.capability] !== true;
    }

    renderVariantGateWarning(state.variantGate);
}

function renderVariantGateWarning(variantGate) {
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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
