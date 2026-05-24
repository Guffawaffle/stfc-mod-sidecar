import { describe, expect, test } from "vitest";

import {
    classifyInstalledCommunityModDll,
    resolveInstalledCommunityModDllStatus,
} from "../../viewer/community-mod-dll-classification.mjs";

describe("community mod DLL classification", () => {
    test("classifies known release fingerprints as known matches", () => {
        const result = classifyInstalledCommunityModDll({
            installState: "installed",
            dllExists: true,
            dllSha256: "A".repeat(64),
            matchedRelease: {
                profile: "waffle-advanced",
                dllSha256: "A".repeat(64),
            },
        });

        expect(result).toMatchObject({
            status: "known_match",
            profile: "waffle-advanced",
            effectiveProfile: "waffle-advanced",
            confidence: "high",
            matchSource: "release_fingerprint",
        });
    });

    test("classifies configured local overrides as config override matches", () => {
        const result = classifyInstalledCommunityModDll({
            installState: "installed",
            dllExists: true,
            dllSha256: "B".repeat(64),
            localConfig: {
                path: "C:/Games/STFC/game/.stfc-sidecar/sidecar-local-config.json",
                recognizedInstalledDlls: [{
                    dllSha256: "B".repeat(64),
                    profile: "waffle-advanced",
                    label: "local-ax-cycle",
                }],
            },
        });

        expect(result).toMatchObject({
            status: "config_override_match",
            profile: "waffle-advanced",
            effectiveProfile: "waffle-advanced",
            confidence: "medium",
            matchSource: "config_override",
            configOverrideLabel: "local-ax-cycle",
        });
    });

    test("classifies unknown hashes without overrides as unknown", () => {
        const result = classifyInstalledCommunityModDll({
            installState: "installed",
            dllExists: true,
            dllSha256: "C".repeat(64),
        });

        expect(result).toMatchObject({
            status: "unknown_hash",
            profile: "unknown",
            effectiveProfile: "unknown",
            confidence: "low",
        });
    });

    test("keeps unsafe overrides honest while exposing an effective profile", () => {
        const result = resolveInstalledCommunityModDllStatus({
            install: {
                ok: true,
                state: "installed",
                classification: "unknown",
                dllMatch: {
                    state: "installed",
                    status: "unknown_hash",
                    profile: "unknown",
                    effectiveProfile: "unknown",
                    confidence: "low",
                    dllSha256: "D".repeat(64),
                },
            },
            selectedProfile: "waffle-advanced",
            unsafeAllowUnrecognizedInstalledDll: true,
            unsafeOverrideConfigPath: "C:/Games/STFC/game/.stfc-sidecar/sidecar-local-config.json",
        });

        expect(result).toMatchObject({
            status: "unsafe_override_allowed",
            profile: "unknown",
            effectiveProfile: "waffle-advanced",
            unsafeOverrideActive: true,
        });
    });
});