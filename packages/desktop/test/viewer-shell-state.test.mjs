import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shellJs = readFileSync(path.resolve(__dirname, "../../viewer/public/shared/shell.js"), "utf8");

describe("viewer shell state hydration", () => {
    test("seeds gated navigation and cards from cached viewer state", () => {
        expect(shellJs).toContain("stfc.viewerState.v1");
        expect(shellJs).toContain("readCachedViewerState() ?? defaultViewerState");
        expect(shellJs).toContain("writeCachedViewerState(state)");
    });

    test("avoids rebuilding navigation when the visible page set is unchanged", () => {
        expect(shellJs).toContain("nav.dataset.renderedPages === signature");
        expect(shellJs).toContain("currentViewerStateKey");
    });

    test("renders both the compact global warning and the setup review summary from the same viewer state", () => {
        expect(shellJs).toContain("variant-gate-warning__headline");
        expect(shellJs).toContain("variant-gate-warning__detail");
        expect(shellJs).toContain("renderVariantGateSetupSummary");
        expect(shellJs).toContain("data-variant-gate-summary");
    });

    test("keeps diagnostics capability cards visible and switches them into disabled-state copy", () => {
        expect(shellJs).toContain('querySelectorAll("[data-capability-card]")');
        expect(shellJs).toContain("module-card--disabled");
        expect(shellJs).toContain("variantGateCapabilityUnavailableSummary");
        expect(shellJs).toContain("data-capability-card-fallback");
    });

    test("keeps developer diagnostics cards discoverable while developer mode is off", () => {
        expect(shellJs).toContain('querySelectorAll("[data-developer-card]")');
        expect(shellJs).toContain('querySelectorAll("[data-developer-unavailable]")');
        expect(shellJs).toContain('closest("[data-capability-card]")');
        expect(shellJs).toContain("capabilityBlocked");
    });
});