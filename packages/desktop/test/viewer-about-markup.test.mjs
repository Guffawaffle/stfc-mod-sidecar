import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const aboutHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/about/index.html"), "utf8");
const aboutApp = readFileSync(path.resolve(__dirname, "../../viewer/public/about/app.js"), "utf8");

describe("viewer about markup", () => {
    test("keeps Community Mod release and install flow prominent", () => {
        expect(aboutHtml.indexOf("community-mod-card")).toBeLessThan(aboutHtml.indexOf("about-grid__column"));
        expect(aboutHtml).toContain("about-mod-install-guide");
        expect(aboutHtml).toContain("select-mod-game-directory");
        expect(aboutHtml).toContain("about-mod-release-summary-state");
    });

    test("folds generic release UI into the companion app card", () => {
        expect(aboutHtml).not.toContain('<p class="eyebrow">Release</p>');
        expect(aboutHtml).toContain('<p class="eyebrow">Companion App</p>');
        expect(aboutHtml.indexOf("about-release-version")).toBeLessThan(aboutHtml.indexOf("about-companion-install-state"));
    });

    test("walks missing-directory users through the install path", () => {
        expect(aboutApp).toContain("buildModInstallGuideSteps");
        expect(aboutApp).toContain("communityModDllStateLabel");
        expect(aboutApp).toContain("ensureGameDirectorySelected({ force: true })");
        expect(aboutApp).toContain("Select the folder that contains prime.exe");
    });
});