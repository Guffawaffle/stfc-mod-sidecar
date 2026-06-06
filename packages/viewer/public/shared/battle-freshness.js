import { formatLocalInstant } from "./instant.js";

const SOURCE_LABELS = Object.freeze({
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  memory: "Memory",
  unavailable: "Unavailable",
});

export function describeBattleFreshness(freshness) {
  const source = normalizeSource(freshness?.source);
  const sourceLabel = SOURCE_LABELS[source] ?? "Unknown";
  const latestInstant = freshness?.latestCapturedAtUnixMs ?? freshness?.latestTimestampIsoUtc ?? null;
  const latestLabel = latestInstant
    ? formatLocalInstant(latestInstant, { fallback: "Unavailable" })
    : "Unavailable";
  const ageLabel = formatAgeMs(freshness?.ageMs);
  const staleAfterLabel = formatAgeMs(freshness?.staleAfterMs);

  if (freshness?.status === "fresh") {
    return {
      statusLabel: `Fresh via ${sourceLabel}`,
      latestLabel,
      title: `Latest stored battle came from ${sourceLabel}. Age ${ageLabel}. Stale after ${staleAfterLabel}.`,
    };
  }

  if (freshness?.status === "stale") {
    return {
      statusLabel: `Stale via ${sourceLabel}`,
      latestLabel,
      title: `Latest stored battle came from ${sourceLabel}. Age ${ageLabel}. Stale after ${staleAfterLabel}.`,
    };
  }

  return {
    statusLabel: "Unavailable",
    latestLabel,
    title: "No stored battle freshness metadata is available from the active event store.",
  };
}

function normalizeSource(source) {
  const normalized = String(source ?? "").trim().toLowerCase();
  return normalized || "unavailable";
}

function formatAgeMs(value) {
  const ageMs = Number(value);
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "unknown";
  }

  if (ageMs < 1000) {
    return `${Math.round(ageMs)} ms`;
  }

  const totalSeconds = Math.round(ageMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}
