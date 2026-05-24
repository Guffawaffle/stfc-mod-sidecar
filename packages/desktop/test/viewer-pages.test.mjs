import { describe, expect, test } from "vitest";

import { visibleViewerPages } from "../../viewer/public/shared/pages.js";

describe("viewer page visibility", () => {
    test("shows the corrected six top-level IA surfaces by default", () => {
        const pages = visibleViewerPages();

        expect(pages.map((page) => page.id)).toEqual(["home", "fleet-watch", "aria", "settings", "setup", "diagnostics"]);
        expect(pages.find((page) => page.id === "home")?.label).toBe("Home");
        expect(pages.find((page) => page.id === "home")?.href).toBe("/");
        expect(pages.find((page) => page.id === "fleet-watch")?.label).toBe("Fleet Watch");
        expect(pages.find((page) => page.id === "fleet-watch")?.href).toBe("/fleet/");
        expect(pages.find((page) => page.id === "aria")?.label).toBe("Aria");
        expect(pages.find((page) => page.id === "settings")?.label).toBe("Settings");
        expect(pages.find((page) => page.id === "setup")?.label).toBe("STFC Mod Setup");
        expect(pages.find((page) => page.id === "setup")?.href).toBe("/about/?surface=setup");
        expect(pages.find((page) => page.id === "diagnostics")?.label).toBe("Diagnostics");
    });

    test("keeps the top-level surfaces stable when battle log is unavailable", () => {
        const pages = visibleViewerPages({
            developerMode: true,
            capabilities: { battleLog: false },
        }).map((page) => page.id);

        expect(pages).toEqual(["home", "fleet-watch", "aria", "settings", "setup", "diagnostics"]);
        expect(pages).not.toContain("battle-log");
        expect(pages).not.toContain("battle-log-workbench");
    });

    test("keeps the top-level surfaces stable when battle log is available", () => {
        const pages = visibleViewerPages({
            developerMode: false,
            capabilities: { battleLog: true },
        }).map((page) => page.id);

        expect(pages).toEqual(["home", "fleet-watch", "aria", "settings", "setup", "diagnostics"]);
        expect(pages).not.toContain("battle-log");
        expect(pages).not.toContain("battle-log-workbench");
    });

    test("keeps the top-level surfaces stable in developer mode", () => {
        const pages = visibleViewerPages({
            developerMode: true,
            capabilities: { battleLog: true },
        }).map((page) => page.id);

        expect(pages).toEqual(["home", "fleet-watch", "aria", "settings", "setup", "diagnostics"]);
        expect(pages).not.toContain("battle-log");
        expect(pages).not.toContain("battle-log-workbench");
    });
});