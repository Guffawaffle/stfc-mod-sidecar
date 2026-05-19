const MAX_ERROR_SUMMARY_LENGTH = 240;

const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/\bauthorization\s*[:=]\s*bearer\s+[^\s,;]+/giu, "authorization=[redacted]"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/giu, "bearer [redacted]"],
  [/\bcookie\s*[:=]\s*[^\s,;]+/giu, "cookie=[redacted]"],
  [/\bsync[_ -]?token\s*[:=]\s*[^\s,;]+/giu, "syncToken=[redacted]"],
  [/\btoken\s*[:=]\s*[^\s,;]+/giu, "token=[redacted]"],
  [/\bpayload_json\s*[:=]\s*[^\n\r]+/giu, "payload_json=[redacted]"],
  [/\brequest body\s*[:=]\s*[^\n\r]+/giu, "request body=[redacted]"],
  [/\bresponse body\s*[:=]\s*[^\n\r]+/giu, "response body=[redacted]"],
]);

export function summarizeFleetBrokerError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const [pattern, replacement] of REDACTION_RULES) {
    message = message.replace(pattern, replacement);
  }

  return message.slice(0, MAX_ERROR_SUMMARY_LENGTH);
}