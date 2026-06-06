import { describe, expect, it } from "vitest";

import { buildObservedHostileProbeStatus } from "../../viewer/server/observed-hostile-probe-status.mjs";

describe("viewer observed hostile probe status", () => {
    it("flags restart-required when settings enable capture but runtime vars are stale", () => {
        const status = buildObservedHostileProbeStatus({
            settingsPath: "C:/Games/STFC/game/community_patch_settings.toml",
            runtimeVarsPath: "C:/Games/STFC/game/community_patch_runtime.vars",
            settings: {
                exists: true,
                updatedAt: "2026-06-06T09:41:08.000Z",
                updatedAtUnixMs: 200,
                root: {
                    advanced: { diagnostics: { hostile_observation: true } },
                    patches: { objecttracker: true },
                    sidecar: { sync: { enabled: true, url: "http://127.0.0.1:43127/api/sidecar/ingest", token: "secret" } },
                },
            },
            runtime: {
                exists: true,
                updatedAt: "2026-06-06T09:27:24.000Z",
                updatedAtUnixMs: 100,
                root: {
                    advanced: { diagnostics: { hostile_observation: false } },
                    patches: { objecttracker: true },
                    sidecar: { sync: { enabled: true, url: "http://127.0.0.1:43127/api/sidecar/ingest", token: "<redacted>" } },
                },
            },
            gameProcess: {
                checked: true,
                running: true,
            },
        });

        expect(status.status).toBe("restart_required");
        expect(status.summary).toContain("Restart STFC");
        expect(status.settingsChangedAfterRuntime).toBe(true);
        expect(status.details).toContain("Runtime vars still show hostile_observation=false.");
    });

    it("reports disabled-in-settings when hostile observation is not configured", () => {
        const status = buildObservedHostileProbeStatus({
            settings: {
                exists: true,
                root: {
                    advanced: { diagnostics: { hostile_observation: false } },
                    patches: { objecttracker: true },
                    sidecar: { sync: { enabled: true, url: "http://127.0.0.1:43127/api/sidecar/ingest", token: "secret" } },
                },
            },
            runtime: {
                exists: false,
            },
            gameProcess: {
                checked: true,
                running: false,
            },
        });

        expect(status.status).toBe("disabled_in_settings");
        expect(status.summary).toContain("off in community_patch_settings.toml");
    });
});
