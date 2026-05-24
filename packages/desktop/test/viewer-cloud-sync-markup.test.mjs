import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cloudSyncHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/diagnostics/cloud-sync/index.html"), "utf8");
const legacyHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/majel/index.html"), "utf8");
const cloudSyncApp = readFileSync(path.resolve(__dirname, "../../viewer/public/majel/app.js"), "utf8");

describe("viewer cloud sync monitor markup", () => {
    test("serves the new Diagnostics route with the existing monitor app module", () => {
        expect(cloudSyncHtml).toContain('data-current-page="diagnostics"');
        expect(cloudSyncHtml).toContain("<h1>Cloud Sync Monitor</h1>");
        expect(cloudSyncHtml).toContain("Accepted cloud sync envelopes from the local sidecar window.");
        expect(cloudSyncHtml).toContain("Select a cloud sync envelope to inspect its payload.");
        expect(cloudSyncHtml).toContain('/majel/app.js');
        expect(cloudSyncHtml).toContain('/shared/shell.js');
        expect(cloudSyncHtml).not.toContain('/diagnostics/cloud-sync/app.js');
    });

    test("keeps the legacy /majel/ route on the clearer Cloud Sync Monitor copy", () => {
        expect(legacyHtml).toContain("<title>STFC Sidecar Viewer | Cloud Sync Monitor</title>");
        expect(legacyHtml).toContain("<h1>Cloud Sync Monitor</h1>");
        expect(legacyHtml).toContain("Select a cloud sync envelope to inspect its payload.");
        expect(legacyHtml).toContain('/majel/app.js');
    });

    test("updates user-facing monitor strings without changing the Majel API paths", () => {
        expect(cloudSyncApp).toContain("No cloud sync envelopes have been accepted yet.");
        expect(cloudSyncApp).toContain("Select a cloud sync envelope to inspect its payload.");
        expect(cloudSyncApp).toContain("Unable to load cloud sync envelope.");
        expect(cloudSyncApp).toContain('fetch(`/api/majel/events?limit=${limit}`');
        expect(cloudSyncApp).toContain('new EventSource("/api/majel/stream")');
        expect(cloudSyncApp).not.toContain("No Majel envelopes have been accepted yet.");
        expect(cloudSyncApp).not.toContain("Select a Majel envelope to inspect its payload.");
        expect(cloudSyncApp).not.toContain("Unable to load Majel envelope.");
    });
});