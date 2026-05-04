import { describe, expect, test } from "vitest";

import { visibleViewerPages } from "../../viewer/public/shared/pages.js";

describe("viewer page visibility", () => {
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
});