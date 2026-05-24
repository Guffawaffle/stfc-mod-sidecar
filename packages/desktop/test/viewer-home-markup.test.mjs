import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const homeHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/index.html"), "utf8");

describe("viewer home markup", () => {
    test("restores Home as the card-based launcher with separate Settings and STFC Mod Setup surfaces", () => {
        expect(homeHtml).toContain("<title>STFC Sidecar Viewer | Home</title>");
        expect(homeHtml).toContain('data-current-page="home"');
        expect(homeHtml).toContain("<h1>Home</h1>");
        expect(homeHtml).not.toContain('aria-label="watch section navigation"');
        expect(homeHtml).toContain('href="/fleet/">Open Fleet Watch</a>');
        expect(homeHtml).toContain('href="/aria/"');
        expect(homeHtml).toContain('href="/settings/">Open Settings</a>');
        expect(homeHtml).toContain('href="/about/?surface=setup"');
        expect(homeHtml).toContain('href="/diagnostics/"');
    });

    test("keeps raw and developer battle tools out of the Home launcher", () => {
        expect(homeHtml).toContain("Battle Log Explorer");
        expect(homeHtml).toContain("raw battle tools");
        expect(homeHtml).not.toContain('href="/battle-log/"');
        expect(homeHtml).not.toContain('href="/battle-log/workbench/"');
        expect(homeHtml).not.toContain('data-capability="battleLog"');
        expect(homeHtml).not.toContain("Battle Workbench");
        expect(homeHtml).not.toContain("Notification Preferences");
    });
});