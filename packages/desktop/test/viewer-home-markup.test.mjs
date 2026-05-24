import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const homeHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/index.html"), "utf8");

describe("viewer home markup", () => {
    test("keeps Battle Log directly reachable while gating the raw surfaces", () => {
        expect(homeHtml).toMatch(/module-card module-card--primary[^>]+data-capability="battleLog"/);
        expect(homeHtml).toMatch(/module-card[^>]+data-developer-only[^>]+data-capability="battleLog"/);
        expect(homeHtml).toContain("Still Easy To Reach");
        expect(homeHtml).toContain('href="/battle-log/"');
        expect(homeHtml.indexOf('href="/battle-log/"')).toBeLessThan(homeHtml.indexOf('href="/diagnostics/"'));
    });

    test("surfaces the Watch landing plus setup and diagnostics transition modules", () => {
        expect(homeHtml).toContain("<h1>Watch</h1>");
        expect(homeHtml).toMatch(/module-card[^>]+data-capability="notifications"/);
        expect(homeHtml).toMatch(/module-card[^>]+data-developer-only[^>]+hidden/);
        expect(homeHtml).toContain('href="/aria/"');
        expect(homeHtml).toContain('href="/setup/"');
        expect(homeHtml).toContain('href="/diagnostics/"');
    });
});