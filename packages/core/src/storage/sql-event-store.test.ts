import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqlSidecarEventStore, deriveSidecarEventKey } from "./sql-event-store.js";
import { BATTLE_CAPTURE_SCHEMA_VERSION, SIDECAR_EVENT_PROTOCOL_VERSION, type BattleCaptureEvent, type DebugEvent } from "../events/types.js";

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
    }
});

describe("sql sidecar event store", () => {
    it("deduplicates canonical battle events in sqlite", async () => {
        const store = await createSqlSidecarEventStore({
            backend: "sqlite",
            connection: makeTempPath("events.sqlite"),
        });

        const event = sampleCaptureEvent();
        const appendResult = await store.append([event, event]);
        const recent = await store.listRecent(10);
        const stored = await store.getBySequenceId(recent[0]?.sequenceId ?? 0);

        expect(appendResult).toEqual({
            received: 2,
            stored: 1,
            duplicates: 1,
        });
        expect(await store.count()).toBe(1);
        expect(recent).toHaveLength(1);
        expect(recent[0]?.event.type).toBe("battle.capture");
        expect(stored?.eventKey).toBe(deriveSidecarEventKey(event));

        await store.close();
    });

    it("uses a stable journal-backed event key", () => {
        expect(deriveSidecarEventKey(sampleCaptureEvent())).toBe(
            `battle.capture:${BATTLE_CAPTURE_SCHEMA_VERSION}:sample-journal-001`,
        );
    });

    it("filters recent events by event type in sqlite", async () => {
        const store = await createSqlSidecarEventStore({
            backend: "sqlite",
            connection: makeTempPath("events.sqlite"),
        });

        await store.append([sampleCaptureEvent(), sampleDebugEvent()]);

        const battleEvents = await store.listRecentByTypes(["battle.capture"], 10);
        const debugEvents = await store.listRecentByTypes(["debug.event"], 10);

        expect(await store.count()).toBe(2);
        expect(await store.countByTypes(["battle.capture"])).toBe(1);
        expect(await store.countByTypes(["debug.event"])).toBe(1);
        expect(battleEvents.map((entry) => entry.event.type)).toEqual(["battle.capture"]);
        expect(debugEvents.map((entry) => entry.event.type)).toEqual(["debug.event"]);

        await store.close();
    });
});

function makeTempPath(fileName: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "stfc-sidecar-store-"));
    tempDirs.push(dir);
    return path.join(dir, fileName);
}

function sampleCaptureEvent(): BattleCaptureEvent {
    return {
        protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
        type: "battle.capture",
        schemaVersion: BATTLE_CAPTURE_SCHEMA_VERSION,
        timestamp: "2026-04-28T00:00:00.000Z",
        source: "stfc-community-mod",
        journalId: "sample-journal-001",
        battleId: "sample-battle-001",
        capturedAtUnixMs: 1777334400000,
        capture: {
            sourceKind: "scopely.journal.battle",
            summary: { targetId: "mar_sample" },
            participants: [],
            battleLog: {
                encoding: "string_tokens.v1",
                tokenCount: 2,
                tokens: ["-96", "111"],
            },
        },
    };
}

function sampleDebugEvent(): DebugEvent {
    return {
        protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
        type: "debug.event",
        timestamp: "2026-04-28T00:00:01.000Z",
        source: "test",
        level: "info",
        message: "debug sample",
    };
}