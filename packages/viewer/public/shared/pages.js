export const viewerPages = [
    {
        id: "watch",
        label: "Watch",
        href: "/",
    },
    {
        id: "aria",
        label: "Aria",
        href: "/aria/",
    },
    {
        id: "setup",
        label: "Setup",
        href: "/setup/",
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
