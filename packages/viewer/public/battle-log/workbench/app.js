import { createBridgeStatus } from "../../shared/bridge-status.js";

const FALLBACK_REFRESH_MS = 15000;

const state = {
    snapshot: null,
    battleGroups: [],
    selectedBattleKey: null,
    selectedCombatantKey: null,
    detailsByLine: new Map(),
    refreshTimer: null,
    eventSource: null,
    lastReportHtml: "",
    lastBattleSelectKey: null,
};

const elements = {
    feedPath: document.querySelector("#feed-path"),
    eventCount: document.querySelector("#event-count"),
    battleCount: document.querySelector("#battle-count"),
    viewerStatus: document.querySelector("#viewer-status"),
    lineLimit: document.querySelector("#line-limit"),
    battleSelect: document.querySelector("#battle-select"),
    autoRefresh: document.querySelector("#auto-refresh"),
    refreshButton: document.querySelector("#refresh-button"),
    reportView: document.querySelector("#report-view"),
};

const bridgeStatus = createBridgeStatus(elements.viewerStatus);

elements.refreshButton.addEventListener("click", () => void refreshSnapshot({ activityLabel: "Refreshing" }));
elements.lineLimit.addEventListener("change", () => void refreshSnapshot({ activityLabel: "Refreshing" }));
elements.autoRefresh.addEventListener("change", updateRefreshLoop);
elements.battleSelect.addEventListener("change", () => {
    state.selectedBattleKey = elements.battleSelect.value;
    state.selectedCombatantKey = null;
    void renderReport();
});

await refreshSnapshot({ activityLabel: "Refreshing" });
updateRefreshLoop();

async function refreshSnapshot(options = {}) {
    bridgeStatus.begin(options.activityLabel ?? "Writing");

    try {
        const limit = Number.parseInt(elements.lineLimit.value, 10) || 200;
        const response = await fetch(`/api/events?limit=${limit}&detail=summary`, { cache: "no-store" });
        const snapshot = await response.json();

        state.snapshot = snapshot;
        state.battleGroups = buildBattleGroups(snapshot);

        if (!state.battleGroups.some((group) => group.key === state.selectedBattleKey)) {
            state.selectedBattleKey = state.battleGroups[0]?.key ?? null;
            state.selectedCombatantKey = null;
        }

        renderStatus(snapshot);
        renderBattleSelect();
        void renderReport();

        if (snapshot.ok) {
            bridgeStatus.finish({ paused: !elements.autoRefresh.checked });
        } else {
            bridgeStatus.disconnected(snapshot.error ?? "Unavailable");
        }
    } catch (error) {
        bridgeStatus.disconnected();
        elements.reportView.innerHTML = `<div class="empty-state">${escapeHtml(error instanceof Error ? error.message : "Unable to load battle feed.")}</div>`;
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
        state.eventSource = new EventSource("/api/events/stream");
        state.eventSource.addEventListener("open", () => markLiveUpdatesConnected());
        state.eventSource.addEventListener("ready", () => markLiveUpdatesConnected());
        state.eventSource.addEventListener("events-updated", () => void refreshSnapshot({ activityLabel: "Writing" }));
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
        void refreshSnapshot({ activityLabel: "Checking" });
    }, FALLBACK_REFRESH_MS);
}

function renderStatus(snapshot) {
    elements.feedPath.textContent = dataSourceLabel(snapshot);
    elements.eventCount.textContent = `${snapshot.returnedLines ?? 0} / ${snapshot.totalLines ?? 0}`;
    elements.battleCount.textContent = `${state.battleGroups.length}`;
}

function dataSourceLabel(snapshot) {
    if (snapshot?.source === "store") {
        return `${snapshot.storageBackend ?? "local"} event store`;
    }

    if (snapshot?.feedPath) {
        return snapshot.feedPath;
    }

    return "Local sidecar data layer";
}

function buildBattleGroups(snapshot) {
    if (!snapshot?.ok || !Array.isArray(snapshot.events)) {
        return [];
    }

    const groups = new Map();

    for (const entry of snapshot.events) {
        if (!entry.parsed) {
            continue;
        }

        const eventType = entryEventType(entry);
        if (!eventType.startsWith("battle.") && eventType !== "catalog.snapshot") {
            continue;
        }

        const hydratedEntry = state.detailsByLine.get(entry.lineNumber) ?? entry;
        const key = entryBattleKey(hydratedEntry);
        const group = groups.get(key) ?? {
            key,
            lineNumber: entry.lineNumber,
            entries: [],
            title: entry.summary?.title ?? `Battle ${key}`,
            timestamp: entry.timestamp ?? entry.summary?.timestamp ?? "",
            captureEntry: null,
            reportEntry: null,
            analyticsEntry: null,
            catalogEntry: null,
        };

        group.entries.push(hydratedEntry);
        group.lineNumber = Math.max(group.lineNumber, entry.lineNumber);
        group.title = entry.summary?.title ?? group.title;
        group.timestamp = entry.timestamp ?? entry.summary?.timestamp ?? group.timestamp;

        if (eventType === "battle.capture" && (!group.captureEntry || hydratedEntry.lineNumber > group.captureEntry.lineNumber)) {
            group.captureEntry = hydratedEntry;
        }

        if (eventType === "battle.report" && (!group.reportEntry || hydratedEntry.lineNumber > group.reportEntry.lineNumber)) {
            group.reportEntry = hydratedEntry;
        }

        if (eventType === "battle.analytics" && (!group.analyticsEntry || hydratedEntry.lineNumber > group.analyticsEntry.lineNumber)) {
            group.analyticsEntry = hydratedEntry;
        }

        if (eventType === "catalog.snapshot" && (!group.catalogEntry || hydratedEntry.lineNumber > group.catalogEntry.lineNumber)) {
            group.catalogEntry = hydratedEntry;
        }

        groups.set(key, group);
    }

    return [...groups.values()].sort((left, right) => right.lineNumber - left.lineNumber);
}

function entryEventType(entry) {
    return String(entry.event?.type ?? entry.eventType ?? "");
}

function entryBattleKey(entry) {
    return String(entry.event?.battleId ?? entry.battleId ?? entry.event?.journalId ?? entry.journalId ?? `line-${entry.lineNumber}`);
}

function renderBattleSelect() {
    const previousValue = elements.battleSelect.value;
    const desiredValue = state.selectedBattleKey ?? "";
    const signature = state.battleGroups.map((group) => group.key).join("|");

    if (signature === state.lastBattleSelectKey && elements.battleSelect.value === desiredValue) {
        return;
    }

    elements.battleSelect.textContent = "";

    if (state.battleGroups.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No battles";
        elements.battleSelect.appendChild(option);
        elements.battleSelect.disabled = true;
        state.lastBattleSelectKey = signature;
        return;
    }

    elements.battleSelect.disabled = false;

    for (const group of state.battleGroups) {
        const option = document.createElement("option");
        option.value = group.key;
        option.textContent = `${formatDateTime(group.timestamp)} | ${group.title}`;
        option.selected = group.key === state.selectedBattleKey;
        elements.battleSelect.appendChild(option);
    }

    if (previousValue && state.battleGroups.some((group) => group.key === previousValue)) {
        elements.battleSelect.value = previousValue;
    }

    state.lastBattleSelectKey = signature;
}

async function renderReport() {
    if (!state.snapshot?.ok) {
        const html = `<div class="empty-state">${escapeHtml(state.snapshot?.error ?? "No battle feed available.")}</div>`;
        if (html !== state.lastReportHtml) {
            elements.reportView.innerHTML = html;
            state.lastReportHtml = html;
        }
        return;
    }

    const group = state.battleGroups.find((item) => item.key === state.selectedBattleKey);
    if (!group) {
        const html = `<div class="empty-state">No battle events found in the selected line window.</div>`;
        if (html !== state.lastReportHtml) {
            elements.reportView.innerHTML = html;
            state.lastReportHtml = html;
        }
        return;
    }

    const selectedBattleKey = state.selectedBattleKey;
    if (group.entries.some((entry) => entry.parsed && !entry.event)) {
        const html = `<div class="empty-state">Loading selected battle detail...</div>`;
        if (html !== state.lastReportHtml) {
            elements.reportView.innerHTML = html;
            state.lastReportHtml = html;
        }

        try {
            await hydrateBattleGroup(group);
        } catch (error) {
            const errorHtml = `<div class="empty-state">${escapeHtml(error instanceof Error ? error.message : "Unable to load selected battle detail.")}</div>`;
            elements.reportView.innerHTML = errorHtml;
            state.lastReportHtml = errorHtml;
            return;
        }

        if (state.selectedBattleKey !== selectedBattleKey) {
            return;
        }

        renderBattleSelect();
    }

    const model = buildReportModel(group);
    const selectedCombatant = model.combatants.find((item) => item.key === state.selectedCombatantKey) ?? model.combatants[0] ?? null;
    state.selectedCombatantKey = selectedCombatant?.key ?? null;

    const html = `
    ${renderBattleDetails(model)}
    ${renderFleetComparison(model)}
    ${renderSignalUptime(model)}
    ${renderCatalogSnapshot(model)}
    ${renderCsvParity(model)}
    ${renderCombatantChooser(model, selectedCombatant)}
    ${renderCombatantDetail(model, selectedCombatant)}
    ${renderDataDive(model)}
  `;

    if (html === state.lastReportHtml) {
        return;
    }

    const scrollSnapshot = new Map();
    for (const node of elements.reportView.querySelectorAll("[data-scroll-key]")) {
        scrollSnapshot.set(node.dataset.scrollKey, { left: node.scrollLeft, top: node.scrollTop });
    }
    const focusedCombatantKey = document.activeElement instanceof HTMLElement
        && elements.reportView.contains(document.activeElement)
        && document.activeElement.matches("[data-combatant-key]")
        ? document.activeElement.getAttribute("data-combatant-key")
        : null;
    const windowScroll = { x: window.scrollX, y: window.scrollY };

    elements.reportView.innerHTML = html;
    state.lastReportHtml = html;

    for (const node of elements.reportView.querySelectorAll("[data-scroll-key]")) {
        const saved = scrollSnapshot.get(node.dataset.scrollKey);
        if (saved) {
            node.scrollLeft = saved.left;
            node.scrollTop = saved.top;
        }
    }
    if (window.scrollX !== windowScroll.x || window.scrollY !== windowScroll.y) {
        window.scrollTo(windowScroll.x, windowScroll.y);
    }

    for (const button of elements.reportView.querySelectorAll("[data-combatant-key]")) {
        button.addEventListener("click", () => {
            state.selectedCombatantKey = button.getAttribute("data-combatant-key");
            void renderReport();
        });
    }

    if (focusedCombatantKey) {
        const restored = elements.reportView.querySelector(`[data-combatant-key="${cssEscapeAttr(focusedCombatantKey)}"]`);
        restored?.focus?.({ preventScroll: true });
    }
}

async function hydrateBattleGroup(group) {
    group.entries = await Promise.all(group.entries.map((entry) => loadEntryDetail(entry)));
    group.captureEntry = null;
    group.reportEntry = null;
    group.analyticsEntry = null;
    group.catalogEntry = null;

    for (const entry of group.entries) {
        const eventType = entryEventType(entry);
        if (eventType === "battle.capture" && (!group.captureEntry || entry.lineNumber > group.captureEntry.lineNumber)) {
            group.captureEntry = entry;
        }
        if (eventType === "battle.report" && (!group.reportEntry || entry.lineNumber > group.reportEntry.lineNumber)) {
            group.reportEntry = entry;
        }
        if (eventType === "battle.analytics" && (!group.analyticsEntry || entry.lineNumber > group.analyticsEntry.lineNumber)) {
            group.analyticsEntry = entry;
        }
        if (eventType === "catalog.snapshot" && (!group.catalogEntry || entry.lineNumber > group.catalogEntry.lineNumber)) {
            group.catalogEntry = entry;
        }
    }
}

async function loadEntryDetail(entry) {
    if (entry.event || !entry.parsed) {
        return entry;
    }

    const cached = state.detailsByLine.get(entry.lineNumber);
    if (cached) {
        return cached;
    }

    const response = await fetch(`/api/events/${entry.lineNumber}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.event) {
        throw new Error(payload.error ?? `Unable to load line ${entry.lineNumber}.`);
    }

    state.detailsByLine.set(entry.lineNumber, payload.event);
    return payload.event;
}

function buildReportModel(group) {
    const reportEvent = group.reportEntry?.event ?? null;
    const captureEvent = group.captureEntry?.event ?? null;
    const analyticsEvent = group.analyticsEntry?.event ?? null;
    const catalogEvent = group.catalogEntry?.event ?? null;
    const report = reportEvent?.report ?? {};
    const capture = captureEvent?.capture ?? {};
    const analytics = analyticsEvent?.analytics ?? report.analytics ?? {};
    const catalog = buildCatalogIndex(catalogEvent?.catalog ?? null);
    const csvParity = analytics.csvParity ?? report.csvParity ?? {};
    const summary = report.summary ?? analytics.summary ?? capture.summary ?? {};
    const timestamp = reportEvent?.timestamp ?? analyticsEvent?.timestamp ?? captureEvent?.timestamp ?? summary.battleTime ?? "";
    const combatants = normalizeCombatants(report.fleets, capture.participants);
    const segments = Array.isArray(report.events) ? report.events : [];
    const rounds = Array.isArray(report.rounds) ? report.rounds : Array.isArray(analytics.rounds) ? analytics.rounds : [];
    const attackRows = Array.isArray(report.attackRows) ? report.attackRows : Array.isArray(analytics.attackRows) ? analytics.attackRows : [];
    const csvParityRows = applyCatalogToCsvRows(Array.isArray(csvParity.rows) ? csvParity.rows : [], catalog);
    const csvParityColumns = Array.isArray(csvParity.columns) ? csvParity.columns : inferCsvParityColumns(csvParityRows);
    const csvParityCoverage = csvParity.coverage ?? {};
    const csvParityNotes = Array.isArray(csvParity.notes) ? csvParity.notes : [];
    const rewards = Array.isArray(report.rewards) ? report.rewards : [];
    const signature = report.decode?.signature ?? deriveCaptureSignature(capture);
    const markerHints = report.decode?.markerHints ?? {};
    const tokenCount = Number(signature?.token_count ?? signature?.tokenCount ?? capture.battleLog?.tokens?.length ?? 0);
    const segmentCount = Number(signature?.segment_count ?? signature?.segmentCount ?? segments.length);
    const title = buildBattleTitle(summary, combatants);

    return {
        key: group.key,
        title,
        timestamp,
        lineNumber: group.lineNumber,
        reportEvent,
        captureEvent,
        analyticsEvent,
        catalogEvent,
        catalog,
        summary,
        combatants,
        segments,
        rounds,
        attackRows,
        csvParity,
        csvParityRows,
        csvParityColumns,
        csvParityCoverage,
        csvParityNotes,
        rewards,
        signature,
        markerHints,
        tokenCount,
        segmentCount,
        entries: group.entries,
        parityNotes: [
            ...(Array.isArray(report.parity?.notes) ? report.parity.notes : []),
            ...csvParityNotes,
        ],
    };
}

function normalizeCombatants(reportFleets, captureParticipants) {
    const source = Array.isArray(reportFleets) && reportFleets.length > 0
        ? reportFleets.map((fleet) => ({ source: "report", value: fleet }))
        : Array.isArray(captureParticipants)
            ? captureParticipants.map((participant) => ({ source: "capture", value: participant }))
            : [];

    return source.map(({ source: sourceKind, value }, index) => {
        const shipIds = arrayFrom(value.ship_ids ?? value.shipIds);
        const hullIds = arrayFrom(value.hull_ids ?? value.hullIds);
        const componentIds = arrayFrom(value.component_ids ?? value.componentIds);
        const displayName = value.display_name ?? value.displayName ?? value.name ?? value.uid ?? `Combatant ${index + 1}`;
        const side = value.side ?? (index === 0 ? "initiator" : "target");

        return {
            key: String(value.uid ?? value.fleet_id ?? value.fleetId ?? shipIds[0] ?? `${side}-${index}`),
            sourceKind,
            side,
            displayName,
            name: value.name ?? displayName,
            uid: value.uid ?? "",
            participantKind: value.participant_kind ?? value.participantKind ?? "",
            displayNameSource: value.display_name_source ?? value.displayNameSource ?? "",
            level: value.ship_level ?? value.shipLevel ?? "",
            offense: numberOrNull(value.offense_rating ?? value.offenseRating),
            defense: numberOrNull(value.defense_rating ?? value.defenseRating),
            officer: numberOrNull(value.officer_rating ?? value.officerRating),
            shipIds,
            hullIds,
            componentIds,
            allianceName: value.alliance_name ?? value.allianceName ?? "",
            allianceTag: value.alliance_tag ?? value.allianceTag ?? "",
        };
    });
}

function renderBattleDetails(model) {
    const summary = model.summary;
    const outcome = formatOutcome(summary.outcome ?? (summary.initiatorWins === true ? "initiator_victory" : ""));
    const rounds = model.rounds.length || summary.roundCount || model.reportEvent?.report?.roundCount || "Pending";
    const armada = summary.battleType === 4 || model.reportEvent?.battleType === 4 ? "Yes" : "No";
    const combatantCards = model.combatants.map((combatant) => renderCombatantCard(combatant, model)).join("");
    const rewardMarkup = model.rewards.length > 0
        ? model.rewards.map((reward) => `<span class="report-pill"><span>${escapeHtml(rewardLabel(reward))}</span><strong>${escapeHtml(rewardValue(reward))}</strong></span>`).join("")
        : `<span class="report-pill report-pill--muted">No rewards captured</span>`;

    return `
    <section class="report-band battle-details-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Battle Details</p>
          <h2>${escapeHtml(model.title)}</h2>
        </div>
        <span class="line-badge">L${model.lineNumber}</span>
      </div>
      <div class="battle-details-layout">
        <aside class="battle-meta">
          ${renderMetric("Outcome", outcome, outcome.toLowerCase().includes("victory") ? "positive" : "")}
          ${renderMetric("Rounds", rounds)}
          ${renderMetric("Segments", model.segmentCount || model.segments.length || "Pending")}
          ${renderMetric("Armada", armada)}
          ${renderMetric("Battle ID", model.key)}
          ${renderMetric("Time", formatDateTime(model.timestamp))}
        </aside>
        <div class="combatant-grid">${combatantCards || `<div class="empty-state">No combatants captured.</div>`}</div>
      </div>
      <div class="reward-row" aria-label="rewards">${rewardMarkup}</div>
    </section>
  `;
}

function renderCombatantCard(combatant, model) {
    const maxOffense = Math.max(1, ...model.combatants.map((item) => item.offense ?? 0));
    const maxDefense = Math.max(1, ...model.combatants.map((item) => item.defense ?? 0));
    const result = combatant.side === "initiator" && isInitiatorVictory(model.summary)
        ? "Winner"
        : combatant.side === "target" && isInitiatorVictory(model.summary)
            ? "Defeated"
            : "Captured";

    return `
    <article class="combatant-card combatant-card--${escapeAttribute(normalizeClassName(combatant.side))}">
      <div class="combatant-card__top">
        <span>${escapeHtml(combatant.sideLabel ?? titleCase(combatant.side))}</span>
        <strong>${escapeHtml(combatant.level ? `Lvl ${combatant.level}` : combatant.participantKind || "Ship")}</strong>
      </div>
      <h3>${escapeHtml(combatant.displayName)}</h3>
      <div class="combatant-subtitle">${escapeHtml(combatant.uid || combatant.participantKind || combatant.displayNameSource || "Unknown UID")}</div>
      <div class="stat-bars">
        ${renderStatBar("Offense", combatant.offense, maxOffense, "offense")}
        ${renderStatBar("Defense", combatant.defense, maxDefense, "defense")}
      </div>
      <div class="combatant-card__footer">
        <span>${escapeHtml(result)}</span>
        <span>${escapeHtml(combatant.shipIds.length ? `${combatant.shipIds.length} ship ref` : "No ship ref")}</span>
      </div>
    </article>
  `;
}

function renderFleetComparison(model) {
    const rows = model.combatants.map((combatant) => `
      <tr>
        <td><strong>${escapeHtml(combatant.displayName)}</strong><span>${escapeHtml(titleCase(combatant.side))}</span></td>
        <td class="numeric">${escapeHtml(formatCompact(combatant.offense))}</td>
        <td class="numeric">${escapeHtml(formatCompact(combatant.defense))}</td>
        <td class="numeric">${escapeHtml(formatCompact(combatant.officer))}</td>
        <td class="numeric">${escapeHtml(String(combatant.componentIds.length || "--"))}</td>
        <td>${escapeHtml(combatant.hullIds.join(", ") || "--")}</td>
        <td>${escapeHtml(combatant.displayNameSource || combatant.sourceKind)}</td>
      </tr>
    `).join("");

    return `
    <section class="report-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Fleet Stats</p>
          <h2>Combatant Comparison</h2>
        </div>
      </div>
      <div class="table-scroll" data-scroll-key="fleet-stats">
        <table class="report-table">
          <thead>
            <tr>
              <th>Ship Name</th>
              <th class="numeric">Offense</th>
              <th class="numeric">Defense</th>
              <th class="numeric">Officer</th>
              <th class="numeric">Components</th>
              <th>Hull IDs</th>
              <th>Name Source</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7">No fleet stats captured.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSignalUptime(model) {
    const hints = Object.entries(model.markerHints);
    const markerRows = hints.length > 0
        ? hints.map(([marker, label]) => `
          <tr>
            <td><strong>${escapeHtml(marker)}</strong></td>
            <td>${escapeHtml(label)}</td>
            <td class="numeric">${escapeHtml(String(countSegmentsWithMarker(model.segments, Number(marker))))}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="3">No marker hints captured.</td></tr>`;

    return `
    <section class="report-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Decode Signals</p>
          <h2>Marker Inventory</h2>
        </div>
      </div>
      <div class="signal-layout">
        <div class="mitigation-chain" aria-label="decode signature">
          ${renderChainItem("Tokens", model.tokenCount)}
          ${renderChainItem("Integers", model.signature?.integer_count)}
          ${renderChainItem("Floats", model.signature?.float_count)}
          ${renderChainItem("Zeroes", model.signature?.zero_count)}
          ${renderChainItem("Segments", model.segmentCount || model.segments.length)}
        </div>
        <div class="table-scroll" data-scroll-key="marker-inventory">
          <table class="report-table report-table--compact">
            <thead><tr><th>Marker</th><th>Current Meaning</th><th class="numeric">Segments</th></tr></thead>
            <tbody>${markerRows}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderCsvParity(model) {
    const rows = model.csvParityRows;
    const columns = model.csvParityColumns;
    const coverage = model.csvParityCoverage ?? {};
    const visibleRows = rows.slice(0, 150);
    const header = columns.map((column) => `<th>${escapeHtml(column.label ?? column.key ?? "Field")}</th>`).join("");
    const body = visibleRows.map((row) => renderCsvParityTableRow(row, columns)).join("");
    const sourceLabel = model.analyticsEvent ? "battle.analytics" : model.reportEvent?.report?.csvParity ? "battle.report" : "pending";

    return `
    <section class="report-band csv-parity-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Prime CSV Parity</p>
          <h2>Battle Events</h2>
        </div>
        <span class="line-badge">${escapeHtml(sourceLabel)}</span>
      </div>
      <div class="metric-grid metric-grid--inline">
        ${renderMetric("Rows", rows.length || "--")}
        ${renderMetric("Attack Records", coverage.attackRecordCount ?? "--")}
        ${renderMetric("Ability Rows", coverage.abilityRowCount ?? "--")}
        ${renderMetric("Catalog", coverage.catalogResolved === true ? "Resolved" : "Pending")}
      </div>
      <div class="table-scroll table-scroll--tall" data-scroll-key="csv-parity">
        <table class="report-table report-table--compact report-table--wide">
          <thead><tr>${header || `<th>Battle Event</th>`}</tr></thead>
          <tbody>${body || `<tr><td colspan="${Math.max(1, columns.length)}">No Prime CSV parity rows captured for this battle yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCsvParityTableRow(row, columns) {
    return `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? "--")}</td>`).join("")}</tr>`;
}

function buildCatalogIndex(rawCatalog) {
    const empty = {
        present: false,
        domains: {},
        coverage: { domainsPresent: [], domainsResolved: [], domainsUnresolved: [], totalEntries: 0, resolvedEntries: 0 },
    };
    if (!rawCatalog || typeof rawCatalog !== "object") {
        return empty;
    }

    const domains = rawCatalog.domains && typeof rawCatalog.domains === "object" ? rawCatalog.domains : {};
    const coverage = rawCatalog.coverage && typeof rawCatalog.coverage === "object"
        ? {
            domainsPresent: Array.isArray(rawCatalog.coverage.domainsPresent) ? rawCatalog.coverage.domainsPresent : [],
            domainsResolved: Array.isArray(rawCatalog.coverage.domainsResolved) ? rawCatalog.coverage.domainsResolved : [],
            domainsUnresolved: Array.isArray(rawCatalog.coverage.domainsUnresolved) ? rawCatalog.coverage.domainsUnresolved : [],
            totalEntries: Number(rawCatalog.coverage.totalEntries ?? 0),
            resolvedEntries: Number(rawCatalog.coverage.resolvedEntries ?? 0),
        }
        : empty.coverage;

    const lookup = (domain, id) => {
        if (!id && id !== 0) return null;
        const key = String(id);
        const bucket = domains[domain];
        if (!bucket || typeof bucket !== "object") return null;
        return bucket[key] ?? null;
    };

    return {
        present: true,
        domains,
        coverage,
        lookup,
        nameOf(domain, id) {
            const entry = lookup(domain, id);
            if (!entry) return null;
            return typeof entry.name === "string" && entry.name.length > 0 ? entry.name : null;
        },
    };
}

function renderCatalogSnapshot(model) {
    if (!model.catalog?.present) {
        return `
    <section class="report-band catalog-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Catalog Snapshot</p>
          <h2>Names &harr; IDs</h2>
        </div>
        <span class="line-badge">pending</span>
      </div>
      <div class="empty-state">No catalog.snapshot event has been emitted for this battle yet. The mod publishes one between battle.report and battle.analytics. Once present, IDs in the parity table will resolve to localized names.</div>
    </section>`;
    }

    const coverage = model.catalog.coverage;
    const domains = model.catalog.domains;
    const orderedDomains = ["hulls", "ships", "components", "resources", "systems", "officers", "abilities", "forbiddenTech", "buffs", "debuffs", "players", "alliances"];
    const cards = orderedDomains
        .filter((name) => domains[name] && Object.keys(domains[name]).length > 0)
        .map((name) => {
            const bucket = domains[name];
            const entries = Object.values(bucket);
            const resolved = entries.filter((e) => !e.unresolved).length;
            const sample = entries.slice(0, 4).map((e) => {
                const label = e.name ? escapeHtml(e.name) : `<span class="muted">${escapeHtml(String(e.id))}</span>`;
                const idHint = e.name ? ` <span class="muted">#${escapeHtml(String(e.id))}</span>` : "";
                return `<li>${label}${idHint}</li>`;
            }).join("");
            const more = entries.length > 4 ? `<li class="muted">+${entries.length - 4} more</li>` : "";
            return `
      <article class="catalog-domain-card">
        <header>
          <h3>${escapeHtml(formatDomainLabel(name))}</h3>
          <span class="line-badge">${resolved} / ${entries.length}</span>
        </header>
        <ul class="catalog-entry-list">${sample}${more}</ul>
      </article>`;
        }).join("");

    return `
    <section class="report-band catalog-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Catalog Snapshot</p>
          <h2>Names &harr; IDs</h2>
        </div>
        <span class="line-badge">catalog.snapshot</span>
      </div>
      <div class="metric-grid metric-grid--inline">
        ${renderMetric("Domains Present", coverage.domainsPresent.length || "--")}
        ${renderMetric("Resolved Entries", coverage.resolvedEntries ?? "--")}
        ${renderMetric("Total Entries", coverage.totalEntries ?? "--")}
        ${renderMetric("Unresolved Domains", coverage.domainsUnresolved.length || "0")}
      </div>
      <div class="catalog-domain-grid">${cards || `<div class="empty-state">Catalog event present but no domains carried IDs.</div>`}</div>
    </section>
  `;
}

function formatDomainLabel(name) {
    switch (name) {
        case "forbiddenTech": return "Forbidden Tech";
        default: return name.charAt(0).toUpperCase() + name.slice(1);
    }
}

function applyCatalogToCsvRows(rows, catalog) {
    if (!catalog?.present || !Array.isArray(rows) || rows.length === 0) {
        return rows;
    }

    const placeholderShipPattern = /^(Hull|Ship)#(\d+)$/;
    const shipFields = ["attackerShip", "targetShip"];

    return rows.map((row) => {
        if (!row || typeof row !== "object") return row;
        const next = { ...row };

        for (const field of shipFields) {
            const cell = next[field];
            if (typeof cell !== "string") continue;
            const match = placeholderShipPattern.exec(cell);
            if (!match) continue;
            const [, kind, id] = match;
            const domain = kind === "Hull" ? "hulls" : "ships";
            const name = catalog.nameOf(domain, id);
            if (name) {
                next[field] = name;
            }
        }

        return next;
    });
}

function renderCombatantChooser(model, selectedCombatant) {
    const buttons = model.combatants.map((combatant) => {
        const selected = combatant.key === selectedCombatant?.key ? "true" : "false";
        return `<button type="button" data-combatant-key="${escapeAttribute(combatant.key)}" aria-pressed="${selected}" class="combatant-tab">${escapeHtml(combatant.displayName)}</button>`;
    }).join("");

    return `
    <section class="combatant-tabs-band" aria-label="select combatant">
      <p class="eyebrow">Select Combatant</p>
      <div class="combatant-tabs">${buttons}</div>
    </section>
  `;
}

function renderCombatantDetail(model, combatant) {
    if (!combatant) {
        return "";
    }

    const relatedSegments = model.segments.filter((segment) => segmentReferencesCombatant(segment, combatant));
    const csvRows = model.csvParityRows.filter((row) => csvRowReferencesCombatant(row, combatant));
    const attackRows = model.attackRows.filter((row) => rowReferencesCombatant(row, combatant));
    const visibleRows = attackRows.length > 0 ? attackRows : relatedSegments;
    const perAttackRows = csvRows.length > 0
        ? csvRows.slice(0, 80).map(renderCombatantCsvRow).join("")
        : visibleRows.slice(0, 80).map((row, index) => renderAttackCandidateRow(row, index, attackRows.length > 0)).join("");
    const usingCsvRows = csvRows.length > 0;

    return `
    <section class="report-band combatant-detail-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">${escapeHtml(titleCase(combatant.side))}</p>
          <h2>${escapeHtml(combatant.displayName)}</h2>
        </div>
      </div>
      <div class="combatant-analysis-grid">
        <article class="metric-grid">
          ${renderMetric("Total Offense", formatCompact(combatant.offense))}
          ${renderMetric("Total Defense", formatCompact(combatant.defense))}
          ${renderMetric("Officer Rating", formatCompact(combatant.officer))}
          ${renderMetric("Components", combatant.componentIds.length || "--")}
          ${renderMetric("Ship IDs", combatant.shipIds.join(", ") || "--")}
          ${renderMetric("Hull IDs", combatant.hullIds.join(", ") || "--")}
        </article>
        <article class="firing-pattern-panel">
          <h3>Firing Pattern</h3>
          ${renderFiringPattern(model, combatant)}
        </article>
      </div>
      <div class="report-subsection-heading">
        <h3>Weapon Details</h3>
        <span>${escapeHtml(usingCsvRows ? "Prime CSV parity rows" : attackRows.length > 0 ? "attack rows" : "decoded segment candidates")}</span>
      </div>
      <div class="table-scroll table-scroll--tall" data-scroll-key="combatant-weapons">
        <table class="report-table report-table--compact">
          ${usingCsvRows ? `
          <thead>
            <tr>
              <th>Round</th>
              <th>Type</th>
              <th>Attacker</th>
              <th>Target</th>
              <th class="numeric">Hull</th>
              <th class="numeric">Shield</th>
              <th class="numeric">Mitigated</th>
              <th>Critical</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>${perAttackRows || `<tr><td colspan="9">No related Prime CSV parity rows captured.</td></tr>`}</tbody>` : `
          <thead>
            <tr>
              <th>Round</th>
              <th>Sub-Round</th>
              <th>Token Range</th>
              <th class="numeric">Length</th>
              <th>Ship Refs</th>
              <th>Component Refs</th>
              <th>Markers</th>
            </tr>
          </thead>
          <tbody>${perAttackRows || `<tr><td colspan="7">No related segment candidates captured.</td></tr>`}</tbody>`}
        </table>
      </div>
    </section>
  `;
}

function renderFiringPattern(model, combatant) {
    const rows = [
        { label: "Round Start", marker: -96 },
        { label: "Segment", marker: -90 },
        { label: "Combatant Ref", marker: -88 },
        { label: "Component Ref", marker: -98 },
        { label: "Record End", marker: -99 },
    ];
    const segments = model.segments.filter((segment) => segmentReferencesCombatant(segment, combatant)).slice(0, 16);
    const headings = segments.map((segment) => `<th>${escapeHtml(String((segment.index ?? 0) + 1))}</th>`).join("");
    const body = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        ${segments.map((segment) => `<td>${arrayFrom(segment.markers).includes(row.marker) ? "1" : "--"}</td>`).join("")}
      </tr>
    `).join("");

    if (segments.length === 0) {
        return `<div class="empty-state">No segment markers available for this combatant.</div>`;
    }

    return `
    <div class="table-scroll firing-pattern-scroll" data-scroll-key="firing-pattern">
      <table class="firing-pattern-table">
        <thead><tr><th>Signal</th>${headings}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderDataDive(model) {
    const firstTokens = arrayFrom(model.signature?.first_tokens ?? model.captureEvent?.event?.capture?.battleLog?.tokens?.slice?.(0, 12));
    const lastTokens = arrayFrom(model.signature?.last_tokens ?? model.captureEvent?.event?.capture?.battleLog?.tokens?.slice?.(-12));
    const parityNotes = model.parityNotes.length > 0
        ? model.parityNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
        : `<li>Semantic analyzer output is still represented as decoded segments when attack rows are unavailable.</li>`;

    return `
    <section class="report-band data-dive-band">
      <div class="report-band__heading">
        <div>
          <p class="eyebrow">Data Dive</p>
          <h2>Source Evidence</h2>
        </div>
      </div>
      <div class="data-dive-grid">
        <article>
          <h3>First Tokens</h3>
          <pre>${escapeHtml(firstTokens.join(", "))}</pre>
        </article>
        <article>
          <h3>Last Tokens</h3>
          <pre>${escapeHtml(lastTokens.join(", "))}</pre>
        </article>
        <article>
          <h3>Notes</h3>
          <ul>${parityNotes}</ul>
        </article>
      </div>
    </section>
  `;
}

function renderAttackCandidateRow(row, index, hasAttackRows) {
    const tokenStart = row.start ?? row.tokenStart ?? "";
    const tokenEnd = row.end ?? row.tokenEnd ?? "";
    const tokenRange = tokenStart !== "" || tokenEnd !== "" ? `${tokenStart}..${tokenEnd}` : "--";
    const componentRefs = arrayFrom(row.component_refs ?? row.componentRefs)
        .map((ref) => typeof ref === "object" ? `${ref.ship_id ?? ref.shipId ?? "?"}:${ref.component_id ?? ref.componentId ?? "?"}` : String(ref))
        .join(", ");
    const round = hasAttackRows ? row.round ?? "--" : inferRoundFromSegment(row, index);
    const subRound = hasAttackRows ? row.subRound ?? row.sub_round ?? "--" : row.index ?? index;

    return `
    <tr>
      <td>${escapeHtml(round)}</td>
      <td>${escapeHtml(subRound)}</td>
      <td>${escapeHtml(tokenRange)}</td>
      <td class="numeric">${escapeHtml(row.length ?? "--")}</td>
      <td>${escapeHtml(arrayFrom(row.ship_ids ?? row.shipIds).join(", ") || "--")}</td>
      <td>${escapeHtml(componentRefs || "--")}</td>
      <td>${escapeHtml(arrayFrom(row.markers).join(" ") || "--")}</td>
    </tr>
  `;
}

function renderCombatantCsvRow(row) {
    const source = [row.sourceKind, row.sourceSegmentIndex != null ? `S${row.sourceSegmentIndex}` : "", row.sourceRecordIndex != null ? `R${row.sourceRecordIndex}` : ""]
        .filter(Boolean)
        .join(" ");

    return `
    <tr>
      <td>${escapeHtml(row.round ?? "--")}</td>
      <td>${escapeHtml(row.type ?? "--")}</td>
      <td>${escapeHtml(row.attackerName ?? "--")}</td>
      <td>${escapeHtml(row.targetName ?? "--")}</td>
      <td class="numeric">${escapeHtml(row.hullDamage ?? "--")}</td>
      <td class="numeric">${escapeHtml(row.shieldDamage ?? "--")}</td>
      <td class="numeric">${escapeHtml(row.mitigatedDamage ?? "--")}</td>
      <td>${escapeHtml(row.criticalHit ?? "--")}</td>
      <td>${escapeHtml(source || row.confidence || "--")}</td>
    </tr>
  `;
}

function renderMetric(label, value, tone = "") {
    const toneClass = tone ? ` metric--${tone}` : "";
    return `<div class="metric${toneClass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "--")}</strong></div>`;
}

function renderStatBar(label, value, maxValue, kind) {
    const percent = value == null ? 0 : Math.max(4, Math.min(100, (value / maxValue) * 100));
    return `
    <div class="stat-bar stat-bar--${escapeAttribute(kind)}">
      <div class="stat-bar__label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatCompact(value))}</strong></div>
      <div class="stat-bar__track"><span style="width: ${percent.toFixed(2)}%"></span></div>
    </div>
  `;
}

function renderChainItem(label, value) {
    return `<div class="chain-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "--")}</strong></div>`;
}

function deriveCaptureSignature(capture) {
    const tokens = Array.isArray(capture?.battleLog?.tokens) ? capture.battleLog.tokens : [];
    return {
        token_count: tokens.length,
        integer_count: tokens.filter((token) => Number.isInteger(Number(token))).length,
        float_count: tokens.filter((token) => !Number.isNaN(Number(token)) && !Number.isInteger(Number(token))).length,
        zero_count: tokens.filter((token) => Number(token) === 0).length,
        first_tokens: tokens.slice(0, 12),
        last_tokens: tokens.slice(-12),
    };
}

function segmentReferencesCombatant(segment, combatant) {
    const shipIds = new Set(combatant.shipIds.map(String));
    const segmentShipIds = arrayFrom(segment.ship_ids ?? segment.shipIds).map(String);
    const directShipRef = segmentShipIds.some((shipId) => shipIds.has(shipId));
    const componentShipRef = arrayFrom(segment.component_refs ?? segment.componentRefs).some((ref) => {
        if (!ref || typeof ref !== "object") {
            return false;
        }
        return shipIds.has(String(ref.ship_id ?? ref.shipId));
    });

    if (directShipRef || componentShipRef) {
        return true;
    }

    return combatant.shipIds.length === 0 && segmentShipIds.length === 0;
}

function rowReferencesCombatant(row, combatant) {
    const text = JSON.stringify(row);
    return combatant.shipIds.some((shipId) => text.includes(String(shipId))) || Boolean(combatant.uid && text.includes(combatant.uid));
}

function csvRowReferencesCombatant(row, combatant) {
    const shipIds = new Set(combatant.shipIds.map(String));
    const rowShipIds = [row.attackerShipId, row.targetShipId].filter((value) => value != null).map(String);
    if (rowShipIds.some((shipId) => shipIds.has(shipId))) {
        return true;
    }

    const uid = String(combatant.uid ?? "");
    if (uid && JSON.stringify(row).includes(uid)) {
        return true;
    }

    const displayName = String(combatant.displayName ?? "");
    return Boolean(displayName && (row.attackerName === displayName || row.targetName === displayName));
}

function inferCsvParityColumns(rows) {
    const preferred = [
        ["round", "Round"],
        ["battleEvent", "Battle Event"],
        ["type", "Type"],
        ["attackerName", "Attacker Name"],
        ["attackerAlliance", "Attacker Alliance"],
        ["attackerShip", "Attacker Ship"],
        ["attackerIsArmada", "Attacker - Is Armada?"],
        ["targetName", "Target Name"],
        ["targetAlliance", "Target Alliance"],
        ["targetShip", "Target Ship"],
        ["targetIsArmada", "Target - Is Armada?"],
        ["criticalHit", "Critical Hit?"],
        ["hullDamage", "Hull Damage"],
        ["shieldDamage", "Shield Damage"],
        ["mitigatedDamage", "Mitigated Damage"],
        ["mitigatedIsolyticDamage", "Mitigated Isolytic Damage"],
        ["mitigatedApexBarrier", "Mitigated Apex Barrier"],
        ["totalDamage", "Total Damage"],
        ["totalIsolyticDamage", "Total Isolytic Damage"],
        ["abilityType", "Ability Type"],
        ["abilityValue", "Ability Value"],
        ["abilityName", "Ability Name"],
        ["abilityOwnerName", "Ability Owner Name"],
        ["targetDefeated", "Target Defeated"],
        ["targetDestroyed", "Target Destroyed"],
        ["chargingWeaponsPercent", "Charging Weapons %"],
    ];

    const keys = rows.length > 0 ? new Set(Object.keys(rows[0])) : new Set(preferred.map(([key]) => key));
    return preferred
        .filter(([key]) => keys.has(key))
        .map(([key, label]) => ({ key, label }));
}

function countSegmentsWithMarker(segments, marker) {
    if (!Array.isArray(segments)) {
        return 0;
    }

    return segments.filter((segment) => arrayFrom(segment.markers).includes(marker)).length;
}

function inferRoundFromSegment(segment, index) {
    if (arrayFrom(segment.markers).includes(-96)) {
        return Math.max(1, Math.floor(index / 4) + 1);
    }

    return Math.max(1, Math.floor(index / 4) + 1);
}

function buildBattleTitle(summary, combatants) {
    const initiator = combatants.find((combatant) => combatant.side === "initiator") ?? combatants[0];
    const target = combatants.find((combatant) => combatant.side === "target") ?? combatants[1];

    if (initiator && target) {
        return `${initiator.displayName} vs ${target.displayName}`;
    }

    return summary.battleId ? `Battle ${summary.battleId}` : "Battle Report";
}

function isInitiatorVictory(summary) {
    return summary.initiatorWins === true || String(summary.outcome ?? "").includes("initiator_victory");
}

function formatOutcome(value) {
    const text = String(value ?? "").replaceAll("_", " ").trim();
    if (!text) {
        return "Unknown";
    }

    return titleCase(text.replace("initiator victory", "victory").replace("target victory", "defeat"));
}

function rewardLabel(reward) {
    if (reward.kind === "resource") {
        return `Resource ${reward.resourceId ?? "unknown"}`;
    }

    if (reward.kind === "chest") {
        return reward.nameKey ?? "Chest";
    }

    return reward.kind ?? "Reward";
}

function rewardValue(reward) {
    return reward.count ?? "--";
}

function formatCompact(value) {
    if (value == null || value === "") {
        return "--";
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
        return String(value);
    }

    const abs = Math.abs(number);
    const units = [
        [1e12, "T"],
        [1e9, "B"],
        [1e6, "M"],
        [1e3, "K"],
    ];

    for (const [unitValue, suffix] of units) {
        if (abs >= unitValue) {
            return `${(number / unitValue).toFixed(abs >= unitValue * 100 ? 0 : 2)}${suffix}`;
        }
    }

    return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatDateTime(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value || "Unknown time" : parsed.toLocaleString();
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function arrayFrom(value) {
    return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeClassName(value) {
    return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
}

function cssEscapeAttr(value) {
    if (typeof window !== "undefined" && typeof window.CSS?.escape === "function") {
        return window.CSS.escape(value);
    }
    return String(value ?? "").replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
