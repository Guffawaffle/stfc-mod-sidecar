import { describe, expect, it } from "vitest";

import {
    buildDraftChangeSummary,
    buildSettingsTroubleshootingPrompt,
    buildSettingsTroubleshootingSummary,
    collectSettingsWarnings,
    redactedPathLabel,
} from "../../viewer/public/settings/troubleshooting.js";

const snapshot = {
    exists: true,
    parseError: false,
    settingsPath: "C:\\Users\\Guff\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_settings.toml",
    settingsSaveMode: "local_trusted",
    applyMode: "next_launch",
    actions: [
        {
            id: "select_fleet",
            label: "Select current fleet",
            effectiveValue: "SPACE",
            issues: [],
        },
        {
            id: "lookup",
            label: "Lookup",
            effectiveValue: "L",
            issues: [{ severity: "warning", message: "Shares a global shortcut." }],
        },
    ],
    hardSettings: [
        {
            id: "control.allow_key_fallthrough",
            label: "Allow key fallthrough",
            value: true,
            issues: [],
        },
    ],
};

const conflicts = [
    {
        binding: "SPACE",
        severity: "warning",
        message: "SPACE is assigned to multiple actions: Select current fleet, Cancel recall.",
    },
    {
        binding: "MOUSE1",
        severity: "info",
        message: "MOUSE1 is shared by context-dependent actions: Primary action, Queue action.",
    },
];

describe("settings troubleshooting context", () => {
    it("redacts local paths to file or folder names", () => {
        expect(redactedPathLabel(snapshot.settingsPath)).toBe("community_patch_settings.toml (path redacted)");
    });

    it("counts warnings from conflicts and snapshot issues", () => {
        expect(collectSettingsWarnings({ snapshot, conflicts })).toEqual([
            "SPACE: SPACE is assigned to multiple actions: Select current fleet, Cancel recall.",
            "Lookup (lookup): warning: Shares a global shortcut.",
        ]);
        expect(buildSettingsTroubleshootingSummary({ snapshot, conflicts, changeCount: 0 })).toContain("2 warnings; 0 draft changes; 1 blocking conflict");
    });

    it("summarizes unsaved draft changes", () => {
        const changes = buildDraftChangeSummary({
            snapshot,
            draftBindings: new Map([
                ["select_fleet", ["SHIFT", "SPACE"]],
                ["lookup", ["L"]],
            ]),
            draftHardSettings: new Map([["control.allow_key_fallthrough", false]]),
        });

        expect(changes).toEqual([
            "Select current fleet (select_fleet): SPACE -> SHIFT|SPACE",
            "Allow key fallthrough (control.allow_key_fallthrough): true -> false",
        ]);
    });

    it("builds a redacted Markdown prompt", () => {
        const prompt = buildSettingsTroubleshootingPrompt({
            snapshot,
            conflicts,
            generatedAt: "2026-05-03T19:30:00.000Z",
            bootstrap: {
                developerMode: false,
                gameDirectory: "C:\\Users\\Guff\\Games\\Star Trek Fleet Command\\default\\game",
                feedPath: "C:\\Users\\Guff\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_battle_feed.jsonl",
            },
            draftBindings: new Map([["select_fleet", ["CTRL", "SPACE"]]]),
            draftHardSettings: new Map([["control.allow_key_fallthrough", true]]),
        });

        expect(prompt).toContain("# STFC Sidecar Settings Troubleshooting Context");
        expect(prompt).toContain("Settings file: community_patch_settings.toml (path redacted)");
        expect(prompt).toContain("Feed file: community_patch_battle_feed.jsonl (path redacted)");
        expect(prompt).toContain("Select current fleet (select_fleet): SPACE -> CTRL|SPACE");
        expect(prompt).not.toContain("C:\\Users");
        expect(prompt).not.toContain("Star Trek Fleet Command");
    });
});