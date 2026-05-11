import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { appendBoundedLogLineSync, trimLogFileSync } from "../src/bounded-log-file.mjs";

describe("bounded local log files", () => {
    test("appends without truncation while the file stays under the cap", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "stfc-sidecar-log-bounds-"));
        const logFile = path.join(directory, "desktop.log");

        try {
            appendBoundedLogLineSync(logFile, "first line\n", { maxBytes: 128, keepBytes: 64 });
            appendBoundedLogLineSync(logFile, "second line\n", { maxBytes: 128, keepBytes: 64 });

            await expect(readFile(logFile, "utf8")).resolves.toBe("first line\nsecond line\n");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test("truncates older output and keeps the newest lines when the cap is exceeded", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "stfc-sidecar-log-bounds-"));
        const logFile = path.join(directory, "desktop.log");
        const truncationBounds = { maxBytes: 128, keepBytes: 64 };

        try {
            appendBoundedLogLineSync(logFile, "alpha-alpha-alpha-alpha\n", truncationBounds);
            appendBoundedLogLineSync(logFile, "beta-beta-beta-beta\n", truncationBounds);
            appendBoundedLogLineSync(logFile, "gamma-gamma-gamma-gamma\n", truncationBounds);
            appendBoundedLogLineSync(logFile, "delta-delta-delta-delta\n", truncationBounds);
            appendBoundedLogLineSync(logFile, "epsilon-epsilon-epsilon\n", truncationBounds);
            appendBoundedLogLineSync(logFile, "zeta-zeta-zeta-zeta\n", truncationBounds);

            const contents = await readFile(logFile, "utf8");
            expect(contents).toContain("[sidecar-log] truncated older troubleshooting output");
            expect(contents).toContain("zeta-zeta-zeta-zeta\n");
            expect(contents).not.toContain("alpha-alpha-alpha-alpha\n");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test("ignores missing files when trimming", () => {
        expect(trimLogFileSync(path.join(tmpdir(), "stfc-sidecar-log-bounds-missing.log"), { maxBytes: 64, keepBytes: 32 })).toBe(false);
    });
});