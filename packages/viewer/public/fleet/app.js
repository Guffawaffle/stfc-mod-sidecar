import { createBridgeStatus } from "../shared/bridge-status.js";
import { classifyProjectionPayload } from "./projection-view-state.js";

const STALE_PROJECTION_MS = 5 * 60 * 1000;
const FALLBACK_REFRESH_MS = 15000;
const FLEET_PAGE_ENTER_EVENT = "stfc:viewer-page-enter";
const FLEET_ALERT_INTENTS_ROUTE = "/api/fleet/alert-intents?limit=8";
const MAX_SHIP_COMBAT_PREVIEW_BATTLES = 3;

let refreshSequence = 0;
let activeRefreshPromise = null;
let fallbackRefreshTimer = null;
let warpEtaRenderTimer = null;
let fleetEventSource = null;
let lastProjectionPayload = null;
let activeActivityRefreshPromise = null;
let activeAlertIntentRefreshPromise = null;
let activeCombatPreviewRefreshPromise = null;
let lastCombatPreviewPayload = null;
let lastProjectionFetchAt = null;
let lastSseConnectedAt = null;
let lastSseEventAt = null;
let lastRenderAt = null;
let currentRenderedStateVersion = "No projection";
let showEmptySlots = false;
let expandedShipCombatSlotKeys = new Set();
let shipCombatDomTokenBySlotKey = new Map();
let shipCombatSlotKeyByDomToken = new Map();
let arrivalBellDomTokenByKey = new Map();
let arrivalBellKeyByDomToken = new Map();
const arrivalBellArms = new Map();
const arrivalBellStatusByKey = new Map();
let arrivalAudioContext = null;

const elements = {
  collapseAllShipCombatButton: document.querySelector("#collapse-all-ship-combat-button"),
  endpoint: document.querySelector("#projection-endpoint"),
  expandAllShipCombatButton: document.querySelector("#expand-all-ship-combat-button"),
  rowCount: document.querySelector("#projection-row-count"),
  updated: document.querySelector("#projection-updated"),
  version: document.querySelector("#projection-version"),
  status: document.querySelector("#projection-status"),
  note: document.querySelector("#projection-note"),
  view: document.querySelector("#projection-view"),
  refreshButton: document.querySelector("#refresh-button"),
  toggleEmptySlotsButton: document.querySelector("#toggle-empty-slots-button"),
  debug: document.querySelector("#projection-debug"),
  activityView: document.querySelector("#fleet-activity-view"),
  alertIntentsView: document.querySelector("#fleet-alert-intents-view"),
};

const bridgeStatus = createBridgeStatus(elements.status);

elements.refreshButton?.addEventListener("click", () => refreshFleetPage({ announce: true }));
elements.toggleEmptySlotsButton?.addEventListener("click", () => {
  showEmptySlots = !showEmptySlots;
  updateEmptySlotsToggle();
  if (lastProjectionPayload) {
    renderProjection(lastProjectionPayload);
  }
});
elements.expandAllShipCombatButton?.addEventListener("click", () => expandAllShipCombatSummaries());
elements.collapseAllShipCombatButton?.addEventListener("click", () => collapseAllShipCombatSummaries());
elements.view?.addEventListener("click", (event) => {
  const target = event?.target;
  if (!target || typeof target.closest !== "function") {
    return;
  }

  const arrivalBellButton = target.closest("[data-arrival-bell-token]");
  if (arrivalBellButton) {
    event.stopPropagation?.();
    toggleArrivalBell(arrivalBellKeyFromDomToken(arrivalBellButton.getAttribute("data-arrival-bell-token")));
    return;
  }

  const closeButton = target.closest("[data-ship-combat-close]");
  if (closeButton) {
    toggleShipCombatSummary(shipCombatSlotKeyFromDomToken(closeButton.getAttribute("data-slot-token")));
    return;
  }

  if (isFleetRowControlTarget(target)) {
    return;
  }

  const row = target.closest("[data-ship-combat-row]");
  if (row) {
    toggleShipCombatSummary(shipCombatSlotKeyFromDomToken(row.getAttribute("data-slot-token")));
  }
});
window.addEventListener("pageshow", () => {
  if (!fleetEventSource) {
    startLiveUpdateLoop();
  }
  return refreshFleetPage({ announce: false });
});
window.addEventListener("focus", () => refreshFleetPage({ announce: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    return refreshFleetPage({ announce: false });
  }

  return undefined;
});
window.addEventListener(FLEET_PAGE_ENTER_EVENT, (event) => {
  if (event.detail?.page === "fleet") {
    return refreshFleetPage({ announce: false });
  }

  return undefined;
});
window.addEventListener("pagehide", closeLiveUpdateLoop);
window.addEventListener("beforeunload", closeLiveUpdateLoop);

await refreshFleetPage({ announce: true });
startLiveUpdateLoop();

export function fleetProjectionPageEnterEvent() {
  return FLEET_PAGE_ENTER_EVENT;
}

export function toggleShipCombatSummary(slotKey) {
  const normalized = String(slotKey ?? "").trim();
  if (!normalized) {
    return;
  }

  const visibleSlotKeys = new Set(visibleShipCombatSummarySlotKeys());
  if (!visibleSlotKeys.has(normalized)) {
    return;
  }

  const next = new Set(expandedShipCombatSlotKeys);
  if (next.has(normalized)) {
    next.delete(normalized);
  } else {
    next.add(normalized);
  }

  expandedShipCombatSlotKeys = next;
  if (lastProjectionPayload) {
    renderProjection(lastProjectionPayload);
  }
}

export function expandAllShipCombatSummaries() {
  expandedShipCombatSlotKeys = new Set(visibleShipCombatSummarySlotKeys());
  if (lastProjectionPayload) {
    renderProjection(lastProjectionPayload);
  }
}

export function collapseAllShipCombatSummaries() {
  if (expandedShipCombatSlotKeys.size === 0) {
    return;
  }

  expandedShipCombatSlotKeys = new Set();
  if (lastProjectionPayload) {
    renderProjection(lastProjectionPayload);
  }
}

updateEmptySlotsToggle();
renderDebugStamps();

async function refreshFleetPage(options = {}) {
  await Promise.all([
    refreshProjection(options),
    refreshActivity(),
    refreshAlertIntents(),
    refreshCombatPreview(),
  ]);
}

async function refreshProjection(options = {}) {
  if (activeRefreshPromise) {
    if (options.announce) {
      bridgeStatus.begin("Refreshing");
    }
    return activeRefreshPromise;
  }

  const requestId = ++refreshSequence;
  lastProjectionFetchAt = new Date().toISOString();
  renderDebugStamps();
  bridgeStatus.begin(options.activityLabel ?? (options.announce ? "Refreshing" : "Checking"));

  const refreshPromise = (async () => {
    try {
      const response = await fetch("/api/fleet/projection", { cache: "no-store" });
      const payload = await response.json();
      if (requestId !== refreshSequence) {
        return;
      }

      renderProjection(payload);
      return;
    } catch {
      if (requestId !== refreshSequence) {
        return;
      }

      renderUnavailable({
        error: "Fleet projection is currently unavailable.",
        retryAfterSeconds: 5,
      });
    }
  })();

  activeRefreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (activeRefreshPromise === refreshPromise) {
      activeRefreshPromise = null;
    }
  }
}

async function refreshActivity() {
  if (!elements.activityView) {
    return undefined;
  }

  if (activeActivityRefreshPromise) {
    return activeActivityRefreshPromise;
  }

  const refreshPromise = (async () => {
    try {
      const response = await fetch("/api/fleet/activity?limit=6", { cache: "no-store" });
      const payload = await response.json();
      renderActivity(payload);
    } catch {
      renderActivityUnavailable();
    }
  })();

  activeActivityRefreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (activeActivityRefreshPromise === refreshPromise) {
      activeActivityRefreshPromise = null;
    }
  }
}

async function refreshAlertIntents() {
  if (!elements.alertIntentsView) {
    return undefined;
  }

  if (activeAlertIntentRefreshPromise) {
    return activeAlertIntentRefreshPromise;
  }

  const refreshPromise = (async () => {
    try {
      const response = await fetch(FLEET_ALERT_INTENTS_ROUTE, { cache: "no-store" });
      const payload = await response.json();
      renderAlertIntents(payload);
    } catch {
      renderAlertIntentsUnavailable();
    }
  })();

  activeAlertIntentRefreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (activeAlertIntentRefreshPromise === refreshPromise) {
      activeAlertIntentRefreshPromise = null;
    }
  }
}

async function refreshCombatPreview() {
  if (activeCombatPreviewRefreshPromise) {
    return activeCombatPreviewRefreshPromise;
  }

  const refreshPromise = (async () => {
    try {
      const response = await fetch("/api/fleet/ship-combat-preview", { cache: "no-store" });
      lastCombatPreviewPayload = await response.json();
    } catch {
      lastCombatPreviewPayload = {
        ok: false,
        error: "Ship combat preview is currently unavailable.",
      };
    }

    if (lastProjectionPayload) {
      renderProjection(lastProjectionPayload);
    }
  })();

  activeCombatPreviewRefreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (activeCombatPreviewRefreshPromise === refreshPromise) {
      activeCombatPreviewRefreshPromise = null;
    }
  }
}

function renderAlertIntents(payload) {
  if (!elements.alertIntentsView) {
    return;
  }

  if (payload?.ok === false) {
    renderAlertIntentsUnavailable(payload.error);
    return;
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) {
    elements.alertIntentsView.innerHTML = '<div class="empty-state">No fleet alert intents from stored evidence yet.</div>';
    return;
  }

  elements.alertIntentsView.innerHTML = items.map(renderAlertIntentRow).join("");
}

function renderAlertIntentsUnavailable(message) {
  if (!elements.alertIntentsView) {
    return;
  }

  elements.alertIntentsView.innerHTML = `<div class="empty-state">${escapeHtml(message || "Fleet alert intents are unavailable.")}</div>`;
}

function renderAlertIntentRow(item) {
  const intent = item?.intent ?? {};
  const missingEvidence = Array.isArray(intent.missingEvidence)
    ? intent.missingEvidence.filter(Boolean).map(String)
    : [];
  const chips = [
    alertIntentKindLabel(intent.kind),
    intent.eventType,
    Number.isFinite(item?.sequenceId) ? `S${item.sequenceId}` : "",
  ].filter(Boolean);
  const chipMarkup = chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  const missingMarkup = missingEvidence.length > 0
    ? `<p class="fleet-alert-intent-row__missing">Missing: ${escapeHtml(missingEvidence.join(", "))}</p>`
    : "";

  return `
    <article class="fleet-activity-row fleet-alert-intent-row">
      <div class="fleet-activity-row__top">
        <div class="chip-row">${chipMarkup}</div>
        <time>${escapeHtml(intent.timestamp ? formatDateTime(intent.timestamp) : "No timestamp")}</time>
      </div>
      <strong>${escapeHtml(alertIntentTitle(intent))}</strong>
      <p>${escapeHtml(alertIntentSummary(intent))}</p>
      ${missingMarkup}
      <div class="fleet-alert-intent-row__meta">
        ${alertIntentMeta("Intent", intent.intentId)}
        ${alertIntentMeta("Dedupe", intent.dedupeKey)}
        ${alertIntentMeta("Event", item?.eventKey)}
      </div>
    </article>
  `;
}

function renderActivity(payload) {
  if (!elements.activityView) {
    return;
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (payload?.ok === false) {
    renderActivityUnavailable(payload.error);
    return;
  }

  if (items.length === 0) {
    elements.activityView.innerHTML = '<div class="empty-state">No recent activity preview is available yet.</div>';
    return;
  }

  elements.activityView.innerHTML = items.map(renderActivityRow).join("");
}

function renderActivityUnavailable(message) {
  if (!elements.activityView) {
    return;
  }

  elements.activityView.innerHTML = `<div class="empty-state">${escapeHtml(message || "Recent activity preview is unavailable.")}</div>`;
}

function renderActivityRow(item) {
  const chips = Array.isArray(item.chips) ? item.chips.slice(0, 4) : [];
  const chipMarkup = chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  const lineBadge = Number.isFinite(item.lineNumber) ? `<span class="line-badge">L${item.lineNumber}</span>` : "";

  return `
    <article class="fleet-activity-row">
      <div class="fleet-activity-row__top">
        <div class="chip-row">${chipMarkup}</div>
        ${lineBadge}
      </div>
      <strong>${escapeHtml(item.title || "Activity")}</strong>
      <p>${escapeHtml(item.subtitle || item.eventType || "Local sidecar activity")}</p>
      <time>${escapeHtml(item.timestamp ? formatDateTime(item.timestamp) : "No timestamp")}</time>
    </article>
  `;
}

function alertIntentKindLabel(kind) {
  if (kind === "fleet_arrival") {
    return "Fleet arrival";
  }

  if (kind === "fleet_incoming_attack") {
    return "Incoming attack";
  }

  return "Fleet alert";
}

function alertIntentTitle(intent) {
  if (intent?.kind === "fleet_arrival") {
    return "Fleet arrival intent";
  }

  if (intent?.kind === "fleet_incoming_attack") {
    return "Incoming attack intent";
  }

  return "Fleet alert intent";
}

function alertIntentSummary(intent) {
  const details = [
    alertIntentFleetLabel(intent),
    alertIntentShipLabel(intent),
    alertIntentTargetLabel(intent),
    alertIntentAttackerLabel(intent),
    alertIntentLocationLabel(intent),
  ].filter(Boolean);

  return details.length > 0 ? details.join(" | ") : "No fleet details available in evidence.";
}

function alertIntentFleetLabel(intent) {
  const fleetId = exactText(intent?.fleet?.fleetId);
  const slotIndex = Number.isFinite(intent?.fleet?.slotIndex) ? intent.fleet.slotIndex : NaN;
  const state = exactText(intent?.fleet?.state?.currentName)
    || (Number.isFinite(intent?.fleet?.state?.current) ? `state ${intent.fleet.state.current}` : "");
  const parts = [
    fleetId ? `fleet ${fleetId}` : "",
    Number.isInteger(slotIndex) ? `slot ${slotIndex}` : "",
    state,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function alertIntentShipLabel(intent) {
  const displayName = exactText(intent?.ship?.displayName) || exactText(intent?.fleet?.shipDisplayName);
  const shipId = exactText(intent?.ship?.shipId);
  const hullName = exactText(intent?.ship?.hullName);
  const parts = [
    displayName ? `ship ${displayName}` : "",
    hullName,
    shipId ? `ship ID ${shipId}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function alertIntentTargetLabel(intent) {
  const targetFleetId = exactText(intent?.target?.fleetId);
  const targetType = exactText(intent?.target?.targetTypeName)
    || (Number.isFinite(intent?.target?.targetType) ? `type ${intent.target.targetType}` : "");
  const parts = [
    targetFleetId ? `target fleet ${targetFleetId}` : "",
    targetType,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function alertIntentAttackerLabel(intent) {
  const attackerKind = exactText(intent?.attacker?.kind);
  const attackerIdentity = exactText(intent?.attacker?.identity);
  const attackerType = Number.isFinite(intent?.attacker?.fleetType) ? `fleet type ${intent.attacker.fleetType}` : "";
  const parts = [
    attackerKind ? `attacker ${attackerKind}` : "",
    attackerIdentity ? `identity ${attackerIdentity}` : "",
    attackerType,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "";
}

function alertIntentLocationLabel(intent) {
  const systemId = exactText(intent?.location?.systemId);
  if (systemId) {
    return `system ${systemId}`;
  }

  return Array.isArray(intent?.missingEvidence) && intent.missingEvidence.includes("systemId")
    ? "system evidence missing"
    : "";
}

function alertIntentMeta(label, value) {
  const text = exactText(value);
  return text
    ? `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(text)}</span>`
    : "";
}

function startLiveUpdateLoop() {
  closeLiveUpdateLoop({ clearWarpEta: false });

  if (!window.EventSource) {
    ensureFallbackRefresh();
    return;
  }

  fleetEventSource = new EventSource("/api/fleet/stream");
  fleetEventSource.addEventListener("open", markLiveUpdatesConnected);
  fleetEventSource.addEventListener("ready", markLiveUpdatesConnected);
  fleetEventSource.addEventListener("fleet-projection-changed", () => {
    lastSseEventAt = new Date().toISOString();
    renderDebugStamps();
    void Promise.all([
      refreshProjection({ announce: false, activityLabel: "Updating" }),
      refreshAlertIntents(),
      refreshCombatPreview(),
    ]);
  });
  fleetEventSource.addEventListener("error", () => {
    bridgeStatus.disconnected();
    ensureFallbackRefresh();
  });
}

function markLiveUpdatesConnected() {
  lastSseConnectedAt = new Date().toISOString();
  renderDebugStamps();
  clearFallbackRefresh();
}

function ensureFallbackRefresh() {
  if (fallbackRefreshTimer) {
    return;
  }

  fallbackRefreshTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") {
      return;
    }

    void refreshProjection({ announce: false, activityLabel: "Checking" });
  }, FALLBACK_REFRESH_MS);
}

function closeLiveUpdateLoop(options = {}) {
  const clearWarpEta = options.clearWarpEta !== false;
  clearFallbackRefresh();
  if (clearWarpEta) {
    clearWarpEtaRenderLoop();
  }
  if (fleetEventSource) {
    fleetEventSource.close();
    fleetEventSource = null;
  }
}

function clearFallbackRefresh() {
  if (!fallbackRefreshTimer) {
    return;
  }

  window.clearInterval(fallbackRefreshTimer);
  fallbackRefreshTimer = null;
}

function ensureWarpEtaRenderLoop() {
  if (warpEtaRenderTimer) {
    return;
  }

  warpEtaRenderTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible" || !lastProjectionPayload) {
      return;
    }

    renderProjection(lastProjectionPayload);
  }, 1000);
}

function clearWarpEtaRenderLoop() {
  if (!warpEtaRenderTimer) {
    return;
  }

  window.clearInterval(warpEtaRenderTimer);
  warpEtaRenderTimer = null;
}

function renderProjection(payload) {
  lastProjectionPayload = payload ?? null;
  updateEmptySlotsToggle();
  const state = classifyProjectionPayload(payload);
  if (state === "unavailable") {
    renderUnavailable(payload ?? {});
    return;
  }

  if (state === "empty") {
    renderEmpty(payload);
    return;
  }

  if (isProjectionStale(payload)) {
    renderRows(payload, { stale: true });
    return;
  }

  renderRows(payload, { stale: false });
}

function renderUnavailable(payload) {
  clearWarpEtaRenderLoop();
  elements.endpoint.textContent = "/api/fleet/projection";
  elements.rowCount.textContent = "0";
  elements.updated.textContent = "Unavailable";
  elements.version.textContent = "Unavailable";
  elements.note.textContent = `Projection unavailable. ${String(payload.error ?? "The local broker did not return a current projection.")}`;
  elements.view.innerHTML = `<div class="empty-state">${escapeHtml(unavailableMessage(payload))}</div>`;
  markProjectionRendered("No projection");
  bridgeStatus.disconnected("Unavailable");
}

function renderEmpty(payload) {
  clearWarpEtaRenderLoop();
  const projection = payload.projection ?? null;
  elements.endpoint.textContent = "/api/fleet/projection";
  elements.rowCount.textContent = "0";
  elements.updated.textContent = projection?.updatedAt ? formatDateTime(projection.updatedAt) : "No updates yet";
  elements.version.textContent = Number.isFinite(projection?.stateVersion) ? `v${projection.stateVersion}` : "No projection";
  elements.note.textContent = "Projection available but empty. No observed fleet rows have been stored yet.";
  elements.view.innerHTML = '<div class="empty-state">No observed fleet rows are available yet.</div>';
  markProjectionRendered(Number.isFinite(projection?.stateVersion) ? `v${projection.stateVersion}` : "No projection");
  bridgeStatus.off("Empty");
}

function renderRows(payload, options = {}) {
  const projection = payload.projection;
  const combatPreviewBySlotKey = recentCombatPreviewBySlotKey(lastCombatPreviewPayload);
  const rows = Array.isArray(projection?.slots)
    ? projection.slots.map((slot) => viewModelForSlot(slot, combatPreviewBySlotKey.get(String(slot?.slotKey ?? "")))).sort(compareRows)
    : [];
  const visibleRows = showEmptySlots ? rows : rows.filter((row) => !row.isEmpty);
  const combatSummarySlotKeys = visibleRows.filter((row) => row.canShowCombatSummary).map((row) => row.slotKey);
  const hiddenEmptyCount = rows.length - visibleRows.length;
  const updatedAt = projection?.updatedAt ?? projection?.observedAt ?? "";
  const stale = Boolean(options.stale);

  rebuildShipCombatDomTokenMaps(visibleRows);
  pruneExpandedShipCombatSlotKeys(combatSummarySlotKeys);
  reconcileArrivalBellArms(visibleRows);
  rebuildArrivalBellDomTokenMaps(visibleRows);
  updateShipCombatSummaryControls(combatSummarySlotKeys);

  elements.endpoint.textContent = "/api/fleet/projection";
  elements.rowCount.textContent = `${visibleRows.length}`;
  elements.updated.textContent = updatedAt ? formatDateTime(updatedAt) : "Unknown";
  elements.version.textContent = Number.isFinite(projection?.stateVersion) ? `v${projection.stateVersion}` : "Unknown";
  elements.note.textContent = projectionNote({
    hiddenEmptyCount,
    stale,
    totalRowCount: rows.length,
    updatedAt,
    visibleRowCount: visibleRows.length,
  });
  elements.view.innerHTML = visibleRows.length === 0
    ? filteredEmptyState(hiddenEmptyCount)
    : `
    <div class="detail-table-scroll">
      <table class="detail-table data-table fleet-table">
        <thead>
          <tr>
            <th>Slot</th>
            <th>State</th>
            <th>Assignment</th>
            <th>Observed</th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map(renderFleetRow).join("")}
        </tbody>
      </table>
    </div>
  `;
  markProjectionRendered(Number.isFinite(projection?.stateVersion) ? `v${projection.stateVersion}` : "Unknown");
  if (visibleRows.some((row) => row.hasWarpEtaTimer)) {
    ensureWarpEtaRenderLoop();
  } else {
    clearWarpEtaRenderLoop();
  }

  if (stale) {
    bridgeStatus.off("Possibly stale");
    return;
  }

  bridgeStatus.open("Current");
}

function markProjectionRendered(versionLabel) {
  lastRenderAt = new Date().toISOString();
  currentRenderedStateVersion = versionLabel || "No projection";
  renderDebugStamps();
}

function isFleetRowControlTarget(target) {
  return Boolean(target.closest("button, a, input, select, textarea, [role='button'], [data-fleet-row-control]"));
}

function toggleArrivalBell(key) {
  const normalized = String(key ?? "").trim();
  if (!normalized) {
    return;
  }

  if (arrivalBellArms.has(normalized)) {
    arrivalBellArms.delete(normalized);
    arrivalBellStatusByKey.delete(normalized);
    if (lastProjectionPayload) {
      renderProjection(lastProjectionPayload);
    }
    return;
  }

  if (!ensureArrivalAudioContext()) {
    arrivalBellStatusByKey.set(normalized, "Audio unavailable");
    if (lastProjectionPayload) {
      renderProjection(lastProjectionPayload);
    }
    return;
  }

  arrivalBellArms.set(normalized, { armedAt: new Date().toISOString() });
  arrivalBellStatusByKey.delete(normalized);
  void prepareArrivalAudio().catch(() => {
    arrivalBellArms.delete(normalized);
    arrivalBellStatusByKey.set(normalized, "Audio unavailable");
    if (lastProjectionPayload) {
      renderProjection(lastProjectionPayload);
    }
  });

  if (lastProjectionPayload) {
    renderProjection(lastProjectionPayload);
  }
}

function renderFleetRow(row) {
  const toggleLabel = row.expanded
    ? "Hide summary"
    : (row.recentBattleCount > 0
      ? `Show ${battleCountLabel(row.recentBattleCount)}`
      : "Show summary");
  const rowClasses = ["fleet-table__row"];
  if (row.canShowCombatSummary) {
    rowClasses.push("fleet-table__row--interactive");
  }
  if (row.expanded) {
    rowClasses.push("fleet-table__row--expanded");
  }

  return `
    <tr class="${rowClasses.join(" ")}"${row.canShowCombatSummary ? ` data-ship-combat-row="true" data-slot-token="${escapeHtml(domTokenForShipCombatSlot(row.slotKey))}"` : ""}>
      <td>
        <div class="fleet-table__cell">
          <strong>${escapeHtml(row.slotLabel)}</strong>
          ${row.canShowCombatSummary ? `<span class="fleet-table__toggle">${escapeHtml(toggleLabel)}</span>` : ""}
        </div>
      </td>
      <td>
        <div class="fleet-table__cell">
          <strong>${escapeHtml(row.stateLabel)}</strong>
          ${row.warpEtaLabel ? `<span class="fleet-table__secondary">${escapeHtml(row.warpEtaLabel)}</span>` : ""}
          ${renderArrivalBellControl(row)}
        </div>
      </td>
      <td>
        <div class="fleet-table__cell">
          <span>${escapeHtml(row.assignmentLabel)}</span>
          ${row.canShowCombatSummary ? `<span class="fleet-table__secondary">${escapeHtml(row.shipCombatStatusLabel)}</span>` : ""}
        </div>
      </td>
      <td>
        <div class="fleet-table__cell">
          <div class="chip-row">${row.observedSignals.map((signal) => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
        </div>
      </td>
    </tr>
    ${row.expanded ? renderShipCombatSummaryRow(row) : ""}
  `;
}

function renderArrivalBellControl(row) {
  if (!row.arrivalBellKey) {
    return "";
  }

  const buttonLabel = row.arrivalBellArmed ? "Armed" : "Notify";
  const actionLabel = row.arrivalBellArmed ? "Disarm arrival chime" : "Notify on arrival";
  const statusMarkup = row.arrivalBellStatus
    ? `<span class="fleet-arrival-bell__status">${escapeHtml(row.arrivalBellStatus)}</span>`
    : "";

  return `
    <div class="fleet-arrival-bell-row">
      <button
        type="button"
        class="fleet-arrival-bell${row.arrivalBellArmed ? " fleet-arrival-bell--armed" : ""}"
        data-fleet-row-control="true"
        data-arrival-bell-token="${escapeHtml(domTokenForArrivalBellKey(row.arrivalBellKey))}"
        aria-label="${escapeHtml(`${actionLabel} for ${row.slotLabel}`)}"
        aria-pressed="${row.arrivalBellArmed ? "true" : "false"}"
      >${escapeHtml(buttonLabel)}</button>
      ${statusMarkup}
    </div>
  `;
}

function renderShipCombatSummaryRow(row) {
  const battles = Array.isArray(row.recentBattles)
    ? row.recentBattles.slice(0, MAX_SHIP_COMBAT_PREVIEW_BATTLES)
    : [];
  const summaryBody = battles.length > 0
    ? `<div class="fleet-combat-preview__list">${battles.map(renderShipCombatBattle).join("")}</div>`
    : `<p class="fleet-combat-preview__empty">${escapeHtml(shipCombatEmptyMessage(row))}</p>`;

  return `
    <tr class="fleet-combat-preview__row">
      <td colspan="4">
        <section class="fleet-combat-preview">
          <div class="fleet-combat-preview__header">
            <div class="fleet-combat-preview__copy">
              <strong>Recent combat</strong>
              <span class="fleet-table__secondary">${escapeHtml(row.shipCombatDetailLabel)}</span>
            </div>
             <button type="button" class="button-secondary fleet-combat-preview__close" data-ship-combat-close="true" data-slot-token="${escapeHtml(domTokenForShipCombatSlot(row.slotKey))}">Close</button>
          </div>
          ${summaryBody}
        </section>
      </td>
    </tr>
  `;
}

function renderShipCombatBattle(battle) {
  const chips = [
    formatCombatOutcome(battle.outcome),
    battle.rounds ? `${battle.rounds} ${battle.rounds === 1 ? "round" : "rounds"}` : "",
    battle.opponentType ? titleCase(String(battle.opponentType).replace(/[_-]+/gu, " ")) : "",
  ].filter(Boolean);
  const subtitle = [formatDateTime(battle.observedAt), formatAge(battle.observedAt), titleCase(String(battle.source ?? "battle.report").replace(/[._-]+/gu, " "))]
    .filter(Boolean)
    .join(" • ");

  return `
    <article class="fleet-combat-preview__item">
      <div class="chip-row fleet-combat-preview__chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
      <strong>${escapeHtml(formatCombatOpponent(battle))}</strong>
      <p>${escapeHtml(subtitle)}</p>
    </article>
  `;
}

function renderDebugStamps() {
  if (!elements.debug) {
    return;
  }

  elements.debug.textContent = [
    `Fetch: ${formatDiagnosticTime(lastProjectionFetchAt)}`,
    `SSE: ${formatDiagnosticTime(lastSseConnectedAt)}`,
    `Event: ${formatDiagnosticTime(lastSseEventAt)}`,
    `Render: ${formatDiagnosticTime(lastRenderAt)}`,
    `Version: ${currentRenderedStateVersion || "No projection"}`,
  ].join(" | ");
}

function viewModelForSlot(slot, recentCombatMatch) {
  const assignmentKind = String(slot.assignmentKind ?? "").trim().toLowerCase();
  const shipId = exactShipId(slot.shipIdentityId);
  const recentBattles = Array.isArray(recentCombatMatch?.recentBattles)
    ? recentCombatMatch.recentBattles.slice(0, MAX_SHIP_COMBAT_PREVIEW_BATTLES)
    : [];
  const canShowCombatSummary = assignmentKind === "player_ship" && !isEmptyState(slot.state);

  const row = {
    slotKey: String(slot.slotKey ?? ""),
    fleetKey: String(slot.fleetKey ?? ""),
    fleetLabel: safeOpaqueLabel("Fleet", slot.fleetKey),
    slotLabel: slotLabelForSlot(slot),
    slotOrder: slotOrderForSlot(slot),
    stateLabel: formatState(slot.state),
    stateValue: normalizedState(slot.state),
    assignmentLabel: formatAssignment(slot.assignmentKind),
    observedSignals: observedSignals(slot),
    shipId,
    canShowCombatSummary,
    recentBattles,
    recentBattleCount: recentBattles.length,
    expanded: canShowCombatSummary && expandedShipCombatSlotKeys.has(String(slot.slotKey ?? "")),
    shipCombatStatusLabel: shipCombatStatusLabel({ canShowCombatSummary, recentBattles, shipId }),
    shipCombatDetailLabel: shipCombatDetailLabel({ recentBattles, shipId }),
    isEmpty: isEmptyState(slot.state),
    updatedAt: String(slot.updatedAt ?? ""),
    activeTimerRemainingMs: activeTimerRemainingMs(slot),
  };

  row.hasWarpEtaTimer = row.stateValue === "warping" && row.activeTimerRemainingMs !== null;
  row.warpEtaLabel = row.hasWarpEtaTimer ? formatWarpEtaLabel(row) : "";
  row.arrivalBellKey = arrivalBellKeyForRow(row);
  applyArrivalBellState(row);
  return row;
}

function compareRows(left, right) {
  return left.slotOrder - right.slotOrder
    || left.slotKey.localeCompare(right.slotKey)
    || left.assignmentLabel.localeCompare(right.assignmentLabel);
}

function slotLabelForSlot(slot) {
  const slotOrder = slotOrderForSlot(slot);
  if (Number.isFinite(slotOrder) && slotOrder !== Number.MAX_SAFE_INTEGER) {
    return `Slot ${slotOrder + 1}`;
  }

  return safeOpaqueLabel("Slot", slot.slotKey);
}

function slotOrderForSlot(slot) {
  const explicitSlotIndex = Number(slot?.slotIndex);
  if (Number.isInteger(explicitSlotIndex) && explicitSlotIndex >= 0) {
    return explicitSlotIndex;
  }

  const slotKeyMatch = /^slot[-:](\d+)$/u.exec(String(slot?.slotKey ?? ""));
  if (slotKeyMatch) {
    return Number(slotKeyMatch[1]);
  }

  return Number.MAX_SAFE_INTEGER;
}

function isEmptyState(value) {
  return normalizedState(value) === "empty";
}

function normalizedState(value) {
  return String(value ?? "").trim().toLowerCase();
}

function visibleShipCombatSummarySlotKeys() {
  const projection = lastProjectionPayload?.projection;
  const combatPreviewBySlotKey = recentCombatPreviewBySlotKey(lastCombatPreviewPayload);
  const rows = Array.isArray(projection?.slots)
    ? projection.slots.map((slot) => viewModelForSlot(slot, combatPreviewBySlotKey.get(String(slot?.slotKey ?? "")))).sort(compareRows)
    : [];
  const visibleRows = showEmptySlots ? rows : rows.filter((row) => !row.isEmpty);
  return visibleRows.filter((row) => row.canShowCombatSummary).map((row) => row.slotKey);
}

function rebuildShipCombatDomTokenMaps(visibleRows) {
  shipCombatDomTokenBySlotKey = new Map();
  shipCombatSlotKeyByDomToken = new Map();

  let index = 0;
  for (const row of visibleRows) {
    if (!row.canShowCombatSummary) {
      continue;
    }

    index += 1;
    const token = `ship-row-${index}`;
    shipCombatDomTokenBySlotKey.set(row.slotKey, token);
    shipCombatSlotKeyByDomToken.set(token, row.slotKey);
  }
}

function domTokenForShipCombatSlot(slotKey) {
  return shipCombatDomTokenBySlotKey.get(slotKey) ?? "";
}

function shipCombatSlotKeyFromDomToken(token) {
  return shipCombatSlotKeyByDomToken.get(String(token ?? "").trim()) ?? "";
}

function rebuildArrivalBellDomTokenMaps(visibleRows) {
  arrivalBellDomTokenByKey = new Map();
  arrivalBellKeyByDomToken = new Map();

  let index = 0;
  for (const row of visibleRows) {
    if (!row.arrivalBellKey) {
      continue;
    }

    index += 1;
    const token = `arrival-bell-${index}`;
    arrivalBellDomTokenByKey.set(row.arrivalBellKey, token);
    arrivalBellKeyByDomToken.set(token, row.arrivalBellKey);
  }
}

function domTokenForArrivalBellKey(key) {
  return arrivalBellDomTokenByKey.get(key) ?? "";
}

function arrivalBellKeyFromDomToken(token) {
  return arrivalBellKeyByDomToken.get(String(token ?? "").trim()) ?? "";
}

function pruneExpandedShipCombatSlotKeys(visibleSlotKeys) {
  const visible = new Set(visibleSlotKeys);
  expandedShipCombatSlotKeys = new Set(
    [...expandedShipCombatSlotKeys].filter((slotKey) => visible.has(slotKey)),
  );
}

function updateShipCombatSummaryControls(visibleSlotKeys) {
  const total = visibleSlotKeys.length;
  const expandedCount = [...expandedShipCombatSlotKeys].filter((slotKey) => visibleSlotKeys.includes(slotKey)).length;

  if (elements.expandAllShipCombatButton) {
    elements.expandAllShipCombatButton.disabled = total === 0 || expandedCount === total;
  }

  if (elements.collapseAllShipCombatButton) {
    elements.collapseAllShipCombatButton.disabled = expandedCount === 0;
  }
}

function reconcileArrivalBellArms(visibleRows) {
  const rowsByBellKey = new Map();
  for (const row of visibleRows) {
    if (row.arrivalBellKey) {
      rowsByBellKey.set(row.arrivalBellKey, row);
    }
  }

  for (const key of [...arrivalBellArms.keys()]) {
    if (!rowsByBellKey.has(key)) {
      arrivalBellArms.delete(key);
    }
  }

  for (const key of [...arrivalBellStatusByKey.keys()]) {
    if (!rowsByBellKey.has(key)) {
      arrivalBellStatusByKey.delete(key);
    }
  }

  for (const row of rowsByBellKey.values()) {
    if (!arrivalBellArms.has(row.arrivalBellKey)) {
      continue;
    }

    const remainingMs = adjustedRemainingMs(row);
    if (remainingMs !== null && remainingMs <= 0) {
      arrivalBellArms.delete(row.arrivalBellKey);
      if (playArrivalChime()) {
        arrivalBellStatusByKey.delete(row.arrivalBellKey);
      } else {
        arrivalBellStatusByKey.set(row.arrivalBellKey, "Audio unavailable");
      }
    }
  }

  for (const row of visibleRows) {
    applyArrivalBellState(row);
  }
}

function arrivalBellKeyForRow(row) {
  if (!row.hasWarpEtaTimer) {
    return "";
  }

  const slotKey = exactText(row.slotKey);
  const shipOrFleetKey = exactText(row.shipId) || exactText(row.fleetKey);
  if (!slotKey || !shipOrFleetKey) {
    return "";
  }

  return `${slotKey}|${shipOrFleetKey}`;
}

function applyArrivalBellState(row) {
  row.arrivalBellArmed = row.arrivalBellKey ? arrivalBellArms.has(row.arrivalBellKey) : false;
  row.arrivalBellStatus = row.arrivalBellKey ? (arrivalBellStatusByKey.get(row.arrivalBellKey) ?? "") : "";
}

function ensureArrivalAudioContext() {
  if (arrivalAudioContext) {
    return arrivalAudioContext;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  try {
    arrivalAudioContext = new AudioContextCtor();
    return arrivalAudioContext;
  } catch {
    arrivalAudioContext = null;
    return null;
  }
}

async function prepareArrivalAudio() {
  const context = ensureArrivalAudioContext();
  if (!context || typeof context.resume !== "function") {
    return;
  }

  await context.resume();
}

function playArrivalChime() {
  const context = ensureArrivalAudioContext();
  if (!context || typeof context.createOscillator !== "function" || typeof context.createGain !== "function") {
    return false;
  }

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = Number.isFinite(context.currentTime) ? context.currentTime : 0;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.45);
    return true;
  } catch {
    return false;
  }
}

function recentCombatPreviewBySlotKey(payload) {
  const matches = Array.isArray(payload?.preview?.matches) ? payload.preview.matches : [];
  const bySlotKey = new Map();

  for (const match of matches) {
    const slotKey = String(match?.slotKey ?? "").trim();
    if (!slotKey) {
      continue;
    }

    bySlotKey.set(slotKey, {
      recentBattles: Array.isArray(match.recentBattles)
        ? match.recentBattles.slice(0, MAX_SHIP_COMBAT_PREVIEW_BATTLES)
        : [],
    });
  }

  return bySlotKey;
}

function shipCombatStatusLabel({ canShowCombatSummary, recentBattles, shipId }) {
  if (!canShowCombatSummary) {
    return "";
  }

  if (recentBattles.length > 0) {
    return `${battleCountLabel(recentBattles.length)} available`;
  }

  if (shipId) {
    return "No recent exact-ID match";
  }

  return "Exact ship ID unavailable";
}

function shipCombatDetailLabel({ recentBattles, shipId }) {
  if (recentBattles.length > 0) {
    return `Matched by exact ship ID. Showing ${battleCountLabel(recentBattles.length)}.`;
  }

  if (shipId) {
    return "No recent battle report in the local exact-ID window has matched this ship yet.";
  }

  return "This row does not currently expose an exact ship ID, so no combat join is shown.";
}

function shipCombatEmptyMessage(row) {
  if (!row.shipId) {
    return "Exact ship ID is not available for this row yet.";
  }

  return "No recent combat summary is available for this ship in the current local battle window.";
}

function battleCountLabel(count) {
  return `${count} recent ${count === 1 ? "battle" : "battles"}`;
}

function formatCombatOutcome(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? titleCase(normalized.replace(/[._-]+/gu, " ")) : "Outcome unavailable";
}

function formatCombatOpponent(battle) {
  const opponentName = String(battle?.opponentName ?? "").trim();
  if (opponentName) {
    return opponentName;
  }

  const opponentType = String(battle?.opponentType ?? "").trim();
  if (opponentType) {
    return titleCase(opponentType.replace(/[._-]+/gu, " "));
  }

  return "Opponent unavailable";
}

function exactShipId(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/u.test(normalized) ? normalized : "";
}

function exactText(value) {
  const normalized = String(value ?? "").trim();
  return normalized;
}

function updateEmptySlotsToggle() {
  if (!elements.toggleEmptySlotsButton) {
    return;
  }

  elements.toggleEmptySlotsButton.textContent = showEmptySlots ? "Hide empty slots" : "Show empty slots";
}

function projectionNote({ hiddenEmptyCount, stale, totalRowCount, updatedAt, visibleRowCount }) {
  const freshness = stale
    ? `Stale: last stored rows from ${formatDateTime(updatedAt)}.`
    : `Current: ${visibleRowCount} observed fleet ${visibleRowCount === 1 ? "row" : "rows"}.`;
  const hiddenNote = hiddenEmptyCount > 0 && !showEmptySlots
    ? ` ${hiddenEmptyCount} ${hiddenEmptyCount === 1 ? "empty slot is" : "empty slots are"} hidden.`
    : "";
  const emptyNote = visibleRowCount === 0 && totalRowCount > 0 && !showEmptySlots
    ? " All slots are currently empty."
    : "";
  return `${freshness}${emptyNote}${hiddenNote} Cargo not projected.`;
}

function filteredEmptyState(hiddenEmptyCount) {
  if (hiddenEmptyCount > 0 && !showEmptySlots) {
    return '<div class="empty-state">All slots are currently empty. Use Show empty slots to inspect them.</div>';
  }

  return '<div class="empty-state">No observed fleet rows are available yet.</div>';
}

function safeOpaqueLabel(prefix, value) {
  const token = String(value ?? "")
    .replace(/^[A-Za-z]+[-:]/u, "")
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(0, 6);
  return `${prefix} ${token || "unknown"}`;
}

function formatState(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "observed") {
    return "Observed";
  }
  if (normalized === "assigned") {
    return "Assigned";
  }
  if (normalized === "empty") {
    return "Empty";
  }
  return normalized ? titleCase(normalized) : "Unknown";
}

function formatAssignment(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "player_ship") {
    return "Player ship";
  }
  if (normalized === "slot") {
    return "Slot";
  }

  const slotTypeMatch = /^slot-type:(.+)$/u.exec(normalized);
  if (slotTypeMatch) {
    return `Slot type ${slotTypeMatch[1]}`;
  }

  return normalized ? titleCase(normalized.replace(/[_-]+/gu, " ")) : "Unknown";
}

function observedSignals(slot) {
  const signals = [];
  const hull = /^hull:(.+)$/u.exec(String(slot.shipType ?? ""));
  if (hull) {
    signals.push(`Hull ${hull[1]}`);
  } else if (slot.shipKeyHash) {
    signals.push(safeOpaqueLabel("Ship", slot.shipKeyHash));
  }

  if (slot.levelBand) {
    signals.push(`Level ${slot.levelBand}`);
  }

  const tier = /^tier:(.+)$/u.exec(String(slot.healthBand ?? ""));
  if (tier) {
    signals.push(`Tier ${tier[1]}`);
  }

  if (signals.length === 0) {
    signals.push("No ship identity");
  }

  return signals;
}

function isProjectionStale(payload) {
  const projection = payload?.projection;
  const updatedAt = projection?.updatedAt ?? projection?.observedAt;
  if (!updatedAt) {
    return false;
  }

  const updatedMs = new Date(updatedAt).valueOf();
  if (!Number.isFinite(updatedMs)) {
    return false;
  }

  return Date.now() - updatedMs > STALE_PROJECTION_MS;
}

function unavailableMessage(payload) {
  const retryAfterSeconds = Number(payload.retryAfterSeconds ?? 0);
  if (retryAfterSeconds > 0) {
    return `Fleet projection is unavailable. Retry in about ${retryAfterSeconds} seconds.`;
  }

  return "Fleet projection is unavailable.";
}

function formatDiagnosticTime(value) {
  return value ? formatDateTime(value) : "Never";
}

function formatDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? (value || "Unknown") : parsed.toLocaleString();
}

function formatAge(value) {
  const parsed = new Date(value);
  const ageMs = Date.now() - parsed.valueOf();
  if (!Number.isFinite(ageMs)) {
    return "Age unknown";
  }

  if (ageMs < 60_000) {
    return "Just now";
  }

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function activeTimerRemainingMs(slot) {
  const value = Number(slot?.activeTimerRemainingMs);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatWarpEtaLabel(row) {
  const remainingMs = adjustedRemainingMs(row);
  if (remainingMs === null) {
    return "";
  }

  if (remainingMs <= 0) {
    return "ETA due";
  }

  return `ETA ${formatDuration(remainingMs)}`;
}

function adjustedRemainingMs(row) {
  if (row.activeTimerRemainingMs === null) {
    return null;
  }

  const observedAt = Date.parse(row.updatedAt);
  if (!Number.isFinite(observedAt)) {
    return Math.max(0, Math.trunc(row.activeTimerRemainingMs));
  }

  const elapsedMs = Math.max(0, Date.now() - observedAt);
  return Math.max(0, Math.trunc(row.activeTimerRemainingMs - elapsedMs));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function titleCase(value) {
  return String(value ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
