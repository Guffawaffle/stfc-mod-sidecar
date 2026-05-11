const MARK_STORAGE_KEY = "stfc.flightRecorder.marks.v1";
const EXPORT_FILENAME_PREFIX = "stfc-flight-recorder";

const fixtureEvents = [
  {
    id: "fixture-arrival",
    timestamp: relativeIso(-18 * 60 * 1000),
    kind: "fleet.arrived",
    severity: "success",
    title: "Fleet arrived in system",
    subtitle: "USS Franklin reached Sol",
    fleet: "USS Franklin",
    system: "Sol",
    details: "Fixture event used until a live event stream is available.",
    source: "fixture",
  },
  {
    id: "fixture-mining",
    timestamp: relativeIso(-11 * 60 * 1000),
    kind: "fleet.mining",
    severity: "info",
    title: "Started mining",
    subtitle: "North Star started mining crystal",
    fleet: "North Star",
    system: "Corva",
    details: "Cargo threshold and node metadata can be added when the C++ event stream lands.",
    source: "fixture",
  },
  {
    id: "fixture-notification",
    timestamp: relativeIso(-6 * 60 * 1000),
    kind: "notification.audio",
    severity: "warning",
    title: "Node depleted notification",
    subtitle: "Desktop + warning cue",
    fleet: "Botany Bay",
    system: "Lycia",
    details: "Notification policy decisions will appear here once emitted by the mod.",
    source: "fixture",
  },
];

const state = {
  feedEvents: [],
  marks: readMarks(),
  source: "fixture",
  lastUpdated: null,
};

const elements = {
  source: document.querySelector("#timeline-source"),
  count: document.querySelector("#timeline-count"),
  markCount: document.querySelector("#mark-count"),
  updated: document.querySelector("#timeline-updated"),
  status: document.querySelector("#timeline-status"),
  list: document.querySelector("#timeline-list"),
  kindFilter: document.querySelector("#kind-filter"),
  severityFilter: document.querySelector("#severity-filter"),
  search: document.querySelector("#timeline-search"),
  refresh: document.querySelector("#refresh-timeline"),
  markKind: document.querySelector("#mark-kind"),
  markNote: document.querySelector("#mark-note"),
  addMark: document.querySelector("#add-mark"),
  exportSession: document.querySelector("#export-session"),
  clearMarks: document.querySelector("#clear-marks"),
};

elements.refresh.addEventListener("click", () => void refreshTimeline());
elements.kindFilter.addEventListener("change", renderTimeline);
elements.severityFilter.addEventListener("change", renderTimeline);
elements.search.addEventListener("input", renderTimeline);
elements.addMark.addEventListener("click", addMark);
elements.exportSession.addEventListener("click", exportSession);
elements.clearMarks.addEventListener("click", clearMarks);

await refreshTimeline();

async function refreshTimeline() {
  setStatus("Refreshing timeline...");
  try {
    const feedAvailable = await canReadFeedEvents();
    if (!feedAvailable) {
      throw new Error("Live feed disabled for the active profile");
    }

    const response = await fetch("/api/events?limit=250&detail=summary", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Feed unavailable (${response.status})`);
    }

    const snapshot = await response.json();
    const events = normalizeFeedSnapshot(snapshot);
    state.feedEvents = events;
    state.source = events.length > 0 ? snapshot.source ?? "feed" : "fixture";
  } catch (error) {
    state.feedEvents = [];
    state.source = "fixture";
    setStatus(error instanceof Error ? `${error.message}; showing fixture timeline.` : "Showing fixture timeline.");
  }

  state.lastUpdated = new Date().toISOString();
  renderKindFilter();
  renderTimeline();
}

async function canReadFeedEvents() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }

    const health = await response.json();
    return health?.capabilities?.battleLog === true;
  } catch {
    return false;
  }
}

function normalizeFeedSnapshot(snapshot) {
  if (!snapshot?.ok || !Array.isArray(snapshot.events)) {
    return [];
  }

  return snapshot.events
    .map((entry) => normalizeFeedEntry(entry))
    .filter(Boolean);
}

function normalizeFeedEntry(entry) {
  const summary = entry?.summary ?? {};
  const chips = Array.isArray(summary.chips) ? summary.chips.filter(Boolean) : [];
  const type = String(chips[0] ?? summary.title ?? "feed.event");
  const timestamp = summary.timestamp ?? new Date().toISOString();
  const title = String(summary.title ?? type);
  const subtitle = String(summary.subtitle ?? "");
  const searchText = `${title} ${subtitle} ${chips.join(" ")}`.toLowerCase();

  return {
    id: `feed-${entry.lineNumber ?? timestamp}-${title}`,
    lineNumber: entry.lineNumber,
    timestamp,
    kind: normalizeKind(type, searchText),
    severity: normalizeSeverity(type, searchText),
    title,
    subtitle,
    fleet: extractLabel(subtitle, ["uss", "north", "botany"]) || "",
    system: "",
    details: chips.join(" | "),
    source: "feed",
  };
}

function normalizeKind(type, searchText) {
  const text = `${type} ${searchText}`.toLowerCase();
  if (text.includes("notification")) return "notification";
  if (text.includes("attack")) return "combat";
  if (text.includes("battle")) return "battle";
  if (text.includes("mine") || text.includes("node")) return "fleet.mining";
  if (text.includes("arriv") || text.includes("dock") || text.includes("repair")) return "fleet.status";
  return type.replace(/[^a-z0-9.:-]+/gi, ".").toLowerCase();
}

function normalizeSeverity(type, searchText) {
  const text = `${type} ${searchText}`.toLowerCase();
  if (text.includes("incoming") || text.includes("attack") || text.includes("critical")) return "critical";
  if (text.includes("depleted") || text.includes("warning") || text.includes("failed")) return "warning";
  if (text.includes("arrived") || text.includes("repair")) return "success";
  return "info";
}

function extractLabel(text, prefixes) {
  const value = String(text ?? "").trim();
  const lower = value.toLowerCase();
  return prefixes.some((prefix) => lower.includes(prefix)) ? value.split(" in ")[0] : "";
}

function renderKindFilter() {
  const current = elements.kindFilter.value;
  const kinds = [...new Set(allEvents().map((event) => event.kind))].sort((left, right) => left.localeCompare(right));
  elements.kindFilter.textContent = "";
  elements.kindFilter.append(new Option("All events", "all"));
  for (const kind of kinds) {
    elements.kindFilter.append(new Option(kindLabel(kind), kind));
  }
  elements.kindFilter.value = kinds.includes(current) ? current : "all";
}

function renderTimeline() {
  const events = filteredEvents();
  elements.list.textContent = "";

  elements.source.textContent = sourceLabel();
  elements.count.textContent = String(events.length);
  elements.markCount.textContent = String(state.marks.length);
  elements.updated.textContent = state.lastUpdated ? formatDateTime(state.lastUpdated) : "Never";

  if (events.length === 0) {
    elements.list.append(renderEmpty("No timeline events match the current filters."));
    setStatus("No matching events");
    return;
  }

  setStatus(`${events.length} event${events.length === 1 ? "" : "s"} shown`);
  for (const event of events) {
    elements.list.append(renderTimelineEvent(event));
  }
}

function renderTimelineEvent(event) {
  const item = document.createElement("article");
  item.className = "timeline-event";
  item.dataset.severity = event.severity;

  const meta = [kindLabel(event.kind), event.fleet, event.system, event.source]
    .filter(Boolean)
    .map((value) => `<span>${escapeHtml(value)}</span>`)
    .join("");

  item.innerHTML = `
    <time>${escapeHtml(formatDateTime(event.timestamp))}</time>
    <div class="timeline-event__body">
      <div class="timeline-event__top">
        <h3>${escapeHtml(event.title)}</h3>
        <strong>${escapeHtml(severityLabel(event.severity))}</strong>
      </div>
      <p>${escapeHtml(event.subtitle || event.details || "No additional detail")}</p>
      <div class="chip-row">${meta}</div>
    </div>
  `;

  return item;
}

function filteredEvents() {
  const kind = elements.kindFilter.value;
  const severity = elements.severityFilter.value;
  const query = elements.search.value.trim().toLowerCase();

  return allEvents()
    .filter((event) => kind === "all" || event.kind === kind)
    .filter((event) => severity === "all" || event.severity === severity)
    .filter((event) => !query || eventSearchText(event).includes(query))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function allEvents() {
  const base = state.feedEvents.length > 0 ? state.feedEvents : fixtureEvents;
  return [...base, ...state.marks];
}

function addMark() {
  const note = elements.markNote.value.trim();
  const kind = elements.markKind.value;
  const mark = {
    id: `mark-${Date.now()}`,
    timestamp: new Date().toISOString(),
    kind,
    severity: kind === "lag-spike" ? "warning" : "info",
    title: markTitle(kind),
    subtitle: note || "Manual session mark",
    fleet: "",
    system: "",
    details: note,
    source: "local-mark",
  };

  state.marks = [mark, ...state.marks].slice(0, 200);
  writeMarks(state.marks);
  elements.markNote.value = "";
  renderKindFilter();
  renderTimeline();
}

function clearMarks() {
  state.marks = [];
  writeMarks(state.marks);
  renderKindFilter();
  renderTimeline();
}

function exportSession() {
  const payload = {
    exportedAt: new Date().toISOString(),
    source: state.source,
    filters: {
      kind: elements.kindFilter.value,
      severity: elements.severityFilter.value,
      search: elements.search.value.trim(),
    },
    events: filteredEvents(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${EXPORT_FILENAME_PREFIX}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function readMarks() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(MARK_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isTimelineEvent) : [];
  } catch {
    return [];
  }
}

function writeMarks(marks) {
  try {
    window.localStorage?.setItem(MARK_STORAGE_KEY, JSON.stringify(marks));
  } catch {
    return;
  }
}

function isTimelineEvent(value) {
  return value && typeof value === "object" && typeof value.timestamp === "string" && typeof value.title === "string";
}

function eventSearchText(event) {
  return [event.kind, event.severity, event.title, event.subtitle, event.fleet, event.system, event.details, event.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sourceLabel() {
  if (state.feedEvents.length > 0) {
    return `${state.source} + local marks`;
  }
  return "fixture + local marks";
}

function kindLabel(kind) {
  return String(kind ?? "event")
    .replace(/[.:-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function severityLabel(severity) {
  return kindLabel(severity || "info");
}

function markTitle(kind) {
  switch (kind) {
    case "lag-spike": return "Lag spike mark";
    case "checked-base": return "Checked base";
    case "combat-note": return "Combat note";
    case "route-note": return "Route note";
    default: return "Manual mark";
  }
}

function renderEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function setStatus(text) {
  elements.status.textContent = text;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function relativeIso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}