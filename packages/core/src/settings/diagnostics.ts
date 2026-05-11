import { parse as parseToml } from "smol-toml";

import {
  DEFAULT_COMMUNITY_MOD_SETTINGS_PROFILE,
  type CommunityModSettingsProfile,
  normalizeCommunityModSettingsProfile,
} from "./hotkeys.js";

export const RUNTIME_TRACE_LEVELS = ["off", "summary", "detailed", "verbose"] as const;

export type RuntimeTraceLevel = typeof RUNTIME_TRACE_LEVELS[number];
export type DiagnosticSettingType = "boolean" | "integer" | "select";
export type DiagnosticIssueSeverity = "info" | "warning" | "error";

export interface DiagnosticSettingOption {
  readonly value: string;
  readonly label: string;
}

export interface DiagnosticSettingCatalogItem {
  readonly id: string;
  readonly section: string;
  readonly key: string;
  readonly label: string;
  readonly type: DiagnosticSettingType;
  readonly defaultValue: boolean | number | RuntimeTraceLevel;
  readonly description: string;
  readonly options?: readonly DiagnosticSettingOption[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly profiles?: readonly CommunityModSettingsProfile[];
}

export interface DiagnosticIssue {
  readonly severity: DiagnosticIssueSeverity;
  readonly message: string;
}

export interface DiagnosticSettingView extends DiagnosticSettingCatalogItem {
  readonly value: boolean | number | RuntimeTraceLevel;
  readonly source: "config" | "legacy" | "default";
  readonly issues: readonly DiagnosticIssue[];
}

export interface CommunityModDiagnosticSettingsSnapshot {
  readonly ok: boolean;
  readonly profile: CommunityModSettingsProfile;
  readonly generatedAt: string;
  readonly parseError?: string;
  readonly developerOnly: true;
  readonly settings: readonly DiagnosticSettingView[];
}

export interface DiagnosticSettingsPatch {
  readonly diagnostics?: Record<string, boolean | number | string>;
}

interface NormalizedDiagnosticSettingPatch {
  readonly section: string;
  readonly key: string;
  readonly value: boolean | number | RuntimeTraceLevel;
}

interface NormalizedDiagnosticSettingsPatch {
  readonly diagnostics: readonly NormalizedDiagnosticSettingPatch[];
}

const runtimeTraceOptions: readonly DiagnosticSettingOption[] = [
  { value: "off", label: "Off" },
  { value: "summary", label: "Summary" },
  { value: "detailed", label: "Detailed" },
  { value: "verbose", label: "Verbose" },
];

const DIAGNOSTIC_SETTING_CATALOG: readonly DiagnosticSettingCatalogItem[] = [
  {
    id: "debug.runtime_trace",
    section: "debug",
    key: "runtime_trace",
    label: "Realtime traces",
    type: "select",
    defaultValue: "off",
    description: "Off has no runtime timer collection. Every level above off adds runtime overhead; summary captures coarse hook costs, while detailed and verbose enable nested probes for focused investigation. Prefer sidecar/spocks.club ingress over long-lived local capture for durable export.",
    options: runtimeTraceOptions,
  },
  {
    id: "debug.runtime_trace_track_overhead",
    section: "debug",
    key: "runtime_trace_track_overhead",
    label: "Track trace overhead",
    type: "boolean",
    defaultValue: true,
    description: "Records instrumentation overhead as a separate trace probe so profiler cost can be separated from mod and game function timing. This adds more diagnostic work in exchange for cleaner attribution.",
  },
  {
    id: "debug.runtime_trace_report_interval_ms",
    section: "debug",
    key: "runtime_trace_report_interval_ms",
    label: "Trace report interval",
    type: "integer",
    defaultValue: 5000,
    description: "Milliseconds between runtime trace summary reports. Lower values increase diagnostic log churn. The mod clamps this to a bounded range.",
    min: 1000,
    max: 60000,
    step: 500,
  },
  {
    id: "sync.sidecar_jsonl",
    section: "sync",
    key: "sidecar_jsonl",
    label: "Local JSONL feed",
    type: "boolean",
    defaultValue: false,
    description: "Explicit opt-in local JSONL fallback feed. Enabling it can add write overhead and create large storage churn. Prefer sidecar/spocks.club ingress for durable export.",
  },
  {
    id: "sync.sidecar_jsonl_replay_seconds",
    section: "sync",
    key: "sidecar_jsonl_replay_seconds",
    label: "JSONL replay window",
    type: "integer",
    defaultValue: 30,
    description: "Seconds retained in the cyclic sidecar JSONL feed. Higher values increase storage churn. Set to 0 with the group cap also 0 only for explicit unlimited append-only capture.",
    min: 0,
    max: 86400,
    step: 30,
  },
  {
    id: "sync.sidecar_jsonl_recent_logs",
    section: "sync",
    key: "sidecar_jsonl_recent_logs",
    label: "JSONL group cap",
    type: "integer",
    defaultValue: 300,
    description: "Maximum retained battle-log groups in the cyclic sidecar JSONL feed. Higher values increase storage churn. Set to 0 with replay window 0 only for explicit unlimited append-only capture.",
    min: 0,
    max: 10000,
    step: 50,
  },
];

const runtimeTraceLevelSet = new Set<string>(RUNTIME_TRACE_LEVELS);

export function buildCommunityModDiagnosticSettingsSnapshot(tomlText: string, options: { readonly profile?: string | CommunityModSettingsProfile } = {}): CommunityModDiagnosticSettingsSnapshot {
  const profile = normalizeCommunityModSettingsProfile(options.profile);
  const generatedAt = new Date().toISOString();
  const parsed = parseCommunityModToml(tomlText);
  const root = parsed.root;
  const settings = diagnosticSettingCatalogForProfile(profile).map((catalogItem) => buildDiagnosticSettingView(catalogItem, root));

  return {
    ok: !parsed.error,
    profile,
    generatedAt,
    parseError: parsed.error,
    developerOnly: true,
    settings,
  };
}

export function diagnosticSettingCatalogForProfile(profileValue: unknown = DEFAULT_COMMUNITY_MOD_SETTINGS_PROFILE): readonly DiagnosticSettingCatalogItem[] {
  const profile = normalizeCommunityModSettingsProfile(profileValue);
  return DIAGNOSTIC_SETTING_CATALOG.filter((item) => !item.profiles || item.profiles.includes(profile));
}

export function normalizeDiagnosticSettingsPatch(input: unknown, options: { readonly profile?: string | CommunityModSettingsProfile } = {}): NormalizedDiagnosticSettingsPatch {
  const profile = normalizeCommunityModSettingsProfile(options.profile);
  const settingById = new Map(diagnosticSettingCatalogForProfile(profile).map((item) => [item.id, item]));
  const payload = asRecord(input);
  const diagnosticsPayload = asRecord(payload.diagnostics);
  const diagnostics: NormalizedDiagnosticSettingPatch[] = [];

  for (const [id, value] of Object.entries(diagnosticsPayload)) {
    const catalogItem = settingById.get(id);
    if (!catalogItem) {
      throw new Error(`Unknown diagnostic setting: ${id}`);
    }

    diagnostics.push({
      section: catalogItem.section,
      key: catalogItem.key,
      value: normalizeDiagnosticPatchValue(catalogItem, value),
    });
  }

  return { diagnostics };
}

export function applyCommunityModDiagnosticSettingsPatch(tomlText: string, input: unknown, options: { readonly profile?: string | CommunityModSettingsProfile } = {}): string {
  parseCommunityModTomlOrThrow(tomlText);
  const patch = normalizeDiagnosticSettingsPatch(input, options);
  let output = tomlText;

  for (const item of patch.diagnostics) {
    output = upsertTomlValue(output, item.section, item.key, item.value);
  }

  parseCommunityModTomlOrThrow(output);
  return output;
}

function buildDiagnosticSettingView(catalogItem: DiagnosticSettingCatalogItem, root: Record<string, unknown>): DiagnosticSettingView {
  const section = asRecord(root[catalogItem.section]);
  const hasConfigValue = Object.hasOwn(section, catalogItem.key);
  const rawValue = section[catalogItem.key];
  const issues: DiagnosticIssue[] = [];
  let value = catalogItem.defaultValue;
  let source: DiagnosticSettingView["source"] = "default";

  if (catalogItem.id === "debug.runtime_trace" && !hasConfigValue && section.mod_impact_monitor === true) {
    value = "summary";
    source = "legacy";
    issues.push({ severity: "info", message: "Legacy mod_impact_monitor=true maps to summary traces." });
    return { ...catalogItem, value, source, issues };
  }

  if (catalogItem.type === "boolean") {
    if (typeof rawValue === "boolean") {
      value = rawValue;
      source = "config";
    } else if (hasConfigValue) {
      issues.push({ severity: "warning", message: `${catalogItem.section}.${catalogItem.key} is not a boolean; the mod will use its built-in default.` });
    }
  } else if (catalogItem.type === "integer") {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      value = clampInteger(catalogItem, rawValue);
      source = "config";
    } else if (hasConfigValue) {
      issues.push({ severity: "warning", message: `${catalogItem.section}.${catalogItem.key} is not an integer; the mod will use its built-in default.` });
    }
  } else if (typeof rawValue === "string") {
    const normalized = normalizeRuntimeTraceLevel(rawValue);
    if (normalized) {
      value = normalized;
      source = "config";
    } else {
      issues.push({ severity: "warning", message: `${catalogItem.section}.${catalogItem.key} must be one of: ${RUNTIME_TRACE_LEVELS.join(", ")}.` });
    }
  } else if (hasConfigValue) {
    issues.push({ severity: "warning", message: `${catalogItem.section}.${catalogItem.key} is not a string; the mod will use its built-in default.` });
  }

  return { ...catalogItem, value, source, issues };
}

function normalizeDiagnosticPatchValue(catalogItem: DiagnosticSettingCatalogItem, value: unknown): boolean | number | RuntimeTraceLevel {
  if (catalogItem.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`${catalogItem.id} must be a boolean.`);
    }
    return value;
  }

  if (catalogItem.type === "integer") {
    const numericValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error(`${catalogItem.id} must be a number.`);
    }
    return clampInteger(catalogItem, numericValue);
  }

  const normalized = normalizeRuntimeTraceLevel(value);
  if (!normalized) {
    throw new Error(`${catalogItem.id} must be one of: ${RUNTIME_TRACE_LEVELS.join(", ")}.`);
  }
  return normalized;
}

function normalizeRuntimeTraceLevel(value: unknown): RuntimeTraceLevel | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_").replace(/\s+/g, "_");
  if (normalized === "detail") {
    return "detailed";
  }
  if (runtimeTraceLevelSet.has(normalized)) {
    return normalized as RuntimeTraceLevel;
  }
  return undefined;
}

function parseCommunityModToml(tomlText: string): { root: Record<string, unknown>; error?: string } {
  if (tomlText.trim().length === 0) {
    return { root: {} };
  }

  try {
    return { root: asRecord(parseToml(tomlText)) };
  } catch (error) {
    return { root: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseCommunityModTomlOrThrow(tomlText: string): void {
  const parsed = parseCommunityModToml(tomlText);
  if (parsed.error) {
    throw new Error(`Cannot update invalid TOML: ${parsed.error}`);
  }
}

function clampInteger(catalogItem: Pick<DiagnosticSettingCatalogItem, "min" | "max">, value: number): number {
  const integer = Math.trunc(value);
  const min = catalogItem.min ?? Number.MIN_SAFE_INTEGER;
  const max = catalogItem.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, integer));
}

function upsertTomlValue(tomlText: string, section: string, key: string, value: string | boolean | number): string {
  const eol = tomlText.includes("\r\n") ? "\r\n" : "\n";
  const lines = tomlText.length > 0 ? tomlText.split(/\r?\n/) : [];
  const sectionHeader = `[${section}]`;
  const sectionIndex = lines.findIndex((line) => sectionHeaderRegex(section).test(line));
  const assignment = `${key} = ${formatTomlScalar(value)}`;

  if (sectionIndex === -1) {
    const prefix = lines.length > 0 && lines[lines.length - 1] !== "" ? [""] : [];
    return [...lines, ...prefix, sectionHeader, assignment].join(eol);
  }

  const nextSectionIndex = lines.findIndex((line, index) => index > sectionIndex && /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line));
  const sectionEnd = nextSectionIndex === -1 ? lines.length : nextSectionIndex;
  const keyIndex = lines.findIndex((line, index) => index > sectionIndex && index < sectionEnd && keyAssignmentRegex(key).test(line));

  if (keyIndex !== -1) {
    lines[keyIndex] = assignment;
    return lines.join(eol);
  }

  lines.splice(sectionEnd, 0, assignment);
  return lines.join(eol);
}

function sectionHeaderRegex(section: string): RegExp {
  return new RegExp(`^\\s*\\[${escapeRegExp(section)}\\]\\s*(?:#.*)?$`);
}

function keyAssignmentRegex(key: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
}

function formatTomlScalar(value: string | boolean | number): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(Math.trunc(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}