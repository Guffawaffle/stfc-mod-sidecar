import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FEED_PATH = "C:\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_battle_feed.jsonl";
const DEFAULT_PORT = 43127;
const DEFAULT_LIMIT = 150;
const POLL_HINT_MS = 2000;
const SHUTDOWN_GRACE_MS = 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const { feedPath, port, defaultLimit } = parseArgs(process.argv.slice(2));
const startedAt = new Date();
const shutdownToken = process.env.STFC_SIDECAR_SHUTDOWN_TOKEN ?? "";

let shutdownRequested = false;
let exitTimer;

let parseEventJsonLine;
try {
    ({ parseEventJsonLine } = await import(new URL("../core/dist/index.js", import.meta.url)));
} catch (error) {
    console.error("Unable to load @stfc-mod-sidecar/core. Run `npm run build --workspace @stfc-mod-sidecar/core` first.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);

    if (requestUrl.pathname === "/api/events") {
        const limitValue = Number.parseInt(requestUrl.searchParams.get("limit") ?? `${defaultLimit}`, 10);
        const snapshot = await readFeedSnapshot(feedPath, Number.isFinite(limitValue) ? limitValue : defaultLimit);
        return sendJson(response, 200, snapshot);
    }

    if (requestUrl.pathname === "/api/health") {
        return sendJson(response, 200, {
            ok: true,
            pid: process.pid,
            feedPath,
            port,
            defaultLimit,
            startedAt: startedAt.toISOString(),
            uptimeMs: Date.now() - startedAt.getTime(),
            shuttingDown: shutdownRequested,
            pollHintMs: POLL_HINT_MS,
            generatedAt: new Date().toISOString(),
        });
    }

    if (requestUrl.pathname === "/api/admin/shutdown") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        if (!shutdownToken) {
            return sendJson(response, 403, { ok: false, error: "Shutdown control is disabled for this process" });
        }

        if (!isAuthorizedShutdownRequest(request)) {
            return sendJson(response, 401, { ok: false, error: "Unauthorized shutdown request" });
        }

        sendJson(response, 202, {
            ok: true,
            pid: process.pid,
            shuttingDown: true,
        });
        setImmediate(() => {
            void shutdownServer("admin_request");
        });
        return;
    }

    if (requestUrl.pathname === "/") {
        return sendFile(response, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    }

    if (requestUrl.pathname === "/app.js") {
        return sendFile(response, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
    }

    if (requestUrl.pathname === "/styles.css") {
        return sendFile(response, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
    }

    return sendJson(response, 404, { ok: false, error: "Not found" });
});

server.on("error", (error) => {
    console.error(`[sidecar-viewer] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
    console.log(`[sidecar-viewer] pid ${process.pid}`);
    console.log(`[sidecar-viewer] listening on http://127.0.0.1:${port}`);
    console.log(`[sidecar-viewer] feed path: ${feedPath}`);
});

process.on("SIGINT", () => {
    void shutdownServer("SIGINT");
});

process.on("SIGTERM", () => {
    void shutdownServer("SIGTERM");
});

function parseArgs(args) {
    let selectedFeedPath = process.env.STFC_SIDECAR_FEED_PATH ?? DEFAULT_FEED_PATH;
    let selectedPort = parseInteger(process.env.STFC_SIDECAR_PORT, DEFAULT_PORT);
    let selectedLimit = parseInteger(process.env.STFC_SIDECAR_LIMIT, DEFAULT_LIMIT);

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const nextValue = () => {
            if (index + 1 >= args.length) {
                console.error(`Missing value for ${arg}`);
                process.exit(2);
            }

            index += 1;
            return args[index];
        };

        if (arg === "--feed-path") {
            selectedFeedPath = nextValue();
            continue;
        }

        if (arg === "--port") {
            selectedPort = parseInteger(nextValue(), DEFAULT_PORT);
            continue;
        }

        if (arg === "--limit") {
            selectedLimit = parseInteger(nextValue(), DEFAULT_LIMIT);
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            console.log("Usage: node packages/viewer/server.mjs [--feed-path <jsonl>] [--port <number>] [--limit <number>]");
            process.exit(0);
        }

        console.error(`Unknown argument: ${arg}`);
        process.exit(2);
    }

    return {
        feedPath: path.resolve(selectedFeedPath),
        port: selectedPort,
        defaultLimit: selectedLimit,
    };
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function readFeedSnapshot(selectedFeedPath, limit) {
    const generatedAt = new Date().toISOString();
    const resolvedLimit = Math.min(Math.max(limit, 10), 500);

    if (!existsSync(selectedFeedPath)) {
        return {
            ok: false,
            feedPath: selectedFeedPath,
            exists: false,
            generatedAt,
            pollHintMs: POLL_HINT_MS,
            events: [],
            error: "Feed file not found. Start the STFC mod feed emitter or point the viewer at another JSONL file.",
        };
    }

    const [fileContents, fileStat] = await Promise.all([
        readFile(selectedFeedPath, "utf8"),
        stat(selectedFeedPath),
    ]);

    const lines = fileContents.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const selectedLines = lines.slice(-resolvedLimit);
    const firstLineNumber = lines.length - selectedLines.length + 1;

    const events = selectedLines.map((rawLine, index) => normalizeLine(rawLine, firstLineNumber + index)).reverse();

    return {
        ok: true,
        feedPath: selectedFeedPath,
        exists: true,
        generatedAt,
        pollHintMs: POLL_HINT_MS,
        lastModified: fileStat.mtime.toISOString(),
        totalLines: lines.length,
        returnedLines: selectedLines.length,
        events,
    };
}

function normalizeLine(rawLine, lineNumber) {
    const parsed = parseEventJsonLine(rawLine);
    if (!parsed.ok) {
        return {
            lineNumber,
            rawLine,
            parsed: false,
            error: parsed.error,
            summary: {
                title: "Unrecognized JSONL line",
                subtitle: parsed.error,
                chips: ["invalid"],
            },
        };
    }

    return {
        lineNumber,
        rawLine,
        parsed: true,
        event: parsed.event,
        summary: summarizeEvent(parsed.event),
    };
}

function summarizeEvent(event) {
    if (event.type === "battle.capture") {
        const capture = asRecord(event.capture);
        const summary = asRecord(capture.summary);
        const battleLog = asRecord(capture.battleLog);
        const tokens = Array.isArray(battleLog.tokens) ? battleLog.tokens : [];
        const participants = Array.isArray(capture.participants) ? capture.participants : [];
        const targetLabel = asText(summary.targetId) || asText(event.battleId) || `Battle capture ${event.journalId}`;

        return {
            title: targetLabel,
            subtitle: `${participants.length} participant${participants.length === 1 ? "" : "s"} captured`,
            chips: [event.type, `battleType ${event.battleType ?? "?"}`, `${tokens.length} tokens`],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "battle.report") {
        const summary = asRecord(event.report?.summary);
        const fleets = Array.isArray(event.report?.fleets) ? event.report.fleets : [];
        const hostile = fleets.find((fleet) => isHostileFleet(fleet)) ?? fleets.find((fleet) => asText(fleet.uid).startsWith("mar_"));
        const playerNames = fleets
            .filter((fleet) => asText(fleet.participant_kind) === "player")
            .map((fleet) => asText(fleet.display_name) || asText(fleet.name))
            .filter(Boolean);
        const targetLabel = asText(hostile?.display_name) || asText(hostile?.name) || asText(summary.targetId) || `Battle ${event.journalId}`;
        const outcome = asText(summary.outcome) || "unknown_outcome";

        return {
            title: targetLabel,
            subtitle: playerNames.length > 0 ? playerNames.join(", ") : "No player participants recorded",
            chips: [event.type, `battleType ${event.battleType ?? "?"}`, outcome],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "debug.event") {
        return {
            title: event.message,
            subtitle: event.source,
            chips: [event.type, event.level],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "hook.event") {
        return {
            title: event.hookName,
            subtitle: event.backend ?? "hook status",
            chips: [event.type, event.status],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "battle.event") {
        return {
            title: event.playerShip ?? event.enemy ?? event.battleId ?? "battle.event",
            subtitle: event.rawLine ?? event.phase,
            chips: [event.type, event.phase],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "session.event") {
        return {
            title: event.phase,
            subtitle: event.sessionId ?? "session event",
            chips: [event.type],
            timestamp: event.timestamp,
        };
    }

    return {
        title: event.action,
        subtitle: event.provider,
        chips: [event.type, event.status],
        timestamp: event.timestamp,
    };
}

function isHostileFleet(fleet) {
    return asText(fleet?.participant_kind) === "hostile" || asText(fleet?.uid).startsWith("mar_");
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asText(value) {
    return typeof value === "string" ? value : "";
}

function isAuthorizedShutdownRequest(request) {
    const authorization = request.headers.authorization;
    if (authorization === `Bearer ${shutdownToken}`) {
        return true;
    }

    return request.headers["x-sidecar-shutdown-token"] === shutdownToken;
}

async function shutdownServer(reason) {
    if (shutdownRequested) {
        return;
    }

    shutdownRequested = true;
    console.log(`[sidecar-viewer] shutdown requested (${reason})`);

    exitTimer = setTimeout(() => {
        console.error("[sidecar-viewer] shutdown timed out; closing active connections");
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
        process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    exitTimer.unref();

    server.close((error) => {
        if (exitTimer) {
            clearTimeout(exitTimer);
        }

        if (error) {
            console.error(`[sidecar-viewer] shutdown failed: ${error.message}`);
            process.exit(1);
            return;
        }

        console.log("[sidecar-viewer] shutdown complete");
        process.exit(0);
    });
}

async function sendFile(response, filePath, contentType) {
    try {
        const body = await readFile(filePath);
        response.writeHead(200, {
            "content-type": contentType,
            "cache-control": "no-store",
        });
        response.end(body);
    } catch (error) {
        sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    response.end(JSON.stringify(value));
}