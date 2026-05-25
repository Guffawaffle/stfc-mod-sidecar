import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fleetHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/fleet/index.html"), "utf8");
const fleetApp = readFileSync(path.resolve(__dirname, "../../viewer/public/fleet/app.js"), "utf8");

describe("viewer fleet markup", () => {
    test("keeps Fleet Watch focused on observed fleet state with a dedicated Fleet script entry", () => {
        expect(fleetHtml).toContain('data-current-page="fleet-watch"');
        expect(fleetHtml).toContain("<h1>Fleet Watch</h1>");
        expect(fleetHtml).toContain('class="console-header-rail console-header-rail--with-controls"');
        expect(fleetHtml).toContain('<span class="console-header-rail__code">02</span>');
        expect(fleetHtml).not.toContain('aria-label="watch section navigation"');
        expect(fleetHtml).toContain("Projection surface");
        expect(fleetHtml).toContain("Observed Rows");
        expect(fleetHtml).toContain("Show empty slots");
        expect(fleetHtml).toContain('id="expand-all-ship-combat-button"');
        expect(fleetHtml).toContain('id="collapse-all-ship-combat-button"');
        expect(fleetHtml).toContain("Recent Activity (preview)");
        expect(fleetHtml).toContain('id="fleet-activity-view"');
        expect(fleetHtml).toContain('href="/diagnostics/"');
        expect(fleetHtml).toContain('id="projection-debug"');
        expect(fleetHtml).toContain("fleet-debug-stamps");
        expect(fleetHtml).toContain('/fleet/app.js');
    });

    test("orders Fleet Watch controls with help last and activity below observed rows", () => {
        expect(fleetHtml.indexOf('id="refresh-button"')).toBeLessThan(fleetHtml.indexOf('id="toggle-empty-slots-button"'));
        expect(fleetHtml.indexOf('id="toggle-empty-slots-button"')).toBeLessThan(fleetHtml.indexOf('aria-label="About Fleet Watch"'));
        expect(fleetHtml.indexOf('id="expand-all-ship-combat-button"')).toBeLessThan(fleetHtml.indexOf('id="collapse-all-ship-combat-button"'));
        expect(fleetHtml.indexOf("Observed Rows")).toBeLessThan(fleetHtml.indexOf("Recent Activity (preview)"));
    });

    test("reads only narrow fleet routes and keeps explicit unavailable, empty, stale, and current copy", () => {
        expect(fleetApp).toContain('fetch("/api/fleet/projection"');
        expect(fleetApp).toContain('fetch("/api/fleet/activity?limit=6"');
        expect(fleetApp).toContain('fetch("/api/fleet/ship-combat-preview"');
        expect(fleetApp).not.toContain("/api/events");
        expect(fleetApp).not.toContain("Raw JSON");
        expect(fleetApp).toContain("Projection unavailable.");
        expect(fleetApp).toContain("Projection available but empty.");
        expect(fleetApp).toContain("Stale: last stored rows");
        expect(fleetApp).toContain("Current:");
        expect(fleetApp).toContain("Show empty slots");
        expect(fleetApp).toContain("No recent activity preview is available yet.");
        expect(fleetApp).toContain("Recent combat");
    });
});
