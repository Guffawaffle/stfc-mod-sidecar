export const viewerPages = [
    {
        id: "home",
        label: "Home",
        href: "/",
    },
    {
        id: "battle-log",
        label: "Battle Log",
        href: "/battle-log/",
        requiresCapability: "battleLog",
    },
    {
        id: "battle-log-workbench",
        label: "Workbench",
        href: "/battle-log/workbench/",
        developerOnly: true,
        requiresCapability: "battleLog",
    },
    {
        id: "settings",
        label: "Settings",
        href: "/settings/",
    },
    {
        id: "about",
        label: "About",
        href: "/about/",
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

    if (page.requiresCapability && capabilities[page.requiresCapability] === false) {
        return false;
    }

    return true;
}