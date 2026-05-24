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
});
