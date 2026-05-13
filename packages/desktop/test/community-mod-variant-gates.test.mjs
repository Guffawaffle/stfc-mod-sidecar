import { describe, expect, test } from "vitest";

import { buildCommunityModVariantGateContext } from "../../viewer/community-mod-variant-gates.mjs";

describe("community mod variant gates", () => {
    test("requires installed DLL reality and selected intent for Advanced runtime features", () => {
        expect(gate({ classification: "waffle-advanced" }, "waffle-advanced").capabilities.battleLog).toBe(true);
        expect(gate({ classification: "waffle-advanced" }, "waffle-basic").capabilities.battleLog).toBe(false);
        expect(gate({ classification: "netniv-basic" }, "waffle-advanced").capabilities.battleLog).toBe(false);
        expect(gate({ classification: "waffle-advanced" }, "waffle-basic").capabilities.notifications).toBe(true);
    });

    test("fails closed for missing or unknown installed DLLs", () => {
        const missing = buildCommunityModVariantGateContext({
            install: { ok: true, state: "none", classification: "none", profile: "none" },
            selectedProfile: "waffle-advanced",
        });
        const unknown = gate({ classification: "unknown" }, "waffle-advanced");

        expect(missing.capabilityBits.battleLog).toBe(0);
        expect(missing.mismatchKind).toBe("no_install");
        expect(missing.capabilityReasons.battleLog).toContain("installed_dll_missing");
        expect(unknown.capabilityBits.battleLog).toBe(0);
        expect(unknown.mismatchKind).toBe("unknown_installed");
        expect(unknown.capabilityReasons.battleLog).toContain("installed_dll_unknown");
    });

    test("keeps settings and install status available across DLL states", () => {
        const unknown = gate({ classification: "unknown" }, "waffle-advanced");

        expect(unknown.capabilityBits.settings).toBe(1);
        expect(unknown.capabilityBits.installStatus).toBe(1);
        expect(unknown.capabilities.settings).toBe(true);
        expect(unknown.capabilities.installStatus).toBe(true);
    });
});

function gate(install, selectedProfile) {
    return buildCommunityModVariantGateContext({
        install: {
            ok: true,
            state: "installed",
            classification: install.classification,
            profile: install.classification,
            manifest: install.manifest ?? { profile: install.classification },
            matchedRelease: install.matchedRelease ?? null,
        },
        selectedProfile,
    });
}