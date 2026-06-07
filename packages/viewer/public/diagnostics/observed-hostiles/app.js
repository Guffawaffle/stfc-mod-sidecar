import { createBridgeStatus } from "../../shared/bridge-status.js";
import { formatLocalInstant } from "../../shared/instant.js";
import {
    classifyObservedHostilePayload,
    describeObservedHostileBaseline,
    describeObservedHostileEvidenceTier,
    describeObservedHostileIdentityQuality,
    describeObservedHostileReferencePresence,
    describeObservedHostileSource,
    formatObservedHostileList,
} from "./view-model.js";

const FALLBACK_REFRESH_MS = 15000;
const OBSERVATION_PAGE_SIZE = 25;

const state = {
    observationsSnapshot: null,
    catalogSnapshot: null,
    observations: [],
    catalogEntries: [],
    activeTab: "observations",
    selectedObservationId: null,
    selectedEntryKey: null,
    observationNextCursor: null,
    observationHasMore: false,
    catalogNextCursor: null,
    catalogHasMore: false,
    pendingData: false,
    refreshTimer: null,
    eventSource: null,
    searchTimer: null,
};

const elements = {
    runtimeNote: document.querySelector("#observed-hostile-runtime-note"),
    source: document.querySelector("#observed-hostile-source"),
    store: document.querySelector("#observed-hostile-store"),
    reference: document.querySelector("#observed-hostile-reference"),
    observationCount: document.querySelector("#observed-hostile-observation-count"),
    entryCount: document.querySelector("#observed-hostile-entry-count"),
    sightingCount: document.querySelector("#observed-hostile-sighting-count"),
    latestSeen: document.querySelector("#observed-hostile-latest-seen"),
    status: document.querySelector("#observed-hostile-status"),
    search: document.querySelector("#observed-hostile-search"),
    statusFilter: document.querySelector("#observed-hostile-status-filter"),
    referenceFilter: document.querySelector("#observed-hostile-reference-filter"),
    limit: document.querySelector("#observed-hostile-limit"),
    autoRefresh: document.querySelector("#observed-hostile-auto-refresh"),
    refreshButton: document.querySelector("#observed-hostile-refresh"),
    feedNote: document.querySelector("#observed-hostile-feed-note"),
    tabButtons: document.querySelectorAll("[data-observed-hostile-tab]"),
    tabPanels: document.querySelectorAll("[data-observed-hostile-panel]"),
    observationList: document.querySelector("#observed-hostile-observation-list"),
    observationPageStatus: document.querySelector("#observed-hostile-observation-page-status"),
    loadMoreObservations: document.querySelector("#observed-hostile-load-more-observations"),
    catalogList: document.querySelector("#observed-hostile-list"),
    catalogPageStatus: document.querySelector("#observed-hostile-catalog-page-status"),
    loadMore: document.querySelector("#observed-hostile-load-more"),
    detail: document.querySelector("#observed-hostile-detail"),
};

const bridgeStatus = createBridgeStatus(elements.status);

elements.refreshButton?.addEventListener("click", () => void refreshAll({ activityLabel: "Refreshing", clearPending: true }));
elements.loadMoreObservations?.addEventListener("click", () => void loadMoreObservations());
elements.loadMore?.addEventListener("click", () => void loadMoreCatalogEntries());
elements.limit?.addEventListener("change", () => void refreshCatalogEntries({ reset: true, activityLabel: "Refreshing entries" }));
elements.statusFilter?.addEventListener("change", () => void refreshAll({ activityLabel: "Filtering", clearPending: true }));
elements.referenceFilter?.addEventListener("change", () => void refreshAll({ activityLabel: "Filtering", clearPending: true }));
for (const button of elements.tabButtons) {
    button.addEventListener("click", () => setActiveTab(button.getAttribute("data-observed-hostile-tab")));
}
elements.search?.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
        void refreshAll({ activityLabel: "Searching", clearPending: true });
    }, 180);
});
elements.autoRefresh?.addEventListener("change", updateRefreshLoop);
window.addEventListener("pageshow", () => void refreshAll({ activityLabel: "Refreshing" }));
window.addEventListener("focus", () => void refreshAll({ activityLabel: "Refreshing" }));
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshAll({ activityLabel: "Refreshing" });
    }
});

await refreshAll({ activityLabel: "Loading observations", clearPending: true });
updateRefreshLoop();

async function refreshAll(options = {}) {
    bridgeStatus.begin(options.activityLabel ?? "Loading");

    try {
        const [observationsSnapshot, catalogSnapshot] = await Promise.all([
            fetchObservations(),
            fetchCatalogEntries(),
        ]);
        applyObservationsSnapshot(observationsSnapshot, { reset: true });
        applyCatalogSnapshot(catalogSnapshot, { reset: true });
        if (options.clearPending) {
            state.pendingData = false;
        }
        renderAll();
        finishBridgeStatus(observationsSnapshot, catalogSnapshot);
    } catch (error) {
        applyLoadError(error);
        renderAll();
        bridgeStatus.disconnected();
    }
}

async function refreshCatalogEntries(options = {}) {
    bridgeStatus.begin(options.activityLabel ?? "Loading entries");
    try {
        const snapshot = await fetchCatalogEntries();
        applyCatalogSnapshot(snapshot, { reset: true });
        if (options.clearPending) {
            state.pendingData = false;
        }
        renderAll();
        finishBridgeStatus(state.observationsSnapshot, snapshot);
    } catch (error) {
        applyLoadError(error);
        renderAll();
        bridgeStatus.disconnected();
    }
}

async function loadMoreObservations() {
    if (!state.observationHasMore || !state.observationNextCursor) {
        return;
    }

    elements.loadMoreObservations.disabled = true;
    const originalText = elements.loadMoreObservations.textContent;
    elements.loadMoreObservations.textContent = "Loading...";
    try {
        const snapshot = await fetchObservations({ cursor: state.observationNextCursor });
        applyObservationsSnapshot(snapshot, { reset: false });
        renderAll();
        finishBridgeStatus(snapshot, state.catalogSnapshot);
    } catch (error) {
        bridgeStatus.disconnected(error instanceof Error ? error.message : "Unable to load more observations.");
    } finally {
        elements.loadMoreObservations.textContent = originalText;
        elements.loadMoreObservations.disabled = false;
    }
}

async function loadMoreCatalogEntries() {
    if (!state.catalogHasMore || !state.catalogNextCursor) {
        return;
    }

    elements.loadMore.disabled = true;
    const originalText = elements.loadMore.textContent;
    elements.loadMore.textContent = "Loading...";
    try {
        const snapshot = await fetchCatalogEntries({ cursor: state.catalogNextCursor });
        applyCatalogSnapshot(snapshot, { reset: false });
        renderAll();
        finishBridgeStatus(state.observationsSnapshot, snapshot);
    } catch (error) {
        bridgeStatus.disconnected(error instanceof Error ? error.message : "Unable to load more entries.");
    } finally {
        elements.loadMore.textContent = originalText;
        elements.loadMore.disabled = false;
    }
}

async function fetchObservations(options = {}) {
    const params = baseProjectionParams({ limit: OBSERVATION_PAGE_SIZE });
    if (options.cursor) {
        params.set("cursor", options.cursor);
    }
    const response = await fetch(`/api/observed-hostiles/observations?${params}`, { cache: "no-store" });
    return response.json();
}

async function fetchCatalogEntries(options = {}) {
    const limit = Number.parseInt(elements.limit?.value ?? "25", 10);
    const params = baseProjectionParams({ limit: Number.isFinite(limit) ? limit : 25 });
    if (options.cursor) {
        params.set("cursor", options.cursor);
    }
    const response = await fetch(`/api/observed-hostiles/catalog-entries?${params}`, { cache: "no-store" });
    return response.json();
}

function baseProjectionParams(options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 25));
    params.set("sort", "latest_seen_desc");
    const query = String(elements.search?.value ?? "").trim();
    const status = String(elements.statusFilter?.value ?? "").trim();
    const reference = String(elements.referenceFilter?.value ?? "").trim();
    if (query) {
        params.set("q", query);
    }
    if (status) {
        params.set("status", status);
    }
    if (reference) {
        params.set("reference", reference);
    }
    return params;
}

function applyObservationsSnapshot(snapshot, options = {}) {
    state.observationsSnapshot = snapshot;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    state.observations = options.reset ? items : mergeByKey(state.observations, items, (observation) => observation?.observationId);
    state.observationNextCursor = snapshot?.nextCursor ?? null;
    state.observationHasMore = snapshot?.hasMore === true;
    if (!state.observations.some((observation) => observation.observationId === state.selectedObservationId)) {
        state.selectedObservationId = state.observations[0]?.observationId ?? null;
    }
}

function applyCatalogSnapshot(snapshot, options = {}) {
    state.catalogSnapshot = snapshot;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    state.catalogEntries = options.reset ? items : mergeByKey(state.catalogEntries, items, (entry) => entry?.key);
    state.catalogNextCursor = snapshot?.nextCursor ?? null;
    state.catalogHasMore = snapshot?.hasMore === true;
}

function mergeByKey(current, incoming, keyForItem) {
    const merged = [...current];
    const seen = new Set(merged.map((item) => keyForItem(item)).filter(Boolean));
    for (const item of incoming) {
        const key = keyForItem(item);
        if (key && !seen.has(key)) {
            seen.add(key);
            merged.push(item);
        }
    }
    return merged;
}

function applyLoadError(error) {
    const message = error instanceof Error ? error.message : "Unable to load observed hostile observations.";
    state.observationsSnapshot = { ok: false, error: message };
    state.catalogSnapshot = { ok: false, error: message };
    state.observations = [];
    state.catalogEntries = [];
    state.observationNextCursor = null;
    state.observationHasMore = false;
    state.catalogNextCursor = null;
    state.catalogHasMore = false;
    state.selectedObservationId = null;
    state.selectedEntryKey = null;
}

function finishBridgeStatus(...snapshots) {
    if (snapshots.some((snapshot) => snapshot?.ok === false)) {
        bridgeStatus.disconnected(snapshots.find((snapshot) => snapshot?.ok === false)?.error ?? "Unavailable");
        return;
    }

    bridgeStatus.finish({ paused: !elements.autoRefresh?.checked });
}

function renderAll() {
    renderTabs();
    renderStatus();
    renderObservationList();
    renderCatalogList();
    renderDetail();
}

function setActiveTab(tab) {
    if (tab !== "observations" && tab !== "catalog") {
        return;
    }

    state.activeTab = tab;
    renderTabs();
}

function renderTabs() {
    for (const button of elements.tabButtons) {
        const tab = button.getAttribute("data-observed-hostile-tab");
        const active = tab === state.activeTab;
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.tabIndex = active ? 0 : -1;
    }

    for (const panel of elements.tabPanels) {
        panel.hidden = panel.getAttribute("data-observed-hostile-panel") !== state.activeTab;
    }
}

function renderStatus() {
    const snapshot = state.observationsSnapshot ?? state.catalogSnapshot;
    const source = describeObservedHostileSource(snapshot);
    const referenceCatalog = describeReferenceCatalog(snapshot?.referenceCatalog ?? state.catalogSnapshot?.referenceCatalog);
    const latest = state.observations[0]?.endedAt ?? state.catalogEntries[0]?.lastSeenAt ?? null;
    const totalObservations = Number(state.observationsSnapshot?.totalApprox ?? state.observations.length ?? 0);
    const totalEntries = Number(state.catalogSnapshot?.totalApprox ?? state.catalogEntries.length ?? 0);
    const passiveScannedEvents = Number(snapshot?.passiveScannedEvents ?? snapshot?.scannedEvents ?? 0);
    const catalogScannedEvents = Number(snapshot?.scannedEvents ?? passiveScannedEvents);
    const supplementalScannedEvents = Number(
        snapshot?.supplementalScannedEvents ?? Math.max(catalogScannedEvents - passiveScannedEvents, 0),
    );
    const totalEvents = Number(snapshot?.totalEvents ?? catalogScannedEvents);
    const ignoredEvents = Number(snapshot?.ignoredEvents ?? 0);

    elements.source.textContent = source.label;
    elements.source.title = source.title;
    elements.store.textContent = snapshot?.storageBackend ? String(snapshot.storageBackend) : "Unknown";
    elements.store.title = snapshot?.storageBackend
        ? `Observed hostile catalog store backend is ${snapshot.storageBackend}.`
        : "Observed hostile catalog store backend is unknown.";
    elements.reference.textContent = referenceCatalog.label;
    elements.reference.title = referenceCatalog.title;
    elements.observationCount.textContent = `${state.observations.length} / ${totalObservations}`;
    elements.entryCount.textContent = `${state.catalogEntries.length} / ${totalEntries}`;
    elements.sightingCount.textContent = supplementalScannedEvents > 0
        ? `${passiveScannedEvents} passive / ${catalogScannedEvents} catalog`
        : `${passiveScannedEvents} passive`;
    elements.sightingCount.title = ignoredEvents > 0
        ? `${passiveScannedEvents} passive sightings, ${supplementalScannedEvents} supplemental sightings, ${ignoredEvents} ignored interactive/debug rows, ${totalEvents} total stored events.`
        : `${passiveScannedEvents} passive sightings, ${supplementalScannedEvents} supplemental sightings, ${totalEvents} total stored events.`;
    elements.latestSeen.textContent = latest ? formatLocalInstant(latest, { fallback: "Unknown time" }) : "No sightings yet";
    elements.latestSeen.title = latest ? latest : "No hostile sightings have been stored yet.";
    renderProbeStatus(snapshot);

    if (snapshot?.ok === false) {
        elements.feedNote.textContent = snapshot.error ?? "Observed hostile observations are unavailable.";
        return;
    }

    if (state.pendingData) {
        elements.feedNote.textContent = "New hostile observations are available. Refresh list to update without changing the current entry mid-inspection.";
        return;
    }

    const query = String(elements.search?.value ?? "").trim();
    const status = String(elements.statusFilter?.value ?? "").trim();
    const referenceFilter = String(elements.referenceFilter?.value ?? "").trim();
    if (query || status || referenceFilter) {
        elements.feedNote.textContent = `Showing ${state.observations.length} passive observation windows and ${state.catalogEntries.length} loaded catalog entries matching current filters.`;
        return;
    }

    const windowMs = Number(state.observationsSnapshot?.observationWindowMs ?? 300000);
    elements.feedNote.textContent = `System Observations use a ${Math.round(windowMs / 1000)}s rolling window over passive fleet_data_system sightings. prescan_target_widget stays supplemental UI evidence${ignoredEvents > 0 ? `; ${ignoredEvents} interactive/debug rows remain outside catalog counts.` : "."}`;
}

function renderObservationList() {
    const payloadState = classifyObservedHostilePayload({ ...state.observationsSnapshot, entries: state.observations });
    if (payloadState === "unavailable") {
        elements.observationList.innerHTML = `<div class="empty-state">${escapeHtml(state.observationsSnapshot?.error ?? "System observations are unavailable.")}</div>`;
    } else if (payloadState === "empty") {
        elements.observationList.innerHTML = `<div class="empty-state">${escapeHtml(observedHostileEmptyMessage(state.observationsSnapshot))}</div>`;
    } else {
        elements.observationList.innerHTML = state.observations.map(renderObservationCard).join("");
        for (const button of elements.observationList.querySelectorAll("[data-observed-hostile-observation-id]")) {
            button.addEventListener("click", () => {
                state.selectedObservationId = button.getAttribute("data-observed-hostile-observation-id");
                const observation = selectedObservation();
                if (state.selectedEntryKey && !observation?.entries?.some((entry) => entry.key === state.selectedEntryKey)) {
                    state.selectedEntryKey = null;
                }
                renderObservationList();
                renderDetail();
            });
        }
    }

    const total = Number(state.observationsSnapshot?.totalApprox ?? state.observations.length ?? 0);
    elements.observationPageStatus.textContent = total > 0
        ? `Showing ${state.observations.length} of ${total} observations`
        : "No observations loaded";
    elements.loadMoreObservations.hidden = state.observationHasMore !== true;
    elements.loadMoreObservations.disabled = state.observationHasMore !== true;
}

function renderObservationCard(observation) {
    const selected = observation?.observationId === state.selectedObservationId;
    const systemLabel = systemObservationLabel(observation);
    const health = observation?.matchHealth ?? {};
    const supplementalSightingCount = Number(observation?.supplementalSightingCount ?? 0);
    const supplementalObservedHostileCount = Number(observation?.supplementalObservedHostileCount ?? 0);
    const chips = [
        `${observation?.observedHostileCount ?? 0} passive hostiles`,
        `${observation?.rawEventCount ?? 0} passive raw events`,
        `${observation?.sightingCount ?? 0} passive sightings`,
        supplementalSightingCount > 0 ? `+${supplementalSightingCount} supplemental sightings` : "",
        supplementalObservedHostileCount > 0 ? `+${supplementalObservedHostileCount} supplemental buckets` : "",
        formatObservationReferencePresence(observation?.referencePresence),
        formatMatchHealth(health),
    ].filter(Boolean);

    return `
      <button class="event-card observed-hostile-observation-card" type="button" data-selected="${selected ? "true" : "false"}" data-observed-hostile-observation-id="${escapeAttribute(observation?.observationId)}">
        <div class="event-card__top">
          <strong>${escapeHtml(systemLabel)}</strong>
          <span class="line-badge">${escapeHtml(formatLocalInstant(observation?.endedAt, { fallback: "Unknown time" }))}</span>
        </div>
        <div class="chip-row">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
        <p>${escapeHtml(formatObservationWindow(observation))}</p>
        <p class="observed-hostile-entry-card__meta">${escapeHtml(formatObservationCoverage(observation))}</p>
      </button>
    `;
}

function renderCatalogList() {
    const payloadState = classifyObservedHostilePayload({ ...state.catalogSnapshot, entries: state.catalogEntries });
    if (payloadState === "unavailable") {
        elements.catalogList.innerHTML = `<div class="empty-state">${escapeHtml(state.catalogSnapshot?.error ?? "Catalog entries are unavailable.")}</div>`;
    } else if (payloadState === "empty") {
        elements.catalogList.innerHTML = '<div class="empty-state">No catalog entries match the current filters.</div>';
    } else {
        elements.catalogList.innerHTML = state.catalogEntries.map(renderEntryCard).join("");
        for (const button of elements.catalogList.querySelectorAll("[data-observed-hostile-key]")) {
            button.addEventListener("click", () => {
                state.selectedEntryKey = button.getAttribute("data-observed-hostile-key");
                renderCatalogList();
                renderDetail();
            });
        }
    }

    const total = Number(state.catalogSnapshot?.totalApprox ?? state.catalogEntries.length ?? 0);
    elements.catalogPageStatus.textContent = total > 0
        ? `Showing ${state.catalogEntries.length} of ${total} entries`
        : "No entries loaded";
    elements.loadMore.hidden = state.catalogHasMore !== true;
    elements.loadMore.disabled = state.catalogHasMore !== true;
}

function renderEntryCard(entry) {
    const selected = entry?.key === state.selectedEntryKey;
    const baseline = describeObservedHostileBaseline(entry?.baseline);
    const evidenceTier = describeObservedHostileEvidenceTier(entry?.evidenceTier);
    const referencePresence = describeObservedHostileReferencePresence(entry?.referencePresence);
    const chips = [
        evidenceTier.label,
        referencePresence.label,
        titleCase(entry?.identityQuality),
        entry?.strongestConfidence ? titleCase(entry.strongestConfidence) : "",
        baseline.label !== "Baseline unavailable" ? baseline.label : "",
        Number.isFinite(entry?.sightingCount) ? `${entry.sightingCount} sightings` : "",
    ].filter(Boolean);
    const subtitle = [
        entry?.identityKind ? titleCase(entry.identityKind) : "",
        entry?.lastSeenAt ? `Last seen ${formatLocalInstant(entry.lastSeenAt, { fallback: "Unknown time" })}` : "",
    ].filter(Boolean).join(" | ");

    return `
      <button class="event-card observed-hostile-entry-card" type="button" data-selected="${selected ? "true" : "false"}" data-observed-hostile-key="${escapeAttribute(entry?.key)}">
        <div class="event-card__top">
          <strong>${escapeHtml(entry?.title ?? entry?.key ?? "Observed hostile")}</strong>
          <span class="line-badge">${escapeHtml(titleCase(entry?.identityKind ?? "unknown"))}</span>
        </div>
        <div class="chip-row">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
        <p>${escapeHtml(subtitle || "Grouped hostile evidence")}</p>
        <p class="observed-hostile-entry-card__meta">${escapeHtml(formatEntryCoverage(entry))}</p>
      </button>
    `;
}

function renderDetail() {
    const observation = selectedObservation();
    const entry = selectedEntry();
    const payloadState = classifyObservedHostilePayload({ ...state.observationsSnapshot, entries: state.observations });
    if (payloadState === "unavailable") {
        elements.detail.innerHTML = `<div class="empty-state">${escapeHtml(state.observationsSnapshot?.error ?? "System observations are unavailable.")}</div>`;
        return;
    }
    if (!observation && !entry) {
        elements.detail.innerHTML = `<div class="empty-state">${escapeHtml(observedHostileEmptyMessage(state.observationsSnapshot))}</div>`;
        return;
    }

    elements.detail.innerHTML = `
      ${observation ? renderObservationDetailBlock(observation) : ""}
      ${observation ? renderObservationHostileList(observation) : ""}
      ${entry ? renderEvidenceEntryDetail(entry) : '<div class="empty-state">Select an observed hostile to inspect its evidence bucket.</div>'}
    `;

    for (const button of elements.detail.querySelectorAll("[data-observed-hostile-detail-key]")) {
        button.addEventListener("click", () => {
            state.selectedEntryKey = button.getAttribute("data-observed-hostile-detail-key");
            renderCatalogList();
            renderDetail();
        });
    }
}

function renderObservationDetailBlock(observation) {
    const supplementalSightingCount = Number(observation?.supplementalSightingCount ?? 0);
    const supplementalObservedHostileCount = Number(observation?.supplementalObservedHostileCount ?? 0);
    return `
      <section class="observed-hostile-detail-block">
        <div class="observed-hostile-detail-block__header">
          <div>
            <p class="eyebrow">System Observation</p>
            <h3>${escapeHtml(systemObservationLabel(observation))}</h3>
          </div>
          <div class="chip-row">
            <span>${escapeHtml(`${observation.observedHostileCount ?? 0} passive hostiles`)}</span>
            <span>${escapeHtml(`${observation.rawEventCount ?? 0} passive raw events`)}</span>
            <span>${escapeHtml(`${observation.sightingCount ?? 0} passive sightings`)}</span>
            ${supplementalSightingCount > 0 ? `<span>${escapeHtml(`+${supplementalSightingCount} supplemental sightings`)}</span>` : ""}
            ${supplementalObservedHostileCount > 0 ? `<span>${escapeHtml(`+${supplementalObservedHostileCount} supplemental buckets`)}</span>` : ""}
            <span>${escapeHtml(formatObservationReferencePresence(observation?.referencePresence))}</span>
            <span>${escapeHtml(formatMatchHealth(observation.matchHealth))}</span>
          </div>
        </div>
        <p class="detail-note">${escapeHtml(formatObservationWindow(observation))}. ${escapeHtml(formatObservationCoverage(observation))}.</p>
      </section>
    `;
}

function renderObservationHostileList(observation) {
    const entries = Array.isArray(observation?.entries) ? observation.entries : [];
    if (entries.length === 0) {
        return '<div class="empty-state">No deduped hostiles are available for this observation window.</div>';
    }

    return `
      <section class="observed-hostile-detail-section">
        <div class="panel-heading observed-hostile-subheading">
          <h3>Passive Observed Hostiles</h3>
          <p>Counted from fleet_data_system and deduped by the same evidence-bucket logic used below.</p>
        </div>
        <div class="observed-hostile-entry-grid">
          ${entries.map((entry) => renderObservationEntryButton(entry)).join("")}
        </div>
      </section>
      ${renderObservationSupplementalList(observation)}
    `;
}

function renderObservationSupplementalList(observation) {
    const entries = Array.isArray(observation?.supplementalEntries) ? observation.supplementalEntries : [];
    if (entries.length === 0) {
        return "";
    }

    return `
      <section class="observed-hostile-detail-section">
        <div class="panel-heading observed-hostile-subheading">
          <h3>Supplemental UI Evidence</h3>
          <p>Captured from view-adjacent UI surfaces and kept out of passive hostile counts.</p>
        </div>
        <div class="observed-hostile-entry-grid">
          ${entries.map((entry) => renderObservationEntryButton(entry)).join("")}
        </div>
      </section>
    `;
}

function renderObservationEntryButton(entry) {
    const selected = entry?.key === state.selectedEntryKey;
    const evidenceTier = describeObservedHostileEvidenceTier(entry?.evidenceTier);
    const referencePresence = describeObservedHostileReferencePresence(entry?.referencePresence);
    return `
      <button class="event-card observed-hostile-entry-card" type="button" data-selected="${selected ? "true" : "false"}" data-observed-hostile-detail-key="${escapeAttribute(entry?.key)}">
        <div class="event-card__top">
          <strong>${escapeHtml(entry?.title ?? entry?.key ?? "Observed hostile")}</strong>
          <span class="line-badge">${escapeHtml(evidenceTier.label)}</span>
        </div>
        <div class="chip-row"><span>${escapeHtml(referencePresence.label)}</span></div>
        <p>${escapeHtml(titleCase(entry?.identityKind ?? "unknown"))} | ${escapeHtml(formatEntryCoverage(entry))}</p>
      </button>
    `;
}

function renderEvidenceEntryDetail(entry) {
    const latest = asRecord(entry.latestObservation);
    const evidenceTier = describeObservedHostileEvidenceTier(entry?.evidenceTier);
    const latestTier = describeObservedHostileEvidenceTier(latest?.sourceTier);
    const referencePresence = describeObservedHostileReferencePresence(entry?.referencePresence);
    return `
      <section class="observed-hostile-detail-block">
        <div class="observed-hostile-detail-block__header">
          <div>
            <p class="eyebrow">Catalog Entry</p>
            <h3>${escapeHtml(entry.title ?? entry.key ?? "Observed hostile")}</h3>
          </div>
          <div class="chip-row">
            <span>${escapeHtml(evidenceTier.label)}</span>
            <span title="${escapeAttribute(referencePresence.title)}">${escapeHtml(referencePresence.label)}</span>
            <span>${escapeHtml(titleCase(entry.identityKind ?? "unknown"))}</span>
            <span>${escapeHtml(titleCase(entry.identityQuality ?? "opaque"))}</span>
            ${entry.strongestConfidence ? `<span>${escapeHtml(titleCase(entry.strongestConfidence))}</span>` : ""}
          </div>
        </div>
        <p class="detail-note">${escapeHtml(`${describeObservedHostileIdentityQuality(entry.identityQuality)} ${evidenceTier.title}`)}</p>
      </section>

      ${renderBaselineMatchBlock(entry)}

      <div class="detail-table-scroll">
        <table class="detail-table observed-hostile-detail-table">
          <tbody>
            ${renderDetailRow("Identity Key", entry.key)}
            ${renderDetailRow("Identity Kind", titleCase(entry.identityKind ?? "unknown"))}
            ${renderDetailRow("Identity Quality", titleCase(entry.identityQuality ?? "opaque"))}
            ${renderDetailRow("Evidence Tier", evidenceTier.label)}
            ${renderDetailRow("Reference Presence", referencePresence.label)}
            ${renderDetailRow("Sightings", entry.sightingCount)}
            ${renderDetailRow("Passive Sightings", entry.passiveSightingCount ?? 0)}
            ${renderDetailRow("Supplemental Sightings", entry.supplementalSightingCount ?? 0)}
            ${renderDetailRow("First Seen", formatLocalInstant(entry.firstSeenAt, { fallback: "Unknown time" }))}
            ${renderDetailRow("Last Seen", formatLocalInstant(entry.lastSeenAt, { fallback: "Unknown time" }))}
            ${renderDetailRow("Source Surfaces", formatObservedHostileList(entry.sourceSurfaces))}
            ${renderDetailRow("Passive Source Surfaces", formatCoverageList(entry?.sourceCoverage, "passive"))}
            ${renderDetailRow("Supplemental Source Surfaces", formatCoverageList(entry?.sourceCoverage, "supplemental"))}
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
            <li><strong>System IDs:</strong> ${escapeHtml(formatObservedHostileList(entry.systemIds))}</li>
            <li><strong>User Levels:</strong> ${escapeHtml(formatObservedHostileList(entry.userLevels))}</li>
            <li><strong>User Loca IDs:</strong> ${escapeHtml(formatObservedHostileList(entry.userLocaIds))}</li>
            <li><strong>Hull Types:</strong> ${escapeHtml(formatObservedHostileList(entry.hullTypeNames, { fallback: "None" }))}</li>
            <li><strong>Fleet Types:</strong> ${escapeHtml(formatObservedHostileList(entry.fleetTypeNames, { fallback: "None" }))}</li>
          </ul>
        </article>
        <article class="observed-hostile-detail-section">
          <h3>Latest Sighting</h3>
          <div class="detail-table-scroll">
            <table class="detail-table observed-hostile-detail-table">
              <tbody>
                ${renderDetailRow("Timestamp", formatLocalInstant(latest.timestamp, { fallback: "Unknown time" }))}
                ${renderDetailRow("Surface", latest.sourceSurface || "Unknown")}
                ${renderDetailRow("Source Tier", latestTier.label)}
                ${renderDetailRow("Confidence", latest.confidence ? titleCase(latest.confidence) : "Unknown")}
                ${renderDetailRow("Runtime Fleet ID", latest.runtimeFleetId || "Unavailable")}
                ${renderDetailRow("Hull", formatHull(latest))}
                ${renderDetailRow("Hull Type", latest.hullTypeName || "Unavailable")}
                ${renderDetailRow("Fleet Type", latest.fleetTypeName || "Unavailable")}
                ${renderDetailRow("Threat Level", latest.threatLevel ?? "Unavailable")}
                ${renderDetailRow("Location Translation ID", latest.locationTranslationId || "Unavailable")}
                ${renderDetailRow("System ID", latest.systemId || "Unavailable")}
                ${renderDetailRow("User ID", latest.userId || "Unavailable")}
                ${renderDetailRow("User Level", latest.userLevel ?? "Unavailable")}
                ${renderDetailRow("User Loca ID", latest.userLocaId || "Unavailable")}
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

            if (state.selectedEntryKey) {
                state.pendingData = true;
                renderStatus();
                bridgeStatus.finish({ paused: false });
                return;
            }

            void refreshAll({ activityLabel: "Updating" });
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
        if (state.selectedEntryKey) {
            state.pendingData = true;
            renderStatus();
            return;
        }

        void refreshAll({ activityLabel: "Checking" });
    }, FALLBACK_REFRESH_MS);
}

function parseStreamPayload(event) {
    try {
        return JSON.parse(event.data ?? "{}");
    } catch {
        return {};
    }
}

function selectedObservation() {
    return state.observations.find((observation) => observation.observationId === state.selectedObservationId) ?? null;
}

function selectedEntry() {
    const observationEntry = selectedObservation()?.entries?.find((entry) => entry.key === state.selectedEntryKey) ?? null;
    return observationEntry ?? state.catalogEntries.find((entry) => entry.key === state.selectedEntryKey) ?? null;
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

function renderBaselineMatchBlock(entry) {
    const baseline = entry?.baseline ?? null;
    const descriptor = describeObservedHostileBaseline(baseline);
    const matches = Array.isArray(baseline?.matches) ? baseline.matches : [];
    const rows = matches.length > 0
        ? matches.map((match) => `
            <tr>
              <td>${escapeHtml(match.hostileId || "Unknown")}</td>
              <td>${escapeHtml(match.name || "Unknown")}</td>
              <td>${escapeHtml(match.factionName || "Unknown")}</td>
              <td>${escapeHtml(match.level ?? "Unknown")}</td>
              <td>${escapeHtml(match.matchSignals?.join(", ") || "None")}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="5">No bundled candidates are available for this entry.</td></tr>`;

    return `
      <section class="observed-hostile-detail-block">
        <div class="observed-hostile-detail-block__header">
          <div>
            <p class="eyebrow">Bundled Baseline</p>
            <h3>${escapeHtml(descriptor.label)}</h3>
          </div>
          <div class="chip-row">
            <span>${escapeHtml(titleCase(baseline?.status ?? "unavailable"))}</span>
            ${Number.isFinite(baseline?.candidateCount) ? `<span>${escapeHtml(`${baseline.candidateCount} top ${baseline.candidateCount === 1 ? "candidate" : "candidates"}`)}</span>` : ""}
            ${Number.isFinite(baseline?.rankedCandidateCount) && baseline.rankedCandidateCount > baseline.candidateCount
                ? `<span>${escapeHtml(`${baseline.rankedCandidateCount} ranked`)}</span>`
                : ""}
          </div>
        </div>
        <p class="detail-note">${escapeHtml(descriptor.title)}</p>
        <div class="detail-table-scroll">
          <table class="detail-table observed-hostile-detail-table">
            <thead>
              <tr>
                <th>Hostile ID</th>
                <th>Name</th>
                <th>Faction</th>
                <th>Level</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    `;
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

function formatMatchHealth(matchHealth) {
    const health = asRecord(matchHealth);
    const matched = Number(health.matched ?? 0);
    const candidate = Number(health.candidate ?? 0);
    const ambiguous = Number(health.ambiguous ?? 0);
    const unmapped = Number(health.unmapped ?? 0);
    const insufficient = Number(health.insufficientSignal ?? 0);
    return `${matched} matched / ${candidate} candidate / ${ambiguous} ambiguous / ${unmapped} unmapped / ${insufficient} needs signal`;
}

function formatObservationReferencePresence(referencePresence) {
    const presence = asRecord(referencePresence);
    const known = Number(presence.known ?? 0);
    const unknown = Number(presence.unknown ?? 0);
    const needsSignal = Number(presence.needsSignal ?? 0);
    const unavailable = Number(presence.unavailable ?? 0);
    const parts = [];

    if (known > 0) {
        parts.push(`${known} known by STFC.space`);
    }
    if (unknown > 0) {
        parts.push(`${unknown} gap candidate${unknown === 1 ? "" : "s"}`);
    }
    if (needsSignal > 0) {
        parts.push(`${needsSignal} need signal`);
    }
    if (unavailable > 0) {
        parts.push(`${unavailable} reference unavailable`);
    }

    return parts.join(" / ") || "Reference unresolved";
}

function formatEntryCoverage(entry) {
    return formatSourceCoverageSummary(entry?.sourceCoverage, { includeIgnored: false });
}

function formatObservationCoverage(observation) {
    return formatSourceCoverageSummary(observation?.sourceCoverage, { includeIgnored: false });
}

function formatSourceCoverageSummary(sourceCoverage, options = {}) {
    const parts = [];
    const passiveSurfaces = coverageSurfaces(sourceCoverage, "passive");
    const supplementalSurfaces = coverageSurfaces(sourceCoverage, "supplemental");
    const ignoredSurfaces = coverageSurfaces(sourceCoverage, "ignored");

    if (passiveSurfaces.length > 0) {
        parts.push(`Passive: ${formatObservedHostileList(passiveSurfaces)}`);
    }
    if (supplementalSurfaces.length > 0) {
        parts.push(`Supplemental: ${formatObservedHostileList(supplementalSurfaces)}`);
    }
    if (options.includeIgnored !== false && ignoredSurfaces.length > 0) {
        parts.push(`Ignored: ${formatObservedHostileList(ignoredSurfaces)}`);
    }

    return parts.length > 0 ? parts.join(" | ") : "No classified source coverage";
}

function formatCoverageList(sourceCoverage, key) {
    return formatObservedHostileList(coverageSurfaces(sourceCoverage, key), { fallback: "None" });
}

function coverageSurfaces(sourceCoverage, key) {
    const bucket = asRecord(asRecord(sourceCoverage)[key]);
    return Array.isArray(bucket.surfaces) ? bucket.surfaces.filter(Boolean) : [];
}

function systemObservationLabel(observation) {
    if (observation?.systemName) {
        return observation.systemName;
    }
    if (observation?.systemId) {
        return `System ${observation.systemId}`;
    }
    return "Unknown system";
}

function formatObservationWindow(observation) {
    const start = formatLocalInstant(observation?.startedAt, { fallback: "Unknown start" });
    const end = formatLocalInstant(observation?.endedAt, { fallback: "Unknown end" });
    return start === end ? start : `${start} to ${end}`;
}

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .split(/\s+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function describeReferenceCatalog(referenceCatalog) {
    const available = referenceCatalog?.available === true;
    if (!available) {
        return {
            available: false,
            label: "Unavailable",
            title: "Bundled hostile reference data is unavailable.",
        };
    }

    const packId = String(referenceCatalog.packId ?? "reference pack").trim();
    const version = String(referenceCatalog.version ?? "").trim();
    const entryCount = Number(referenceCatalog.entryCount ?? 0);
    return {
        available: true,
        label: version ? `${packId} ${version}` : packId,
        title: entryCount > 0
            ? `Bundled hostile baseline '${packId}' version ${version || "unknown"} contains ${entryCount} entries.`
            : `Bundled hostile baseline '${packId}' is available.`,
    };
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
