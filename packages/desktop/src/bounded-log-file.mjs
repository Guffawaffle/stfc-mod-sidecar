import fs from "node:fs";

export const DEFAULT_LOG_MAX_BYTES = 512 * 1024;
export const DEFAULT_LOG_KEEP_BYTES = 384 * 1024;

export function appendBoundedLogLineSync(logFilePath, line, options = {}) {
    if (!logFilePath) {
        return false;
    }

    fs.appendFileSync(logFilePath, line, "utf8");
    return trimLogFileSync(logFilePath, options);
}

export function trimLogFileSync(logFilePath, options = {}) {
    if (!logFilePath) {
        return false;
    }

    const bounds = normalizeLogBounds(options);
    let stat;
    try {
        stat = fs.statSync(logFilePath);
    } catch {
        return false;
    }

    if (!stat.isFile() || stat.size <= bounds.maxBytes) {
        return false;
    }

    const source = fs.readFileSync(logFilePath, "utf8");
    const notice = buildTruncationNotice(bounds.maxBytes);
    const availableTailBytes = Math.max(0, Math.min(bounds.keepBytes, bounds.maxBytes - Buffer.byteLength(notice, "utf8")));
    const lines = source.match(/[^\n]*\n|[^\n]+/g) ?? [];
    let tail = "";

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const candidate = `${lines[index]}${tail}`;
        if (Buffer.byteLength(candidate, "utf8") > availableTailBytes) {
            break;
        }

        tail = candidate;
    }

    fs.writeFileSync(logFilePath, `${notice}${tail}`, "utf8");
    return true;
}

function normalizeLogBounds(options) {
    const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes
        : DEFAULT_LOG_MAX_BYTES;
    const keepBytes = Number.isInteger(options.keepBytes) && options.keepBytes >= 0
        ? options.keepBytes
        : DEFAULT_LOG_KEEP_BYTES;

    return {
        maxBytes,
        keepBytes: Math.min(keepBytes, maxBytes),
    };
}

function buildTruncationNotice(maxBytes) {
    const notice = `[${new Date().toISOString()}] [sidecar-log] truncated older troubleshooting output\n`;
    if (Buffer.byteLength(notice, "utf8") <= maxBytes) {
        return notice;
    }

    return Buffer.from(notice, "utf8").subarray(0, maxBytes).toString("utf8");
}