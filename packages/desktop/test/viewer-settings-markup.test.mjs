import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/settings/index.html"), "utf8");
const settingsApp = readFileSync(path.resolve(__dirname, "../../viewer/public/settings/app.js"), "utf8");
const hotkeyDependencies = readFileSync(path.resolve(__dirname, "../../viewer/public/settings/hotkey-dependencies.js"), "utf8");

describe("viewer settings markup", () => {
    test("marks the interactive settings page as the top-level Settings surface", () => {
        expect(settingsHtml).toContain('data-current-page="settings"');
        expect(settingsHtml).toContain('class="console-header-rail"');
        expect(settingsHtml).toContain('<span class="console-header-rail__code">04</span>');
        expect(settingsHtml).toContain("<h1>Companion Settings</h1>");
        expect(settingsHtml).toContain("Preferences and local controls");
    });

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

    test("includes Scopely hotkey dependency affordances", () => {
        expect(settingsHtml).toContain('id="settings-hotkey-dependency-note"');
        expect(settingsApp).toContain("buildHotkeyDependencyState");
        expect(settingsApp).toContain("keybindingsAvailable");
        expect(hotkeyDependencies).toContain("control.use_scopely_hotkeys");
    });
});
