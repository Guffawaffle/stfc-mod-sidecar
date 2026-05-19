import { createBridgeStatus } from "../shared/bridge-status.js";
import { classifyProjectionPayload } from "./projection-view-state.js";

const STALE_PROJECTION_MS = 5 * 60 * 1000;
const FALLBACK_REFRESH_MS = 15000;
const FLEET_PAGE_ENTER_EVENT = "stfc:viewer-page-enter";

let refreshSequence = 0;
let activeRefreshPromise = null;
let fallbackRefreshTimer = null;
let fleetEventSource = null;
let lastProjectionPayload = null;
let showEmptySlots = false;

const elements = {
  endpoint: document.querySelector("#projection-endpoint"),
  rowCount: document.querySelector("#projection-row-count"),
  updated: document.querySelector("#projection-updated"),
  version: document.querySelector("#projection-version"),
  status: document.querySelector("#projection-status"),
  note: document.querySelector("#projection-note"),
  view: document.querySelector("#projection-view"),
  refreshButton: document.querySelector("#refresh-button"),
  toggleEmptySlotsButton: document.querySelector("#toggle-empty-slots-button"),
};

const bridgeStatus = createBridgeStatus(elements.status);

elements.refreshButton?.addEventListener("click", () => refreshProjection({ announce: true }));
elements.toggleEmptySlotsButton?.addEventListener("click", () => {
  showEmptySlots = !showEmptySlots;
  updateEmptySlotsToggle();
  if (lastProjectionPayload) {
    renderProjection(lastProjectionPayload);
  }
});
window.addEventListener("pageshow", () => {
  if (!fleetEventSource) {
    startLiveUpdateLoop();
  }
  return refreshProjection({ announce: false });
});
window.addEventListener("focus", () => refreshProjection({ announce: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    return refreshProjection({ announce: false });
  }

  return undefined;
});
window.addEventListener(FLEET_PAGE_ENTER_EVENT, (event) => {
  if (event.detail?.page === "fleet") {
    return refreshProjection({ announce: false });
  }

  return undefined;
});
window.addEventListener("pagehide", closeLiveUpdateLoop);
window.addEventListener("beforeunload", closeLiveUpdateLoop);

await refreshProjection({ announce: true });
startLiveUpdateLoop();

export function fleetProjectionPageEnterEvent() {
  return FLEET_PAGE_ENTER_EVENT;
}

updateEmptySlotsToggle();

async function refreshProjection(options = {}) {
  if (activeRefreshPromise) {
    if (options.announce) {
      bridgeStatus.begin("Refreshing");
    }
    return activeRefreshPromise;
  }

  const requestId = ++refreshSequence;
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

function startLiveUpdateLoop() {
  closeLiveUpdateLoop();

  if (!window.EventSource) {
    ensureFallbackRefresh();
    return;
  }

  fleetEventSource = new EventSource("/api/fleet/stream");
  fleetEventSource.addEventListener("open", markLiveUpdatesConnected);
  fleetEventSource.addEventListener("ready", markLiveUpdatesConnected);
  fleetEventSource.addEventListener("fleet-projection-changed", () => {
    void refreshProjection({ announce: false, activityLabel: "Updating" });
  });
  fleetEventSource.addEventListener("error", () => {
    bridgeStatus.disconnected();
    ensureFallbackRefresh();
  });
}

function markLiveUpdatesConnected() {
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

function closeLiveUpdateLoop() {
  clearFallbackRefresh();
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
  elements.endpoint.textContent = "/api/fleet/projection";
  elements.rowCount.textContent = "0";
  elements.updated.textContent = "Unavailable";
  elements.version.textContent = "Unavailable";
  elements.note.textContent = `Projection unavailable. ${String(payload.error ?? "The local broker did not return a current projection.")}`;
  elements.view.innerHTML = `<div class="empty-state">${escapeHtml(unavailableMessage(payload))}</div>`;
  bridgeStatus.disconnected("Unavailable");
}

function renderEmpty(payload) {
  const projection = payload.projection ?? null;
  elements.endpoint.textContent = "/api/fleet/projection";
  elements.rowCount.textContent = "0";
  elements.updated.textContent = projection?.updatedAt ? formatDateTime(projection.updatedAt) : "No updates yet";
  elements.version.textContent = Number.isFinite(projection?.stateVersion) ? `v${projection.stateVersion}` : "No projection";
  elements.note.textContent = "Projection available but empty. No observed fleet rows have been stored yet.";
  elements.view.innerHTML = '<div class="empty-state">No observed fleet rows are available yet.</div>';
  bridgeStatus.off("Empty");
}

function renderRows(payload, options = {}) {
  const projection = payload.projection;
  const rows = Array.isArray(projection?.slots) ? projection.slots.map(viewModelForSlot).sort(compareRows) : [];
  const visibleRows = showEmptySlots ? rows : rows.filter((row) => !row.isEmpty);
  const hiddenEmptyCount = rows.length - visibleRows.length;
  const updatedAt = projection?.updatedAt ?? projection?.observedAt ?? "";
  const stale = Boolean(options.stale);

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
            <th>Fleet</th>
            <th>Slot</th>
            <th>State</th>
            <th>Assignment</th>
            <th>Observed</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map((row) => `
            <tr>
              <td><div class="fleet-table__cell"><strong>${escapeHtml(row.fleetLabel)}</strong></div></td>
              <td><div class="fleet-table__cell"><strong>${escapeHtml(row.slotLabel)}</strong></div></td>
              <td><div class="fleet-table__cell"><strong>${escapeHtml(row.stateLabel)}</strong></div></td>
              <td><div class="fleet-table__cell"><span>${escapeHtml(row.assignmentLabel)}</span></div></td>
              <td>
                <div class="fleet-table__cell">
                  <div class="chip-row">${row.observedSignals.map((signal) => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
                </div>
              </td>
              <td>
                <div class="fleet-table__cell">
                  <strong>${escapeHtml(formatDateTime(row.updatedAt))}</strong>
                  <span class="fleet-table__secondary">${escapeHtml(formatAge(row.updatedAt))}</span>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (stale) {
    bridgeStatus.off("Possibly stale");
    return;
  }

  bridgeStatus.open("Current");
}

function viewModelForSlot(slot) {
  return {
    fleetLabel: safeOpaqueLabel("Fleet", slot.fleetKey),
    slotLabel: safeOpaqueLabel("Slot", slot.slotKey),
    slotOrder: slotOrderForSlot(slot),
    stateLabel: formatState(slot.state),
    assignmentLabel: formatAssignment(slot.assignmentKind),
    observedSignals: observedSignals(slot),
    isEmpty: isEmptyState(slot.state),
    updatedAt: String(slot.updatedAt ?? ""),
  };
}

function compareRows(left, right) {
  return left.slotOrder - right.slotOrder
    || left.slotLabel.localeCompare(right.slotLabel)
    || left.fleetLabel.localeCompare(right.fleetLabel);
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
  return String(value ?? "").trim().toLowerCase() === "empty";
}

function updateEmptySlotsToggle() {
  if (!elements.toggleEmptySlotsButton) {
    return;
  }

  elements.toggleEmptySlotsButton.textContent = showEmptySlots ? "Hide empty slots" : "Show empty slots";
}

function projectionNote({ hiddenEmptyCount, stale, totalRowCount, updatedAt, visibleRowCount }) {
  const freshness = stale
    ? `Projection may be stale. Showing the last stored observed fleet rows from ${formatDateTime(updatedAt)}.`
    : `Projection current. Showing ${visibleRowCount} observed fleet rows from the latest local projection.`;
  const hiddenNote = hiddenEmptyCount > 0 && !showEmptySlots
    ? ` ${hiddenEmptyCount} ${hiddenEmptyCount === 1 ? "empty slot is" : "empty slots are"} hidden.`
    : "";
  const emptyNote = visibleRowCount === 0 && totalRowCount > 0 && !showEmptySlots
    ? " All slots are currently empty."
    : "";
  return `${freshness}${emptyNote}${hiddenNote} Cargo is not currently projected in this slice.`;
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
