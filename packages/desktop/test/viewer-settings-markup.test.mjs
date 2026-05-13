import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/settings/index.html"), "utf8");
const settingsApp = readFileSync(path.resolve(__dirname, "../../viewer/public/settings/app.js"), "utf8");

describe("viewer settings markup", () => {
    test("keeps save controls outside individual tab panels", () => {
        expect(settingsHtml.indexOf("settings-save-strip")).toBeGreaterThan(settingsHtml.indexOf("settings-tablist"));
        expect(settingsHtml.indexOf("settings-save-strip")).toBeLessThan(settingsHtml.indexOf("<section id=\"settings-panel-general\""));
        expect(settingsHtml).toContain("No unsaved changes");
        expect(settingsHtml).toContain("Save for next launch");
    });

    test("pairs changed indicators with a revert action", () => {
        expect(settingsApp).toContain("settings-chip--changed");
        expect(settingsApp).toContain("settings-chip__action");
        expect(settingsApp).toContain("data-revert-hard-setting");
        expect(settingsApp).toContain("data-revert-notification-event");
    });
});