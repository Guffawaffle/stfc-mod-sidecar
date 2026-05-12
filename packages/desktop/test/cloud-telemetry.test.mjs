import { describe, expect, it, vi } from "vitest";
import { createCloudTelemetryBridge } from "../../viewer/cloud-telemetry.mjs";

const fixedNow = () => new Date("2026-05-11T10:00:00.000Z");

describe("cloud telemetry bridge", () => {
    it("converts existing mod ship and slot sync payloads without requiring cloud upload", () => {
        const bridge = createCloudTelemetryBridge({
            env: {},
            gameDir: "C:/Games/Star Trek Fleet Command/default/game",
            sidecarVersion: "0.1.0-test",
            now: fixedNow,
            fetchImpl: null,
        });

        const result = bridge.ingestSyncPayload([
            { type: "ship", psid: 12345, hull_id: 9191, level: 34, tier: 6 },
            { type: "slot", sid: 22, slot_type: 2, item_id: 9001 },
        ]);

        expect(result).toMatchObject({
            ok: true,
            protocolVersion: "stfc.telemetry.v1",
            received: 2,
            accepted: 2,
            batches: 1,
            queued: 0,
            uploadEnabled: false,
            endpointConfigured: false,
        });
        expect(bridge.status()).toMatchObject({ acceptedEvents: 2, queueDepth: 0 });
    });

    it("uploads strict telemetry batches with hashed ship keys and bearer auth", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202 });
        const bridge = createCloudTelemetryBridge({
            env: {
                STFC_SIDECAR_CLOUD_TELEMETRY_URL: "https://majel.example.test/api/sidecar/telemetry",
                STFC_SIDECAR_CLOUD_TELEMETRY_TOKEN: "cloud-token",
                STFC_SIDECAR_INSTALL_ID: "install-test",
                STFC_SIDECAR_SESSION_ID: "session-test",
            },
            gameDir: "C:/Games/Star Trek Fleet Command/default/game",
            sidecarVersion: "0.1.0-test",
            now: fixedNow,
            fetchImpl,
            logger: { warn: vi.fn() },
        });

        const result = bridge.ingestSyncPayload([
            { type: "ship", psid: 12345, hull_id: 9191, level: 34, tier: 6 },
            { type: "slot", sid: 22, slot_type: 2, item_id: 9001 },
        ]);

        expect(result).toMatchObject({ accepted: 2, queued: 1, uploadEnabled: true });
        await waitForCall(fetchImpl);

        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe("https://majel.example.test/api/sidecar/telemetry");
        expect(options.method).toBe("POST");
        expect(options.headers.authorization).toBe("Bearer cloud-token");

        const batch = JSON.parse(options.body);
        expect(batch.events.map((event) => event.type)).toEqual(["fleet.snapshot", "fleet.slot.changed"]);
        expect(batch.events[0]).toMatchObject({
            protocolVersion: "stfc.telemetry.v1",
            schemaVersion: "stfc.telemetry.fleet-snapshot.v1",
            installId: "install-test",
            sessionId: "session-test",
            classification: "cloud_private",
        });
        expect(batch.events[0].slots[0].shipKeyHash).toMatch(/^[0-9a-f]{32}$/);
        expect(JSON.stringify(batch)).not.toContain("psid");
        expect(bridge.status()).toMatchObject({ uploadedBatches: 1, uploadedEvents: 2, queueDepth: 0 });
    });
});

async function waitForCall(mock) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mock.mock.calls.length > 0) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("expected fetch to be called");
}