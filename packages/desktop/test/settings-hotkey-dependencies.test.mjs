import { describe, expect, test } from "vitest";

import { buildHotkeyDependencyState } from "../../viewer/public/settings/hotkey-dependencies.js";

describe("settings hotkey dependencies", () => {
    test("keeps router controls and keybindings available when Scopely hotkeys are off", () => {
        const dependency = buildHotkeyDependencyState(snapshot(false), new Map());

        expect(dependency.useScopelyHotkeys).toBe(false);
        expect(dependency.keybindingsAvailable).toBe(true);
        expect(dependency.lockedHardSettingIds).toEqual([]);
        expect(dependency.hardSettingsMessage).toBe("");
    });

    test("locks router controls and hides custom keybindings when Scopely hotkeys are on", () => {
        const dependency = buildHotkeyDependencyState(snapshot(true), new Map([["control.use_scopely_hotkeys", true]]));

        expect(dependency.useScopelyHotkeys).toBe(true);
        expect(dependency.keybindingsAvailable).toBe(false);
        expect(dependency.lockedHardSettingIds).toEqual([
            "control.hotkeys_enabled",
            "control.hotkeys_extended",
        ]);
        expect(dependency.hardSettingsMessage).toMatch(/game shortcut layer active/i);
        expect(dependency.keybindingsMessage).toMatch(/custom keybindings are inactive/i);
    });
});

function snapshot(useScopelyHotkeys) {
    return {
        hardSettings: [
            { id: "control.hotkeys_enabled", value: true },
            { id: "control.hotkeys_extended", value: true },
            { id: "control.use_scopely_hotkeys", value: useScopelyHotkeys },
        ],
    };
}