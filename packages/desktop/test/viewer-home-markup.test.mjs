import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const homeHtml = readFileSync(path.resolve(__dirname, "../../viewer/public/index.html"), "utf8");

describe("viewer home markup", () => {
    test("gates Battle Log module links by capability before developer mode", () => {
        expect(homeHtml).toMatch(/module-card module-card--primary[^>]+data-capability="battleLog"/);
        expect(homeHtml).toMatch(/module-card[^>]+data-developer-only[^>]+data-capability="battleLog"/);
    });

    test("surfaces Waffle and Developer Tools dashboard modules", () => {
        expect(homeHtml).toContain("<h1>Dashboard</h1>");
        expect(homeHtml).toMatch(/module-card[^>]+data-capability="notifications"/);
        expect(homeHtml).toMatch(/module-card[^>]+data-developer-only hidden/);
    });
});