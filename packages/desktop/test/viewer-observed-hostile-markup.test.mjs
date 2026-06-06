import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const observedHostileHtml = readFileSync(
    path.resolve(__dirname, "../../viewer/public/diagnostics/observed-hostiles/index.html"),
    "utf8",
);

describe("viewer observed hostile catalog markup", () => {
    test("serves a dedicated diagnostics-hosted observed hostile catalog surface", () => {
        expect(observedHostileHtml).toContain("<title>STFC Sidecar Viewer | Observed Hostile Catalog</title>");
        expect(observedHostileHtml).toContain('data-current-page="diagnostics"');
        expect(observedHostileHtml).toContain("<h1>Observed Hostile Catalog</h1>");
        expect(observedHostileHtml).toContain('id="observed-hostile-search"');
        expect(observedHostileHtml).toContain('id="observed-hostile-limit"');
        expect(observedHostileHtml).toContain('id="observed-hostile-auto-refresh"');
        expect(observedHostileHtml).toContain('id="observed-hostile-refresh"');
        expect(observedHostileHtml).toContain('href="/api/events?scope=observed&limit=200"');
        expect(observedHostileHtml).toContain('id="observed-hostile-runtime-note"');
        expect(observedHostileHtml).toContain('id="observed-hostile-source"');
        expect(observedHostileHtml).toContain('id="observed-hostile-store"');
        expect(observedHostileHtml).toContain('id="observed-hostile-entry-count"');
        expect(observedHostileHtml).toContain('id="observed-hostile-sighting-count"');
        expect(observedHostileHtml).toContain('id="observed-hostile-latest-seen"');
        expect(observedHostileHtml).toContain('id="observed-hostile-status"');
        expect(observedHostileHtml).toContain('id="observed-hostile-list"');
        expect(observedHostileHtml).toContain('id="observed-hostile-detail"');
        expect(observedHostileHtml).toContain('href="/diagnostics/"');
        expect(observedHostileHtml).toContain('/diagnostics/observed-hostiles/app.js');
        expect(observedHostileHtml).toContain('/shared/shell.js');
    });
});
