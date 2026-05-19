import { createBridgeStatus } from "../shared/bridge-status.js";

const FALLBACK_REFRESH_MS = 15000;

const state = {
  snapshot: null,
  selectedLocalId: null,
  detailsById: new Map(),
  refreshTimer: null,
  eventSource: null,
};

const elements = {
  endpoint: document.querySelector("#endpoint"),
  acceptedCount: document.querySelector("#accepted-count"),
  storedCount: document.querySelector("#stored-count"),
  rejectedCount: document.querySelector("#rejected-count"),
  viewerStatus: document.querySelector("#viewer-status"),
  eventLimit: document.querySelector("#event-limit"),
  autoRefresh: document.querySelector("#auto-refresh"),
  refreshButton: document.querySelector("#refresh-button"),
  eventList: document.querySelector("#event-list"),
  detailView: document.querySelector("#detail-view"),
};

const bridgeStatus = createBridgeStatus(elements.viewerStatus);

elements.refreshButton.addEventListener("click", () => void refreshSnapshot({ announce: true }));
elements.eventLimit.addEventListener("change", () => void refreshSnapshot({ announce: true }));
elements.autoRefresh.addEventListener("change", updateRefreshLoop);

await refreshSnapshot({ announce: true });
updateRefreshLoop();

async function refreshSnapshot(options = {}) {
  bridgeStatus.begin(options.activityLabel ?? (options.announce ? "Refreshing" : "Checking"));

  try {
    const limit = Number.parseInt(elements.eventLimit.value, 10) || 150;
    const response = await fetch(`/api/majel/events?limit=${limit}`, { cache: "no-store" });
    const snapshot = await response.json();
    state.snapshot = snapshot;

    renderStatus(snapshot);
    renderEventList(snapshot);
    void renderSelectedDetail();

    if (response.ok && snapshot.ok) {
      bridgeStatus.finish({ paused: !elements.autoRefresh.checked });
      return;
    }

    bridgeStatus.disconnected(snapshot.error ?? "Unavailable");
  } catch {
    bridgeStatus.disconnected();
  }
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

  if (!elements.autoRefresh.checked) {
    bridgeStatus.off();
    return;
  }

  if (window.EventSource) {
    bridgeStatus.off("Opening");
    state.eventSource = new EventSource("/api/majel/stream");
    state.eventSource.addEventListener("open", () => markLiveUpdatesConnected());
    state.eventSource.addEventListener("ready", () => markLiveUpdatesConnected());
    state.eventSource.addEventListener("majel-updated", () => void refreshSnapshot({ announce: false, activityLabel: "Writing" }));
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
  if (state.refreshTimer || !elements.autoRefresh.checked) {
    return;
  }

  state.refreshTimer = window.setInterval(() => {
    void refreshSnapshot({ announce: false, activityLabel: "Checking" });
  }, FALLBACK_REFRESH_MS);
}

function renderStatus(snapshot) {
  elements.endpoint.textContent = snapshot.endpoint ?? "/api/majel/ingest";
  elements.acceptedCount.textContent = `${snapshot.totalEnvelopes ?? 0}`;
  elements.storedCount.textContent = `${snapshot.returnedEnvelopes ?? 0} / ${snapshot.storedEnvelopes ?? 0}`;
  elements.rejectedCount.textContent = lastRejectedLabel(snapshot);
}

function lastRejectedLabel(snapshot) {
  const count = snapshot.rejectedEnvelopes ?? 0;
  if (!count) {
    return "0";
  }

  const suffix = snapshot.lastRejectedAt ? `, last ${formatDateTime(snapshot.lastRejectedAt)}` : "";
  return `${count}${suffix}`;
}

function renderEventList(snapshot) {
  elements.eventList.textContent = "";

  if (!snapshot.ok || !Array.isArray(snapshot.events) || snapshot.events.length === 0) {
    state.selectedLocalId = null;
    elements.eventList.appendChild(renderEmpty(snapshot.lastRejectedError
      ? `No accepted envelopes yet. Last rejection: ${snapshot.lastRejectedError}`
      : "No Majel envelopes have been accepted yet."));
    return;
  }

  if (!state.selectedLocalId || !snapshot.events.some((entry) => entry.localId === state.selectedLocalId)) {
    state.selectedLocalId = snapshot.events[0].localId;
  }

  for (const entry of snapshot.events) {
    const summary = entry.summary ?? {};
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-card";
    button.dataset.selected = entry.localId === state.selectedLocalId ? "true" : "false";

    const chips = [
      ...(Array.isArray(summary.chips) ? summary.chips : []),
      `${entry.payloadBytes ?? 0} payload bytes`,
    ];
    button.innerHTML = `
      <div class="event-card__top">
        <strong>${escapeHtml(summary.title ?? "Unknown schema")}</strong>
        <span class="line-badge">M${entry.localId}</span>
      </div>
      <p>${escapeHtml(summary.subtitle ?? "")}</p>
      <div class="chip-row">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
      <time>${escapeHtml(entry.receivedAt ? formatDateTime(entry.receivedAt) : "No received time")}</time>
    `;

    button.addEventListener("click", () => {
      state.selectedLocalId = entry.localId;
      renderEventList(state.snapshot);
      void renderSelectedDetail();
    });

    elements.eventList.appendChild(button);
  }
}

async function renderSelectedDetail() {
  elements.detailView.textContent = "";
  if (!state.selectedLocalId) {
    elements.detailView.appendChild(renderEmpty("Select a Majel envelope to inspect its payload."));
    return;
  }

  const requestedLocalId = state.selectedLocalId;
  let detail = state.detailsById.get(requestedLocalId);
  if (!detail) {
    try {
      elements.detailView.appendChild(renderEmpty("Loading envelope detail..."));
      const response = await fetch(`/api/majel/events/${requestedLocalId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.event) {
        throw new Error(payload.error ?? "Unable to load Majel envelope.");
      }

      detail = payload.event;
      state.detailsById.set(requestedLocalId, detail);
    } catch (error) {
      elements.detailView.textContent = "";
      elements.detailView.appendChild(renderEmpty(error instanceof Error ? error.message : "Unable to load Majel envelope."));
      return;
    }
  }

  if (state.selectedLocalId !== requestedLocalId) {
    return;
  }

  renderDetail(detail);
}

function renderDetail(detail) {
  const envelope = detail.envelope ?? {};
  const rows = renderDetailRows([
    ["Protocol", envelope.protocolVersion],
    ["Schema", envelope.schema],
    ["Classification", envelope.classification],
    ["Event ID", envelope.eventId],
    ["Sequence", envelope.sequence],
    ["Observed", envelope.observedAt],
    ["Received", detail.receivedAt],
    ["Source", envelope.source],
    ["Source Version", envelope.sourceVersion],
    ["Install ID", envelope.installId],
    ["Session ID", envelope.sessionId],
    ["Envelope Bytes", detail.envelopeBytes],
    ["Payload Bytes", detail.payloadBytes],
  ]);

  elements.detailView.textContent = "";
  elements.detailView.innerHTML = `
    <section class="detail-panel">
      <h3>Envelope</h3>
      <table class="detail-table">${rows}</table>
    </section>
    <section class="detail-panel raw-panel">
      <h3>Payload JSON</h3>
      <pre>${escapeHtml(JSON.stringify(envelope.payload ?? {}, null, 2))}</pre>
    </section>
    <section class="detail-panel raw-panel">
      <h3>Raw Envelope JSON</h3>
      <pre>${escapeHtml(JSON.stringify(envelope, null, 2))}</pre>
    </section>
  `;
}

function renderDetailRows(rows) {
  return rows
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(formatDetailValue(value))}</td></tr>`)
    .join("");
}

function formatDetailValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function renderEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function formatDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
