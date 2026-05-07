import { describe, expect, test } from "vitest";

import { buildCapabilityUnavailablePage } from "../../viewer/public-page-responses.mjs";

describe("public capability unavailable page", () => {
    test("renders an HTML fallback instead of exposing raw JSON for disabled public pages", () => {
        const html = buildCapabilityUnavailablePage({
            title: "Battle Log unavailable",
            heading: "Battle Log Unavailable",
            message: "Battle Log surfaces are not available.",
            details: ["Active profile: netniv-basic"],
        });

        expect(html).toContain("<!doctype html>");
        expect(html).toContain("Battle Log Unavailable");
        expect(html).toContain("Active profile: netniv-basic");
        expect(html).toContain("data-variant-gate-warning-suppressed");
        expect(html).toContain("/shared/shell.js");
    });

    test("escapes dynamic text", () => {
        const html = buildCapabilityUnavailablePage({
            heading: "<script>alert(1)</script>",
            details: ["profile <basic>"],
            primaryHref: "https://example.com/unsafe",
        });

        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).toContain("profile &lt;basic&gt;");
        expect(html).toContain("href=\"#\"");
        expect(html).not.toContain("<script>alert(1)</script>");
    });
});