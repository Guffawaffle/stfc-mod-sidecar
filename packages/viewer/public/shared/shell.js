import { viewerPages } from "./pages.js";

for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
    renderNavigation(nav, false);
}

applyDeveloperMode(false);
void refreshDeveloperMode({ retries: 6 });
window.addEventListener("stfc:mode-changed", (event) => {
    applyDeveloperMode(Boolean(event.detail?.developerMode));
});
window.addEventListener("pageshow", () => void refreshDeveloperMode());
window.addEventListener("focus", () => void refreshDeveloperMode());
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshDeveloperMode();
    }
});

function renderNavigation(nav, developerMode) {
    const currentPage = nav.dataset.currentPage ?? "";
    nav.textContent = "";

    for (const page of viewerPages.filter((item) => developerMode || !item.developerOnly)) {
        const link = document.createElement("a");
        link.className = page.id === currentPage ? "site-nav__link site-nav__link--active" : "site-nav__link";
        link.href = page.href;
        link.textContent = page.label;
        nav.appendChild(link);
    }
}

async function refreshDeveloperMode(options = {}) {
    const retries = options.retries ?? 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetch("/api/health", { cache: "no-store" });
            if (response.ok) {
                const health = await response.json();
                applyDeveloperMode(Boolean(health.developerMode));
                return;
            }
        } catch {
            // The bundled server can be briefly unavailable while mode changes restart it.
        }

        if (attempt < retries) {
            await delay(350);
        }
    }

    applyDeveloperMode(false);
}

function applyDeveloperMode(developerMode) {
    for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
        renderNavigation(nav, developerMode);
    }

    for (const element of document.querySelectorAll("[data-developer-only]")) {
        element.hidden = !developerMode;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
