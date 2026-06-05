import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const styles = readFileSync(path.resolve(__dirname, "../../viewer/public/styles.css"), "utf8");

describe("viewer LCARS style primitives", () => {
    test("uses compact header rails and avoids selected underlines on command/nav controls", () => {
        expect(styles).toContain(".console-header-rail");
        expect(styles).toContain(".site-nav__link--active");
        expect(styles).toContain("box-shadow: inset 0 0 0 2px");
        expect(styles).toContain(".command-tile::after");
        expect(styles).toContain("content: none;");
    });

    test("keeps motion restrained for reduced-motion users", () => {
        expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    });

    test("keeps Fleet Watch previews and Decode Signals surfaces dark", () => {
        expect(styles).toContain(".fleet-combat-preview");
        expect(styles).toContain(".fleet-table .chip-row span");
        expect(styles).toContain(".fleet-activity-row .chip-row span");
        expect(styles).toContain(".fleet-activity-row .line-badge");
        expect(styles).toContain(".fleet-combat-preview__chips span");
        expect(styles).toContain(".report-workbench .chain-item");
        expect(styles).toContain(".report-workbench .line-badge");
        expect(styles).toContain(".report-workbench .table-scroll");
    });

    test("lets Battle Workbench content panels use viewport height without trapping the whole report", () => {
        expect(styles).toContain("min-height: clamp(640px, calc(100vh - 255px), 1180px);");
        expect(styles).toContain(".catalog-band,\n.csv-parity-band,\n.combatant-detail-band,\n.data-dive-band");
        expect(styles).toContain("min-height: clamp(420px, 52vh, 820px);");
        expect(styles).toContain("max-height: none;\n  overflow: visible;");
        expect(styles).toContain("max-height: clamp(340px, 48vh, 720px);");
        expect(styles).toContain("scrollbar-gutter: stable;");
        expect(styles).not.toContain("max-height: min(1040px, calc(100vh - 250px));");
    });
});
