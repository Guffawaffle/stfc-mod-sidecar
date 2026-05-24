import { describe, expect, test } from "vitest";

import {
    hasVariantGateReviewState,
    isVariantGateCapabilityReviewOnly,
    shouldShowVariantGateWarning,
    variantGateCapabilityReviewSummary,
    variantGateCapabilityUnavailableSummary,
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

    test("keeps the warning persistent when the unsafe override is active", () => {
        const variantGate = gate({
            mismatchKind: "unknown_installed",
            installedProfile: "unknown",
            unsafeOverrides: {
                allowUnrecognizedInstalledDll: true,
                active: true,
                configPath: "C:/Games/STFC/game/.stfc-sidecar/sidecar-local-config.json",
            },
        });
        const key = variantGateWarningKey(variantGate);
        const view = variantGateWarningViewModel(variantGate);

        expect(shouldShowVariantGateWarning(variantGate)).toBe(true);
        expect(shouldShowVariantGateWarning(variantGate, key)).toBe(true);
        expect(view.title).toMatch(/unsafe dll override/i);
        expect(view.compactSummary).toMatch(/review setup/i);
        expect(view.summary).toMatch(/override is allowing/i);
        expect(view.persistent).toBe(true);
    });

    test("keeps setup review state available even when the global banner can be dismissed", () => {
        expect(hasVariantGateReviewState(gate({ mismatchKind: "unknown_installed", installedProfile: "unknown" }))).toBe(true);
        expect(hasVariantGateReviewState(gate({ mismatchKind: "selected_differs_from_installed" }))).toBe(true);
        expect(hasVariantGateReviewState(gate({ mismatchKind: "none" }))).toBe(false);
    });

    test("builds a user-facing explanation with fix affordance", () => {
        const view = variantGateWarningViewModel(gate({ mismatchKind: "selected_differs_from_installed" }));

        expect(view.title).toMatch(/selected profile/i);
        expect(view.summary).toContain("Basic");
        expect(view.summary).toContain("Waffle Advanced");
        expect(view.fixLabel).toBe("Open STFC Mod Setup");
        expect(view.fixHref).toBe("/about/?surface=setup");
    });

    test("summarizes blocked capability cards with setup-oriented copy", () => {
        const summary = variantGateCapabilityUnavailableSummary(gate({
            mismatchKind: "unknown_installed",
            installedProfile: "unknown",
            capabilityReasons: { battleLog: ["installed_dll_unknown"] },
        }), "battleLog");

        expect(summary).toMatch(/version\.dll unrecognized/i);
        expect(summary).toMatch(/STFC Mod Setup/);
    });

    test("treats unknown installed DLLs as review-only for safe diagnostic profiles", () => {
        const variantGate = gate({
            mismatchKind: "unknown_installed",
            selectedProfile: "waffle-advanced",
            installedProfile: "unknown",
            capabilityReasons: { battleLog: ["installed_dll_unknown"] },
        });

        expect(isVariantGateCapabilityReviewOnly(variantGate, "battleLog")).toBe(true);
        expect(variantGateCapabilityReviewSummary(variantGate, "battleLog")).toMatch(/read-only review/i);
    });

    test("allows developer mode to soften unknown-DLL diagnostics without changing hard unsupported profiles", () => {
        const variantGate = gate({
            mismatchKind: "unknown_installed",
            selectedProfile: "netniv-basic",
            installedProfile: "unknown",
            capabilityReasons: { battleLog: ["installed_dll_unknown"] },
        });

        expect(isVariantGateCapabilityReviewOnly(variantGate, "battleLog")).toBe(false);
        expect(isVariantGateCapabilityReviewOnly(variantGate, "battleLog", { developerMode: true })).toBe(true);
        expect(isVariantGateCapabilityReviewOnly(gate({
            capabilityReasons: { battleLog: ["selected_profile_netniv-basic_does_not_support_battleLog"] },
        }), "battleLog", { developerMode: true })).toBe(false);
    });
});

function gate(overrides = {}) {
    return {
        selectedProfile: overrides.selectedProfile ?? "netniv-basic",
        installedProfile: overrides.installedProfile ?? "waffle-advanced",
        installedState: overrides.installedState ?? "installed",
        mismatchKind: overrides.mismatchKind ?? "selected_differs_from_installed",
        unsafeOverrides: overrides.unsafeOverrides ?? {
            allowUnrecognizedInstalledDll: false,
            active: false,
            configPath: "",
        },
        capabilityReasons: overrides.capabilityReasons ?? {
            battleLog: ["selected_profile_netniv-basic_does_not_support_battleLog"],
        },
    };
}
