import { createBridgeStatus } from "../../shared/bridge-status.js";
import { formatLocalInstant } from "../../shared/instant.js";
import {
    classifyObservedHostilePayload,
    describeObservedHostileIdentityQuality,
    describeObservedHostileSource,
    filterObservedHostileEntries,
    formatObservedHostileList,
} from "./view-model.js";

const FALLBACK_REFRESH_MS = 15000;

const state = {
    snapshot: null,
    entries: [],
    filteredEntries: [],
    selectedKey: null,
    refreshTimer: null,
    eventSource: null,
};

const elements = {
    runtimeNote: document.querySelector("#observed-hostile-runtime-note"),
    source: document.querySelector("#observed-hostile-source"),
    store: document.querySelector("#observed-hostile-store"),
    entryCount: document.querySelector("#observed-hostile-entry-count"),
    sightingCount: document.querySelector("#observed-hostile-sighting-count"),
    latestSeen: document.querySelector("#observed-hostile-latest-seen"),
    status: document.querySelector("#observed-hostile-status"),
    search: document.querySelector("#observed-hostile-search"),
    limit: document.querySelector("#observed-hostile-limit"),
    autoRefresh: document.querySelector("#observed-hostile-auto-refresh"),
    refreshButton: document.querySelector("#observed-hostile-refresh"),
    feedNote: document.querySelector("#observed-hostile-feed-note"),
    list: document.querySelector("#observed-hostile-list"),
    detail: document.querySelector("#observed-hostile-detail"),
};

const bridgeStatus = createBridgeStatus(elements.status);

elements.refreshButton?.addEventListener("click", () => void refreshSnapshot({ activityLabel: "Refreshing" }));
elements.limit?.addEventListener("change", () => void refreshSnapshot({ activityLabel: "Refreshing" }));
elements.search?.addEventListener("input", () => {
    applyFilters();
    renderList();
    renderDetail();
});
elements.autoRefresh?.addEventListener("change", updateRefreshLoop);
window.addEventListener("pageshow", () => void refreshSnapshot({ activityLabel: "Refreshing" }));
window.addEventListener("focus", () => void refreshSnapshot({ activityLabel: "Refreshing" }));
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshSnapshot({ activityLabel: "Refreshing" });
    }
});

await refreshSnapshot({ activityLabel: "Loading catalog" });
updateRefreshLoop();

async function refreshSnapshot(options = {}) {
    bridgeStatus.begin(options.activityLabel ?? "Loading");

    try {
        const limit = Number.parseInt(elements.limit?.value ?? "200", 10);
        const response = await fetch(`/api/observed-hostiles?limit=${Number.isFinite(limit) ? limit : 200}`, {
            cache: "no-store",
        });
        const snapshot = await response.json();

        state.snapshot = snapshot;
        state.entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
        applyFilters();
        renderStatus(snapshot);
        renderList();
        renderDetail();

        if (snapshot?.ok) {
            bridgeStatus.finish({ paused: !elements.autoRefresh?.checked });
        } else {
            bridgeStatus.disconnected(snapshot?.error ?? "Unavailable");
        }
    } catch (error) {
        state.snapshot = {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to load observed hostile catalog.",
        };
        state.entries = [];
        state.filteredEntries = [];
        state.selectedKey = null;
        renderStatus(state.snapshot);
        renderList();
        renderDetail();
        bridgeStatus.disconnected();
    }
}

function applyFilters() {
    state.filteredEntries = filterObservedHostileEntries(state.entries, elements.search?.value ?? "");
    if (!state.filteredEntries.some((entry) => entry?.key === state.selectedKey)) {
        state.selectedKey = state.filteredEntries[0]?.key ?? null;
    }
}

function renderStatus(snapshot) {
    const source = describeObservedHostileSource(snapshot);
    const latest = state.entries[0]?.lastSeenAt ?? null;
    const returnedEntries = Number(snapshot?.returnedEntries ?? state.filteredEntries.length ?? 0);
    const totalEntries = Number(snapshot?.totalEntries ?? state.entries.length ?? 0);
    const scannedEvents = Number(snapshot?.scannedEvents ?? 0);
    const totalEvents = Number(snapshot?.totalEvents ?? scannedEvents);

    elements.source.textContent = source.label;
    elements.source.title = source.title;
    elements.store.textContent = snapshot?.storageBackend ? String(snapshot.storageBackend) : "Unknown";
    elements.store.title = snapshot?.storageBackend
        ? `Observed hostile catalog store backend is ${snapshot.storageBackend}.`
        : "Observed hostile catalog store backend is unknown.";
    elements.entryCount.textContent = `${returnedEntries} / ${totalEntries}`;
    elements.sightingCount.textContent = `${scannedEvents} / ${totalEvents}`;
    elements.latestSeen.textContent = latest ? formatLocalInstant(latest, { fallback: "Unknown time" }) : "No sightings yet";
    elements.latestSeen.title = latest ? latest : "No hostile sightings have been stored yet.";
    renderProbeStatus(snapshot);

    if (snapshot?.ok === false) {
        elements.feedNote.textContent = snapshot.error ?? "Observed hostile catalog is unavailable.";
        return;
    }

    const searchActive = String(elements.search?.value ?? "").trim().length > 0;
    if (searchActive) {
        elements.feedNote.textContent = `Showing ${state.filteredEntries.length} matching entries from ${state.entries.length} grouped catalog records.`;
        return;
    }

    elements.feedNote.textContent = "Grouped from sidecar-stored hostile sightings. Public sync is unchanged.";
}

function renderList() {
    const payloadState = classifyObservedHostilePayload(state.snapshot);
    if (payloadState === "unavailable") {
        elements.list.innerHTML = `<div class="empty-state">${escapeHtml(state.snapshot?.error ?? "Observed hostile catalog is unavailable.")}</div>`;
        return;
    }

    if (payloadState === "empty") {
        elements.list.innerHTML = `<div class="empty-state">${escapeHtml(observedHostileEmptyMessage(state.snapshot))}</div>`;
        return;
    }

    if (state.filteredEntries.length === 0) {
        elements.list.innerHTML = '<div class="empty-state">No catalog entries match the current search.</div>';
        return;
    }

    elements.list.innerHTML = state.filteredEntries.map(renderEntryCard).join("");
    for (const button of elements.list.querySelectorAll("[data-observed-hostile-key]")) {
        button.addEventListener("click", () => {
            state.selectedKey = button.getAttribute("data-observed-hostile-key");
            renderList();
            renderDetail();
        });
    }
}

function renderEntryCard(entry) {
    const selected = entry?.key === state.selectedKey;
    const chips = [
        titleCase(entry?.identityQuality),
        entry?.strongestConfidence ? titleCase(entry.strongestConfidence) : "",
        Number.isFinite(entry?.sightingCount) ? `${entry.sightingCount} sightings` : "",
    ].filter(Boolean);
    const subtitle = [
        entry?.identityKind ? titleCase(entry.identityKind) : "",
        entry?.lastSeenAt ? `Last seen ${formatLocalInstant(entry.lastSeenAt, { fallback: "Unknown time" })}` : "",
    ].filter(Boolean).join(" • ");

    return `
      <button class="event-card observed-hostile-entry-card" type="button" data-selected="${selected ? "true" : "false"}" data-observed-hostile-key="${escapeAttribute(entry?.key)}">
        <div class="event-card__top">
          <strong>${escapeHtml(entry?.title ?? entry?.key ?? "Observed hostile")}</strong>
          <span class="line-badge">${escapeHtml(titleCase(entry?.identityKind ?? "unknown"))}</span>
        </div>
        <div class="chip-row">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
        <p>${escapeHtml(subtitle || "Grouped hostile evidence")}</p>
        <p class="observed-hostile-entry-card__meta">${escapeHtml(formatObservedHostileList(entry?.sourceSurfaces, { fallback: "No source surfaces" }))}</p>
      </button>
    `;
}

function renderDetail() {
    const payloadState = classifyObservedHostilePayload(state.snapshot);
    if (payloadState === "unavailable") {
        elements.detail.innerHTML = `<div class="empty-state">${escapeHtml(state.snapshot?.error ?? "Observed hostile catalog is unavailable.")}</div>`;
        return;
    }

    const entry = state.filteredEntries.find((item) => item?.key === state.selectedKey) ?? null;
    if (!entry) {
        const message = payloadState === "empty"
            ? observedHostileEmptyMessage(state.snapshot)
            : "Select a catalog entry to inspect its grouped hostile evidence.";
        elements.detail.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
        return;
    }

    const latest = asRecord(entry.latestObservation);
    elements.detail.innerHTML = `
      <section class="observed-hostile-detail-block">
        <div class="observed-hostile-detail-block__header">
          <div>
            <p class="eyebrow">Catalog Entry</p>
            <h3>${escapeHtml(entry.title ?? entry.key ?? "Observed hostile")}</h3>
          </div>
          <div class="chip-row">
            <span>${escapeHtml(titleCase(entry.identityKind ?? "unknown"))}</span>
            <span>${escapeHtml(titleCase(entry.identityQuality ?? "opaque"))}</span>
            ${entry.strongestConfidence ? `<span>${escapeHtml(titleCase(entry.strongestConfidence))}</span>` : ""}
          </div>
        </div>
        <p class="detail-note">${escapeHtml(describeObservedHostileIdentityQuality(entry.identityQuality))}</p>
      </section>

      <div class="detail-table-scroll">
        <table class="detail-table observed-hostile-detail-table">
          <tbody>
            ${renderDetailRow("Identity Key", entry.key)}
            ${renderDetailRow("Identity Kind", titleCase(entry.identityKind ?? "unknown"))}
            ${renderDetailRow("Identity Quality", titleCase(entry.identityQuality ?? "opaque"))}
            ${renderDetailRow("Sightings", entry.sightingCount)}
            ${renderDetailRow("First Seen", formatLocalInstant(entry.firstSeenAt, { fallback: "Unknown time" }))}
            ${renderDetailRow("Last Seen", formatLocalInstant(entry.lastSeenAt, { fallback: "Unknown time" }))}
            ${renderDetailRow("Source Surfaces", formatObservedHostileList(entry.sourceSurfaces))}
          </tbody>
        </table>
      </div>

      <section class="observed-hostile-detail-grid">
        <article class="observed-hostile-detail-section">
          <h3>Observed Identifiers</h3>
          <ul class="module-list observed-hostile-detail-list">
            <li><strong>Hull IDs:</strong> ${escapeHtml(formatObservedHostileList(entry.hullIds))}</li>
            <li><strong>Hull Names:</strong> ${escapeHtml(formatObservedHostileList(entry.hullNames))}</li>
            <li><strong>Runtime Fleet IDs:</strong> ${escapeHtml(formatObservedHostileList(entry.runtimeFleetIds))}</li>
            <li><strong>Location Translation IDs:</strong> ${escapeHtml(formatObservedHostileList(entry.locationTranslationIds))}</li>
            <li><strong>User IDs:</strong> ${escapeHtml(formatObservedHostileList(entry.userIds))}</li>
          </ul>
        </article>
        <article class="observed-hostile-detail-section">
          <h3>Latest Observation</h3>
          <div class="detail-table-scroll">
            <table class="detail-table observed-hostile-detail-table">
              <tbody>
                ${renderDetailRow("Timestamp", formatLocalInstant(latest.timestamp, { fallback: "Unknown time" }))}
                ${renderDetailRow("Surface", latest.sourceSurface || "Unknown")}
                ${renderDetailRow("Confidence", latest.confidence ? titleCase(latest.confidence) : "Unknown")}
                ${renderDetailRow("Runtime Fleet ID", latest.runtimeFleetId || "Unavailable")}
                ${renderDetailRow("Hull", formatHull(latest))}
                ${renderDetailRow("Threat Level", latest.threatLevel ?? "Unavailable")}
                ${renderDetailRow("Location Translation ID", latest.locationTranslationId || "Unavailable")}
                ${renderDetailRow("User ID", latest.userId || "Unavailable")}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
}

function updateRefreshLoop() {
    if (state.refreshTimer) {
        window.clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }

    if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
    }

    if (!elements.autoRefresh?.checked) {
        bridgeStatus.off();
        return;
    }

    if (window.EventSource) {
        bridgeStatus.off("Opening");
        state.eventSource = new EventSource("/api/events/stream");
        state.eventSource.addEventListener("open", () => markLiveUpdatesConnected());
        state.eventSource.addEventListener("ready", () => markLiveUpdatesConnected());
        state.eventSource.addEventListener("events-updated", (event) => {
            const update = parseStreamPayload(event);
            if (update?.reason !== "observed-hostile-ingest") {
                return;
            }

            bridgeStatus.begin("Updating");
            void refreshSnapshot({ activityLabel: "Updating" });
        });
        state.eventSource.addEventListener("error", () => {
            bridgeStatus.disconnected();
            ensureFallbackRefresh();
        });
        return;
    }

    ensureFallbackRefresh();
}

function markLiveUpdatesConnected() {
    if (state.refreshTimer) {
        window.clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }

    bridgeStatus.open();
}

function ensureFallbackRefresh() {
    if (state.refreshTimer || !elements.autoRefresh?.checked) {
        return;
    }

    state.refreshTimer = window.setInterval(() => {
        if (document.visibilityState !== "visible") {
            return;
        }

        void refreshSnapshot({ activityLabel: "Checking" });
    }, FALLBACK_REFRESH_MS);
}

function parseStreamPayload(event) {
    try {
        return JSON.parse(event.data ?? "{}");
    } catch {
        return {};
    }
}

function renderProbeStatus(snapshot) {
    const probeStatus = asRecord(snapshot?.probeStatus);
    if (!elements.runtimeNote) {
        return;
    }

    if (!probeStatus.status || probeStatus.status === "capture_ready") {
        elements.runtimeNote.hidden = true;
        elements.runtimeNote.innerHTML = "";
        return;
    }

    const details = Array.isArray(probeStatus.details)
        ? probeStatus.details.filter((detail) => String(detail ?? "").trim().length > 0)
        : [];
    const detailsHtml = details.length > 0
        ? `<ul class="variant-gate-warning__details">${details.map((detail) => `<li class="variant-gate-warning__detail">${escapeHtml(detail)}</li>`).join("")}</ul>`
        : "";

    elements.runtimeNote.hidden = false;
    elements.runtimeNote.innerHTML = `
      <div class="variant-gate-warning__copy">
        <p class="eyebrow">Capture Status</p>
        <div class="variant-gate-warning__headline">
          <strong>${escapeHtml(observedHostileProbeHeadline(probeStatus.status))}</strong>
          ${escapeHtml(String(probeStatus.summary ?? "Observed hostile capture needs attention."))}
        </div>
        ${detailsHtml}
      </div>
    `;
}

function observedHostileProbeHeadline(status) {
    switch (status) {
        case "restart_required":
            return "Restart required.";
        case "launch_required":
            return "Launch required.";
        case "transport_not_configured":
            return "Transport not ready.";
        case "disabled_in_settings":
            return "Probe disabled.";
        case "object_tracker_disabled":
            return "Object tracker disabled.";
        case "runtime_unavailable":
            return "Runtime snapshot unavailable.";
        case "settings_invalid":
            return "Settings invalid.";
        case "settings_unavailable":
            return "Settings unavailable.";
        case "runtime_invalid":
            return "Runtime snapshot invalid.";
        default:
            return "Capture attention needed.";
    }
}

function observedHostileEmptyMessage(snapshot) {
    const probeStatus = asRecord(snapshot?.probeStatus);
    if (probeStatus.status && probeStatus.status !== "capture_ready" && String(probeStatus.summary ?? "").trim().length > 0) {
        return String(probeStatus.summary);
    }

    return "No observed hostile sightings are stored yet.";
}

function renderDetailRow(label, value) {
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value ?? "Unavailable")}</td></tr>`;
}

function formatHull(latest) {
    const hullName = String(latest.hullName ?? "").trim();
    const hullId = String(latest.hullId ?? "").trim();
    if (hullName && hullId) {
        return `${hullName} (${hullId})`;
    }

    return hullName || hullId || "Unavailable";
}

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .split(/\s+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
