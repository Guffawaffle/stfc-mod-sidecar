import { parse as parseToml } from "smol-toml";

export const HOTKEY_MAX_BINDINGS = 2;

export type HotkeyBindingSource = "config" | "default" | "off";
export type HotkeyIssueSeverity = "info" | "warning" | "error";
export type HotkeyHardSettingType = "boolean" | "integer";

export interface HotkeyActionCatalogItem {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly defaultBindings: readonly string[];
  readonly description?: string;
  readonly maxBindings?: number;
  readonly allowUnbound?: boolean;
  readonly conflictGroup?: string;
}

export interface HotkeyHardSettingCatalogItem {
  readonly id: string;
  readonly section: string;
  readonly key: string;
  readonly label: string;
  readonly type: HotkeyHardSettingType;
  readonly defaultValue: boolean | number;
  readonly description: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface HotkeyIssue {
  readonly severity: HotkeyIssueSeverity;
  readonly message: string;
}

export interface HotkeyActionView extends HotkeyActionCatalogItem {
  readonly bindings: readonly string[];
  readonly source: HotkeyBindingSource;
  readonly rawValue: string;
  readonly effectiveValue: string;
  readonly isExplicitlyOff: boolean;
  readonly issues: readonly HotkeyIssue[];
  readonly maxBindings: number;
  readonly allowUnbound: boolean;
}

export interface HotkeyHardSettingView extends HotkeyHardSettingCatalogItem {
  readonly value: boolean | number;
  readonly source: "config" | "default";
  readonly issues: readonly HotkeyIssue[];
}

export interface HotkeyConflict {
  readonly binding: string;
  readonly actionIds: readonly string[];
  readonly labels: readonly string[];
  readonly severity: Exclude<HotkeyIssueSeverity, "error">;
  readonly message: string;
}

export interface CommunityModHotkeySettingsSnapshot {
  readonly ok: boolean;
  readonly generatedAt: string;
  readonly parseError?: string;
  readonly actions: readonly HotkeyActionView[];
  readonly hardSettings: readonly HotkeyHardSettingView[];
  readonly conflicts: readonly HotkeyConflict[];
}

export interface HotkeySettingsPatch {
  readonly shortcuts?: Record<string, string | readonly string[]>;
  readonly hardSettings?: Record<string, boolean | number>;
}

interface NormalizedShortcutPatch {
  readonly section: "shortcuts";
  readonly key: string;
  readonly value: string;
}

interface NormalizedHardSettingPatch {
  readonly section: string;
  readonly key: string;
  readonly value: boolean | number;
}

interface NormalizedHotkeySettingsPatch {
  readonly shortcuts: readonly NormalizedShortcutPatch[];
  readonly hardSettings: readonly NormalizedHardSettingPatch[];
}

const navigationActions = [
  action("select_current", "Select current fleet", "Chat Tabs & Selection", ["CTRL-SPACE"]),
  action("select_ship1", "Select ship 1", "Chat Tabs & Selection", ["1"]),
  action("select_ship2", "Select ship 2", "Chat Tabs & Selection", ["2"]),
  action("select_ship3", "Select ship 3", "Chat Tabs & Selection", ["3"]),
  action("select_ship4", "Select ship 4", "Chat Tabs & Selection", ["4"]),
  action("select_ship5", "Select ship 5", "Chat Tabs & Selection", ["5"]),
  action("select_ship6", "Select ship 6", "Chat Tabs & Selection", ["6"]),
  action("select_ship7", "Select ship 7", "Chat Tabs & Selection", ["7"]),
  action("select_ship8", "Select ship 8", "Chat Tabs & Selection", ["8"]),
  action("select_chatglobal", "Select global chat", "Chat Tabs & Selection", ["CTRL-1"]),
  action("select_chatalliance", "Select alliance chat", "Chat Tabs & Selection", ["CTRL-2"]),
  action("select_chatprivate", "Select private chat", "Chat Tabs & Selection", ["CTRL-3"]),
] as const;

const actionActions = [
  action("action_primary", "Primary action", "Queue & Primary", ["SPACE", "MOUSE1"], { conflictGroup: "primary-action" }),
  action("action_queue", "Queue action", "Queue & Primary", ["SPACE", "MOUSE1"], { conflictGroup: "primary-action" }),
  action("action_queue_clear", "Clear action queue", "Queue & Primary", ["CTRL-C"]),
  action("action_secondary", "Secondary action", "Queue & Primary", ["TAB", "MOUSE4"]),
  action("action_view", "View target details", "Queue & Primary", ["V", "MOUSE2"]),
  action("toggle_queue", "Toggle queue", "Queue & Primary", ["CTRL-Q"]),
  action("action_recall", "Recall", "Recall & Repair", ["R", "MOUSE3"], { conflictGroup: "recall-repair" }),
  action("action_repair", "Repair", "Recall & Repair", ["R", "MOUSE3"], { conflictGroup: "recall-repair" }),
  action("action_recall_cancel", "Cancel recall", "Recall & Repair", ["SPACE", "MOUSE1"], { conflictGroup: "primary-action" }),
] as const;

const screenActions = [
  action("show_alliance", "Alliance", "Screens", ["ALT-'"]),
  action("show_alliance_armada", "Alliance armada", "Screens", ["CTRL-'"]),
  action("show_alliance_help", "Alliance help", "Screens", ["SHIFT-'"]),
  action("show_artifacts", "Artifacts", "Screens", ["SHIFT-I"]),
  action("show_awayteam", "Away team", "Screens", ["T"]),
  action("show_bookmarks", "Bookmarks", "Screens", ["B"]),
  action("show_chat", "Chat full screen", "Screens", ["C"]),
  action("show_chatside1", "Chat left", "Screens", ["ALT-C"]),
  action("show_chatside2", "Chat right", "Screens", ["`"]),
  action("show_commander", "Fleet commander", "Screens", ["O"]),
  action("show_daily", "Daily missions", "Screens", ["Z"]),
  action("show_events", "Events", "Screens", ["SHIFT-E"]),
  action("show_exocomp", "Exocomp", "Screens", ["X"]),
  action("show_factions", "Factions", "Screens", ["F"]),
  action("show_galaxy", "Galaxy", "Screens", ["G"]),
  action("show_gifts", "Gifts", "Screens", ["/"]),
  action("show_inventory", "Inventory", "Screens", ["I"]),
  action("show_lookup", "Lookup", "Screens", ["L"]),
  action("show_missions", "Missions", "Screens", ["M"]),
  action("show_officers", "Officers", "Screens", ["SHIFT-O"]),
  action("show_qtrials", "Q Trials", "Screens", ["SHIFT-Q"]),
  action("show_refinery", "Refinery", "Screens", ["SHIFT-F"]),
  action("show_research", "Research", "Screens", ["U"]),
  action("show_scrapyard", "Scrap yard", "Screens", ["Y"]),
  action("show_settings", "Settings", "Screens", ["SHIFT-S"]),
  action("show_ships", "Manage ships", "Screens", ["N"]),
  action("show_stationexterior", "Station exterior", "Screens", ["SHIFT-G"]),
  action("show_stationinterior", "Station interior", "Screens", ["SHIFT-H"]),
  action("show_system", "System", "Screens", ["H"]),
] as const;

const zoomActions = [
  action("zoom_preset1", "Zoom preset 1", "Zoom & Presets", ["F1"]),
  action("zoom_preset2", "Zoom preset 2", "Zoom & Presets", ["F2"]),
  action("zoom_preset3", "Zoom preset 3", "Zoom & Presets", ["F3"]),
  action("zoom_preset4", "Zoom preset 4", "Zoom & Presets", ["F4"]),
  action("zoom_preset5", "Zoom preset 5", "Zoom & Presets", ["F5"]),
  action("set_zoom_preset1", "Set zoom preset 1", "Zoom & Presets", ["SHIFT-F1"]),
  action("set_zoom_preset2", "Set zoom preset 2", "Zoom & Presets", ["SHIFT-F2"]),
  action("set_zoom_preset3", "Set zoom preset 3", "Zoom & Presets", ["SHIFT-F3"]),
  action("set_zoom_preset4", "Set zoom preset 4", "Zoom & Presets", ["SHIFT-F4"]),
  action("set_zoom_preset5", "Set zoom preset 5", "Zoom & Presets", ["SHIFT-F5"]),
  action("set_zoom_default", "Set default zoom", "Zoom & Presets", ["CTRL-="]),
  action("zoom_in", "Zoom in", "Zoom & Presets", ["Q"]),
  action("zoom_out", "Zoom out", "Zoom & Presets", ["E"]),
  action("zoom_min", "Zoom minimum", "Zoom & Presets", ["BACKSPACE"]),
  action("zoom_max", "Zoom maximum", "Zoom & Presets", ["MINUS"]),
  action("zoom_reset", "Zoom reset", "Zoom & Presets", ["="]),
] as const;

const utilityActions = [
  action("ui_scaleup", "UI scale up", "UI Scale", ["PGUP"]),
  action("ui_scaledown", "UI scale down", "UI Scale", ["PGDOWN"]),
  action("ui_scaleviewerup", "Viewer scale up", "UI Scale", ["SHIFT-PGUP"]),
  action("ui_scaleviewerdown", "Viewer scale down", "UI Scale", ["SHIFT-PGDOWN"]),
  action("toggle_cargo_default", "Toggle default cargo", "Cargo & Locate", ["ALT-1"]),
  action("toggle_cargo_player", "Toggle player cargo", "Cargo & Locate", ["ALT-2"]),
  action("toggle_cargo_station", "Toggle station cargo", "Cargo & Locate", ["ALT-3"]),
  action("toggle_cargo_hostile", "Toggle hostile cargo", "Cargo & Locate", ["ALT-4"]),
  action("toggle_cargo_armada", "Toggle armada cargo", "Cargo & Locate", ["ALT-5"]),
  action("toggle_preview_locate", "Toggle preview locate", "Cargo & Locate", ["CTRL-R"]),
  action("toggle_preview_recall", "Toggle preview recall", "Cargo & Locate", ["CTRL-T"]),
  action("move_up", "Move up", "Experimental", ["W"]),
  action("move_down", "Move down", "Experimental", ["S"]),
  action("move_left", "Move left", "Experimental", ["A"]),
  action("move_right", "Move right", "Experimental", ["D"]),
  action("log_trace", "Log trace", "Hotkeys Master Switch & Logs", ["CTRL-SHIFT-F7"]),
  action("log_info", "Log info", "Hotkeys Master Switch & Logs", ["CTRL-SHIFT-F8"]),
  action("log_debug", "Log debug", "Hotkeys Master Switch & Logs", ["CTRL-SHIFT-F9"]),
  action("log_warn", "Log warn", "Hotkeys Master Switch & Logs", ["CTRL-SHIFT-F10"]),
  action("log_error", "Log error", "Hotkeys Master Switch & Logs", ["CTRL-SHIFT-F11"]),
  action("log_off", "Log off", "Hotkeys Master Switch & Logs", ["CTRL-SHIFT-F12"]),
  action("set_hotkeys_disable", "Disable mod hotkeys", "Hotkeys Master Switch & Logs", ["CTRL-ALT-MINUS"]),
  action("set_hotkeys_enabled", "Enable mod hotkeys", "Hotkeys Master Switch & Logs", ["CTRL-ALT-="]),
  action("quit", "Quit process", "Hotkeys Master Switch & Logs", ["F10"]),
] as const;

export const HOTKEY_ACTION_CATALOG: readonly HotkeyActionCatalogItem[] = [
  ...utilityActions,
  ...navigationActions,
  ...actionActions,
  ...screenActions,
  ...zoomActions,
];

export const HOTKEY_HARD_SETTING_CATALOG: readonly HotkeyHardSettingCatalogItem[] = [
  {
    id: "control.hotkeys_enabled",
    section: "control",
    key: "hotkeys_enabled",
    label: "Mod hotkeys",
    type: "boolean",
    defaultValue: true,
    description: "Master toggle for the mod keyboard router.",
  },
  {
    id: "control.hotkeys_extended",
    section: "control",
    key: "hotkeys_extended",
    label: "Extended hotkeys",
    type: "boolean",
    defaultValue: true,
    description: "Enable extended shortcut families such as cargo, panels, and zoom helpers.",
  },
  {
    id: "control.use_scopely_hotkeys",
    section: "control",
    key: "use_scopely_hotkeys",
    label: "Use Scopely hotkeys",
    type: "boolean",
    defaultValue: false,
    description: "Prefer the game shortcut layer instead of the mod router where applicable.",
  },
  {
    id: "control.allow_key_fallthrough",
    section: "control",
    key: "allow_key_fallthrough",
    label: "Allow key fallthrough",
    type: "boolean",
    defaultValue: false,
    description: "Let unhandled key frames continue into the original game input path.",
  },
  {
    id: "control.select_timer",
    section: "control",
    key: "select_timer",
    label: "Ship select timer",
    type: "integer",
    defaultValue: 500,
    description: "Maximum milliseconds for fleet select timing and double-tap style interactions.",
    min: 0,
    max: 2000,
    step: 50,
  },
  {
    id: "control.enable_experimental",
    section: "control",
    key: "enable_experimental",
    label: "Experimental controls",
    type: "boolean",
    defaultValue: false,
    description: "Enable experimental control features, including movement-key behavior.",
  },
  {
    id: "ui.disable_move_keys",
    section: "ui",
    key: "disable_move_keys",
    label: "Disable move keys",
    type: "boolean",
    defaultValue: false,
    description: "Disable the experimental WASD movement shortcuts even if present in the binding list.",
  },
  {
    id: "ui.disable_escape_exit",
    section: "ui",
    key: "disable_escape_exit",
    label: "Protect Escape exit",
    type: "boolean",
    defaultValue: true,
    description: "Prevent Escape from immediately opening the game exit prompt.",
  },
  {
    id: "ui.escape_exit_timer",
    section: "ui",
    key: "escape_exit_timer",
    label: "Escape double-tap window",
    type: "integer",
    defaultValue: 0,
    description: "Milliseconds between Escape presses that still allows the exit prompt; 0 keeps Escape fully blocked.",
    min: 0,
    max: 2000,
    step: 50,
  },
];

const actionById = new Map(HOTKEY_ACTION_CATALOG.map((item) => [item.id, item]));
const hardSettingById = new Map(HOTKEY_HARD_SETTING_CATALOG.map((item) => [item.id, item]));
const hardSettingBySectionKey = new Map(HOTKEY_HARD_SETTING_CATALOG.map((item) => [`${item.section}.${item.key}`, item]));

const modifierKeys = new Set(["SHIFT", "LSHIFT", "RSHIFT", "CTRL", "LCTRL", "RCTRL", "ALT", "LALT", "RALT", "WIN", "LWIN", "RWIN", "ALTGR"]);
const primaryKeys = new Set([
  "HOME", "END", "PGUP", "PGDOWN", "LEFT", "RIGHT", "UP", "DOWN", "BACKSPACE", "CLEAR", "CAPS", "BREAK",
  "INSERT", "DELETE", "HELP", "MENU", "PAUSE", "PRINT", "SPACE", "RETURN", "SCROLL", "SYSREQ", "TAB",
  "MOUSE0", "MOUSE1", "MOUSE2", "MOUSE3", "MOUSE4", "MOUSE5", "MOUSE6", "MINUS", "'", "_", ",", ".",
  ";", ":", "!", "?", "(", ")", "[", "]", "{", "}", "@", "*", "/", "\\", "\"", "&", "#", "%", "`", "^",
  "+", "<", "=", ">", "~", "$", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13", "F14", "F15",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "KEY0", "KEY1", "KEY2", "KEY3", "KEY4", "KEY5", "KEY6",
  "KEY7", "KEY8", "KEY9", "KEYDIVIDE", "KEYENTER", "KEYEQUAL", "KEYMINUS", "KEYMULTI", "KEYPERIOD", "KEYPLUS", "NUMLOCK",
]);

export function buildCommunityModHotkeySettingsSnapshot(tomlText: string): CommunityModHotkeySettingsSnapshot {
  const generatedAt = new Date().toISOString();
  const parsed = parseCommunityModToml(tomlText);
  const root = parsed.root;
  const shortcuts = asRecord(root.shortcuts);
  const actions = HOTKEY_ACTION_CATALOG.map((catalogItem) => buildActionView(catalogItem, shortcuts));
  const hardSettings = HOTKEY_HARD_SETTING_CATALOG.map((catalogItem) => buildHardSettingView(catalogItem, root));
  const conflicts = buildConflicts(actions);

  return {
    ok: !parsed.error,
    generatedAt,
    parseError: parsed.error,
    actions,
    hardSettings,
    conflicts,
  };
}

export function normalizeHotkeySettingsPatch(input: unknown): NormalizedHotkeySettingsPatch {
  const payload = asRecord(input);
  const shortcutsPayload = asRecord(payload.shortcuts);
  const hardSettingsPayload = asRecord(payload.hardSettings);
  const shortcuts: NormalizedShortcutPatch[] = [];
  const hardSettings: NormalizedHardSettingPatch[] = [];

  for (const [id, value] of Object.entries(shortcutsPayload)) {
    const catalogItem = actionById.get(id);
    if (!catalogItem) {
      throw new Error(`Unknown shortcut action: ${id}`);
    }

    const formatted = normalizePatchShortcutValue(catalogItem, value);
    shortcuts.push({ section: "shortcuts", key: id, value: formatted });
  }

  for (const [id, value] of Object.entries(hardSettingsPayload)) {
    const catalogItem = hardSettingById.get(id);
    if (!catalogItem) {
      throw new Error(`Unknown hard setting: ${id}`);
    }

    hardSettings.push({ section: catalogItem.section, key: catalogItem.key, value: normalizeHardSettingPatchValue(catalogItem, value) });
  }

  return { shortcuts, hardSettings };
}

export function applyCommunityModHotkeySettingsPatch(tomlText: string, input: unknown): string {
  parseCommunityModTomlOrThrow(tomlText);
  const patch = normalizeHotkeySettingsPatch(input);
  let output = tomlText;

  for (const item of patch.hardSettings) {
    output = upsertTomlValue(output, item.section, item.key, item.value);
  }

  for (const item of patch.shortcuts) {
    output = upsertTomlValue(output, item.section, item.key, item.value);
  }

  parseCommunityModTomlOrThrow(output);
  return output;
}

export function formatShortcutValue(bindings: readonly string[]): string {
  const normalized = bindings.map(normalizeBindingToken).filter((binding) => binding.length > 0);
  return normalized.length === 0 ? "NONE" : normalized.join("|");
}

function action(id: string, label: string, group: string, defaultBindings: readonly string[], options: Partial<HotkeyActionCatalogItem> = {}): HotkeyActionCatalogItem {
  return {
    id,
    label,
    group,
    defaultBindings,
    maxBindings: HOTKEY_MAX_BINDINGS,
    allowUnbound: true,
    ...options,
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

function buildActionView(catalogItem: HotkeyActionCatalogItem, shortcuts: Record<string, unknown>): HotkeyActionView {
  const maxBindings = catalogItem.maxBindings ?? HOTKEY_MAX_BINDINGS;
  const allowUnbound = catalogItem.allowUnbound ?? true;
  const rawSetting = shortcuts[catalogItem.id];
  const hasConfigValue = Object.hasOwn(shortcuts, catalogItem.id);
  const rawValue = typeof rawSetting === "string" ? rawSetting : formatShortcutValue(catalogItem.defaultBindings);
  const source = hasConfigValue && typeof rawSetting === "string"
    ? rawValue.trim().toUpperCase() === "NONE" ? "off" : "config"
    : "default";
  const bindings = source === "off" ? [] : shortcutValueToBindings(rawValue);
  const issues: HotkeyIssue[] = [];

  if (hasConfigValue && typeof rawSetting !== "string") {
    issues.push({ severity: "warning", message: "Config value is not a string; the mod will use its built-in default." });
  }

  if (bindings.length > maxBindings) {
    issues.push({ severity: "warning", message: `This action has ${bindings.length} bindings; the sidecar editor currently saves at most ${maxBindings}.` });
  }

  if (!allowUnbound && bindings.length === 0) {
    issues.push({ severity: "error", message: "This action cannot be unbound." });
  }

  for (const binding of bindings) {
    const validation = validateBinding(binding);
    if (validation) {
      issues.push(validation);
    }
  }

  return {
    ...catalogItem,
    maxBindings,
    allowUnbound,
    bindings,
    source,
    rawValue,
    effectiveValue: formatShortcutValue(bindings),
    isExplicitlyOff: source === "off",
    issues,
  };
}

function buildHardSettingView(catalogItem: HotkeyHardSettingCatalogItem, root: Record<string, unknown>): HotkeyHardSettingView {
  const section = asRecord(root[catalogItem.section]);
  const hasConfigValue = Object.hasOwn(section, catalogItem.key);
  const rawValue = section[catalogItem.key];
  const issues: HotkeyIssue[] = [];
  let value = catalogItem.defaultValue;

  if (catalogItem.type === "boolean") {
    if (typeof rawValue === "boolean") {
      value = rawValue;
    } else if (hasConfigValue) {
      issues.push({ severity: "warning", message: "Config value is not a boolean; the mod will use its built-in default." });
    }
  } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    value = clampInteger(catalogItem, rawValue);
  } else if (hasConfigValue) {
    issues.push({ severity: "warning", message: "Config value is not an integer; the mod will use its built-in default." });
  }

  return {
    ...catalogItem,
    value,
    source: hasConfigValue && issues.length === 0 ? "config" : "default",
    issues,
  };
}

function shortcutValueToBindings(value: string): string[] {
  if (value.trim().toUpperCase() === "NONE") {
    return [];
  }

  return value.split("|").map(normalizeBindingToken).filter((binding) => binding.length > 0);
}

function normalizePatchShortcutValue(catalogItem: HotkeyActionCatalogItem, value: unknown): string {
  const bindings = Array.isArray(value) ? value.map((item) => String(item)) : shortcutValueToBindings(String(value ?? ""));
  const normalized = bindings.map(normalizeBindingToken).filter((binding) => binding.length > 0);
  const maxBindings = catalogItem.maxBindings ?? HOTKEY_MAX_BINDINGS;

  if (normalized.length === 0 && !(catalogItem.allowUnbound ?? true)) {
    throw new Error(`${catalogItem.id} cannot be unbound.`);
  }

  if (normalized.length > maxBindings) {
    throw new Error(`${catalogItem.id} has ${normalized.length} bindings; at most ${maxBindings} are supported by the sidecar editor.`);
  }

  const duplicates = new Set<string>();
  for (const binding of normalized) {
    const issue = validateBinding(binding);
    if (issue?.severity === "error") {
      throw new Error(`${catalogItem.id} has invalid binding ${binding}: ${issue.message}`);
    }

    if (duplicates.has(binding)) {
      throw new Error(`${catalogItem.id} repeats binding ${binding}.`);
    }

    duplicates.add(binding);
  }

  return formatShortcutValue(normalized);
}

function normalizeHardSettingPatchValue(catalogItem: HotkeyHardSettingCatalogItem, value: unknown): boolean | number {
  if (catalogItem.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`${catalogItem.id} must be a boolean.`);
    }
    return value;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${catalogItem.id} must be a number.`);
  }

  return clampInteger(catalogItem, numericValue);
}

function normalizeBindingToken(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function validateBinding(binding: string): HotkeyIssue | undefined {
  if (binding.includes("|")) {
    return { severity: "error", message: "Binding segments cannot contain a pipe; use separate binding chips instead." };
  }

  const tokens = binding.split("-").filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { severity: "error", message: "Binding is empty." };
  }

  const primary = tokens.filter((token) => !modifierKeys.has(token));
  if (primary.length !== 1) {
    return { severity: "error", message: "Use zero or more modifiers plus exactly one primary key." };
  }

  for (const token of tokens) {
    if (!modifierKeys.has(token) && !primaryKeys.has(token)) {
      return { severity: "error", message: `Unknown key token ${token}.` };
    }
  }

  if (modifierKeys.has(primary[0])) {
    return { severity: "error", message: "A modifier cannot be the primary key." };
  }

  if (tokens.length === 1 && primaryKeys.has(primary[0]) && /^[A-Z0-9]$/.test(primary[0])) {
    return { severity: "info", message: "Single-character shortcuts are convenient but easier to trigger accidentally." };
  }

  return undefined;
}

function buildConflicts(actions: readonly HotkeyActionView[]): HotkeyConflict[] {
  const bindings = new Map<string, HotkeyActionView[]>();
  for (const actionView of actions) {
    for (const binding of actionView.bindings) {
      const existing = bindings.get(binding) ?? [];
      existing.push(actionView);
      bindings.set(binding, existing);
    }
  }

  return [...bindings.entries()]
    .filter(([, actionViews]) => actionViews.length > 1)
    .map(([binding, actionViews]) => {
      const groups = new Set(actionViews.map((item) => item.conflictGroup).filter(Boolean));
      const severity = groups.size === 1 && actionViews.every((item) => item.conflictGroup) ? "info" : "warning";
      const labels = actionViews.map((item) => item.label);
      return {
        binding,
        actionIds: actionViews.map((item) => item.id),
        labels,
        severity,
        message: severity === "info"
          ? `${binding} is intentionally shared by context-dependent actions: ${labels.join(", ")}.`
          : `${binding} is assigned to multiple actions: ${labels.join(", ")}.`,
      };
    });
}

function clampInteger(catalogItem: HotkeyHardSettingCatalogItem, value: number): number {
  const integer = Math.trunc(value);
  const min = catalogItem.min ?? Number.MIN_SAFE_INTEGER;
  const max = catalogItem.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, integer));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    // Keep the mod's long-standing semantics: missing shortcut key means default,
    // explicit "NONE" means intentionally unbound. A future comment-preserving TOML
    // editor could retain inline comments too; this constrained writer only replaces
    // allowlisted key assignment lines.
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