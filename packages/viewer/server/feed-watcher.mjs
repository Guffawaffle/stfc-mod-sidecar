import { existsSync, watch } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_DETAIL_CACHE_LIMIT = 128;
const DEFAULT_WATCH_DEBOUNCE_MS = 250;

export function createFeedWatcher({
    debounceMs = DEFAULT_WATCH_DEBOUNCE_MS,
    detailCacheLimit = DEFAULT_DETAIL_CACHE_LIMIT,
    feedPath,
    logger = console,
    normalizeLine,
    onFeedChanged = () => { },
    pollHintMs,
    summarizeLine,
}) {
    let feedIndex = createEmptyFeedIndex();
    let feedWatcher = null;
    let feedWatcherPath = "";
    let feedWatcherDebounce = null;

    function ensure() {
        const target = watcherTargetForFeed(feedPath);
        if (!target || target === feedWatcherPath) {
            return;
        }

        close();
        try {
            feedWatcher = watch(target, { persistent: false }, (_eventType, filename) => {
                if (filename && !isFeedWatcherFilename(filename)) {
                    return;
                }

                scheduleUpdate();
            });
            feedWatcherPath = target;
            feedWatcher.on("error", (error) => {
                logger.warn(`[sidecar-viewer] feed watcher failed: ${error instanceof Error ? error.message : String(error)}`);
                close();
            });
            logger.log(`[sidecar-viewer] watching feed updates at ${target}`);
        } catch (error) {
            logger.warn(`[sidecar-viewer] unable to watch feed updates: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    function close() {
        if (feedWatcherDebounce) {
            clearTimeout(feedWatcherDebounce);
            feedWatcherDebounce = null;
        }

        if (feedWatcher) {
            feedWatcher.close();
            feedWatcher = null;
            feedWatcherPath = "";
        }
    }

    function resetIndex(selectedFeedPath = feedPath) {
        feedIndex = createEmptyFeedIndex(selectedFeedPath);
    }

    function watcherTargetForFeed(selectedFeedPath) {
        if (existsSync(selectedFeedPath)) {
            return selectedFeedPath;
        }

        const directory = path.dirname(selectedFeedPath);
        return existsSync(directory) ? directory : "";
    }

    function isFeedWatcherFilename(filename) {
        return path.basename(String(filename)) === path.basename(feedPath);
    }

    function scheduleUpdate() {
        if (feedWatcherDebounce) {
            clearTimeout(feedWatcherDebounce);
        }

        feedWatcherDebounce = setTimeout(() => {
            feedWatcherDebounce = null;
            ensure();
            onFeedChanged();
        }, debounceMs);
        feedWatcherDebounce.unref?.();
    }

    async function readFeedSnapshot(limit, options = {}) {
        const generatedAt = new Date().toISOString();
        const resolvedLimit = Math.min(Math.max(limit, 10), 500);
        const includeDetails = options.includeDetails !== false;

        if (!existsSync(feedPath)) {
            return {
                ok: false,
                feedPath,
                exists: false,
                generatedAt,
                pollHintMs,
                events: [],
                error: "Feed file not found. Start the STFC mod feed emitter or point the viewer at another JSONL file.",
            };
        }

        const { fileStat, visibleEntries } = await refreshFeedIndex(feedPath);
        const selectedEntries = visibleEntries.slice(-resolvedLimit);
        const events = includeDetails
            ? (await Promise.all(selectedEntries.map((entry) => hydrateIndexedEntry(feedPath, fileStat.size, entry)))).reverse()
            : selectedEntries.map(publicEntry).reverse();

        return {
            ok: true,
            feedPath,
            exists: true,
            detail: includeDetails ? "full" : "summary",
            generatedAt,
            pollHintMs,
            lastModified: fileStat.mtime.toISOString(),
            totalLines: visibleEntries.length,
            returnedLines: selectedEntries.length,
            events,
        };
    }

    async function readFeedLine(lineNumber) {
        const generatedAt = new Date().toISOString();
        if (!existsSync(feedPath)) {
            return {
                ok: false,
                statusCode: 404,
                feedPath,
                exists: false,
                generatedAt,
                error: "Feed file not found.",
            };
        }

        const { fileStat, visibleEntries } = await refreshFeedIndex(feedPath);
        const indexedEntry = visibleEntries.find((entry) => entry.lineNumber === lineNumber);

        if (!indexedEntry) {
            return {
                ok: false,
                statusCode: 404,
                feedPath,
                exists: true,
                generatedAt,
                totalLines: visibleEntries.length,
                error: `Line ${lineNumber} is not available in the feed.`,
            };
        }

        return {
            ok: true,
            feedPath,
            exists: true,
            detail: "full",
            generatedAt,
            lastModified: fileStat.mtime.toISOString(),
            totalLines: visibleEntries.length,
            event: await hydrateIndexedEntry(feedPath, fileStat.size, indexedEntry),
        };
    }

    async function refreshFeedIndex(selectedFeedPath) {
        const fileStat = await stat(selectedFeedPath);
        const needsReset = feedIndex.feedPath !== selectedFeedPath
            || fileStat.size < feedIndex.fileSize
            || fileStat.mtimeMs < feedIndex.lastModifiedMs;

        if (needsReset) {
            feedIndex = createEmptyFeedIndex(selectedFeedPath);
        }

        if (feedIndex.feedPath !== selectedFeedPath) {
            feedIndex.feedPath = selectedFeedPath;
        }

        if (fileStat.size > feedIndex.fileSize) {
            const chunk = await readFeedChunk(selectedFeedPath, feedIndex.fileSize, fileStat.size - feedIndex.fileSize);
            ingestFeedChunk(feedIndex, chunk, feedIndex.fileSize);
        }

        feedIndex.fileSize = fileStat.size;
        feedIndex.lastModifiedMs = fileStat.mtimeMs;

        return {
            fileStat,
            visibleEntries: visibleFeedEntries(feedIndex, fileStat.size),
        };
    }

    function ingestFeedChunk(index, chunk, chunkStartOffset) {
        const hasPending = index.pendingBuffer.length > 0;
        const combinedBuffer = hasPending ? Buffer.concat([index.pendingBuffer, chunk]) : chunk;
        const combinedStartOffset = hasPending ? index.pendingStartOffset : chunkStartOffset;

        let lineStart = 0;

        for (let cursor = 0; cursor < combinedBuffer.length; cursor += 1) {
            if (combinedBuffer[cursor] !== 0x0a) {
                continue;
            }

            let contentEnd = cursor;
            if (contentEnd > lineStart && combinedBuffer[contentEnd - 1] === 0x0d) {
                contentEnd -= 1;
            }

            appendIndexedLine(
                index,
                combinedBuffer.subarray(lineStart, contentEnd),
                combinedStartOffset + lineStart,
                combinedStartOffset + contentEnd,
            );
            lineStart = cursor + 1;
        }

        index.pendingBuffer = combinedBuffer.subarray(lineStart);
        index.pendingStartOffset = combinedStartOffset + lineStart;
    }

    function appendIndexedLine(index, rawLineBuffer, startOffset, endOffset) {
        const rawLine = rawLineBuffer.toString("utf8");
        if (rawLine.trim().length === 0) {
            return;
        }

        const summaryEntry = summarizeLine(rawLine, index.entries.length + 1);
        index.entries.push({
            ...summaryEntry,
            startOffset,
            endOffset,
        });
    }

    function visibleFeedEntries(index, fileSize) {
        const entries = [...index.entries];
        const pendingEntry = pendingFeedEntry(index, fileSize);
        if (pendingEntry) {
            entries.push(pendingEntry);
        }
        return entries;
    }

    function pendingFeedEntry(index, fileSize) {
        if (index.pendingBuffer.length === 0) {
            return null;
        }

        const rawLine = index.pendingBuffer.toString("utf8");
        if (rawLine.trim().length === 0) {
            return null;
        }

        return {
            ...summarizeLine(rawLine, index.entries.length + 1),
            startOffset: index.pendingStartOffset,
            endOffset: fileSize,
        };
    }

    async function hydrateIndexedEntry(selectedFeedPath, fileSize, entry) {
        if (!entry.parsed) {
            const rawLine = await readIndexedRawLine(selectedFeedPath, fileSize, entry);
            return normalizeLine(rawLine, entry.lineNumber);
        }

        const cached = feedIndex.detailCache.get(entry.lineNumber);
        if (cached) {
            return cached;
        }

        const rawLine = await readIndexedRawLine(selectedFeedPath, fileSize, entry);
        const normalizedEntry = normalizeLine(rawLine, entry.lineNumber);
        rememberDetailEntry(normalizedEntry);
        return normalizedEntry;
    }

    async function readIndexedRawLine(selectedFeedPath, fileSize, entry) {
        const pendingEntry = pendingFeedEntry(feedIndex, fileSize);
        if (pendingEntry && pendingEntry.lineNumber === entry.lineNumber) {
            return feedIndex.pendingBuffer.toString("utf8");
        }

        const length = Math.max(0, entry.endOffset - entry.startOffset);
        const lineBuffer = await readFeedChunk(selectedFeedPath, entry.startOffset, length);
        return lineBuffer.toString("utf8");
    }

    async function readFeedChunk(selectedFeedPath, offset, length) {
        if (length <= 0) {
            return Buffer.alloc(0);
        }

        const handle = await open(selectedFeedPath, "r");
        try {
            const buffer = Buffer.alloc(length);
            let totalBytesRead = 0;

            while (totalBytesRead < length) {
                const { bytesRead } = await handle.read(buffer, totalBytesRead, length - totalBytesRead, offset + totalBytesRead);
                if (bytesRead === 0) {
                    break;
                }

                totalBytesRead += bytesRead;
            }

            return totalBytesRead === buffer.length ? buffer : buffer.subarray(0, totalBytesRead);
        } finally {
            await handle.close();
        }
    }

    function rememberDetailEntry(entry) {
        feedIndex.detailCache.delete(entry.lineNumber);
        feedIndex.detailCache.set(entry.lineNumber, entry);

        while (feedIndex.detailCache.size > detailCacheLimit) {
            const oldestLineNumber = feedIndex.detailCache.keys().next().value;
            feedIndex.detailCache.delete(oldestLineNumber);
        }
    }

    return {
        close,
        ensure,
        readFeedLine,
        readFeedSnapshot,
        resetIndex,
    };
}

function createEmptyFeedIndex(selectedFeedPath = "") {
    return {
        feedPath: selectedFeedPath,
        fileSize: 0,
        lastModifiedMs: 0,
        entries: [],
        pendingBuffer: Buffer.alloc(0),
        pendingStartOffset: 0,
        detailCache: new Map(),
    };
}

function publicEntry(entry) {
    const { startOffset: _startOffset, endOffset: _endOffset, ...value } = entry;
    return value;
}
