import { visibleViewerPages } from "./pages.js";

const defaultViewerState = Object.freeze({
    developerMode: false,
    capabilities: { battleLog: false },
});

for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
    renderNavigation(nav, defaultViewerState);
}

applyViewerState(defaultViewerState);
void refreshViewerState({ retries: 6 });
window.addEventListener("stfc:mode-changed", (event) => {
    applyViewerState({
        developerMode: Boolean(event.detail?.developerMode),
        capabilities: event.detail?.capabilities ?? {},
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
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
