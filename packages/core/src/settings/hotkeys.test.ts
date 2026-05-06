import { describe, expect, it } from "vitest";

import {
  applyCommunityModHotkeySettingsPatch,
  buildCommunityModHotkeySettingsSnapshot,
  formatShortcutValue,
  hotkeyActionCatalogForProfile,
  hotkeyHardSettingCatalogForProfile,
  normalizeCommunityModSettingsProfile,
  normalizeHotkeySettingsPatch,
} from "./hotkeys.js";

describe("community mod hotkey settings", () => {
  it("treats missing shortcuts as defaults and explicit NONE as off", () => {
    const snapshot = buildCommunityModHotkeySettingsSnapshot(`
[shortcuts]
zoom_preset1 = "NONE"
action_view = "V|MOUSE2"
`);

    const zoomPreset1 = snapshot.actions.find((action) => action.id === "zoom_preset1");
    const zoomPreset2 = snapshot.actions.find((action) => action.id === "zoom_preset2");
    const actionView = snapshot.actions.find((action) => action.id === "action_view");

    expect(zoomPreset1?.source).toBe("off");
    expect(zoomPreset1?.bindings).toEqual([]);
    expect(zoomPreset1?.effectiveValue).toBe("NONE");
    expect(zoomPreset2?.source).toBe("default");
    expect(zoomPreset2?.bindings).toEqual(["F2"]);
    expect(actionView?.source).toBe("config");
    expect(actionView?.bindings).toEqual(["V", "MOUSE2"]);
  });

  it("surfaces hard hotkey-related settings", () => {
    const snapshot = buildCommunityModHotkeySettingsSnapshot(`
[control]
hotkeys_enabled = false
allow_key_fallthrough = true
select_timer = 725

[ui]
disable_move_keys = true
`, { profile: "guff-advanced" });

    expect(snapshot.hardSettings.find((setting) => setting.id === "control.hotkeys_enabled")?.value).toBe(false);
    expect(snapshot.hardSettings.find((setting) => setting.id === "control.allow_key_fallthrough")?.value).toBe(true);
    expect(snapshot.hardSettings.find((setting) => setting.id === "control.select_timer")?.value).toBe(725);
    expect(snapshot.hardSettings.find((setting) => setting.id === "ui.disable_move_keys")?.value).toBe(true);
  });

  it("detects warning conflicts while allowing known contextual overlaps", () => {
    const snapshot = buildCommunityModHotkeySettingsSnapshot(`
[shortcuts]
action_primary = "SPACE|MOUSE1"
action_queue = "SPACE|MOUSE1"
show_inventory = "I"
show_research = "I"
`);

    expect(snapshot.conflicts.find((conflict) => conflict.binding === "SPACE")?.severity).toBe("info");
    expect(snapshot.conflicts.find((conflict) => conflict.binding === "I")?.severity).toBe("warning");
  });

  it("validates patch values and preserves NONE formatting", () => {
    expect(formatShortcutValue([])).toBe("NONE");
    expect(formatShortcutValue(["ctrl-q", " mouse4 "])).toBe("CTRL-Q|MOUSE4");

    const patch = normalizeHotkeySettingsPatch({
      shortcuts: {
        zoom_preset1: [],
        action_view: ["v", "mouse2"],
      },
      hardSettings: {
        "control.allow_key_fallthrough": true,
        "control.select_timer": 750,
      },
    }, { profile: "guff-advanced" });

    expect(patch.shortcuts).toContainEqual({ section: "shortcuts", key: "zoom_preset1", value: "NONE" });
    expect(patch.shortcuts).toContainEqual({ section: "shortcuts", key: "action_view", value: "V|MOUSE2" });
    expect(patch.hardSettings).toContainEqual({ section: "control", key: "allow_key_fallthrough", value: true });
    expect(patch.hardSettings).toContainEqual({ section: "control", key: "select_timer", value: 750 });
  });

  it("rejects more than two bindings from sidecar patches", () => {
    expect(() => normalizeHotkeySettingsPatch({ shortcuts: { action_view: ["V", "MOUSE2", "F6"] } }))
      .toThrow(/at most 2/);
  });

  it("updates allowlisted TOML keys without deleting unrelated comments", () => {
    const original = `# header
[control]
# keep this comment
hotkeys_enabled = true

[shortcuts]
# existing zoom comment
zoom_preset1 = "F1"
`;

    const updated = applyCommunityModHotkeySettingsPatch(original, {
      hardSettings: { "control.allow_key_fallthrough": true },
      shortcuts: {
        zoom_preset1: [],
        action_view: ["V", "MOUSE2"],
      },
    }, { profile: "guff-advanced" });

    expect(updated).toContain("# keep this comment");
    expect(updated).toContain("# existing zoom comment");
    expect(updated).toContain("allow_key_fallthrough = true");
    expect(updated).toContain('zoom_preset1 = "NONE"');
    expect(updated).toContain('action_view = "V|MOUSE2"');
  });

  it("filters fork-only settings from the netniV Basic profile", () => {
    const snapshot = buildCommunityModHotkeySettingsSnapshot(`
[control]
allow_key_fallthrough = true

[ui]
escape_exit_timer = 300
`, { profile: "netniv-basic" });

    expect(snapshot.profile).toBe("netniv-basic");
    expect(snapshot.hardSettings.map((setting) => setting.id)).not.toContain("control.allow_key_fallthrough");
    expect(snapshot.hardSettings.map((setting) => setting.id)).not.toContain("ui.escape_exit_timer");
    expect(snapshot.actions.map((action) => action.id)).not.toContain("move_up");
    expect(snapshot.actions.map((action) => action.id)).not.toContain("set_hotkeys_disable");
  });

  it("keeps existing settings behavior in the advanced profile", () => {
    expect(hotkeyHardSettingCatalogForProfile("guff-advanced").map((setting) => setting.id)).toContain("control.allow_key_fallthrough");
    expect(hotkeyActionCatalogForProfile("guff-advanced").map((action) => action.id)).toContain("move_up");
  });

  it("rejects advanced-only patches in the netniV Basic profile", () => {
    expect(() => normalizeHotkeySettingsPatch({
      hardSettings: { "control.allow_key_fallthrough": true },
    }, { profile: "netniv-basic" })).toThrow(/Unknown hard setting/);

    expect(() => normalizeHotkeySettingsPatch({
      shortcuts: { move_up: "W" },
    }, { profile: "netniv-basic" })).toThrow(/Unknown shortcut action/);
  });

  it("normalizes profile aliases while defaulting to Official Basic", () => {
    expect(normalizeCommunityModSettingsProfile("official")).toBe("netniv-basic");
    expect(normalizeCommunityModSettingsProfile("alpha")).toBe("guff-advanced");
    expect(normalizeCommunityModSettingsProfile(undefined)).toBe("netniv-basic");
  });
});