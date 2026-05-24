import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ariaHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/aria/index.html"), "utf8");
const setupHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/setup/index.html"), "utf8");
const diagnosticsHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/diagnostics/index.html"), "utf8");

describe("viewer landing page markup", () => {
    test("keeps Aria as a thin static boundary page", () => {
        expect(ariaHtml).toContain('data-current-page="aria"');
        expect(ariaHtml).toContain("<h1>Aria</h1>");
        expect(ariaHtml).toContain("Remote Assistant, Local Bridge");
        expect(ariaHtml).toContain("Explicit Context Send, Not Silent Collection");
        expect(ariaHtml).toContain("Fleet Watch, Setup, And Diagnostics Keep Their Own Homes");
        expect(ariaHtml).toContain('class="module-grid module-grid--two"');
        expect(ariaHtml).toContain('class="module-card module-card--primary module-card--wide"');
        expect(ariaHtml).toContain('href="/fleet/"');
        expect(ariaHtml).toContain('href="/about/?surface=setup"');
        expect(ariaHtml).toContain('href="/settings/"');
        expect(ariaHtml).toContain('href="/diagnostics/"');
        expect(ariaHtml).toContain('/shared/shell.js');
        expect(ariaHtml).not.toContain('/aria/app.js');
    });

    test("keeps /setup/ as a thin compatibility redirect into the setup-focused about surface", () => {
        expect(setupHtml).toContain('content="0; url=/about/?surface=setup"');
        expect(setupHtml).toContain('href="/about/?surface=setup"');
        expect(setupHtml).toContain('window.location.replace("/about/?surface=setup")');
        expect(setupHtml).toContain('data-variant-gate-warning-suppressed');
        expect(setupHtml).not.toContain('/shared/shell.js');
    });

    test("keeps Diagnostics as a thin static landing page over existing raw tools", () => {
        expect(diagnosticsHtml).toContain('data-current-page="diagnostics"');
        expect(diagnosticsHtml).toContain("<h1>Diagnostics</h1>");
        expect(diagnosticsHtml).toContain("Battle Log Explorer");
        expect(diagnosticsHtml).toContain("Battle Workbench");
        expect(diagnosticsHtml).toContain("Cloud Sync Monitor");
        expect(diagnosticsHtml).toContain('data-capability-card="battleLog"');
        expect(diagnosticsHtml).toContain("data-developer-card");
        expect(diagnosticsHtml).toContain("data-developer-unavailable");
        expect(diagnosticsHtml).toContain("Available when Companion developer mode is enabled.");
        expect(diagnosticsHtml).toContain('data-capability-card-fallback');
        expect(diagnosticsHtml).toContain('href="/about/?surface=setup"');
        expect(diagnosticsHtml).toContain('href="/battle-log/"');
        expect(diagnosticsHtml).toContain('href="/battle-log/workbench/"');
        expect(diagnosticsHtml).toContain('href="/diagnostics/cloud-sync/"');
        expect(diagnosticsHtml).not.toContain('href="/majel/"');
        expect(diagnosticsHtml).toContain('href="/about/#diagnostics-bundle"');
        expect(diagnosticsHtml).not.toContain('href="/about/">Open Setup And Support</a>');
        expect(diagnosticsHtml).toContain('href="/settings/#diagnostics"');
        expect(diagnosticsHtml).toContain('/shared/shell.js');
        expect(diagnosticsHtml).not.toContain('/diagnostics/app.js');
    });
});