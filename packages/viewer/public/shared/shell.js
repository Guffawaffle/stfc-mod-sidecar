import { viewerPages } from "./pages.js";

for (const nav of document.querySelectorAll("[data-viewer-nav]")) {
    renderNavigation(nav);
}

function renderNavigation(nav) {
    const currentPage = nav.dataset.currentPage ?? "";
    nav.textContent = "";

    for (const page of viewerPages) {
        const link = document.createElement("a");
        link.className = page.id === currentPage ? "site-nav__link site-nav__link--active" : "site-nav__link";
        link.href = page.href;
        link.textContent = page.label;
        nav.appendChild(link);
    }
}