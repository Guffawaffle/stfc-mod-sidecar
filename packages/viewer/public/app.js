const state = {
    snapshot: null,
    selectedLineNumber: null,
    refreshTimer: null,
};

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
    const response = await fetch(`/api/events?limit=${limit}`, { cache: "no-store" });
    const snapshot = await response.json();
    state.snapshot = snapshot;

    renderStatus(snapshot);
    renderEventList(snapshot);
    renderSelectedEvent();
}

function updateRefreshLoop() {
    if (state.refreshTimer) {
        window.clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }

    if (!elements.autoRefresh.checked) {
        return;
    }

    state.refreshTimer = window.setInterval(() => {
        void refreshSnapshot();
    }, 2000);
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
            renderSelectedEvent();
        });

        elements.eventList.appendChild(button);
    }
}

function renderSelectedEvent() {
    elements.detailView.textContent = "";

    if (!state.snapshot?.ok || !Array.isArray(state.snapshot.events)) {
        elements.detailView.appendChild(renderEmpty(state.snapshot?.error ?? "No event selected."));
        return;
    }

    const entry = state.snapshot.events.find((item) => item.lineNumber === state.selectedLineNumber);
    if (!entry) {
        elements.detailView.appendChild(renderEmpty("Select an event from the feed list."));
        return;
    }

    if (!entry.parsed) {
        elements.detailView.innerHTML = `
      <section class="detail-panel">
        <h3>Unrecognized JSONL line</h3>
        <p>${escapeHtml(entry.error ?? "Unknown parsing error")}</p>
      </section>
      <section class="detail-panel">
        <h3>Raw Line</h3>
        <pre>${escapeHtml(entry.rawLine)}</pre>
      </section>
    `;
        return;
    }

    const event = entry.event;
    const summaryRows = buildSummaryRows(event);
    const summaryTable = summaryRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");

    const battlePanels = event.type === "battle.report"
        ? renderBattlePanels(event)
        : event.type === "battle.capture"
            ? renderBattleCapturePanels(event)
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

    return rows.filter(([, value]) => value !== "");
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