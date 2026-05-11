import { describe, expect, it } from "vitest";

import {
  applyCommunityModNotificationSettingsPatch,
  buildCommunityModNotificationSettingsSnapshot,
  normalizeNotificationSettingsPatch,
} from "./notifications.js";

describe("community mod notification settings", () => {
  it("builds rows from legacy and inline notification config", () => {
    const snapshot = buildCommunityModNotificationSettingsSnapshot(`
[notifications]
notifications_fleet_arrived_in_system = true
notifications_audio_fleet_arrived_in_system = false

[notifications.audio]
enabled = true
default_sound = "soft"

[notifications.events.fleet]
arrived_in_system = { system = false, audio = true, sound = "arrival" }
repair_complete = { system = true, audio = true, sound = "repair" }
`, { profile: "guff-advanced" });

    const arrival = snapshot.events.find((event) => event.id === "fleet.arrived_in_system");
    const repair = snapshot.events.find((event) => event.id === "fleet.repair_complete");

    expect(snapshot.master.audioEnabled).toBe(true);
    expect(snapshot.master.defaultSound).toBe("soft");
    expect(arrival?.source).toBe("event");
    expect(arrival?.system).toBe(false);
    expect(arrival?.audio).toBe(true);
    expect(arrival?.sound).toBe("arrival");
    expect(repair?.system).toBe(true);
    expect(repair?.sound).toBe("repair");
  });

  it("filters notification rows out of the official basic profile", () => {
    const snapshot = buildCommunityModNotificationSettingsSnapshot("", { profile: "netniv-basic" });
    expect(snapshot.events).toEqual([]);
  });

  it("validates event patches", () => {
    const patch = normalizeNotificationSettingsPatch({
      master: { systemEnabled: true, audioEnabled: true, defaultSound: "soft" },
      events: {
        "fleet.arrived_in_system": { system: false, audio: true, sound: "arrival" },
      },
    }, { profile: "guff-advanced" });

    expect(patch.master).toEqual({ systemEnabled: true, audioEnabled: true, defaultSound: "soft" });
    expect(patch.events).toContainEqual({
      id: "fleet.arrived_in_system",
      category: "fleet",
      key: "arrived_in_system",
      system: false,
      audio: true,
      sound: "arrival",
    });
  });

  it("rejects unknown notification rows and sounds", () => {
    expect(() => normalizeNotificationSettingsPatch({
      events: { "fleet.nope": { system: true, audio: false, sound: "soft" } },
    }, { profile: "guff-advanced" })).toThrow(/Unknown notification event/);

    expect(() => normalizeNotificationSettingsPatch({
      events: { "fleet.arrived_in_system": { system: true, audio: true, sound: "klaxon" } },
    }, { profile: "guff-advanced" })).toThrow(/must be one of/);
  });

  it("writes compact inline TOML tables without deleting comments", () => {
    const original = `# keep me
[notifications.system]
enabled = false

[notifications.events.fleet]
# existing row comment
arrived_in_system = { system = true, audio = false, sound = "soft" }
`;

    const updated = applyCommunityModNotificationSettingsPatch(original, {
      master: { audioEnabled: true, defaultSound: "default" },
      events: {
        "fleet.arrived_in_system": { system: false, audio: true, sound: "arrival" },
        "fleet.repair_complete": { system: true, audio: true, sound: "repair" },
      },
    }, { profile: "guff-advanced" });

    expect(updated).toContain("# keep me");
    expect(updated).toContain("# existing row comment");
    expect(updated).toContain("[notifications.audio]");
    expect(updated).toContain("enabled = true");
    expect(updated).toContain('arrived_in_system = { system = false, audio = true, sound = "arrival" }');
    expect(updated).toContain('repair_complete = { system = true, audio = true, sound = "repair" }');
  });
});
