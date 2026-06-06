import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqlSidecarEventStore, deriveSidecarEventKey } from "./sql-event-store.js";
import {
    BATTLE_CAPTURE_SCHEMA_VERSION,
    BATTLE_REPORT_SCHEMA_VERSION,
    OBSERVED_HOSTILE_SCHEMA_VERSION,
    SIDECAR_EVENT_PROTOCOL_VERSION,
    type BattleCaptureEvent,
    type BattleReportEvent,
    type DebugEvent,
    type ObservedHostileEvent,
} from "../events/types.js";

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

        await store.append([sampleCaptureEvent(), sampleDebugEvent(), sampleObservedHostileEvent()]);

        const battleEvents = await store.listRecentByTypes(["battle.capture"], 10);
        const debugEvents = await store.listRecentByTypes(["debug.event"], 10);
        const hostileEvents = await store.listRecentByTypes(["observed.hostile"], 10);

        expect(await store.count()).toBe(3);
        expect(await store.countByTypes(["battle.capture"])).toBe(1);
        expect(await store.countByTypes(["debug.event"])).toBe(1);
        expect(await store.countByTypes(["observed.hostile"])).toBe(1);
        expect(battleEvents.map((entry) => entry.event.type)).toEqual(["battle.capture"]);
        expect(debugEvents.map((entry) => entry.event.type)).toEqual(["debug.event"]);
        expect(hostileEvents.map((entry) => entry.event.type)).toEqual(["observed.hostile"]);

        await store.close();
    });

    it("loads complete battle groups by battle id or journal id in sqlite", async () => {
        const store = await createSqlSidecarEventStore({
            backend: "sqlite",
            connection: makeTempPath("events.sqlite"),
        });

        await store.append([
            sampleCaptureEvent({ battleId: "battle-lookup", journalId: "journal-lookup" }),
            sampleReportEvent({
                battleId: "battle-lookup",
                journalId: "journal-lookup",
                timestamp: "2026-04-28T00:00:02.000Z",
            }),
            sampleCaptureEvent({ battleId: "other-battle", journalId: "other-journal" }),
        ]);

        const byBattleId = await store.listByBattleKey("battle-lookup");
        expect(byBattleId.map((entry) => entry.event.battleId)).toEqual(["battle-lookup", "battle-lookup"]);
        expect(byBattleId.map((entry) => entry.sequenceId)).toEqual([1, 2]);

        const byJournalId = await store.listByBattleKey("journal-lookup");
        expect(byJournalId.map((entry) => entry.event.journalId)).toEqual(["journal-lookup", "journal-lookup"]);

        await store.close();
    });

    it("reads latest stored battle freshness metadata in sqlite", async () => {
        const store = await createSqlSidecarEventStore({
            backend: "sqlite",
            connection: makeTempPath("events.sqlite"),
        });

        await store.append([
            sampleDebugEvent(),
            sampleCaptureEvent({
                battleId: "battle-older",
                journalId: "journal-older",
                timestamp: "2026-04-28T00:00:00.000Z",
                capturedAtUnixMs: 1777334400000,
            }),
            sampleReportEvent({
                battleId: "battle-newer",
                journalId: "journal-newer",
                timestamp: "2026-04-28T00:05:00.000Z",
                capturedAtUnixMs: 1777334700000,
            }),
        ]);

        await expect(store.readLatestBattleFreshness()).resolves.toEqual({
            latestBattleId: "battle-newer",
            latestJournalId: "journal-newer",
            latestCapturedAtUnixMs: 1777334700000,
            latestTimestampIsoUtc: "2026-04-28T00:05:00.000Z",
        });

        await store.close();
    });
});

function makeTempPath(fileName: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "stfc-sidecar-store-"));
    tempDirs.push(dir);
    return path.join(dir, fileName);
}

function sampleCaptureEvent(overrides: Partial<BattleCaptureEvent> = {}): BattleCaptureEvent {
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
        ...overrides,
    };
}

function sampleReportEvent(overrides: Partial<BattleReportEvent> = {}): BattleReportEvent {
    return {
        protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
        type: "battle.report",
        schemaVersion: BATTLE_REPORT_SCHEMA_VERSION,
        timestamp: "2026-04-28T00:00:01.000Z",
        source: "stfc-community-mod",
        journalId: "sample-journal-001",
        battleId: "sample-battle-001",
        capturedAtUnixMs: 1777334400000,
        report: {
            summary: { outcome: "initiator_victory" },
            rewards: [],
            fleets: [],
            events: [],
            decode: {},
            parity: {},
        },
        ...overrides,
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

function sampleObservedHostileEvent(overrides: Partial<ObservedHostileEvent> = {}): ObservedHostileEvent {
    return {
        protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
        type: "observed.hostile",
        schemaVersion: OBSERVED_HOSTILE_SCHEMA_VERSION,
        timestamp: "2026-04-28T00:00:02.000Z",
        source: "stfc-community-mod",
        observation: {
            sourceSurface: "prescan_target_widget",
            confidence: "strong",
            runtimeFleetId: "4001",
            hullId: "3066099110",
            hullName: "Armada Carrier",
            locationTranslationId: "847108551",
        },
        ...overrides,
    };
}
