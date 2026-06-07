import { describe, expect, test } from "vitest";

import { parseDesktopLifecycleAxArgs, runDesktopLifecycleAction } from "../../../scripts/desktop-lifecycle-ax.mjs";

describe("desktop lifecycle ax", () => {
    test("parses lifecycle arguments with bounded lines and launch args", () => {
        expect(parseDesktopLifecycleAxArgs([
            "--action",
            "logs",
            "--lines",
            "25",
            "--launch-arg",
            "--trace-warnings",
        ])).toEqual({
            action: "logs",
            lines: 25,
            skipStop: false,
            launchArgs: ["--trace-warnings"],
        });

        expect(parseDesktopLifecycleAxArgs([
            "--action",
            "cycle",
            "--skip-stop",
        ])).toEqual({
            action: "cycle",
            lines: 80,
            skipStop: true,
            launchArgs: [],
        });
    });

    test("returns structured status and log snapshots without launching the desktop", async () => {
        const status = await runDesktopLifecycleAction({ action: "status" });
        expect(status).toMatchObject({
            ok: true,
            protocolVersion: "stfc.sidecar.desktop-lifecycle.ax.v1",
            detail: "desktop-lifecycle",
            action: "status",
            result: {
                ok: true,
                expectedPort: 43127,
                healthUrl: expect.stringContaining("127.0.0.1"),
            },
        });

        const logs = await runDesktopLifecycleAction({ action: "logs", lines: 5 });
        expect(logs).toMatchObject({
            ok: true,
            action: "logs",
            result: {
                ok: true,
                lineCount: 5,
                stdoutLogPath: expect.stringContaining("desktop-dev.out.log"),
                stderrLogPath: expect.stringContaining("desktop-dev.err.log"),
            },
        });
    });
});
