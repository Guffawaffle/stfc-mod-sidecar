const BARE_UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const EXPLICIT_TIMEZONE_PATTERN = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

export function normalizeUtcInstantString(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  if (!BARE_UTC_ISO_PATTERN.test(text) || EXPLICIT_TIMEZONE_PATTERN.test(text)) {
    return text;
  }

  return `${text}Z`;
}

export function parseInstant(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return new Date(value.valueOf());
  }

  const normalized = normalizeUtcInstantString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function extractCapturedAtUnixMs(record) {
  return firstFiniteNumber(
    record?.capturedAtUnixMs,
    record?.capture?.capturedAtUnixMs,
  );
}

export function pickBestInstant(record) {
  if (record == null || typeof record !== "object") {
    return record;
  }

  return extractCapturedAtUnixMs(record) ?? record.timestamp ?? null;
}

export function formatLocalInstant(value, options = {}) {
  const parsed = parseInstant(value);
  if (!parsed) {
    return options.fallback ?? "Unknown time";
  }

  return parsed.toLocaleString(options.locale, options.timeZone ? { timeZone: options.timeZone } : undefined);
}

export function formatRecordInstant(record, options = {}) {
  const instant = pickBestInstant(record);
  return instant == null
    ? options.fallback ?? "Unknown time"
    : formatLocalInstant(instant, options);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}
