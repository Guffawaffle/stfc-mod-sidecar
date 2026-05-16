import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFeedWatcher } from "../../viewer/server/feed-watcher.mjs";

const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("viewer feed watcher", () => {
    it("returns the existing missing-feed snapshot shape", async () => {
        const feedPath = path.join(await tempDir(), "missing.jsonl");
        const feedWatcher = createTestFeedWatcher(feedPath);

        const snapshot = await feedWatcher.readFeedSnapshot(25);

        expect(snapshot).toMatchObject({
            ok: false,
            feedPath,
            exists: false,
            pollHintMs: 2000,
            events: [],
            error: "Feed file not found. Start the STFC mod feed emitter or point the viewer at another JSONL file.",
        });
    });

    it("indexes feed lines for summary snapshots and detail reads", async () => {
        const directory = await tempDir();
        const feedPath = path.join(directory, "community_patch_battle_feed.jsonl");
        await writeFile(feedPath, [
            JSON.stringify({ type: "debug.event", message: "first" }),
            "not-json",
            JSON.stringify({ type: "debug.event", message: "pending" }),
        ].join("\n"), "utf8");

        const feedWatcher = createTestFeedWatcher(feedPath);
        const summary = await feedWatcher.readFeedSnapshot(10, { includeDetails: false });

        expect(summary).toMatchObject({
            ok: true,
            feedPath,
            exists: true,
            detail: "summary",
            pollHintMs: 2000,
            totalLines: 3,
            returnedLines: 3,
        });
        expect(summary.events.map((event) => event.lineNumber)).toEqual([3, 2, 1]);
        expect(summary.events[0]).toMatchObject({ parsed: true, summary: { title: "pending" } });
        expect(summary.events[0]).not.toHaveProperty("startOffset");
        expect(summary.events[1]).toMatchObject({ parsed: false, summary: { title: "invalid" } });

        const detail = await feedWatcher.readFeedLine(3);

        expect(detail).toMatchObject({
            ok: true,
            feedPath,
            exists: true,
            detail: "full",
            totalLines: 3,
            event: {
                lineNumber: 3,
                rawLine: JSON.stringify({ type: "debug.event", message: "pending" }),
                parsed: true,
                summary: { title: "pending" },
            },
        });
    });

    it("closes watcher lifecycle without depending on debounce timing", async () => {
        const directory = await tempDir();
        const feedPath = path.join(directory, "community_patch_battle_feed.jsonl");
        await writeFile(feedPath, `${JSON.stringify({ type: "debug.event", message: "first" })}\n`, "utf8");
        const logger = { log: vi.fn(), warn: vi.fn() };
        const feedWatcher = createTestFeedWatcher(feedPath, { logger });

        expect(() => feedWatcher.ensure()).not.toThrow();
        feedWatcher.close();
    });
});

function createTestFeedWatcher(feedPath, overrides = {}) {
    return createFeedWatcher({
        feedPath,
        logger: { log: () => { }, warn: () => { } },
        normalizeLine: (rawLine, lineNumber) => linePayload(rawLine, lineNumber, "full"),
        pollHintMs: 2000,
        summarizeLine: (rawLine, lineNumber) => linePayload(rawLine, lineNumber, "summary"),
        ...overrides,
    });
}

function linePayload(rawLine, lineNumber, detail) {
    try {
        const event = JSON.parse(rawLine);
        return {
            lineNumber,
            rawLine: detail === "full" ? rawLine : undefined,
            parsed: true,
            detail,
            summary: { title: event.message },
        };
    } catch (error) {
        return {
            lineNumber,
            rawLine: detail === "full" ? rawLine : undefined,
            parsed: false,
            detail,
            error: error instanceof Error ? error.message : String(error),
            summary: { title: "invalid" },
        };
    }
}

async function tempDir() {
    const directory = await mkdtemp(path.join(tmpdir(), "stfc-sidecar-feed-watcher-"));
    tempDirs.push(directory);
    return directory;
}
