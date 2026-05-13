import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shellJs = readFileSync(path.resolve(__dirname, "../../viewer/public/shared/shell.js"), "utf8");

describe("viewer shell state hydration", () => {
    test("seeds gated navigation and cards from cached viewer state", () => {
        expect(shellJs).toContain("stfc.viewerState.v1");
        expect(shellJs).toContain("readCachedViewerState() ?? defaultViewerState");
        expect(shellJs).toContain("writeCachedViewerState(state)");
    });

    test("avoids rebuilding navigation when the visible page set is unchanged", () => {
        expect(shellJs).toContain("nav.dataset.renderedPages === signature");
        expect(shellJs).toContain("currentViewerStateKey");
    });
});