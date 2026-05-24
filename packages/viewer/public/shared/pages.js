export const viewerPages = [
    {
        id: "home",
        label: "Home",
        href: "/",
    },
    {
        id: "fleet-watch",
        label: "Fleet Watch",
        href: "/fleet/",
    },
    {
        id: "aria",
        label: "Aria",
        href: "/aria/",
    },
    {
        id: "settings",
        label: "Settings",
        href: "/settings/",
    },
    {
        id: "setup",
        label: "STFC Mod Setup",
        href: "/about/?surface=setup",
    },
    {
        id: "diagnostics",
        label: "Diagnostics",
        href: "/diagnostics/",
    },
];

export function visibleViewerPages(state = {}) {
    return viewerPages.filter((page) => isViewerPageVisible(page, state));
}

export function isViewerPageVisible(page, state = {}) {
    const developerMode = Boolean(state.developerMode);
    const capabilities = state.capabilities ?? {};
    if (page.developerOnly && !developerMode) {
        return false;
    }

    if (page.requiresCapability && capabilities[page.requiresCapability] !== true) {
        return false;
    }

    return true;
}
