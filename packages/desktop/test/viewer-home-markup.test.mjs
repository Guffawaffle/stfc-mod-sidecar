import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const homeHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/index.html"), "utf8");

describe("viewer home markup", () => {
    test("keeps Home as a command console with selectable previews and route actions", () => {
        expect(homeHtml).toContain("<title>STFC Sidecar Viewer | Home</title>");
        expect(homeHtml).toContain('data-current-page="home"');
        expect(homeHtml).toContain("<h1>Home</h1>");
        expect(homeHtml).toContain('class="console-header-rail"');
        expect(homeHtml).toContain('<span class="console-header-rail__code">01</span>');
        expect(homeHtml).toContain('class="command-console home-command-console"');
        expect(homeHtml).toContain('role="tablist"');
        expect(homeHtml).toContain('data-command-tile');
        expect(homeHtml).toContain('data-command-panel');
        expect(homeHtml).toContain('/home/app.js');
        expect(homeHtml.match(/<button id="home-tile-[\s\S]*?<\/button>/g).join("\n")).not.toContain("command-chip");
        expect(homeHtml).not.toContain('aria-label="watch section navigation"');
        expect(homeHtml).toContain('href="/fleet/">Open Fleet Watch</a>');
        expect(homeHtml).toContain('href="/aria/">Open Aria</a>');
        expect(homeHtml).toContain('href="/settings/">Open Settings</a>');
        expect(homeHtml).toContain('href="/about/?surface=setup">Open STFC Mod Setup</a>');
        expect(homeHtml).toContain('href="/diagnostics/">Open Diagnostics</a>');
    });

    test("keeps raw and developer battle tools out of the Home launcher", () => {
        expect(homeHtml).toContain("Raw evidence tools, transport monitors, and support bundle paths.");
        expect(homeHtml).not.toContain('href="/battle-log/"');
        expect(homeHtml).not.toContain('href="/battle-log/workbench/"');
        expect(homeHtml).not.toContain('data-capability="battleLog"');
        expect(homeHtml).not.toContain("Battle Log Explorer");
        expect(homeHtml).not.toContain("Battle Workbench");
        expect(homeHtml).not.toContain("Notification Preferences");
    });
});
