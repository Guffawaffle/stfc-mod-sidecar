import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fleetHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/fleet/index.html"), "utf8");
const fleetApp = readFileSync(path.resolve(__dirname, "../../viewer/public/fleet/app.js"), "utf8");

describe("viewer fleet markup", () => {
    test("adds a normal navigation page with a dedicated Fleet script entry", () => {
        expect(fleetHtml).toContain('data-current-page="fleet"');
        expect(fleetHtml).toContain("<h1>Current Fleet Projection</h1>");
        expect(fleetHtml).toContain("Observed fleet rows");
        expect(fleetHtml).toContain("Show empty slots");
        expect(fleetHtml).toContain('/fleet/app.js');
    });

    test("reads only the fleet projection route and keeps explicit unavailable, empty, stale, and current copy", () => {
        expect(fleetApp).toContain('fetch("/api/fleet/projection"');
        expect(fleetApp).not.toContain("/api/events");
        expect(fleetApp).toContain("Projection unavailable.");
        expect(fleetApp).toContain("Projection available but empty.");
        expect(fleetApp).toContain("Projection may be stale.");
        expect(fleetApp).toContain("Projection current.");
        expect(fleetApp).toContain("Show empty slots");
    });
});
