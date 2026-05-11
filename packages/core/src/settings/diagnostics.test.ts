import { describe, expect, it } from "vitest";

import {
  applyCommunityModDiagnosticSettingsPatch,
  buildCommunityModDiagnosticSettingsSnapshot,
  normalizeDiagnosticSettingsPatch,
} from "./diagnostics.js";

describe("community mod diagnostic settings", () => {
  it("builds realtime trace settings for the advanced profile", () => {
    const snapshot = buildCommunityModDiagnosticSettingsSnapshot(`
[debug]
runtime_trace = "detailed"
runtime_trace_track_overhead = false
runtime_trace_report_interval_ms = 2500
`, { profile: "guff-advanced" });

    expect(snapshot.settings.find((setting) => setting.id === "debug.runtime_trace")?.value).toBe("detailed");
    expect(snapshot.settings.find((setting) => setting.id === "debug.runtime_trace_track_overhead")?.value).toBe(false);
    expect(snapshot.settings.find((setting) => setting.id === "debug.runtime_trace_report_interval_ms")?.value).toBe(2500);
  });

  it("maps the legacy mod impact monitor flag to summary", () => {
    const snapshot = buildCommunityModDiagnosticSettingsSnapshot(`
[debug]
mod_impact_monitor = true
`, { profile: "guff-advanced" });

    const trace = snapshot.settings.find((setting) => setting.id === "debug.runtime_trace");
    expect(trace?.value).toBe("summary");
    expect(trace?.source).toBe("legacy");
  });

  it("filters diagnostics out of the official basic profile", () => {
    const snapshot = buildCommunityModDiagnosticSettingsSnapshot("", { profile: "netniv-basic" });
    expect(snapshot.settings).toEqual([]);
  });

  it("validates diagnostic patches", () => {
    const patch = normalizeDiagnosticSettingsPatch({
      diagnostics: {
        "debug.runtime_trace": "verbose",
        "debug.runtime_trace_track_overhead": true,
        "debug.runtime_trace_report_interval_ms": 1500,
      },
    }, { profile: "guff-advanced" });

    expect(patch.diagnostics).toContainEqual({ section: "debug", key: "runtime_trace", value: "verbose" });
    expect(patch.diagnostics).toContainEqual({ section: "debug", key: "runtime_trace_track_overhead", value: true });
    expect(patch.diagnostics).toContainEqual({ section: "debug", key: "runtime_trace_report_interval_ms", value: 1500 });
  });

  it("rejects unknown settings and invalid levels", () => {
    expect(() => normalizeDiagnosticSettingsPatch({
      diagnostics: { "debug.nope": true },
    }, { profile: "guff-advanced" })).toThrow(/Unknown diagnostic setting/);

    expect(() => normalizeDiagnosticSettingsPatch({
      diagnostics: { "debug.runtime_trace": "firehose" },
    }, { profile: "guff-advanced" })).toThrow(/must be one of/);
  });

  it("updates allowlisted debug TOML keys without deleting comments", () => {
    const original = `# keep me
[debug]
# existing trace comment
runtime_trace = "off"
`;

    const updated = applyCommunityModDiagnosticSettingsPatch(original, {
      diagnostics: {
        "debug.runtime_trace": "summary",
        "debug.runtime_trace_track_overhead": true,
        "debug.runtime_trace_report_interval_ms": 5000,
      },
    }, { profile: "guff-advanced" });

    expect(updated).toContain("# keep me");
    expect(updated).toContain("# existing trace comment");
    expect(updated).toContain('runtime_trace = "summary"');
    expect(updated).toContain("runtime_trace_track_overhead = true");
    expect(updated).toContain("runtime_trace_report_interval_ms = 5000");
  });
});