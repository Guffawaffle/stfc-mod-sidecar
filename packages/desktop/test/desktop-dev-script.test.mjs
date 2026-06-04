import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPackageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
const desktopPackageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
const desktopDevScript = readFileSync(path.resolve(__dirname, "../../../scripts/desktop-dev.mjs"), "utf8");

describe("desktop dev script", () => {
    test("stops a stale managed viewer before Electron starts its desktop sidecar", () => {
        expect(rootPackageJson.scripts["desktop:dev"]).toBe("node ./scripts/desktop-dev.mjs");
        expect(desktopPackageJson.scripts.dev).toBe("node ../../scripts/desktop-dev.mjs --skip-stop");
        expect(desktopDevScript).toContain("run(resolveNpmInvocation([\"run\", \"server:stop\"])");
        expect(desktopDevScript).toContain("delete electronEnv.ELECTRON_RUN_AS_NODE;");
        expect(desktopDevScript).toContain("import electronPath from \"electron\";");
    });
});
