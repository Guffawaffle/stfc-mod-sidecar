export const viewerPages = [
    {
        id: "home",
        label: "Dashboard",
        href: "/",
    },
    {
        id: "fleet",
        label: "Fleet",
        href: "/fleet/",
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
        id: "majel",
        label: "Majel",
        href: "/majel/",
        developerOnly: true,
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

    if (page.requiresCapability && capabilities[page.requiresCapability] !== true) {
        return false;
    }

    return true;
}
