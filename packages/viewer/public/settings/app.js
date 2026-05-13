import { normalizeModProfile } from "../shared/community-mod-status.js";

const state = {
  snapshot: null,
  notificationSnapshot: null,
  diagnosticSnapshot: null,
  draftBindings: new Map(),
  draftHardSettings: new Map(),
  draftDiagnostics: new Map(),
  draftNotificationMaster: {},
  draftNotificationEvents: new Map(),
  captureActionId: null,
  captureBinding: "",
  captureReplace: false,
  dirty: false,
  saving: false,
  bootstrap: null,
  activeSettingsTab: settingsTabFromHash() || "general",
};

const elements = {
  desktopBootstrap: document.querySelector("#desktop-bootstrap"),
  desktopBootstrapState: document.querySelector("#desktop-bootstrap-state"),
  desktopBootstrapUnavailable: document.querySelector("#desktop-bootstrap-unavailable"),
  desktopGameDirectory: document.querySelector("#desktop-game-directory"),
  desktopModProfileSelect: document.querySelector("#desktop-mod-profile-select"),
  desktopDeveloperMode: document.querySelector("#desktop-developer-mode"),
  selectGameDirectory: document.querySelector("#select-game-directory"),
  openGameDirectory: document.querySelector("#open-game-directory"),
  settingsSaveStrip: document.querySelector(".settings-save-strip"),
  settingsChangeState: document.querySelector("#settings-change-state"),
  settingsStatusMessage: document.querySelector("#settings-status-message"),
  settingsToken: document.querySelector("#settings-token"),
  settingsTokenControl: document.querySelector("#settings-token-control"),
  reloadSettings: document.querySelector("#reload-settings"),
  saveSettings: document.querySelector("#save-settings"),
  settingsTabButtons: [...document.querySelectorAll("[data-settings-tab]")],
  settingsTabPanels: [...document.querySelectorAll("[data-settings-panel]")],
  hardSettings: document.querySelector("#hard-settings"),
  notificationSettings: document.querySelector("#notification-settings"),
  notificationMaster: document.querySelector("#notification-master"),
  notificationPreviewState: document.querySelector("#notification-preview-state"),
  notificationRows: document.querySelector("#notification-rows"),
  diagnosticSettings: document.querySelector("#diagnostic-settings"),
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
elements.desktopModProfileSelect?.addEventListener("change", () => void setModProfile(elements.desktopModProfileSelect.value));
elements.desktopDeveloperMode?.addEventListener("change", () => void setDeveloperMode(elements.desktopDeveloperMode.checked));
elements.reloadSettings.addEventListener("click", () => void loadSettings());
elements.saveSettings.addEventListener("click", () => void saveSettings());
elements.settingsTabButtons.forEach((button) => button.addEventListener("click", onSettingsTabClick));
elements.settingsToken.addEventListener("input", renderSaveState);
elements.hotkeySearch.addEventListener("input", renderHotkeys);
elements.hotkeyGroup.addEventListener("change", renderHotkeys);
elements.conflictsOnly.addEventListener("change", renderHotkeys);
elements.hardSettings.addEventListener("change", onHardSettingChange);
elements.hardSettings.addEventListener("click", onHardSettingClick);
elements.diagnosticSettings?.addEventListener("change", onDiagnosticSettingChange);
elements.diagnosticSettings?.addEventListener("click", onDiagnosticSettingClick);
elements.notificationSettings.addEventListener("change", onNotificationChange);
elements.notificationSettings.addEventListener("click", (event) => void onNotificationClick(event));
elements.hotkeyGroups.addEventListener("click", onHotkeyClick);
elements.captureOk.addEventListener("click", confirmCapture);
elements.captureCancel.addEventListener("click", cancelCapture);
window.addEventListener("keydown", onCaptureKeyDown, true);
window.addEventListener("pointerdown", onCapturePointerDown, true);
window.addEventListener("contextmenu", onCaptureContextMenu, true);
window.addEventListener("hashchange", () => {
  const tab = settingsTabFromHash();
  if (tab) {
    setActiveSettingsTab(tab, { updateHash: false });
  }
});

await loadSettings();
await loadBootstrap();

async function loadSettings() {
  setStatus("Loading...");
  const [hotkeyResponse, notificationResponse] = await Promise.all([
    fetch("/api/settings/hotkeys", { cache: "no-store" }),
    fetch("/api/settings/notifications", { cache: "no-store" }),
  ]);
  const snapshot = await hotkeyResponse.json();
  const notificationSnapshot = await notificationResponse.json();
  const diagnosticSnapshot = await loadDiagnosticSettingsSnapshot();

  state.snapshot = snapshot;
  state.notificationSnapshot = notificationSnapshot;
  state.diagnosticSnapshot = diagnosticSnapshot;
  state.draftBindings = new Map(snapshot.actions.map((action) => [action.id, [...action.bindings]]));
  state.draftHardSettings = new Map(snapshot.hardSettings.map((setting) => [setting.id, setting.value]));
  state.draftDiagnostics = new Map((diagnosticSnapshot?.settings ?? []).map((setting) => [setting.id, setting.value]));
  state.draftNotificationMaster = { ...notificationSnapshot.master };
  state.draftNotificationEvents = new Map(notificationSnapshot.events.map((item) => [item.id, {
    system: item.system,
    audio: item.audio,
    sound: item.sound,
  }]));
  state.captureActionId = null;
  state.captureBinding = "";
  state.captureReplace = false;
  state.dirty = false;
  state.saving = false;

  renderAll();
  setStatus("Ready");
}

async function loadDiagnosticSettingsSnapshot() {
  const response = await fetch("/api/settings/diagnostics", { cache: "no-store" });
  if (response.status === 403 || response.status === 404) {
    return null;
  }

  const payload = await response.json();
  return response.ok ? payload : null;
}

async function saveSettings() {
  if (!state.snapshot || !state.dirty || state.saving) {
    return;
  }

  state.saving = true;
  renderSaveState();

  const token = elements.settingsToken.value.trim();
  const requiresToken = snapshotRequiresSaveToken(state.snapshot);
  const hotkeyPayload = buildHotkeyPatchPayload();
  const diagnosticPayload = buildDiagnosticPatchPayload();
  const notificationPayload = buildNotificationPatchPayload();

  try {
    if (patchHasKeys(hotkeyPayload.shortcuts) || patchHasKeys(hotkeyPayload.hardSettings)) {
      await sendSettingsUpdate("/api/settings/hotkeys", hotkeyPayload, token, requiresToken);
    }

    if (patchHasKeys(diagnosticPayload.diagnostics)) {
      await sendSettingsUpdate("/api/settings/diagnostics", diagnosticPayload, token, requiresToken);
    }

    if (notificationPatchHasChanges(notificationPayload)) {
      await sendSettingsUpdate("/api/settings/notifications", notificationPayload, token, requiresToken);
    }
  } catch (error) {
    state.saving = false;
    setStatus(error instanceof Error ? error.message : String(error));
    renderSaveState();
    return;
  }

  state.saving = false;
  await loadSettings();
  setStatus("Saved for next launch");
}

async function sendSettingsUpdate(url, payload, token, requiresToken) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "authorization": requiresToken && token ? `Bearer ${token}` : "",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? "Unable to save settings.");
  }
  return body;
}

function renderAll() {
  renderSummary();
  renderBootstrap();
  renderGroupFilter();
  renderHardSettings();
  renderDiagnostics();
  renderNotifications();
  renderHotkeys();
  renderSettingsTabs();
  renderSaveState();
}

function onSettingsTabClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement) || !button.dataset.settingsTab) {
    return;
  }

  setActiveSettingsTab(button.dataset.settingsTab);
}

function setActiveSettingsTab(tab, options = {}) {
  state.activeSettingsTab = tab;
  if (options.updateHash !== false) {
    window.history.replaceState(null, "", `#${tab}`);
  }
  renderSettingsTabs();
}

function settingsTabFromHash() {
  const hash = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  const aliases = {
    setup: "general",
    general: "general",
    "hard-settings": "hard-settings",
    hard: "hard-settings",
    keybindings: "keybindings",
    hotkeys: "keybindings",
    diagnostics: "diagnostics",
    notifications: "notifications",
    notification: "notifications",
  };
  return aliases[hash] ?? "";
}

function renderSettingsTabs() {
  const availableTabs = new Set(["general", "hard-settings", "keybindings"]);
  if ((state.diagnosticSnapshot?.settings.length ?? 0) > 0 && state.bootstrap?.developerMode !== false) {
    availableTabs.add("diagnostics");
  }
  if (state.notificationSnapshot) {
    availableTabs.add("notifications");
  }

  if (!availableTabs.has(state.activeSettingsTab)) {
    state.activeSettingsTab = "general";
  }

  for (const button of elements.settingsTabButtons) {
    const tab = button.dataset.settingsTab;
    const available = availableTabs.has(tab);
    const selected = tab === state.activeSettingsTab;
    button.hidden = !available;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }

  for (const panel of elements.settingsTabPanels) {
    const tab = panel.dataset.settingsPanel;
    panel.hidden = tab !== state.activeSettingsTab || !availableTabs.has(tab);
  }
}

function renderSummary() {
  renderSaveState();
}

async function loadBootstrap() {
  if (!window.stfcDesktop?.getBootstrap) {
    state.bootstrap = await loadServerBootstrap();
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

async function loadServerBootstrap() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const health = await response.json();
    return {
      desktop: false,
      developerMode: Boolean(health.developerMode),
      companionMode: health.companionMode,
      modeLabel: modeLabel(health.developerMode),
      modProfile: health.modProfile,
      settingsProfile: health.settingsProfile,
      communityModInstall: health.communityModInstall,
      gameDirectory: health.gameDir,
      feedPath: health.feedPath,
      settingsPath: health.settingsPath,
      healthOk: Boolean(health.ok),
    };
  } catch {
    return null;
  }
}

async function selectGameDirectory() {
  if (!window.stfcDesktop?.selectGameDirectory) {
    return;
  }

  elements.selectGameDirectory.disabled = true;
  elements.desktopBootstrapState.textContent = "Selecting...";
  try {
    state.bootstrap = await window.stfcDesktop.selectGameDirectory();
    if (state.bootstrap?.ok === false) {
      renderBootstrap();
      renderSummary();
      return;
    }

    await loadSettings();
    await loadBootstrap();
  } catch (error) {
    state.bootstrap = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    renderBootstrap();
    renderSummary();
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

async function setModProfile(profile) {
  if (!window.stfcDesktop?.setModProfile) {
    return;
  }

  elements.desktopModProfileSelect.disabled = true;
  elements.desktopBootstrapState.textContent = "Switching profile...";
  try {
    state.bootstrap = await window.stfcDesktop.setModProfile(profile);
    if (state.bootstrap?.ok === false) {
      renderBootstrap();
      renderSummary();
      return;
    }

    await loadSettings();
    await loadBootstrap();
  } catch (error) {
    state.bootstrap = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    renderBootstrap();
    renderSummary();
  } finally {
    elements.desktopModProfileSelect.disabled = false;
  }
}

async function setDeveloperMode(enabled) {
  if (!window.stfcDesktop?.setDeveloperMode) {
    return;
  }

  elements.desktopDeveloperMode.disabled = true;
  elements.desktopBootstrapState.textContent = "Switching mode...";
  try {
    state.bootstrap = await window.stfcDesktop.setDeveloperMode(Boolean(enabled));
    if (state.bootstrap?.ok === false) {
      renderBootstrap();
      renderSummary();
      return;
    }

    await loadSettings();
    await loadBootstrap();
  } catch (error) {
    state.bootstrap = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    renderBootstrap();
    renderSummary();
  } finally {
    elements.desktopDeveloperMode.disabled = false;
  }
}

function renderBootstrap() {
  if (!elements.desktopBootstrap) {
    return;
  }

  const bootstrap = state.bootstrap;
  elements.desktopBootstrap.hidden = !window.stfcDesktop;
  elements.desktopBootstrapUnavailable.hidden = Boolean(window.stfcDesktop);
  if (!window.stfcDesktop) {
    elements.desktopBootstrapState.textContent = "Browser view: native setup controls are inactive.";
    return;
  }

  const gameDirectory = bootstrap?.gameDirectory || "Select STFC directory";
  const modProfile = bootstrap?.modProfile ?? state.snapshot?.modProfile ?? state.snapshot?.profile ?? "netniv-basic";
  elements.desktopGameDirectory.textContent = gameDirectory;
  elements.desktopModProfileSelect.value = normalizeModProfile(modProfile);
  elements.desktopDeveloperMode.checked = Boolean(bootstrap?.developerMode);
  elements.openGameDirectory.disabled = !bootstrap?.gameDirectorySelected;
  elements.selectGameDirectory.textContent = bootstrap?.gameDirectorySelected ? "Change STFC Game Directory" : "Select STFC Game Directory";
  if (bootstrap?.error) {
    elements.desktopBootstrapState.textContent = `${bootstrap.securityMotto ?? "Security"}: ${bootstrap.error}`;
  } else if (bootstrap?.gameDirectorySelected) {
    elements.desktopBootstrapState.textContent = bootstrap.healthOk ? "Companion connected." : "STFC directory selected.";
  } else {
    elements.desktopBootstrapState.textContent = bootstrap?.requiredExecutable
      ? `${bootstrap.securityMotto}: select a directory containing ${bootstrap.requiredExecutable}`
      : "Select STFC directory";
  }
}

function renderGroupFilter() {
  if (!state.snapshot) {
    return;
  }

  const selected = elements.hotkeyGroup.value || "all";
  const groups = ["all", ...new Set(state.snapshot.actions.map((action) => action.group))];
  elements.hotkeyGroup.innerHTML = groups
    .map((group) => `<option value="${escapeHtml(group)}"${group === selected ? " selected" : ""}>${escapeHtml(group === "all" ? "All groups" : group)}</option>`)
    .join("");
}

function renderHardSettings() {
  elements.hardSettings.innerHTML = state.snapshot.hardSettings.map((setting) => {
    const value = state.draftHardSettings.get(setting.id);
    const marker = value === setting.value ? "" : changedBadge(`data-revert-hard-setting="${escapeHtml(setting.id)}"`, `Revert ${setting.label}`);
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

function renderDiagnostics() {
  const snapshot = state.diagnosticSnapshot;
  if (!elements.diagnosticSettings) {
    return;
  }

  if (!snapshot || snapshot.settings.length === 0) {
    elements.diagnosticSettings.innerHTML = `<div class="empty-state">Developer diagnostics are not available for this profile.</div>`;
    return;
  }

  elements.diagnosticSettings.innerHTML = snapshot.settings.map((setting) => {
    const value = state.draftDiagnostics.get(setting.id);
    const marker = value === setting.value ? "" : changedBadge(`data-revert-diagnostic-setting="${escapeHtml(setting.id)}"`, `Revert ${setting.label}`);
    const issues = setting.issues
      .map((issue) => `<span class="settings-chip settings-chip--${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}</span>`)
      .join("");
    const control = renderDiagnosticControl(setting, value);

    return `
      <article class="hard-setting-row">
        <div>
          ${control}
          <p>${escapeHtml(setting.description)}</p>
          ${issues ? `<div class="setting-issues">${issues}</div>` : ""}
        </div>
        ${marker}
      </article>
    `;
  }).join("");
}

function renderDiagnosticControl(setting, value) {
  if (setting.type === "boolean") {
    return `<label class="settings-toggle"><input type="checkbox" data-diagnostic-setting="${escapeHtml(setting.id)}"${value ? " checked" : ""} /><span>${escapeHtml(setting.label)}</span></label>`;
  }

  if (setting.type === "select") {
    return `<label class="control"><span>${escapeHtml(setting.label)}</span><select data-diagnostic-setting="${escapeHtml(setting.id)}">
      ${(setting.options ?? []).map((option) => `<option value="${escapeHtml(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select></label>`;
  }

  return `<label class="control"><span>${escapeHtml(setting.label)}</span><input type="number" min="${setting.min ?? 0}" max="${setting.max ?? 60000}" step="${setting.step ?? 1}" value="${escapeHtml(value)}" data-diagnostic-setting="${escapeHtml(setting.id)}" /></label>`;
}

function renderNotifications() {
  const snapshot = state.notificationSnapshot;
  if (!snapshot) {
    return;
  }

  if (snapshot.events.length === 0) {
    elements.notificationSettings.hidden = false;
    elements.notificationMaster.innerHTML = "";
    elements.notificationPreviewState.hidden = true;
    elements.notificationRows.innerHTML = `<div class="empty-state notification-empty">Notification settings are not available for the current profile.</div>`;
    return;
  }

  elements.notificationSettings.hidden = false;
  const master = state.draftNotificationMaster;
  elements.notificationSettings.dataset.systemEnabled = String(Boolean(master.systemEnabled));
  elements.notificationSettings.dataset.audioEnabled = String(Boolean(master.audioEnabled));
  elements.notificationPreviewState.hidden = !master.audioEnabled;
  elements.notificationMaster.innerHTML = `
    <label class="settings-toggle">
      <input type="checkbox" data-notification-master="systemEnabled"${master.systemEnabled ? " checked" : ""} />
      <span>Desktop notifications</span>
    </label>
    <label class="settings-toggle">
      <input type="checkbox" data-notification-master="audioEnabled"${master.audioEnabled ? " checked" : ""} />
      <span>Audio cues</span>
    </label>
    ${master.audioEnabled ? `<label class="control notification-master__sound">
      <span>Default sound</span>
      <select data-notification-master="defaultSound">
        ${snapshot.soundCatalog.map((sound) => `<option value="${escapeHtml(sound.id)}"${sound.id === master.defaultSound ? " selected" : ""}>${escapeHtml(sound.label)}</option>`).join("")}
      </select>
    </label>` : ""}
    ${notificationMasterChangeCount() > 0 ? changedBadge("data-revert-notification-master", "Revert notification defaults") : ""}
  `;

  if (!master.systemEnabled && !master.audioEnabled) {
    elements.notificationRows.innerHTML = `<div class="empty-state notification-empty">Notification channels are off.</div>`;
    return;
  }

  const groups = groupNotificationEvents(snapshot.events);
  elements.notificationRows.innerHTML = [...groups.entries()].map(([groupName, rows]) => `
    <section class="notification-group">
      <div class="notification-group__heading">
        <h3>${escapeHtml(groupName)}</h3>
        <span>${rows.length} event${rows.length === 1 ? "" : "s"}</span>
      </div>
      <div class="notification-list">
        ${rows.map((row) => renderNotificationRow(row, master)).join("")}
      </div>
    </section>
  `).join("");
}

function renderNotificationRow(item, master) {
  const draft = state.draftNotificationEvents.get(item.id) ?? item;
  const delivery = notificationDeliveryValue(draft, master);
  const audioActive = Boolean(master.audioEnabled && draft.audio);
  const changed = draft.system !== item.system || draft.audio !== item.audio || draft.sound !== item.sound;
  const issues = item.issues
    .map((issue) => `<span class="settings-chip settings-chip--${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}</span>`)
    .join("");
  const source = item.source === "event" ? "Configured" : item.source === "legacy" ? "Legacy" : "Default";

  return `
    <article class="notification-row" data-audio-active="${audioActive ? "true" : "false"}">
      <div class="notification-row__title">
        <h4>${escapeHtml(item.label)}</h4>
        <p>${escapeHtml(item.id)}</p>
      </div>
      <label class="control notification-row__delivery">
        <span>Delivery</span>
        <select data-notification-event="${escapeHtml(item.id)}" data-notification-field="delivery">
          ${notificationDeliveryOptions(master).map((option) => `<option value="${escapeHtml(option.id)}"${option.id === delivery ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      ${audioActive ? `<label class="control notification-row__sound">
        <span>Sound</span>
        <select data-notification-event="${escapeHtml(item.id)}" data-notification-field="sound">
          ${state.notificationSnapshot.soundCatalog.map((sound) => `<option value="${escapeHtml(sound.id)}"${sound.id === draft.sound ? " selected" : ""}>${escapeHtml(sound.label)}</option>`).join("")}
        </select>
      </label>` : ""}
      <div class="notification-row__actions">
        ${audioActive ? `<button type="button" data-notification-test="${escapeHtml(item.id)}">Play</button>` : ""}
        <span class="settings-chip settings-chip--info">${escapeHtml(source)}</span>
        ${changed ? changedBadge(`data-revert-notification-event="${escapeHtml(item.id)}"`, `Revert ${item.label}`) : ""}
        ${issues}
      </div>
    </article>
  `;
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
        <div class="hotkey-issues">${changed ? changedBadge(`data-command="reset" data-action-id="${escapeHtml(action.id)}"`, `Revert ${action.label}`) : ""}${issueMarkup}${conflictMarkup}</div>
      </div>
      <div class="hotkey-row__controls">
        ${addChangeButton}
        <button type="button" data-command="off" data-action-id="${escapeHtml(action.id)}">${escapeHtml(unboundLabel)}</button>
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

function onHardSettingClick(event) {
  const button = event.target.closest("[data-revert-hard-setting]");
  if (!button) {
    return;
  }

  const setting = state.snapshot.hardSettings.find((item) => item.id === button.dataset.revertHardSetting);
  if (!setting) {
    return;
  }

  state.draftHardSettings.set(setting.id, setting.value);
  markDirty();
  renderHardSettings();
  renderSummary();
  renderSaveState();
}

function onDiagnosticSettingChange(event) {
  const input = event.target.closest("[data-diagnostic-setting]");
  if (!input || !state.diagnosticSnapshot) {
    return;
  }

  const setting = state.diagnosticSnapshot.settings.find((item) => item.id === input.dataset.diagnosticSetting);
  if (!setting) {
    return;
  }

  const value = setting.type === "boolean" ? input.checked : setting.type === "integer" ? Number(input.value) : input.value;
  state.draftDiagnostics.set(setting.id, value);
  markDirty();
  renderDiagnostics();
  renderSummary();
  renderSaveState();
}

function onDiagnosticSettingClick(event) {
  const button = event.target.closest("[data-revert-diagnostic-setting]");
  if (!button || !state.diagnosticSnapshot) {
    return;
  }

  const setting = state.diagnosticSnapshot.settings.find((item) => item.id === button.dataset.revertDiagnosticSetting);
  if (!setting) {
    return;
  }

  state.draftDiagnostics.set(setting.id, setting.value);
  markDirty();
  renderDiagnostics();
  renderSummary();
  renderSaveState();
}

function onNotificationChange(event) {
  const masterInput = event.target.closest("[data-notification-master]");
  if (masterInput) {
    const key = masterInput.dataset.notificationMaster;
    state.draftNotificationMaster[key] = masterInput.type === "checkbox" ? masterInput.checked : masterInput.value;
    markDirty();
    renderNotifications();
    renderSummary();
    renderSaveState();
    return;
  }

  const input = event.target.closest("[data-notification-event]");
  if (!input) {
    return;
  }

  const draft = { ...(state.draftNotificationEvents.get(input.dataset.notificationEvent) ?? {}) };
  if (input.dataset.notificationField === "delivery") {
    const delivery = notificationDeliveryFlags(input.value);
    draft.system = delivery.system;
    draft.audio = delivery.audio;
  } else {
    draft[input.dataset.notificationField] = input.type === "checkbox" ? input.checked : input.value;
  }
  state.draftNotificationEvents.set(input.dataset.notificationEvent, draft);
  markDirty();
  renderNotifications();
  renderSummary();
  renderSaveState();
}

async function onNotificationClick(event) {
  const masterRevert = event.target.closest("[data-revert-notification-master]");
  if (masterRevert && state.notificationSnapshot) {
    state.draftNotificationMaster = { ...state.notificationSnapshot.master };
    markDirty();
    renderNotifications();
    renderSummary();
    renderSaveState();
    return;
  }

  const eventRevert = event.target.closest("[data-revert-notification-event]");
  if (eventRevert && state.notificationSnapshot) {
    const item = state.notificationSnapshot.events.find((entry) => entry.id === eventRevert.dataset.revertNotificationEvent);
    if (item) {
      state.draftNotificationEvents.set(item.id, {
        system: item.system,
        audio: item.audio,
        sound: item.sound,
      });
      markDirty();
      renderNotifications();
      renderSummary();
      renderSaveState();
    }
    return;
  }

  const button = event.target.closest("button[data-notification-test]");
  if (!button) {
    return;
  }

  const draft = state.draftNotificationEvents.get(button.dataset.notificationTest);
  if (!state.draftNotificationMaster.audioEnabled || !draft?.audio) {
    elements.notificationPreviewState.textContent = "Audio cue disabled";
    return;
  }

  const sound = draft?.sound ?? "default";
  try {
    await playNotificationSound(sound);
    elements.notificationPreviewState.textContent = sound === "none" ? "No sound selected" : `Played ${sound}`;
  } catch (error) {
    elements.notificationPreviewState.textContent = error instanceof Error ? error.message : String(error);
  }
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

function buildHotkeyPatchPayload() {
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

function buildDiagnosticPatchPayload() {
  const diagnostics = {};
  const snapshot = state.diagnosticSnapshot;
  if (!snapshot) {
    return { diagnostics };
  }

  for (const setting of snapshot.settings) {
    const value = state.draftDiagnostics.get(setting.id);
    if (value !== setting.value) {
      diagnostics[setting.id] = value;
    }
  }

  return { diagnostics };
}

function buildNotificationPatchPayload() {
  const snapshot = state.notificationSnapshot;
  const master = {};
  const events = {};
  if (!snapshot) {
    return { master, events };
  }

  for (const key of ["systemEnabled", "audioEnabled", "defaultSound"]) {
    if (state.draftNotificationMaster[key] !== snapshot.master[key]) {
      master[key] = state.draftNotificationMaster[key];
    }
  }

  for (const item of snapshot.events) {
    const draft = state.draftNotificationEvents.get(item.id) ?? item;
    if (draft.system !== item.system || draft.audio !== item.audio || draft.sound !== item.sound) {
      events[item.id] = { system: Boolean(draft.system), audio: Boolean(draft.audio), sound: draft.sound };
    }
  }

  return { master, events };
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

  const hotkeys = buildHotkeyPatchPayload();
  const diagnostics = buildDiagnosticPatchPayload();
  const notifications = buildNotificationPatchPayload();
  return Object.keys(hotkeys.shortcuts).length
    + Object.keys(hotkeys.hardSettings).length
    + Object.keys(diagnostics.diagnostics).length
    + Object.keys(notifications.master).length
    + Object.keys(notifications.events).length;
}

function patchHasKeys(value) {
  return Object.keys(value).length > 0;
}

function notificationPatchHasChanges(value) {
  return patchHasKeys(value.master) || patchHasKeys(value.events);
}

function notificationMasterChangeCount() {
  const snapshot = state.notificationSnapshot;
  if (!snapshot) {
    return 0;
  }

  return ["systemEnabled", "audioEnabled", "defaultSound"]
    .filter((key) => state.draftNotificationMaster[key] !== snapshot.master[key])
    .length;
}

function notificationDeliveryOptions(master) {
  const options = [{ id: "none", label: "None" }];
  if (master.systemEnabled) {
    options.push({ id: "desktop", label: "Desktop" });
  }
  if (master.audioEnabled) {
    options.push({ id: "audio", label: "Audio" });
  }
  if (master.systemEnabled && master.audioEnabled) {
    options.push({ id: "both", label: "Both" });
  }
  return options;
}

function notificationDeliveryValue(draft, master) {
  const system = Boolean(master.systemEnabled && draft.system);
  const audio = Boolean(master.audioEnabled && draft.audio);
  if (system && audio) {
    return "both";
  }
  if (system) {
    return "desktop";
  }
  if (audio) {
    return "audio";
  }
  return "none";
}

function notificationDeliveryFlags(value) {
  return {
    system: value === "desktop" || value === "both",
    audio: value === "audio" || value === "both",
  };
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
  const saveSupported = state.snapshot?.saveSupported !== false;
  const changeCount = countChanges();
  state.dirty = changeCount > 0;
  const canSave = state.snapshot && saveSupported && state.dirty && !state.saving && (!requiresToken || elements.settingsToken.value.trim().length > 0);
  if (elements.settingsTokenControl) {
    elements.settingsTokenControl.hidden = !requiresToken;
  }
  if (!requiresToken) {
    elements.settingsToken.value = "";
  }
  elements.saveSettings.disabled = !canSave;
  elements.saveSettings.textContent = state.saving ? "Saving..." : saveSupported ? "Save" : "Select folder";
  elements.reloadSettings.textContent = state.dirty ? "Discard" : "Reload";
  elements.reloadSettings.title = state.dirty ? "Discard unsaved changes and reload from disk" : "Reload settings from disk";
  if (elements.settingsSaveStrip) {
    elements.settingsSaveStrip.dataset.dirty = String(state.dirty);
  }
  if (elements.settingsChangeState) {
    elements.settingsChangeState.textContent = state.dirty
      ? `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}`
      : "No unsaved changes";
  }
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
  elements.settingsStatusMessage.textContent = text;
}

function changedBadge(buttonAttributes, label) {
  return `<span class="settings-chip settings-chip--changed"><span>Changed</span><button class="settings-chip__action" type="button" ${buttonAttributes} aria-label="${escapeHtml(label)}">Revert</button></span>`;
}

function modeLabel(developerMode) {
  return developerMode ? "Developer Tools" : "Standard Companion";
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

function groupNotificationEvents(events) {
  const grouped = new Map();
  for (const item of events) {
    const rows = grouped.get(item.group) ?? [];
    rows.push(item);
    grouped.set(item.group, rows);
  }
  return grouped;
}

let notificationAudioContext;

async function playNotificationSound(soundId) {
  const sound = state.notificationSnapshot?.soundCatalog.find((item) => item.id === soundId);
  if (!sound || sound.pattern.length === 0) {
    return;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Audio preview is not supported in this browser.");
  }

  notificationAudioContext ??= new AudioContextCtor();
  const context = notificationAudioContext;
  await context.resume();

  let when = context.currentTime + 0.01;
  for (const segment of sound.pattern) {
    const duration = Math.max(0, Number(segment.durationMs) / 1000);
    if (segment.frequency > 0 && duration > 0) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(segment.frequency, when);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.22, when + Math.min(0.01, duration / 3));
      gain.gain.setValueAtTime(0.22, Math.max(when, when + duration - 0.025));
      gain.gain.linearRampToValueAtTime(0, when + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(when);
      oscillator.stop(when + duration);
    }
    when += duration;
  }
}
