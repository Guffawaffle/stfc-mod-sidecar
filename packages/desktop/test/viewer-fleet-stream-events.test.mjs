import { describe, expect, it } from "vitest";

import {
    fleetProjectionStreamSummary,
    shouldNotifyFleetProjectionChanged,
} from "../../viewer/server/fleet-stream-events.mjs";

describe("viewer fleet stream events", () => {
    it("notifies only when broker projection advances", () => {
        expect(shouldNotifyFleetProjectionChanged({ projectionAdvanced: 1 })).toBe(true);
        expect(shouldNotifyFleetProjectionChanged({ projectionAdvanced: 0, projectionNoOp: 1 })).toBe(false);
        expect(shouldNotifyFleetProjectionChanged({ projectionAdvanced: 0, projectionStale: 1 })).toBe(false);
        expect(shouldNotifyFleetProjectionChanged(null)).toBe(false);
    });

    it("builds a projection-safe stream summary without raw payloads or private identifiers", () => {
        const summary = fleetProjectionStreamSummary({
            ok: true,
            available: true,
            generatedAt: "2026-05-18T12:06:00.000Z",
            cloudUploadEnabled: false,
            projection: {
                projectionKey: "fleet:install-secret",
                installId: "install-secret",
                sessionId: "session-secret",
                stateVersion: 17,
                stateHash: "hash-safe",
                observedAt: "2026-05-18T12:05:00.000Z",
                updatedAt: "2026-05-18T12:05:00.000Z",
                slotCount: 1,
                slots: [{
                    slotKey: "slot-0",
                    fleetKey: "fleet-private",
                    token: "secret-sync-token",
                    payload: { coordinates: { x: 1, y: 2 } },
                }],
            },
        });

        expect(summary).toEqual({
            stateVersion: 17,
            stateHash: "hash-safe",
            observedAt: "2026-05-18T12:05:00.000Z",
            updatedAt: "2026-05-18T12:05:00.000Z",
            slotCount: 1,
        });
        expect(JSON.stringify(summary)).not.toContain("secret");
        expect(JSON.stringify(summary)).not.toContain("coordinates");
        expect(JSON.stringify(summary)).not.toContain("payload");
    });
});
