import { describe, expect, test } from "vitest";

import { visibleViewerPages } from "../../viewer/public/shared/pages.js";

describe("viewer page visibility", () => {
    test("hides capability-gated pages until the capability is explicitly enabled", () => {
        const pages = visibleViewerPages().map((page) => page.id);
        const dashboard = visibleViewerPages().find((page) => page.id === "home");
        const fleet = visibleViewerPages().find((page) => page.id === "fleet");

        expect(dashboard?.label).toBe("Dashboard");
        expect(fleet?.label).toBe("Fleet");
        expect(pages).toContain("fleet");
        expect(pages).not.toContain("battle-log");
        expect(pages).not.toContain("battle-log-workbench");
        expect(pages).toContain("settings");
    });

    test("hides Battle Log surfaces when the active profile lacks battle log capability", () => {
        const pages = visibleViewerPages({
            developerMode: true,
            capabilities: { battleLog: false },
        }).map((page) => page.id);

        expect(pages).not.toContain("battle-log");
        expect(pages).not.toContain("battle-log-workbench");
        expect(pages).toContain("settings");
    });

    test("keeps Battle Log visible for profiles with battle log capability", () => {
        const pages = visibleViewerPages({
            developerMode: false,
            capabilities: { battleLog: true },
        }).map((page) => page.id);

        expect(pages).toContain("battle-log");
        expect(pages).not.toContain("battle-log-workbench");
    });

    test("shows the advanced workbench when Developer Tools and Battle Log are both enabled", () => {
        const pages = visibleViewerPages({
            developerMode: true,
            capabilities: { battleLog: true },
        }).map((page) => page.id);

        expect(pages).toContain("battle-log");
        expect(pages).toContain("battle-log-workbench");
    });
});