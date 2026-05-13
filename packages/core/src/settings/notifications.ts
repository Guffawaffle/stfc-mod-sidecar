import { parse as parseToml } from "smol-toml";

import {
  DEFAULT_COMMUNITY_MOD_SETTINGS_PROFILE,
  type CommunityModSettingsProfile,
  normalizeCommunityModSettingsProfile,
} from "./hotkeys.js";

export type NotificationIssueSeverity = "info" | "warning" | "error";
export type NotificationSettingSource = "event" | "legacy" | "default";

export interface NotificationSoundCatalogItem {
  readonly id: NotificationSoundId;
  readonly label: string;
  readonly pattern: readonly NotificationToneSegment[];
}

export interface NotificationToneSegment {
  readonly frequency: number;
  readonly durationMs: number;
}

export interface NotificationEventCatalogItem {
  readonly id: string;
  readonly category: string;
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly defaultSystem: boolean;
  readonly defaultAudio: boolean;
  readonly defaultSound: NotificationSoundId;
  readonly legacySystemKey?: string;
  readonly legacySystemPath?: readonly string[];
  readonly legacyAudioKey?: string;
  readonly legacyAudioPath?: readonly string[];
  readonly profiles?: readonly CommunityModSettingsProfile[];
}

export interface NotificationIssue {
  readonly severity: NotificationIssueSeverity;
  readonly message: string;
}

export interface NotificationEventView extends NotificationEventCatalogItem {
  readonly system: boolean;
  readonly audio: boolean;
  readonly sound: NotificationSoundId;
  readonly source: NotificationSettingSource;
  readonly issues: readonly NotificationIssue[];
}

export interface CommunityModNotificationSettingsSnapshot {
  readonly ok: boolean;
  readonly profile: CommunityModSettingsProfile;
  readonly generatedAt: string;
  readonly parseError?: string;
  readonly master: {
    readonly systemEnabled: boolean;
    readonly audioEnabled: boolean;
    readonly defaultSound: NotificationSoundId;
  };
  readonly soundCatalog: readonly NotificationSoundCatalogItem[];
  readonly events: readonly NotificationEventView[];
}

export interface NotificationSettingsPatch {
  readonly master?: {
    readonly systemEnabled?: boolean;
    readonly audioEnabled?: boolean;
    readonly defaultSound?: string;
  };
  readonly events?: Record<string, {
    readonly system?: boolean;
    readonly audio?: boolean;
    readonly sound?: string;
  }>;
}

interface NormalizedNotificationEventPatch {
  readonly id: string;
  readonly category: string;
  readonly key: string;
  readonly system: boolean;
  readonly audio: boolean;
  readonly sound: NotificationSoundId;
}

interface NormalizedNotificationSettingsPatch {
  readonly master: {
    readonly systemEnabled?: boolean;
    readonly audioEnabled?: boolean;
    readonly defaultSound?: NotificationSoundId;
  };
  readonly events: readonly NormalizedNotificationEventPatch[];
}

export const NOTIFICATION_SOUND_IDS = [
  "none",
  "default",
  "info",
  "success",
  "warning",
  "alarm",
  "arrival",
  "soft",
  "ping",
  "repair",
] as const;

export type NotificationSoundId = typeof NOTIFICATION_SOUND_IDS[number];

export const NOTIFICATION_SOUND_CATALOG: readonly NotificationSoundCatalogItem[] = [
  sound("none", "None", []),
  sound("default", "Default", [[740, 70], [0, 22], [880, 85], [0, 18]]),
  sound("info", "Info", [[659, 80], [0, 24], [880, 110]]),
  sound("success", "Success", [[587, 70], [0, 18], [740, 70], [0, 18], [988, 120]]),
  sound("warning", "Warning", [[622, 90], [0, 36], [466, 110], [0, 28], [466, 90]]),
  sound("alarm", "Alarm", [[880, 90], [0, 42], [880, 90], [0, 42], [698, 160]]),
  sound("arrival", "Arrival", [[523, 65], [0, 18], [659, 70], [0, 18], [1046, 125]]),
  sound("soft", "Soft", [[523, 90], [0, 26], [659, 110]]),
  sound("ping", "Ping", [[1046, 95]]),
  sound("repair", "Repair", [[440, 70], [0, 18], [554, 70], [0, 18], [740, 140]]),
];

export const NOTIFICATION_EVENT_CATALOG: readonly NotificationEventCatalogItem[] = [
  event("battle.victory", "battle", "victory", "Battle", "Victory", true, false, "success", "notifications_victory"),
  event("battle.defeat", "battle", "defeat", "Battle", "Defeat", true, false, "warning", "notifications_defeat"),
  event("battle.partial_victory", "battle", "partial_victory", "Battle", "Partial victory", true, false, "success", "notifications_partial_victory"),
  event("battle.station_victory", "battle", "station_victory", "Battle", "Station victory", false, false, "success", "notifications_station_victory"),
  event("battle.station_defeat", "battle", "station_defeat", "Battle", "Station defeat", false, false, "warning", "notifications_station_defeat"),
  event("battle.station_battle", "battle", "station_battle", "Battle", "Station battle", false, false, "alarm", "notifications_station_battle"),
  event("battle.incoming_attack_player", "battle", "incoming_attack_player", "Battle", "Incoming player attack", false, false, "alarm", "notifications_incoming_attack_player"),
  event("battle.incoming_attack_hostile", "battle", "incoming_attack_hostile", "Battle", "Incoming hostile attack", false, false, "warning", "notifications_incoming_attack_hostile"),
  event("battle.fleet_battle", "battle", "fleet_battle", "Battle", "Fleet battle", false, false, "warning", "notifications_fleet_battle"),
  event("battle.armada_battle_won", "battle", "armada_battle_won", "Battle", "Armada victory", false, false, "success", "notifications_armada_battle_won"),
  event("battle.armada_battle_lost", "battle", "armada_battle_lost", "Battle", "Armada defeat", false, false, "warning", "notifications_armada_battle_lost"),
  event("battle.assault_victory", "battle", "assault_victory", "Battle", "Assault victory", false, false, "success", "notifications_assault_victory"),
  event("battle.assault_defeat", "battle", "assault_defeat", "Battle", "Assault defeat", false, false, "warning", "notifications_assault_defeat"),
  event("armada.created", "armada", "created", "Armada", "Armada created", true, false, "info", "notifications_armada_created"),
  event("armada.canceled", "armada", "canceled", "Armada", "Armada canceled", true, false, "soft", "notifications_armada_canceled"),
  event("event.tournament", "event", "tournament", "Events", "Tournament progress", true, false, "info", "notifications_tournament"),
  event("event.chained_event_scored", "event", "chained_event_scored", "Events", "Chained event scored", true, false, "ping", "notifications_chained_event_scored"),
  event("fleet.arrived_in_system", "fleet", "arrived_in_system", "Fleet", "Arrived in system", false, false, "arrival", "notifications_fleet_arrived_in_system", ["notifications", "system", "fleet", "arrived_in_system"], "notifications_audio_fleet_arrived_in_system", ["notifications", "audio", "fleet", "arrived_in_system"]),
  event("fleet.arrived_at_destination", "fleet", "arrived_at_destination", "Fleet", "Arrived at destination", false, false, "soft", "notifications_fleet_arrived_at_destination", ["notifications", "system", "fleet", "arrived_at_destination"]),
  event("fleet.started_mining", "fleet", "started_mining", "Fleet", "Started mining", false, false, "ping", "notifications_fleet_started_mining", ["notifications", "system", "fleet", "started_mining"]),
  event("fleet.node_depleted", "fleet", "node_depleted", "Fleet", "Node depleted", false, false, "warning", "notifications_fleet_node_depleted", ["notifications", "system", "fleet", "node_depleted"]),
  event("fleet.docked", "fleet", "docked", "Fleet", "Docked", false, false, "soft", "notifications_fleet_docked", ["notifications", "system", "fleet", "docked"]),
  event("fleet.repair_complete", "fleet", "repair_complete", "Fleet", "Repair complete", false, false, "repair", "notifications_fleet_repair_complete", ["notifications", "system", "fleet", "repair_complete"]),
];

const soundIds = new Set<string>(NOTIFICATION_SOUND_IDS);

export function buildCommunityModNotificationSettingsSnapshot(tomlText: string, options: { readonly profile?: string | CommunityModSettingsProfile } = {}): CommunityModNotificationSettingsSnapshot {
  const profile = normalizeCommunityModSettingsProfile(options.profile);
  const generatedAt = new Date().toISOString();
  const parsed = parseCommunityModToml(tomlText);
  const root = parsed.root;
  const master = buildMasterView(root);
  const events = notificationEventCatalogForProfile(profile).map((item) => buildEventView(item, root, master.defaultSound));

  return {
    ok: !parsed.error,
    profile,
    generatedAt,
    parseError: parsed.error,
    master,
    soundCatalog: NOTIFICATION_SOUND_CATALOG,
    events,
  };
}

export function notificationEventCatalogForProfile(profileValue: unknown = DEFAULT_COMMUNITY_MOD_SETTINGS_PROFILE): readonly NotificationEventCatalogItem[] {
  const profile = normalizeCommunityModSettingsProfile(profileValue);
  return NOTIFICATION_EVENT_CATALOG.filter((item) => !item.profiles || item.profiles.includes(profile));
}

export function normalizeNotificationSettingsPatch(input: unknown, options: { readonly profile?: string | CommunityModSettingsProfile } = {}): NormalizedNotificationSettingsPatch {
  const profile = normalizeCommunityModSettingsProfile(options.profile);
  const eventById = new Map(notificationEventCatalogForProfile(profile).map((item) => [item.id, item]));
  const payload = asRecord(input);
  const masterPayload = asRecord(payload.master);
  const eventsPayload = asRecord(payload.events);
  const master: { systemEnabled?: boolean; audioEnabled?: boolean; defaultSound?: NotificationSoundId } = {};
  const events: NormalizedNotificationEventPatch[] = [];

  if (Object.hasOwn(masterPayload, "systemEnabled")) {
    master.systemEnabled = normalizeBoolean(masterPayload.systemEnabled, "master.systemEnabled");
  }
  if (Object.hasOwn(masterPayload, "audioEnabled")) {
    master.audioEnabled = normalizeBoolean(masterPayload.audioEnabled, "master.audioEnabled");
  }
  if (Object.hasOwn(masterPayload, "defaultSound")) {
    master.defaultSound = normalizeSoundId(masterPayload.defaultSound, "master.defaultSound");
  }

  for (const [id, value] of Object.entries(eventsPayload)) {
    const catalogItem = eventById.get(id);
    if (!catalogItem) {
      throw new Error(`Unknown notification event: ${id}`);
    }

    const row = asRecord(value);
    events.push({
      id,
      category: catalogItem.category,
      key: catalogItem.key,
      system: normalizeBoolean(row.system, `${id}.system`),
      audio: normalizeBoolean(row.audio, `${id}.audio`),
      sound: normalizeSoundId(row.sound, `${id}.sound`),
    });
  }

  return { master, events };
}

export function applyCommunityModNotificationSettingsPatch(tomlText: string, input: unknown, options: { readonly profile?: string | CommunityModSettingsProfile } = {}): string {
  parseCommunityModTomlOrThrow(tomlText);
  const patch = normalizeNotificationSettingsPatch(input, options);
  let output = tomlText;

  if (patch.master.systemEnabled !== undefined) {
    output = upsertTomlValue(output, "notifications.system", "enabled", patch.master.systemEnabled);
  }
  if (patch.master.audioEnabled !== undefined) {
    output = upsertTomlValue(output, "notifications.audio", "enabled", patch.master.audioEnabled);
  }
  if (patch.master.defaultSound !== undefined) {
    output = upsertTomlValue(output, "notifications.audio", "default_sound", patch.master.defaultSound);
  }

  for (const item of patch.events) {
    output = upsertTomlRawValue(output, `notifications.events.${item.category}`, item.key, formatNotificationPolicyInlineTable(item));
  }

  parseCommunityModTomlOrThrow(output);
  return output;
}

function buildMasterView(root: Record<string, unknown>): CommunityModNotificationSettingsSnapshot["master"] {
  const systemEnabled = readBoolean(root, [["notifications", "system", "enabled"], ["notifications", "notifications_enabled"]], false).value;
  const audioEnabled = readBoolean(root, [["notifications", "audio", "enabled"], ["notifications", "notifications_audio_enabled"]], false).value;
  const defaultSound = normalizeSoundIdOrDefault(readString(root, [["notifications", "audio", "default_sound"]]).value, "default");
  return { systemEnabled, audioEnabled, defaultSound };
}

function buildEventView(catalogItem: NotificationEventCatalogItem, root: Record<string, unknown>, masterDefaultSound: NotificationSoundId): NotificationEventView {
  const issues: NotificationIssue[] = [];
  const defaultSound = catalogItem.defaultSound === "default" ? masterDefaultSound : catalogItem.defaultSound;
  const legacySystemPaths = [
    catalogItem.legacySystemPath,
    catalogItem.legacySystemKey ? ["notifications", catalogItem.legacySystemKey] : undefined,
  ].filter(Boolean) as string[][];
  const legacyAudioPaths = [
    catalogItem.legacyAudioPath,
    catalogItem.legacyAudioKey ? ["notifications", catalogItem.legacyAudioKey] : undefined,
  ].filter(Boolean) as string[][];
  const legacySystem = readBoolean(root, legacySystemPaths, catalogItem.defaultSystem);
  const legacyAudio = readBoolean(root, legacyAudioPaths, catalogItem.defaultAudio);
  let source: NotificationSettingSource = legacySystem.source || legacyAudio.source ? "legacy" : "default";
  let system = legacySystem.value;
  let audio = legacyAudio.value;
  let soundId = defaultSound;

  issues.push(...legacySystem.issues, ...legacyAudio.issues);

  const eventValue = readPath(root, ["notifications", "events", catalogItem.category, catalogItem.key]);
  if (eventValue.exists) {
    const table = asRecord(eventValue.value);
    if (Object.keys(table).length === 0) {
      issues.push({ severity: "warning", message: "Event policy is not an inline table; defaults are shown." });
    } else {
      source = "event";
      const systemRead = readBoolean(table, [["system"]], system);
      const audioRead = readBoolean(table, [["audio"]], audio);
      issues.push(...systemRead.issues, ...audioRead.issues);
      system = systemRead.value;
      audio = audioRead.value;
      soundId = normalizeSoundIdOrDefault(readString(table, [["sound"]]).value, soundId, issues);
    }
  }

  return {
    ...catalogItem,
    system,
    audio,
    sound: soundId,
    source,
    issues,
  };
}

function sound(id: NotificationSoundId, label: string, pattern: readonly (readonly [number, number])[]): NotificationSoundCatalogItem {
  return { id, label, pattern: pattern.map(([frequency, durationMs]) => ({ frequency, durationMs })) };
}

function event(
  id: string,
  category: string,
  key: string,
  group: string,
  label: string,
  defaultSystem: boolean,
  defaultAudio: boolean,
  defaultSound: NotificationSoundId,
  legacySystemKey?: string,
  legacySystemPath?: readonly string[],
  legacyAudioKey?: string,
  legacyAudioPath?: readonly string[],
): NotificationEventCatalogItem {
  return {
    id,
    category,
    key,
    group,
    label,
    defaultSystem,
    defaultAudio,
    defaultSound,
    legacySystemKey,
    legacySystemPath,
    legacyAudioKey,
    legacyAudioPath,
    profiles: ["waffle-basic", "waffle-advanced"],
  };
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

function readBoolean(root: Record<string, unknown>, paths: readonly (readonly string[])[], defaultValue: boolean): { value: boolean; source?: string; issues: NotificationIssue[] } {
  const issues: NotificationIssue[] = [];
  for (const path of paths) {
    const read = readPath(root, path);
    if (!read.exists) {
      continue;
    }

    if (typeof read.value === "boolean") {
      return { value: read.value, source: path.join("."), issues };
    }

    issues.push({ severity: "warning", message: `${path.join(".")} is not a boolean; the mod will use its default.` });
  }

  return { value: defaultValue, issues };
}

function readString(root: Record<string, unknown>, paths: readonly (readonly string[])[]): { value?: string; source?: string } {
  for (const path of paths) {
    const read = readPath(root, path);
    if (read.exists && typeof read.value === "string") {
      return { value: read.value, source: path.join(".") };
    }
  }

  return {};
}

function readPath(root: Record<string, unknown>, path: readonly string[]): { exists: boolean; value?: unknown } {
  let current: unknown = root;
  for (const segment of path) {
    const record = asRecord(current);
    if (!Object.hasOwn(record, segment)) {
      return { exists: false };
    }
    current = record[segment];
  }

  return { exists: true, value: current };
}

function normalizeBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

function normalizeSoundId(value: unknown, path: string): NotificationSoundId {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_").replace(/\s+/g, "_");
  if (!soundIds.has(normalized)) {
    throw new Error(`${path} must be one of: ${NOTIFICATION_SOUND_IDS.join(", ")}.`);
  }
  return normalized as NotificationSoundId;
}

function normalizeSoundIdOrDefault(value: unknown, defaultValue: NotificationSoundId, issues?: NotificationIssue[]): NotificationSoundId {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  try {
    return normalizeSoundId(value, "sound");
  } catch {
    issues?.push({ severity: "warning", message: `Unknown sound '${String(value)}'; ${defaultValue} is shown.` });
    return defaultValue;
  }
}

function upsertTomlValue(tomlText: string, section: string, key: string, value: string | boolean | number): string {
  return upsertTomlRawValue(tomlText, section, key, formatTomlScalar(value));
}

function upsertTomlRawValue(tomlText: string, section: string, key: string, rawValue: string): string {
  const eol = tomlText.includes("\r\n") ? "\r\n" : "\n";
  const lines = tomlText.length > 0 ? tomlText.split(/\r?\n/) : [];
  const sectionHeader = `[${section}]`;
  const sectionIndex = lines.findIndex((line) => sectionHeaderRegex(section).test(line));
  const assignment = `${key} = ${rawValue}`;

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

function formatNotificationPolicyInlineTable(value: { readonly system: boolean; readonly audio: boolean; readonly sound: NotificationSoundId }): string {
  return `{ system = ${formatTomlScalar(value.system)}, audio = ${formatTomlScalar(value.audio)}, sound = ${formatTomlScalar(value.sound)} }`;
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

function sectionHeaderRegex(section: string): RegExp {
  return new RegExp(`^\\s*\\[${escapeRegExp(section)}\\]\\s*(?:#.*)?$`);
}

function keyAssignmentRegex(key: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
