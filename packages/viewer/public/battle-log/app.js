const state = {
  snapshot: null,
  selectedLineNumber: null,
  detailsByLine: new Map(),
  refreshTimer: null,
  eventSource: null,
};

const FALLBACK_REFRESH_MS = 15000;

const elements = {
  feedPath: document.querySelector("#feed-path"),
  lastModified: document.querySelector("#last-modified"),
  eventCount: document.querySelector("#event-count"),
  viewerStatus: document.querySelector("#viewer-status"),
  lineLimit: document.querySelector("#line-limit"),
  autoRefresh: document.querySelector("#auto-refresh"),
  refreshButton: document.querySelector("#refresh-button"),
  eventList: document.querySelector("#event-list"),
  detailView: document.querySelector("#detail-view"),
};

elements.refreshButton.addEventListener("click", () => void refreshSnapshot());
elements.lineLimit.addEventListener("change", () => void refreshSnapshot());
elements.autoRefresh.addEventListener("change", updateRefreshLoop);

await refreshSnapshot();
updateRefreshLoop();

async function refreshSnapshot() {
  setStatus("Refreshing…");

  const limit = Number.parseInt(elements.lineLimit.value, 10) || 150;
  const response = await fetch(`/api/events?limit=${limit}&detail=summary`, { cache: "no-store" });
  const snapshot = await response.json();
  state.snapshot = snapshot;

  renderStatus(snapshot);
  renderEventList(snapshot);
  void renderSelectedEvent();
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
    setStatus("Paused");
    return;
  }

  if (window.EventSource) {
    state.eventSource = new EventSource("/api/events/stream");
    state.eventSource.addEventListener("open", () => markLiveUpdatesConnected());
    state.eventSource.addEventListener("ready", () => markLiveUpdatesConnected());
    state.eventSource.addEventListener("events-updated", () => void refreshSnapshot());
    state.eventSource.addEventListener("error", () => {
      setStatus("Live updates reconnecting...");
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

  setStatus("Live updates connected");
}

function ensureFallbackRefresh() {
  if (state.refreshTimer || !elements.autoRefresh.checked) {
    return;
  }

  state.refreshTimer = window.setInterval(() => {
    void refreshSnapshot();
  }, FALLBACK_REFRESH_MS);
}

function renderStatus(snapshot) {
  elements.feedPath.textContent = snapshot.feedPath ?? "Unknown";
  elements.lastModified.textContent = snapshot.lastModified ? formatDateTime(snapshot.lastModified) : "Waiting for feed file";
  elements.eventCount.textContent = `${snapshot.returnedLines ?? 0} / ${snapshot.totalLines ?? 0}`;
  setStatus(snapshot.ok ? "Live" : snapshot.error ?? "Unavailable");
}

function setStatus(text) {
  elements.viewerStatus.textContent = text;
}

function renderEventList(snapshot) {
  elements.eventList.textContent = "";

  if (!snapshot.ok || !Array.isArray(snapshot.events) || snapshot.events.length === 0) {
    elements.eventList.appendChild(renderEmpty(snapshot.error ?? "No events in feed yet."));
    state.selectedLineNumber = null;
    return;
  }

  if (!snapshot.events.some((entry) => entry.lineNumber === state.selectedLineNumber)) {
    state.selectedLineNumber = snapshot.events[0].lineNumber;
  }

  for (const entry of snapshot.events) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-card";
    if (entry.lineNumber === state.selectedLineNumber) {
      button.dataset.selected = "true";
    }

    const summary = entry.summary ?? { title: "Unknown event", subtitle: "", chips: [] };
    const chipMarkup = Array.isArray(summary.chips) ? summary.chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("") : "";

    button.innerHTML = `
      <div class="event-card__top">
        <strong>${escapeHtml(summary.title ?? "Unknown event")}</strong>
        <span class="line-badge">L${entry.lineNumber}</span>
      </div>
      <p>${escapeHtml(summary.subtitle ?? "")}</p>
      <div class="chip-row">${chipMarkup}</div>
      <time>${escapeHtml(summary.timestamp ? formatDateTime(summary.timestamp) : "No timestamp")}</time>
    `;

    button.addEventListener("click", () => {
      state.selectedLineNumber = entry.lineNumber;
      renderEventList(state.snapshot);
      void renderSelectedEvent();
    });

    elements.eventList.appendChild(button);
  }
}

async function renderSelectedEvent() {
  elements.detailView.textContent = "";

  if (!state.snapshot?.ok || !Array.isArray(state.snapshot.events)) {
    elements.detailView.appendChild(renderEmpty(state.snapshot?.error ?? "No event selected."));
    return;
  }

  const entry = state.snapshot.events.find((item) => item.lineNumber === state.selectedLineNumber);
  if (!entry) {
    elements.detailView.appendChild(renderEmpty("Select a feed event to inspect its payload."));
    return;
  }

  let detailEntry;
  try {
    detailEntry = await loadEntryDetail(entry);
  } catch (error) {
    elements.detailView.appendChild(renderEmpty(error instanceof Error ? error.message : "Unable to load event detail."));
    return;
  }

  if (state.selectedLineNumber !== entry.lineNumber) {
    return;
  }

  if (!detailEntry.parsed) {
    elements.detailView.innerHTML = `
      <section class="detail-panel">
        <h3>Unrecognized JSONL line</h3>
        <p>${escapeHtml(detailEntry.error ?? "Unknown parsing error")}</p>
      </section>
      <section class="detail-panel">
        <h3>Raw Line</h3>
        <pre>${escapeHtml(detailEntry.rawLine ?? detailEntry.rawPreview ?? "")}</pre>
      </section>
    `;
    return;
  }

  const event = detailEntry.event;
  const summaryRows = buildSummaryRows(event);
  const summaryTable = summaryRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");

  const battlePanels = event.type === "battle.report"
    ? renderBattlePanels(event)
    : event.type === "battle.capture"
      ? renderBattleCapturePanels(event)
      : event.type === "battle.analytics"
        ? renderBattleAnalyticsPanels(event)
        : event.type === "catalog.snapshot"
          ? renderCatalogSnapshotPanels(event)
          : "";

  elements.detailView.innerHTML = `
    <section class="detail-panel">
      <h3>Envelope</h3>
      <table class="detail-table">${summaryTable}</table>
    </section>
    ${battlePanels}
    <section class="detail-panel raw-panel">
      <h3>Raw JSON</h3>
      <pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre>
    </section>
  `;
}

async function loadEntryDetail(entry) {
  if (entry.event || !entry.parsed) {
    return entry;
  }

  const cached = state.detailsByLine.get(entry.lineNumber);
  if (cached) {
    return cached;
  }

  elements.detailView.appendChild(renderEmpty("Loading event detail..."));
  const response = await fetch(`/api/events/${entry.lineNumber}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.ok || !payload.event) {
    throw new Error(payload.error ?? `Unable to load line ${entry.lineNumber}.`);
  }

  state.detailsByLine.set(entry.lineNumber, payload.event);
  return payload.event;
}

function buildSummaryRows(event) {
  const rows = [
    ["Type", event.type],
    ["Timestamp", event.timestamp ?? ""],
    ["Source", event.source ?? ""],
  ];

  if (event.type === "battle.report") {
    rows.push(["Journal ID", event.journalId ?? ""]);
    rows.push(["Battle Type", `${event.battleType ?? ""}`]);
    rows.push(["Outcome", `${event.report?.summary?.outcome ?? ""}`]);
  }

  if (event.type === "battle.capture") {
    rows.push(["Journal ID", event.journalId ?? ""]);
    rows.push(["Battle Type", `${event.battleType ?? ""}`]);
    rows.push(["Source Kind", `${event.capture?.sourceKind ?? ""}`]);
    rows.push(["Token Count", `${event.capture?.battleLog?.tokens?.length ?? 0}`]);
  }

  if (event.type === "battle.analytics") {
    rows.push(["Journal ID", event.journalId ?? ""]);
    rows.push(["Battle Type", `${event.battleType ?? ""}`]);
    rows.push(["CSV Parity", `${event.analytics?.csvParity?.status ?? ""}`]);
  }

  if (event.type === "catalog.snapshot") {
    rows.push(["Journal ID", event.journalId ?? ""]);
    rows.push(["Battle Type", `${event.battleType ?? ""}`]);
    rows.push(["Scope", event.scope ?? ""]);
    rows.push(["Coverage", `${event.catalog?.coverage?.resolvedEntries ?? 0}/${event.catalog?.coverage?.totalEntries ?? 0}`]);
  }

  return rows.filter(([, value]) => value !== "");
}

function renderBattleAnalyticsPanels(event) {
  const analytics = asObject(event.analytics);
  const summary = asObject(analytics.summary);
  const csvParity = asObject(analytics.csvParity);
  const coverage = asObject(csvParity.coverage);
  const rows = asArray(csvParity.rows).filter(isObject);
  const notes = asArray(csvParity.notes).map((note) => String(note));
  const columns = buildDataColumns(csvParity.columns, rows, [
    "round",
    "battleEvent",
    "type",
    "attackerName",
    "targetName",
    "criticalHit",
    "hullDamage",
    "shieldDamage",
    "mitigatedDamage",
    "totalDamage",
    "identityStatus",
  ]);

  const summaryRows = renderDetailRows([
    ["Outcome", summary.outcome],
    ["Rounds", summary.roundCount],
    ["Reference", csvParity.reference],
    ["Status", csvParity.status],
    ["Attack Records", coverage.attackRecordCount],
    ["CSV Rows", coverage.csvParityRowCount ?? rows.length],
    ["Ability Rows", coverage.abilityRowCount],
    ["Catalog Resolved", coverage.catalogResolved],
  ]);

  const noteMarkup = notes.length > 0
    ? `<ul class="note-list">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : `<p class="detail-note">No analytics notes recorded.</p>`;

  return `
    <section class="detail-panel">
      <h3>Analytics Summary</h3>
      <table class="detail-table">${summaryRows}</table>
    </section>
    <section class="detail-panel">
      <h3>Prime CSV Parity Rows</h3>
      ${renderDataTable(rows, columns, "No parity rows recorded.")}
    </section>
    <section class="detail-panel">
      <h3>Analytics Notes</h3>
      ${noteMarkup}
    </section>
  `;
}

function renderCatalogSnapshotPanels(event) {
  const catalog = asObject(event.catalog);
  const coverage = asObject(catalog.coverage);
  const domains = asObject(catalog.domains);
  const domainRows = Object.entries(domains)
    .filter(([, entries]) => isObject(entries))
    .map(([domain, entries]) => summarizeCatalogDomain(domain, entries))
    .filter((row) => row.total > 0);
  const unresolvedRows = Object.entries(domains)
    .flatMap(([domain, entries]) => catalogEntriesFor(domain, entries))
    .filter((entry) => entry.unresolved);

  const coverageRows = renderDetailRows([
    ["Scope", event.scope],
    ["Total Entries", coverage.totalEntries],
    ["Resolved Entries", coverage.resolvedEntries],
    ["Domains Present", asArray(coverage.domainsPresent).join(", ")],
    ["Domains Resolved", asArray(coverage.domainsResolved).join(", ")],
    ["Domains Unresolved", asArray(coverage.domainsUnresolved).join(", ")],
  ]);

  return `
    <section class="detail-panel">
      <h3>Catalog Coverage</h3>
      <table class="detail-table">${coverageRows}</table>
    </section>
    <section class="detail-panel">
      <h3>Catalog Domains</h3>
      ${renderDataTable(domainRows, [
    { key: "domain", label: "Domain" },
    { key: "total", label: "Total" },
    { key: "resolved", label: "Resolved" },
    { key: "unresolved", label: "Unresolved" },
    { key: "examples", label: "Examples" },
  ], "No catalog domains recorded.")}
    </section>
    <section class="detail-panel">
      <h3>Unresolved Catalog Entries</h3>
      ${renderDataTable(unresolvedRows, [
    { key: "domain", label: "Domain" },
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
  ], "No unresolved catalog entries recorded.")}
    </section>
  `;
}

function renderBattleCapturePanels(event) {
  const capture = event.capture ?? {};
  const participants = Array.isArray(capture.participants) ? capture.participants : [];
  const tokens = Array.isArray(capture.battleLog?.tokens) ? capture.battleLog.tokens : [];
  const visibleTokens = tokens.slice(0, 300);
  const hiddenTokenCount = tokens.length - visibleTokens.length;

  const participantRows = participants.map((participant) => {
    const shipIds = Array.isArray(participant.shipIds) ? participant.shipIds.join(", ") : "";
    const hullIds = Array.isArray(participant.hullIds) ? participant.hullIds.join(", ") : "";
    return `
      <tr>
        <td>${escapeHtml(participant.side ?? "")}</td>
        <td>${escapeHtml(participant.displayName ?? participant.name ?? "")}</td>
        <td>${escapeHtml(participant.uid ?? "")}</td>
        <td>${escapeHtml(participant.participantKind ?? "")}</td>
        <td>${escapeHtml(shipIds)}</td>
        <td>${escapeHtml(hullIds)}</td>
      </tr>
    `;
  }).join("");

  const tokenRows = visibleTokens.map((token, index) => `
      <tr>
        <td>${index}</td>
        <td>${escapeHtml(token)}</td>
        <td>${escapeHtml(String(token).startsWith("-") ? "marker" : "value")}</td>
      </tr>
    `).join("");

  const truncationNote = hiddenTokenCount > 0 ? `<p>${hiddenTokenCount} additional tokens hidden in this view.</p>` : "";

  return `
    <section class="detail-panel">
      <h3>Capture Participants</h3>
      <table class="detail-table participant-table">
        <thead>
          <tr>
            <th>Side</th>
            <th>Display</th>
            <th>UID</th>
            <th>Kind</th>
            <th>Ship IDs</th>
            <th>Hull IDs</th>
          </tr>
        </thead>
        <tbody>${participantRows || `<tr><td colspan="6">No participants recorded.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="detail-panel">
      <h3>Battle Log Tokens</h3>
      ${truncationNote}
      <table class="detail-table token-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>Token</th>
            <th>Kind</th>
          </tr>
        </thead>
        <tbody>${tokenRows || `<tr><td colspan="3">No battle log tokens captured.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function renderBattlePanels(event) {
  const fleets = Array.isArray(event.report?.fleets) ? event.report.fleets : [];
  const rewards = Array.isArray(event.report?.rewards) ? event.report.rewards : [];

  const participantRows = fleets.map((fleet) => {
    const hulls = Array.isArray(fleet.hull_ids) ? fleet.hull_ids.join(", ") : "";
    return `
      <tr>
        <td>${escapeHtml(fleet.side ?? "")}</td>
        <td>${escapeHtml(fleet.display_name ?? fleet.name ?? "")}</td>
        <td>${escapeHtml(fleet.uid ?? "")}</td>
        <td>${escapeHtml(fleet.participant_kind ?? "")}</td>
        <td>${escapeHtml(fleet.display_name_source ?? "")}</td>
        <td>${escapeHtml(`${fleet.ship_level ?? ""}`)}</td>
        <td>${escapeHtml(hulls)}</td>
      </tr>
    `;
  }).join("");

  const rewardMarkup = rewards.length > 0
    ? rewards.map((reward) => `<li><strong>${escapeHtml(reward.kind ?? "reward")}</strong> ${escapeHtml(renderReward(reward))}</li>`).join("")
    : `<li>No rewards captured on this line.</li>`;

  return `
    <section class="detail-panel">
      <h3>Participants</h3>
      <table class="detail-table participant-table">
        <thead>
          <tr>
            <th>Side</th>
            <th>Display</th>
            <th>UID</th>
            <th>Kind</th>
            <th>Source</th>
            <th>Level</th>
            <th>Hull IDs</th>
          </tr>
        </thead>
        <tbody>${participantRows || `<tr><td colspan="7">No participants recorded.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="detail-panel">
      <h3>Rewards</h3>
      <ul class="reward-list">${rewardMarkup}</ul>
    </section>
  `;
}

function renderDetailRows(rows) {
  return rows
    .map(([label, value]) => [label, formatDetailValue(value)])
    .filter(([, value]) => value !== "")
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
}

function renderDataTable(rows, columns, emptyMessage, limit = 50) {
  if (!Array.isArray(rows) || rows.length === 0 || columns.length === 0) {
    return `<p class="detail-note">${escapeHtml(emptyMessage)}</p>`;
  }

  const visibleRows = rows.slice(0, limit);
  const hiddenCount = rows.length - visibleRows.length;
  const hiddenNote = hiddenCount > 0 ? `<p class="detail-note">${hiddenCount} additional rows hidden in this view.</p>` : "";
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = visibleRows.map((row) => `
    <tr>
    ${columns.map((column) => `<td>${escapeHtml(formatDetailValue(row[column.key]))}</td>`).join("")}
    </tr>
  `).join("");

  return `
  ${hiddenNote}
  <div class="detail-table-scroll">
    <table class="detail-table data-table">
    <thead><tr>${header}</tr></thead>
    <tbody>${body}</tbody>
    </table>
  </div>
  `;
}

function buildDataColumns(configuredColumns, rows, preferredKeys = []) {
  const configured = asArray(configuredColumns)
    .filter(isObject)
    .map((column) => ({ key: String(column.key ?? ""), label: String(column.label ?? column.key ?? "") }))
    .filter((column) => column.key !== "");

  if (configured.length > 0) {
    // Keep wide parity payloads readable by scrolling a bounded table instead of rendering every known column.
    return configured.slice(0, 12);
  }

  const keys = new Set();
  for (const key of preferredKeys) {
    if (rows.some((row) => Object.hasOwn(row, key))) {
      keys.add(key);
    }
  }

  for (const row of rows.slice(0, 10)) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }

  return [...keys].slice(0, 12).map((key) => ({ key, label: labelFromKey(key) }));
}

function summarizeCatalogDomain(domain, entries) {
  const catalogEntries = Object.values(entries).filter(isObject);
  const unresolved = catalogEntries.filter((entry) => entry.unresolved).length;
  const examples = catalogEntries
    .map((entry) => entry.name ?? entry.id)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return {
    domain,
    total: catalogEntries.length,
    resolved: catalogEntries.length - unresolved,
    unresolved,
    examples,
  };
}

function catalogEntriesFor(domain, entries) {
  if (!isObject(entries)) {
    return [];
  }

  return Object.values(entries)
    .filter(isObject)
    .map((entry) => ({
      domain,
      id: entry.id,
      name: entry.name ?? "",
      type: entry.type ?? "",
      unresolved: Boolean(entry.unresolved),
    }));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDetailValue(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function labelFromKey(key) {
  return String(key)
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (match) => match.toUpperCase());
}

function renderReward(reward) {
  if (reward.kind === "resource") {
    return `${reward.count ?? 0} of ${reward.resourceId ?? "unknown-resource"}`;
  }

  if (reward.kind === "chest") {
    return `${reward.count ?? 0} chest ${reward.nameKey ?? ""}`.trim();
  }

  return JSON.stringify(reward);
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
