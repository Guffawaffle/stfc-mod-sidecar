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
        expect(unknown.installedDllStatus).toBe("unknown_hash");
        expect(unknown.mismatchKind).toBe("unknown_installed");
        expect(unknown.capabilityReasons.battleLog).toContain("installed_dll_unknown");
    });

    test("uses centralized DLL match results for Battle Log gating", () => {
        const result = gate({
            classification: "unknown",
            dllMatch: {
                state: "installed",
                status: "config_override_match",
                profile: "waffle-advanced",
                effectiveProfile: "waffle-advanced",
                confidence: "medium",
                matchSource: "config_override",
                dllSha256: "E".repeat(64),
                configOverrideLabel: "local-ax-cycle",
                configOverrideConfigPath: "C:/Games/STFC/game/.stfc-sidecar/sidecar-local-config.json",
            },
        }, "waffle-advanced");

        expect(result.capabilityBits.battleLog).toBe(1);
        expect(result.installedProfile).toBe("waffle-advanced");
        expect(result.installedDllStatus).toBe("config_override_match");
        expect(result.mismatchKind).toBe("none");
    });

    test("allows advanced runtime surfaces only when the unsafe unknown-DLL override is enabled", () => {
        const blocked = gate({ classification: "unknown" }, "waffle-advanced");
        const allowed = gate({ classification: "unknown" }, "waffle-advanced", {
            unsafeAllowUnrecognizedInstalledDll: true,
            unsafeOverrideConfigPath: "C:/Games/STFC/game/.stfc-sidecar/sidecar-local-config.json",
        });

        expect(blocked.capabilityBits.battleLog).toBe(0);
        expect(allowed.capabilityBits.battleLog).toBe(1);
        expect(allowed.capabilityBits.eventStore).toBe(1);
        expect(allowed.installedProfile).toBe("unknown");
        expect(allowed.installedEffectiveProfile).toBe("waffle-advanced");
        expect(allowed.installedDllStatus).toBe("unsafe_override_allowed");
        expect(allowed.mismatchKind).toBe("unknown_installed");
        expect(allowed.unsafeOverrides).toEqual({
            allowUnrecognizedInstalledDll: true,
            active: true,
            configPath: "C:/Games/STFC/game/.stfc-sidecar/sidecar-local-config.json",
        });
    });

    test("keeps settings and install status available across DLL states", () => {
        const unknown = gate({ classification: "unknown" }, "waffle-advanced");

        expect(unknown.capabilityBits.settings).toBe(1);
        expect(unknown.capabilityBits.installStatus).toBe(1);
        expect(unknown.capabilities.settings).toBe(true);
        expect(unknown.capabilities.installStatus).toBe(true);
    });
});

function gate(install, selectedProfile, overrides = {}) {
    return buildCommunityModVariantGateContext({
        install: {
            ok: true,
            state: "installed",
            classification: install.classification,
            profile: install.classification,
            dllMatch: install.dllMatch,
            manifest: install.manifest ?? { profile: install.classification },
            matchedRelease: install.matchedRelease ?? null,
        },
        selectedProfile,
        ...overrides,
    });
}