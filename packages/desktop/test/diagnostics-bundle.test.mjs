import { describe, expect, it } from "vitest";

import {
    buildDiagnosticsBundle,
    buildDiagnosticsMarkdown,
    redactPath,
    redactSensitiveText,
} from "../../viewer/diagnostics-bundle.mjs";

describe("diagnostics bundle", () => {
    it("redacts absolute paths to names only", () => {
        const redacted = redactPath("C:\\Users\\Guff\\AppData\\Roaming\\STFC Community Mod Companion\\desktop-settings.json");

        expect(redacted).toMatchObject({
            present: true,
            name: "desktop-settings.json",
            redacted: "<redacted>/desktop-settings.json",
        });
    });

    it("redacts obvious token-shaped text", () => {
        expect(redactSensitiveText("Authorization: Bearer abc123.token")).toBe("Authorization: Bearer <redacted>");
        expect(redactSensitiveText("failed?token=abc123&x=1")).toBe("failed?token=<redacted>&x=1");
    });

    it("does not expose raw local paths in bundle output", () => {
        const bundle = buildDiagnosticsBundle({
            generatedAt: "2026-05-03T10:00:00.000Z",
            release: { version: "0.0.1-Alpha", channel: "alpha", updateMode: "manual", signaturePolicy: "local_unsigned" },
            gameDir: "C:\\Users\\Guff\\Games\\Star Trek Fleet Command\\default\\game",
            feedPath: "C:\\Users\\Guff\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_battle_feed.jsonl",
            settingsPath: "C:\\Users\\Guff\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_settings.toml",
            feed: { exists: true, totalLines: 12, returnedLines: 5, pollHintMs: 2000 },
            settings: { exists: true, actions: [{ issues: [{ severity: "warning" }] }], hardSettings: [] },
        });

        const serialized = JSON.stringify(bundle);
        expect(serialized).not.toContain("Users");
        expect(serialized).not.toContain("Guff");
        expect(serialized).toContain("community_patch_battle_feed.jsonl");
    });

    it("creates Markdown from the redacted bundle", () => {
        const bundle = buildDiagnosticsBundle({
            generatedAt: "2026-05-03T10:00:00.000Z",
            release: { version: "0.0.1-Alpha", channel: "alpha", updateMode: "manual", signaturePolicy: "authenticode_required" },
            feed: { exists: false, error: "token=abc123" },
            settings: { exists: false },
        });

        const markdown = buildDiagnosticsMarkdown(bundle);
        expect(markdown).toContain("# STFC Sidecar Diagnostics");
        expect(markdown).toContain("token=<redacted>");
    });
});