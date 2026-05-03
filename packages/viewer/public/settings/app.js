const state = {
  snapshot: null,
  draftBindings: new Map(),
  draftHardSettings: new Map(),
  captureActionId: null,
  captureBinding: "",
  captureReplace: false,
  dirty: false,
  saving: false,
  bootstrap: null,
};

const elements = {
  desktopBootstrap: document.querySelector("#desktop-bootstrap"),
  desktopBootstrapState: document.querySelector("#desktop-bootstrap-state"),
  gameDirectory: document.querySelector("#game-directory"),
  desktopGameDirectory: document.querySelector("#desktop-game-directory"),
  desktopFeedPath: document.querySelector("#desktop-feed-path"),
  selectGameDirectory: document.querySelector("#select-game-directory"),
  openGameDirectory: document.querySelector("#open-game-directory"),
  settingsToken: document.querySelector("#settings-token"),
  settingsTokenControl: document.querySelector("#settings-token-control"),
  reloadSettings: document.querySelector("#reload-settings"),
  saveSettings: document.querySelector("#save-settings"),
  settingsPath: document.querySelector("#settings-path"),
  settingsState: document.querySelector("#settings-state"),
  settingsWarningCount: document.querySelector("#settings-warning-count"),
  settingsChangeCount: document.querySelector("#settings-change-count"),
  hardSettings: document.querySelector("#hard-settings"),
  hotkeySearch: document.querySelector("#hotkey-search"),
  hotkeyGroup: document.querySelector("#hotkey-group"),
  conflictsOnly: document.querySelector("#conflicts-only"),
  conflictPanel: document.querySelector("#conflict-panel"),
  conflictList: document.querySelector("#conflict-list"),
  hotkeyGroups: document.querySelector("#hotkey-groups"),
  captureDialog: document.querySelector("#capture-dialog"),
  capturePanel: document.querySelector("#capture-panel"),
  captureTitle: document.querySelector("#capture-title"),
  capturePreview: document.querySelector("#capture-preview"),
  captureOk: document.querySelector("#capture-ok"),
  captureCancel: document.querySelector("#capture-cancel"),
};

elements.selectGameDirectory?.addEventListener("click", () => void selectGameDirectory());
elements.openGameDirectory?.addEventListener("click", () => void openGameDirectory());
elements.reloadSettings.addEventListener("click", () => void loadSettings());
elements.saveSettings.addEventListener("click", () => void saveSettings());
elements.settingsToken.addEventListener("input", renderSaveState);
elements.hotkeySearch.addEventListener("input", renderHotkeys);
elements.hotkeyGroup.addEventListener("change", renderHotkeys);
elements.conflictsOnly.addEventListener("change", renderHotkeys);
elements.hardSettings.addEventListener("change", onHardSettingChange);
elements.hotkeyGroups.addEventListener("click", onHotkeyClick);
elements.captureOk.addEventListener("click", confirmCapture);
elements.captureCancel.addEventListener("click", cancelCapture);
window.addEventListener("keydown", onCaptureKeyDown, true);
window.addEventListener("pointerdown", onCapturePointerDown, true);
window.addEventListener("contextmenu", onCaptureContextMenu, true);

await loadSettings();
await loadBootstrap();

async function loadSettings() {
  setStatus("Loading...");
  const response = await fetch("/api/settings/hotkeys", { cache: "no-store" });
  const snapshot = await response.json();

  state.snapshot = snapshot;
  state.draftBindings = new Map(snapshot.actions.map((action) => [action.id, [...action.bindings]]));
  state.draftHardSettings = new Map(snapshot.hardSettings.map((setting) => [setting.id, setting.value]));
  state.captureActionId = null;
  state.captureBinding = "";
  state.captureReplace = false;
  state.dirty = false;
  state.saving = false;

  renderAll();
}

async function saveSettings() {
  if (!state.snapshot || !state.dirty || state.saving) {
    return;
  }

  state.saving = true;
  renderSaveState();

  const token = elements.settingsToken.value.trim();
  const requiresToken = snapshotRequiresSaveToken(state.snapshot);
  const response = await fetch("/api/settings/hotkeys", {
    method: "PUT",
    headers: {
      "authorization": requiresToken && token ? `Bearer ${token}` : "",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildPatchPayload()),
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    state.saving = false;
    setStatus(payload.error ?? "Unable to save settings.");
    renderSaveState();
    return;
  }

  state.snapshot = payload;
  state.draftBindings = new Map(payload.actions.map((action) => [action.id, [...action.bindings]]));
  state.draftHardSettings = new Map(payload.hardSettings.map((setting) => [setting.id, setting.value]));
  state.dirty = false;
  state.saving = false;
  renderAll();
  setStatus("Saved for next launch");
}

function renderAll() {
  renderSummary();
  renderBootstrap();
  renderGroupFilter();
  renderHardSettings();
  renderHotkeys();
  renderSaveState();
}

function renderSummary() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  const conflicts = buildDraftConflicts();
  const warnings = conflicts.filter((conflict) => conflict.severity === "warning").length
    + snapshot.actions.reduce((count, action) => count + action.issues.filter((issue) => issue.severity !== "info").length, 0)
    + snapshot.hardSettings.reduce((count, setting) => count + setting.issues.filter((issue) => issue.severity !== "info").length, 0);

  elements.gameDirectory.textContent = state.bootstrap?.gameDirectory || gameDirectoryFromSettingsPath(snapshot.settingsPath) || "Unknown";
  elements.settingsPath.textContent = snapshot.settingsPath ?? "Unknown";
  elements.settingsState.textContent = snapshot.parseError ? "Invalid TOML" : snapshot.exists ? "Found" : "Not found";
  elements.settingsWarningCount.textContent = String(warnings);
  elements.settingsChangeCount.textContent = String(countChanges());
}

async function loadBootstrap() {
  if (!window.stfcDesktop?.getBootstrap) {
    state.bootstrap = null;
    renderBootstrap();
    renderSummary();
    return;
  }

  try {
    state.bootstrap = await window.stfcDesktop.getBootstrap();
  } catch (error) {
    state.bootstrap = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  renderBootstrap();
  renderSummary();
}

async function selectGameDirectory() {
  if (!window.stfcDesktop?.selectGameDirectory) {
    return;
  }

  elements.selectGameDirectory.disabled = true;
  elements.desktopBootstrapState.textContent = "Selecting...";
  try {
    state.bootstrap = await window.stfcDesktop.selectGameDirectory();
    await loadSettings();
    await loadBootstrap();
  } catch (error) {
    state.bootstrap = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    renderBootstrap();
  } finally {
    elements.selectGameDirectory.disabled = false;
  }
}

async function openGameDirectory() {
  if (!window.stfcDesktop?.openGameDirectory) {
    return;
  }

  const result = await window.stfcDesktop.openGameDirectory();
  if (!result?.ok) {
    elements.desktopBootstrapState.textContent = result?.error ?? "Unable to open directory.";
  }
}

function renderBootstrap() {
  if (!elements.desktopBootstrap) {
    return;
  }

  const bootstrap = state.bootstrap;
  elements.desktopBootstrap.hidden = !window.stfcDesktop;
  if (!window.stfcDesktop) {
    elements.gameDirectory.textContent = gameDirectoryFromSettingsPath(state.snapshot?.settingsPath) || "Unknown";
    return;
  }

  const gameDirectory = bootstrap?.gameDirectory || "Not selected";
  elements.desktopGameDirectory.textContent = gameDirectory;
  elements.desktopFeedPath.textContent = bootstrap?.feedPath || "Unknown";
  elements.openGameDirectory.disabled = !bootstrap?.gameDirectory;
  if (bootstrap?.error) {
    elements.desktopBootstrapState.textContent = bootstrap.error;
  } else if (bootstrap?.gameDirectorySelected) {
    elements.desktopBootstrapState.textContent = bootstrap.healthOk ? "Connected" : "Selected";
  } else {
    elements.desktopBootstrapState.textContent = "Default path";
  }
}

function renderGroupFilter() {
  const selected = elements.hotkeyGroup.value || "all";
  const groups = ["all", ...new Set(state.snapshot.actions.map((action) => action.group))];
  elements.hotkeyGroup.innerHTML = groups
    .map((group) => `<option value="${escapeHtml(group)}"${group === selected ? " selected" : ""}>${escapeHtml(group === "all" ? "All groups" : group)}</option>`)
    .join("");
}

function renderHardSettings() {
  elements.hardSettings.innerHTML = state.snapshot.hardSettings.map((setting) => {
    const value = state.draftHardSettings.get(setting.id);
    const marker = value === setting.value ? "" : `<span class="settings-chip settings-chip--changed">Changed</span>`;
    const control = setting.type === "boolean"
      ? `<label class="settings-toggle"><input type="checkbox" data-hard-setting="${escapeHtml(setting.id)}"${value ? " checked" : ""} /><span>${escapeHtml(setting.label)}</span></label>`
      : `<label class="control"><span>${escapeHtml(setting.label)}</span><input type="number" min="${setting.min ?? 0}" max="${setting.max ?? 9999}" step="${setting.step ?? 1}" value="${escapeHtml(value)}" data-hard-setting="${escapeHtml(setting.id)}" /></label>`;

    return `
      <article class="hard-setting-row">
        <div>
          ${control}
          <p>${escapeHtml(setting.description)}</p>
        </div>
        ${marker}
      </article>
    `;
  }).join("");
}

function renderHotkeys() {
  const query = elements.hotkeySearch.value.trim().toLowerCase();
  const group = elements.hotkeyGroup.value || "all";
  const conflicts = buildDraftConflicts();
  const conflictActionIds = new Set(conflicts.flatMap((conflict) => conflict.actionIds));
  const draftActions = draftActionsWithBindings().filter((action) => {
    if (group !== "all" && action.group !== group) {
      return false;
    }

    if (elements.conflictsOnly.checked && !conflictActionIds.has(action.id)) {
      return false;
    }

    const haystack = `${action.id} ${action.label} ${action.group} ${action.bindings.join(" ")}`.toLowerCase();
    return query === "" || haystack.includes(query);
  });

  renderConflicts(conflicts);

  const grouped = groupActions(draftActions);
  elements.hotkeyGroups.innerHTML = [...grouped.entries()].map(([groupName, actions]) => `
    <section class="settings-panel hotkey-group">
      <div class="panel-heading">
        <h2>${escapeHtml(groupName)}</h2>
        <p>${actions.length} action${actions.length === 1 ? "" : "s"}</p>
      </div>
      <div class="hotkey-list">
        ${actions.map(renderHotkeyAction).join("")}
      </div>
    </section>
  `).join("") || `<div class="empty-state">No hotkeys match the current filters.</div>`;

  renderSummary();
  renderSaveState();
}

function renderConflicts(conflicts) {
  elements.conflictPanel.hidden = conflicts.length === 0;
  elements.conflictList.innerHTML = conflicts.map((conflict) => `
    <article class="conflict-row conflict-row--${escapeHtml(conflict.severity)}">
      <strong>${escapeHtml(conflict.binding)}</strong>
      <span>${escapeHtml(conflict.message)}</span>
    </article>
  `).join("");
}

function renderHotkeyAction(action) {
  const bindings = action.bindings;
  const actionConflicts = buildDraftConflicts().filter((conflict) => conflict.actionIds.includes(action.id));
  // Consolidate single-char info: at most one chip per action regardless of binding count
  const nonSingleCharIssues = action.issues.filter(
    (issue) => !(issue.severity === "info" && /single.character/i.test(issue.message))
  );
  const hasSingleChar = bindings.some((b) => /^[A-Z0-9]$/.test(b));
  const allIssues = [
    ...nonSingleCharIssues,
    ...(hasSingleChar ? [{ severity: "info", message: "Single-character shortcut." }] : []),
  ];
  const issueMarkup = allIssues
    .map((issue) => `<span class="settings-chip settings-chip--${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}</span>`)
    .join("");
  const conflictMarkup = actionConflicts
    .map((conflict) => `<span class="settings-chip settings-chip--${escapeHtml(conflict.severity)}">${escapeHtml(conflict.binding)} shared</span>`)
    .join("");
  const changed = formatBindings(bindings) !== action.effectiveValue;
  const fallthrough = state.draftHardSettings.get("control.allow_key_fallthrough") ?? false;
  const unboundLabel = fallthrough ? "Fallthrough" : "Off";
  const bindingMarkup = bindings.length > 0
    ? bindings.map((binding, index) => `
      <span class="binding-chip">
        <kbd>${escapeHtml(binding)}</kbd>
        <button type="button" data-command="remove" data-action-id="${escapeHtml(action.id)}" data-binding-index="${index}" aria-label="Remove ${escapeHtml(binding)}">x</button>
      </span>
    `).join("")
    : `<span class="settings-chip settings-chip--off">${escapeHtml(unboundLabel)}</span>`;
  const addChangeButton = bindings.length >= action.maxBindings
    ? ""
    : bindings.length === 1
      ? `<button type="button" data-command="change" data-action-id="${escapeHtml(action.id)}">Change</button>`
      : `<button type="button" data-command="capture" data-action-id="${escapeHtml(action.id)}">Add</button>`;
  const resetButton = changed
    ? `<button type="button" data-command="reset" data-action-id="${escapeHtml(action.id)}">Reset</button>`
    : "";
  const atDefault = action.defaultBindings.length > 0
    && formatBindings(bindings) === formatBindings([...action.defaultBindings]);
  const defaultButton = action.defaultBindings.length > 0 && !atDefault
    ? `<button type="button" data-command="default" data-action-id="${escapeHtml(action.id)}">Default</button>`
    : "";

  return `
    <article class="hotkey-row" data-action-row="${escapeHtml(action.id)}">
      <div class="hotkey-row__main">
        <div>
          <h3>${escapeHtml(action.label)}</h3>
          <p>${escapeHtml(action.id)}</p>
        </div>
        <div class="binding-row">${bindingMarkup}</div>
        <div class="hotkey-issues">${changed ? `<span class="settings-chip settings-chip--changed">Changed</span>` : ""}${issueMarkup}${conflictMarkup}</div>
      </div>
      <div class="hotkey-row__controls">
        ${addChangeButton}
        <button type="button" data-command="off" data-action-id="${escapeHtml(action.id)}">${escapeHtml(unboundLabel)}</button>
        ${resetButton}
        ${defaultButton}
      </div>
    </article>
  `;
}

function onHardSettingChange(event) {
  const input = event.target.closest("[data-hard-setting]");
  if (!input) {
    return;
  }

  const setting = state.snapshot.hardSettings.find((item) => item.id === input.dataset.hardSetting);
  if (!setting) {
    return;
  }

  const value = setting.type === "boolean" ? input.checked : Number(input.value);
  state.draftHardSettings.set(setting.id, value);
  markDirty();
  renderHardSettings();
  renderSummary();
  renderSaveState();
}

function onHotkeyClick(event) {
  const button = event.target.closest("button[data-command]");
  if (!button) {
    return;
  }

  const action = state.snapshot.actions.find((item) => item.id === button.dataset.actionId);
  if (!action) {
    return;
  }

  const bindings = [...(state.draftBindings.get(action.id) ?? [])];
  switch (button.dataset.command) {
    case "capture":
      startCapture(action.id, false);
      return;
    case "change":
      startCapture(action.id, true);
      return;
    case "remove":
      bindings.splice(Number(button.dataset.bindingIndex), 1);
      state.draftBindings.set(action.id, bindings);
      break;
    case "off":
      state.draftBindings.set(action.id, []);
      break;
    case "reset":
      state.draftBindings.set(action.id, [...action.bindings]);
      break;
    case "default":
      state.draftBindings.set(action.id, [...action.defaultBindings]);
      break;
    default:
      return;
  }

  markDirty();
  renderHotkeys();
  renderSummary();
  renderSaveState();
}

function startCapture(actionId, replace = false) {
  const action = state.snapshot.actions.find((item) => item.id === actionId);
  if (!action) {
    return;
  }

  state.captureActionId = actionId;
  state.captureReplace = replace;
  state.captureBinding = "";
  elements.captureTitle.textContent = action.label;
  clearCaptureBinding("Waiting for input...");
  elements.captureDialog.hidden = false;
  elements.capturePanel.focus();
}

function cancelCapture() {
  state.captureActionId = null;
  state.captureBinding = "";
  elements.captureDialog.hidden = true;
}

function confirmCapture() {
  if (!state.captureActionId || !state.captureBinding) {
    return;
  }

  if (state.captureReplace) {
    state.draftBindings.set(state.captureActionId, []);
  }

  if (addBinding(state.captureActionId, state.captureBinding)) {
    cancelCapture();
  } else {
    clearCaptureBinding("Already assigned or limit reached.");
  }
}

function onCaptureKeyDown(event) {
  if (!state.captureActionId) {
    return;
  }

  if (isCaptureControlTarget(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    cancelCapture();
    return;
  }

  const binding = bindingFromKeyboardEvent(event);
  if (!binding) {
    clearCaptureBinding("Press a non-modifier key.");
    return;
  }

  setCaptureBinding(binding);
}

function onCapturePointerDown(event) {
  if (!state.captureActionId || isCaptureControlTarget(event.target)) {
    return;
  }

  if (event.pointerType && event.pointerType !== "mouse") {
    return;
  }

  const binding = bindingFromPointerEvent(event);
  if (!binding) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setCaptureBinding(binding);
}

function onCaptureContextMenu(event) {
  if (!state.captureActionId || isCaptureControlTarget(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

function setCaptureBinding(binding) {
  state.captureBinding = binding;
  elements.capturePreview.innerHTML = `<kbd>${escapeHtml(binding)}</kbd>`;
  elements.captureOk.disabled = false;
}

function clearCaptureBinding(message) {
  state.captureBinding = "";
  elements.capturePreview.textContent = message;
  elements.captureOk.disabled = true;
}

function addBinding(actionId, binding) {
  const action = state.snapshot.actions.find((item) => item.id === actionId);
  const normalized = normalizeBinding(binding);
  if (!action || !normalized) {
    return false;
  }

  const bindings = [...(state.draftBindings.get(actionId) ?? [])];
  if (bindings.includes(normalized) || bindings.length >= action.maxBindings) {
    return false;
  }

  bindings.push(normalized);
  state.draftBindings.set(actionId, bindings);
  markDirty();
  renderHotkeys();
  renderSummary();
  renderSaveState();
  return true;
}

function bindingFromKeyboardEvent(event) {
  const key = keyTokenFromEvent(event);
  if (!key || ["SHIFT", "CTRL", "ALT", "WIN"].includes(key)) {
    return "";
  }

  const modifiers = [];
  if (event.ctrlKey) modifiers.push("CTRL");
  if (event.altKey) modifiers.push("ALT");
  if (event.shiftKey) modifiers.push("SHIFT");
  if (event.metaKey) modifiers.push("WIN");
  return [...modifiers, key].join("-");
}

function bindingFromPointerEvent(event) {
  const key = mouseTokenFromButton(event.button);
  if (!key) {
    return "";
  }

  return [...modifiersFromEvent(event), key].join("-");
}

function modifiersFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("CTRL");
  if (event.altKey) modifiers.push("ALT");
  if (event.shiftKey) modifiers.push("SHIFT");
  if (event.metaKey) modifiers.push("WIN");
  return modifiers;
}

function mouseTokenFromButton(button) {
  switch (button) {
    case 0:
      return "MOUSE0";
    case 1:
      return "MOUSE2";
    case 2:
      return "MOUSE1";
    case 3:
      return "MOUSE3";
    case 4:
      return "MOUSE4";
    case 5:
      return "MOUSE5";
    case 6:
      return "MOUSE6";
    default:
      return "";
  }
}

function isCaptureControlTarget(target) {
  return target instanceof Element && Boolean(target.closest("[data-capture-control]"));
}

function keyTokenFromEvent(event) {
  const key = event.key;
  if (/^F\d{1,2}$/.test(key)) return key.toUpperCase();
  if (/^[a-zA-Z0-9]$/.test(key)) return key.toUpperCase();

  const named = {
    " ": "SPACE",
    "Alt": "ALT",
    "ArrowDown": "DOWN",
    "ArrowLeft": "LEFT",
    "ArrowRight": "RIGHT",
    "ArrowUp": "UP",
    "Backspace": "BACKSPACE",
    "CapsLock": "CAPS",
    "Control": "CTRL",
    "Delete": "DELETE",
    "End": "END",
    "Enter": "RETURN",
    "Home": "HOME",
    "Insert": "INSERT",
    "Meta": "WIN",
    "PageDown": "PGDOWN",
    "PageUp": "PGUP",
    "Pause": "PAUSE",
    "PrintScreen": "PRINT",
    "ScrollLock": "SCROLL",
    "Shift": "SHIFT",
    "Tab": "TAB",
    "-": "MINUS",
  };

  return named[key] ?? key.toUpperCase();
}

function buildPatchPayload() {
  const shortcuts = {};
  const hardSettings = {};

  for (const action of state.snapshot.actions) {
    const draftValue = formatBindings(state.draftBindings.get(action.id) ?? []);
    if (draftValue !== action.effectiveValue) {
      shortcuts[action.id] = state.draftBindings.get(action.id) ?? [];
    }
  }

  for (const setting of state.snapshot.hardSettings) {
    const value = state.draftHardSettings.get(setting.id);
    if (value !== setting.value) {
      hardSettings[setting.id] = value;
    }
  }

  return { shortcuts, hardSettings };
}

function buildDraftConflicts() {
  const bindingsByKey = new Map();
  for (const action of draftActionsWithBindings()) {
    for (const binding of action.bindings) {
      const items = bindingsByKey.get(binding) ?? [];
      items.push(action);
      bindingsByKey.set(binding, items);
    }
  }

  return [...bindingsByKey.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([binding, actions]) => {
      const groups = new Set(actions.map((action) => action.conflictGroup).filter(Boolean));
      const severity = groups.size === 1 && actions.every((action) => action.conflictGroup) ? "info" : "warning";
      const labels = actions.map((action) => action.label);
      return {
        binding,
        actionIds: actions.map((action) => action.id),
        labels,
        severity,
        message: severity === "info"
          ? `${binding} is shared by context-dependent actions: ${labels.join(", ")}.`
          : `${binding} is assigned to multiple actions: ${labels.join(", ")}.`,
      };
    });
}

function draftActionsWithBindings() {
  return state.snapshot.actions.map((action) => ({
    ...action,
    bindings: state.draftBindings.get(action.id) ?? [],
  }));
}


function countChanges() {
  if (!state.snapshot) {
    return 0;
  }

  return Object.keys(buildPatchPayload().shortcuts).length + Object.keys(buildPatchPayload().hardSettings).length;
}

function formatBindings(bindings) {
  return bindings.length === 0 ? "NONE" : bindings.map(normalizeBinding).join("|");
}

function normalizeBinding(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function markDirty() {
  state.dirty = countChanges() > 0;
}

function renderSaveState() {
  const requiresToken = snapshotRequiresSaveToken(state.snapshot);
  const canSave = state.snapshot && state.dirty && !state.saving && (!requiresToken || elements.settingsToken.value.trim().length > 0);
  if (elements.settingsTokenControl) {
    elements.settingsTokenControl.hidden = !requiresToken;
  }
  if (!requiresToken) {
    elements.settingsToken.value = "";
  }
  elements.saveSettings.disabled = !canSave;
  elements.saveSettings.textContent = state.saving ? "Saving..." : "Save for next launch";
}

function snapshotRequiresSaveToken(snapshot) {
  if (!snapshot) {
    return false;
  }

  if (snapshot.settingsSaveMode) {
    return snapshot.settingsSaveMode === "remote_protected";
  }

  return Boolean(snapshot.saveRequiresToken);
}

function setStatus(text) {
  elements.settingsState.textContent = text;
}

function gameDirectoryFromSettingsPath(settingsPath) {
  if (!settingsPath) {
    return "";
  }

  const normalized = String(settingsPath).replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? settingsPath.slice(0, index) : "";
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replaceAll('"', "\\\"");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function groupActions(actions) {
  const grouped = new Map();
  for (const action of actions) {
    const items = grouped.get(action.group) ?? [];
    items.push(action);
    grouped.set(action.group, items);
  }
  return grouped;
}