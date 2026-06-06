import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { parseDesktopDevArgs } from "../../../scripts/desktop-dev.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPackageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
const desktopPackageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
const desktopDevScript = readFileSync(path.resolve(__dirname, "../../../scripts/desktop-dev.mjs"), "utf8");
const axScript = readFileSync(path.resolve(__dirname, "../../../scripts/ax.mjs"), "utf8");
const familyManifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../manifests/families/sidecar.family.json"), "utf8"));

describe("desktop dev script", () => {
    test("stops a stale managed viewer before Electron starts its desktop sidecar", () => {
        expect(rootPackageJson.scripts["desktop:dev"]).toBe("node ./scripts/desktop-dev.mjs");
        expect(rootPackageJson.scripts["desktop:dev:bg"]).toBe("node ./scripts/desktop-dev.mjs start-bg");
        expect(rootPackageJson.scripts["desktop:dev:status"]).toBe("node ./scripts/desktop-dev.mjs status");
        expect(rootPackageJson.scripts["desktop:dev:stop"]).toBe("node ./scripts/desktop-dev.mjs stop");
        expect(rootPackageJson.scripts["desktop:dev:logs"]).toBe("node ./scripts/desktop-dev.mjs logs");
        expect(desktopPackageJson.scripts.dev).toBe("node ../../scripts/desktop-dev.mjs --skip-stop");
        expect(desktopDevScript).toContain("run(resolveNpmInvocation([\"run\", \"server:stop\"])");
        expect(desktopDevScript).toContain("delete electronEnv.ELECTRON_RUN_AS_NODE;");
        expect(desktopDevScript).toContain("import electronPath from \"electron\";");
        expect(desktopDevScript).toContain("const runtimeDir = path.join(repoRoot, \".runtime\")");
        expect(desktopDevScript).toContain("const pidPath = path.join(runtimeDir, \"desktop-dev.pid\")");
        expect(desktopDevScript).toContain("const logsDir = path.join(repoRoot, \".logs\")");
        expect(desktopDevScript).toContain("const stdoutLogPath = path.join(logsDir, \"desktop-dev.out.log\")");
        expect(axScript).toContain("desktop:start");
        expect(familyManifest.commands["desktop-start"].executionTarget.args).toEqual(["desktop:start"]);
    });

    test("parses background and log commands without changing foreground defaults", () => {
        expect(parseDesktopDevArgs([])).toEqual({
            command: "start",
            skipStop: false,
            cycle: false,
            launchArgs: [],
            lines: 80,
        });
        expect(parseDesktopDevArgs(["--skip-stop"])) .toEqual({
            command: "start",
            skipStop: true,
            cycle: false,
            launchArgs: [],
            lines: 80,
        });
        expect(parseDesktopDevArgs(["start-bg", "--foo"])) .toEqual({
            command: "start-bg",
            skipStop: false,
            cycle: false,
            launchArgs: ["--foo"],
            lines: 80,
        });
        expect(parseDesktopDevArgs(["start-bg", "--cycle", "--foo"])) .toEqual({
            command: "start-bg",
            skipStop: false,
            cycle: true,
            launchArgs: ["--foo"],
            lines: 80,
        });
        expect(parseDesktopDevArgs(["logs", "--lines", "25"])) .toEqual({
            command: "logs",
            skipStop: false,
            cycle: false,
            launchArgs: [],
            lines: 25,
        });
    });
});
