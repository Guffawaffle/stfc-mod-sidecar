export function buildSettingsTroubleshootingSummary(input = {}) {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return "Loading settings context.";
  }

  const conflicts = input.conflicts ?? [];
  const warningCount = collectSettingsWarnings({ snapshot, conflicts }).length;
  const changeCount = input.changeCount ?? buildDraftChangeSummary(input).length;
  const conflictCount = conflicts.filter((conflict) => conflict.severity === "warning").length;
  const pieces = [
    `${warningCount} warning${warningCount === 1 ? "" : "s"}`,
    `${changeCount} draft change${changeCount === 1 ? "" : "s"}`,
    `${conflictCount} blocking conflict${conflictCount === 1 ? "" : "s"}`,
  ];
  return `${pieces.join("; ")}. Local paths are reduced to file or folder names in exported context.`;
}

export function buildSettingsTroubleshootingPrompt(input = {}) {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return "Settings are still loading.";
  }

  const conflicts = input.conflicts ?? [];
  const warnings = collectSettingsWarnings({ snapshot, conflicts });
  const changes = buildDraftChangeSummary(input);
  const infoConflicts = conflicts.filter((conflict) => conflict.severity === "info");
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const bootstrap = input.bootstrap ?? {};
  const contextRows = [
    `Generated: ${generatedAt}`,
    `Mode: ${modeLabel(bootstrap.developerMode)}`,
    `Config state: ${snapshot.parseError ? "Invalid TOML" : snapshot.exists ? "Found" : "Not found"}`,
    `Settings file: ${redactedPathLabel(snapshot.settingsPath)}`,
    `Game directory: ${redactedPathLabel(bootstrap.gameDirectory || gameDirectoryFromSettingsPath(snapshot.settingsPath))}`,
    `Feed file: ${redactedPathLabel(bootstrap.feedPath)}`,
    `Save mode: ${snapshot.settingsSaveMode ?? "unknown"}`,
    `Apply mode: ${snapshot.applyMode ?? "unknown"}`,
    `Hotkey actions: ${snapshot.actions.length}`,
    `Hard settings: ${snapshot.hardSettings.length}`,
    `Draft changes: ${changes.length}`,
    `Warnings: ${warnings.length}`,
  ];

  return [
    "# STFC Sidecar Settings Troubleshooting Context",
    "",
    "Use this redacted settings context to help troubleshoot hotkey or Community Mod settings issues.",
    "Do not assume omitted local paths, tokens, credentials, or raw game payloads are available.",
    "Keep recommendations read-only unless the user explicitly asks for a settings change.",
    "",
    "## Context",
    ...contextRows.map((row) => `- ${row}`),
    "",
    "## Warnings And Conflicts",
    ...formatPromptList(warnings, "No warnings or blocking conflicts detected."),
    "",
    "## Context-Dependent Shared Bindings",
    ...formatPromptList(infoConflicts.map((conflict) => `${conflict.binding}: ${conflict.message}`), "No context-dependent shared bindings detected."),
    "",
    "## Unsaved Draft Changes",
    ...formatPromptList(changes, "No unsaved draft changes."),
  ].join("\n");
}

export function collectSettingsWarnings(input = {}) {
  const snapshot = input.snapshot;
  const conflicts = input.conflicts ?? [];
  const rows = [];

  if (!snapshot) {
    return rows;
  }

  if (snapshot.parseError) {
    rows.push("Settings TOML could not be parsed.");
  }

  for (const conflict of conflicts) {
    if (conflict.severity === "warning") {
      rows.push(`${conflict.binding}: ${conflict.message}`);
    }
  }

  for (const action of snapshot.actions ?? []) {
    for (const issue of action.issues.filter((item) => item.severity !== "info")) {
      rows.push(`${action.label} (${action.id}): ${issue.severity}: ${issue.message}`);
    }
  }

  for (const setting of snapshot.hardSettings ?? []) {
    for (const issue of setting.issues.filter((item) => item.severity !== "info")) {
      rows.push(`${setting.label} (${setting.id}): ${issue.severity}: ${issue.message}`);
    }
  }

  return rows;
}

export function buildDraftChangeSummary(input = {}) {
  const snapshot = input.snapshot;
  const draftBindings = input.draftBindings ?? new Map();
  const draftHardSettings = input.draftHardSettings ?? new Map();
  const changes = [];

  if (!snapshot) {
    return changes;
  }

  for (const action of snapshot.actions ?? []) {
    const draftValue = formatBindings(draftBindings.get(action.id) ?? []);
    if (draftValue !== action.effectiveValue) {
      changes.push(`${action.label} (${action.id}): ${action.effectiveValue} -> ${draftValue}`);
    }
  }

  for (const setting of snapshot.hardSettings ?? []) {
    const draftValue = draftHardSettings.get(setting.id);
    if (draftValue !== setting.value) {
      changes.push(`${setting.label} (${setting.id}): ${setting.value} -> ${draftValue}`);
    }
  }

  return changes;
}

export function redactedPathLabel(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "Unknown";
  }

  const normalized = rawValue.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.at(-1) ?? rawValue;
  return `${name} (path redacted)`;
}

function formatPromptList(items, emptyText) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${emptyText}`];
}

function modeLabel(developerMode) {
  return developerMode ? "Developer Tools" : "Standard Companion";
}

function gameDirectoryFromSettingsPath(settingsPath) {
  if (!settingsPath) {
    return "";
  }

  const normalized = String(settingsPath).replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? settingsPath.slice(0, index) : "";
}

function formatBindings(bindings) {
  return bindings.length === 0 ? "NONE" : bindings.map(normalizeBinding).join("|");
}

function normalizeBinding(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}