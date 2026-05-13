import { describe, expect, test } from "vitest";

import {
    shouldShowVariantGateWarning,
    variantGateWarningKey,
    variantGateWarningViewModel,
} from "../../viewer/public/shared/variant-gate-warning.js";

describe("variant gate warning", () => {
    test("warns for installed-vs-selected mismatches until ignored for the session", () => {
        const variantGate = gate({ mismatchKind: "selected_differs_from_installed" });
        const key = variantGateWarningKey(variantGate);

        expect(shouldShowVariantGateWarning(variantGate)).toBe(true);
        expect(shouldShowVariantGateWarning(variantGate, key)).toBe(false);
    });

    test("warns for unknown installed DLLs but not clean or no-install states", () => {
        expect(shouldShowVariantGateWarning(gate({ mismatchKind: "unknown_installed", installedProfile: "unknown" }))).toBe(true);
        expect(shouldShowVariantGateWarning(gate({ mismatchKind: "none" }))).toBe(false);
        expect(shouldShowVariantGateWarning(gate({ mismatchKind: "no_install", installedProfile: "none" }))).toBe(false);
    });

    test("builds a user-facing explanation with fix affordance", () => {
        const view = variantGateWarningViewModel(gate({ mismatchKind: "selected_differs_from_installed" }));

        expect(view.title).toMatch(/selected profile/i);
        expect(view.summary).toContain("Basic");
        expect(view.summary).toContain("Waffle Advanced");
        expect(view.fixHref).toBe("/settings/#general");
    });
});

function gate(overrides = {}) {
    return {
        selectedProfile: overrides.selectedProfile ?? "netniv-basic",
        installedProfile: overrides.installedProfile ?? "waffle-advanced",
        installedState: overrides.installedState ?? "installed",
        mismatchKind: overrides.mismatchKind ?? "selected_differs_from_installed",
        capabilityReasons: {
            battleLog: ["selected_profile_netniv-basic_does_not_support_battleLog"],
        },
    };
}