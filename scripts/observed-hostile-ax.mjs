import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSqlSidecarEventStore, parseEventJsonLine } from "../packages/core/dist/index.js";
import {
    buildObservedHostileCatalogEntriesSnapshot,
    deriveObservedHostileIdentity,
    observedHostileSourceSurfaceInfo,
} from "../packages/viewer/server/observed-hostile-access.mjs";
import {
    buildObservedHostileCommunityReport,
    formatObservedHostileCommunityReportMarkdown,
    highConfidenceUntrackedHostileGate,
} from "../packages/viewer/server/observed-hostile-community-report.mjs";
import {
    buildObservedHostileReferenceSummary,
    loadObservedHostileReferenceCatalog,
} from "../packages/viewer/server/observed-hostile-reference.mjs";

const OBSERVED_HOSTILE_AX_PROTOCOL_VERSION = "stfc.observed-hostile.ax.v1";
const OBSERVED_HOSTILE_EVENT_TYPES = Object.freeze(["observed.hostile"]);
const DEFAULT_STORE_PATH = "./.sidecar/sidecar-events.sqlite";
const DEFAULT_PROJECTION_EVENT_LIMIT = 5000;
const DEFAULT_INSPECTION_LIMIT = 25;
const DEFAULT_RAW_EVENT_LIMIT = 25;
const DEFAULT_REPORT_PREVIEW_LIMIT = 5;
const DEFAULT_REPORT_TIMEOUT_SEC = 4;
const MAX_PROJECTION_EVENT_LIMIT = 5000;
const MAX_INSPECTION_LIMIT = 250;
const MAX_RAW_EVENT_LIMIT = 100;
const MAX_REPORT_PREVIEW_LIMIT = 50;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export async function observedHostileReportCommand(argv = []) {
    const options = parseObservedHostileAxArgs(argv, { mode: "report" });
    const payload = await readObservedHostileReportCommandPayload(options);

    return payload.ok === false
        ? { success: false, errors: [payload.error ?? "Observed hostile report unavailable"], data: payload }
        : { success: true, data: payload };
}

export async function observedHostileInspectCommand(argv = []) {
    const options = parseObservedHostileAxArgs(argv, { mode: "inspect" });
    const [snapshot, referenceCatalog] = await Promise.all([
        readObservedHostileStoreSnapshot(),
        loadObservedHostileReferenceCatalog(),
    ]);
    const payload = buildObservedHostileInspectionPayload(snapshot, {
        ...options,
        generatedAt: new Date().toISOString(),
        referenceCatalog,
    });

    return payload.ok === false
        ? { success: false, errors: [payload.error ?? "Observed hostile inspection unavailable"], data: payload }
        : { success: true, data: payload };
}

export function buildObservedHostileReportPayload(snapshot = {}, options = {}) {
    const report = buildObservedHostileCommunityReport(snapshot, {
        generatedAt: options.generatedAt,
        referenceCatalog: options.referenceCatalog ?? null,
    });

    return {
        ok: report.ok !== false,
        protocolVersion: OBSERVED_HOSTILE_AX_PROTOCOL_VERSION,
        detail: "observed-hostile-report",
        generatedAt: report.generatedAt ?? options.generatedAt ?? new Date().toISOString(),
        source: snapshotSourceMetadata(snapshot),
        reference: buildObservedHostileReferenceSummary(options.referenceCatalog),
        report,
        markdown: options.includeMarkdown ? formatObservedHostileCommunityReportMarkdown(report) : undefined,
        error: report.ok === false ? report.error ?? "Observed hostile community report unavailable" : undefined,
    };
}

export function buildObservedHostileInspectionPayload(snapshot = {}, options = {}) {
    const catalog = buildObservedHostileCatalogEntriesSnapshot(snapshot, {
        limit: options.limit,
        q: options.q,
        status: options.status,
        reference: options.reference,
        systemId: options.systemId,
        referenceCatalog: options.referenceCatalog ?? null,
    });
    const reportPayload = buildObservedHostileReportPayload(snapshot, {
        generatedAt: options.generatedAt,
        includeMarkdown: false,
        referenceCatalog: options.referenceCatalog ?? null,
    });
    const reportByKey = new Map(
        (Array.isArray(reportPayload.report?.items) ? reportPayload.report.items : []).map((item) => [String(item.observedKey ?? ""), item]),
    );
    const rawEvidenceByKey = buildRawEvidenceByKey(snapshot, { rawLimit: options.rawLimit });
    const exactKey = asText(options.key);
    const filteredEntries = exactKey
        ? (Array.isArray(catalog.items) ? catalog.items : []).filter((entry) => String(entry?.key ?? "") === exactKey)
        : (Array.isArray(catalog.items) ? catalog.items : []);

    const items = filteredEntries.map((entry) => {
        const reportItem = reportByKey.get(String(entry?.key ?? "")) ?? null;
        return {
            key: entry.key,
            title: entry.title,
            matchHealthStatus: entry.matchHealthStatus,
            referencePresence: entry.referencePresence,
            highConfidenceGate: highConfidenceUntrackedHostileGate(entry),
            includedInCommunityReport: Boolean(reportItem),
            communityReportItem: reportItem,
            entry,
            rawEvidence: rawEvidenceByKey.get(String(entry?.key ?? "")) ?? emptyRawEvidence(options.rawLimit),
        };
    });

    const warnings = [];
    if (exactKey && items.length === 0) {
        warnings.push(`No observed hostile entry matched key '${exactKey}'.`);
    }

    return {
        ok: catalog.ok !== false && reportPayload.ok !== false,
        protocolVersion: OBSERVED_HOSTILE_AX_PROTOCOL_VERSION,
        detail: "observed-hostile-inspection",
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        source: snapshotSourceMetadata(snapshot),
        reference: reportPayload.reference,
        filters: {
            key: exactKey || null,
            q: asText(options.q) || null,
            status: asText(options.status) || null,
            reference: asText(options.reference) || null,
            systemId: asText(options.systemId) || null,
            limit: normalizePositiveInteger(options.limit, DEFAULT_INSPECTION_LIMIT, MAX_INSPECTION_LIMIT),
            rawLimit: normalizePositiveInteger(options.rawLimit, DEFAULT_RAW_EVENT_LIMIT, MAX_RAW_EVENT_LIMIT),
        },
        catalog: {
            totalApprox: finiteIntegerOrNull(catalog.totalApprox) ?? 0,
            unfilteredTotalApprox: finiteIntegerOrNull(catalog.unfilteredTotalApprox) ?? 0,
            returnedEntries: items.length,
        },
        communityReportSummary: reportPayload.report?.summary ?? null,
        warnings,
        items,
        error: catalog.ok === false
            ? catalog.error ?? "Observed hostile catalog unavailable"
            : reportPayload.ok === false
                ? reportPayload.error ?? "Observed hostile community report unavailable"
                : undefined,
    };
}

export function parseObservedHostileAxArgs(argv = [], options = {}) {
    const mode = options.mode === "report" ? "report" : "inspect";
    const parsed = {
        key: "",
        q: "",
        status: "",
        reference: "",
        systemId: "",
        limit: DEFAULT_INSPECTION_LIMIT,
        rawLimit: DEFAULT_RAW_EVENT_LIMIT,
        markdown: false,
        source: "route",
        serverUrl: "",
        jsonOut: "",
        markdownOut: "",
        previewLimit: DEFAULT_REPORT_PREVIEW_LIMIT,
        full: false,
        timeoutSec: DEFAULT_REPORT_TIMEOUT_SEC,
    };
    const recognized = new Set([
        "--key",
        "--q",
        "--status",
        "--reference",
        "--system-id",
        "--limit",
        "--raw-limit",
        "--markdown",
        "--source",
        "--server-url",
        "--json-out",
        "--markdown-out",
        "--preview-limit",
        "--full",
        "--timeout-sec",
    ]);

    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] ?? "");
        if (!recognized.has(arg)) {
            throw new Error(`Unknown observed hostile ${mode} option: ${arg}`);
        }

        if (arg === "--markdown") {
            parsed.markdown = true;
            continue;
        }

        if (arg === "--full") {
            parsed.full = true;
            continue;
        }

        if (index + 1 >= argv.length) {
            throw new Error(`Missing value for ${arg}`);
        }

        const value = String(argv[index + 1] ?? "");
        index += 1;
        switch (arg) {
            case "--key":
                parsed.key = value;
                break;
            case "--q":
                parsed.q = value;
                break;
            case "--status":
                parsed.status = value;
                break;
            case "--reference":
                parsed.reference = value;
                break;
            case "--system-id":
                parsed.systemId = value;
                break;
            case "--limit":
                parsed.limit = normalizePositiveInteger(value, DEFAULT_INSPECTION_LIMIT, MAX_INSPECTION_LIMIT);
                break;
            case "--raw-limit":
                parsed.rawLimit = normalizePositiveInteger(value, DEFAULT_RAW_EVENT_LIMIT, MAX_RAW_EVENT_LIMIT);
                break;
            case "--source":
                parsed.source = normalizeReportSource(value);
                break;
            case "--server-url":
                parsed.serverUrl = value;
                break;
            case "--json-out":
                parsed.jsonOut = value;
                break;
            case "--markdown-out":
                parsed.markdownOut = value;
                break;
            case "--preview-limit":
                parsed.previewLimit = normalizePositiveInteger(value, DEFAULT_REPORT_PREVIEW_LIMIT, MAX_REPORT_PREVIEW_LIMIT);
                break;
            case "--timeout-sec":
                parsed.timeoutSec = normalizePositiveInteger(value, DEFAULT_REPORT_TIMEOUT_SEC, 30);
                break;
            default:
                break;
        }
    }

    if (mode === "report") {
        return {
            markdown: parsed.markdown,
            source: parsed.source,
            serverUrl: parsed.serverUrl,
            jsonOut: parsed.jsonOut,
            markdownOut: parsed.markdownOut,
            previewLimit: parsed.previewLimit,
            full: parsed.full,
            timeoutSec: parsed.timeoutSec,
        };
    }

    return {
        key: parsed.key,
        q: parsed.q,
        status: parsed.status,
        reference: parsed.reference,
        systemId: parsed.systemId,
        limit: parsed.limit,
        rawLimit: parsed.rawLimit,
        markdown: parsed.markdown,
    };
}

export async function readObservedHostileReportCommandPayload(options = {}) {
    const generatedAt = new Date().toISOString();
    const reportSource = normalizeReportSource(options.source ?? "route");
    const wantMarkdown = Boolean(options.markdown || options.markdownOut);
    const warnings = [];

    if (reportSource === "route" || reportSource === "auto") {
        const routePayload = await fetchObservedHostileRouteReportPayload({
            generatedAt,
            includeMarkdown: wantMarkdown,
            serverUrl: options.serverUrl,
            timeoutSec: options.timeoutSec,
        });
        if (routePayload.ok !== false) {
            writeObservedHostileArtifacts(routePayload.report, routePayload.markdown, options);
            return summarizeObservedHostileReportForAx(routePayload, options, warnings);
        }
        if (reportSource === "route") {
            return summarizeObservedHostileReportForAx(routePayload, options, warnings);
        }
        warnings.push(`Route fetch failed; falling back to local store snapshot. ${routePayload.error ?? "Unknown route error"}`);
    }

    const [snapshot, referenceCatalog] = await Promise.all([
        readObservedHostileStoreSnapshot(),
        loadObservedHostileReferenceCatalog(),
    ]);
    const directPayload = buildObservedHostileReportPayload(snapshot, {
        generatedAt,
        includeMarkdown: wantMarkdown,
        referenceCatalog,
    });
    writeObservedHostileArtifacts(directPayload.report, directPayload.markdown, options);
    return summarizeObservedHostileReportForAx(directPayload, options, warnings);
}

export async function fetchObservedHostileRouteReportPayload(options = {}) {
    const serverUrl = resolveSidecarBaseUrl(options.serverUrl);
    const jsonUrl = `${serverUrl}/api/observed-hostiles/community-report`;
    const markdownUrl = `${jsonUrl}?format=markdown`;
    const timeoutMs = normalizePositiveInteger(options.timeoutSec, DEFAULT_REPORT_TIMEOUT_SEC, 30) * 1000;

    try {
        const response = await fetch(jsonUrl, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            return {
                ok: false,
                protocolVersion: OBSERVED_HOSTILE_AX_PROTOCOL_VERSION,
                detail: "observed-hostile-report",
                generatedAt: options.generatedAt ?? new Date().toISOString(),
                transport: { source: "route", serverUrl, jsonUrl, markdownUrl },
                error: `Observed hostile report route returned ${response.status}`,
            };
        }

        const report = await response.json();
        let markdown;
        if (options.includeMarkdown) {
            const markdownResponse = await fetch(markdownUrl, {
                headers: { accept: "text/markdown" },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (markdownResponse.ok) {
                markdown = await markdownResponse.text();
            }
        }

        return {
            ok: report.ok !== false,
            protocolVersion: OBSERVED_HOSTILE_AX_PROTOCOL_VERSION,
            detail: "observed-hostile-report",
            generatedAt: report.generatedAt ?? options.generatedAt ?? new Date().toISOString(),
            source: report.source ?? null,
            reference: report.reference ?? null,
            report,
            markdown,
            transport: { source: "route", serverUrl, jsonUrl, markdownUrl },
            error: report.ok === false ? report.error ?? "Observed hostile community report unavailable" : undefined,
        };
    } catch (error) {
        return {
            ok: false,
            protocolVersion: OBSERVED_HOSTILE_AX_PROTOCOL_VERSION,
            detail: "observed-hostile-report",
            generatedAt: options.generatedAt ?? new Date().toISOString(),
            transport: { source: "route", serverUrl, jsonUrl, markdownUrl },
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function summarizeObservedHostileReportForAx(payload = {}, options = {}, warnings = []) {
    const report = payload.report ?? null;
    const items = Array.isArray(report?.items) ? report.items : [];
    const previewLimit = normalizePositiveInteger(options.previewLimit, DEFAULT_REPORT_PREVIEW_LIMIT, MAX_REPORT_PREVIEW_LIMIT);
    const itemsPreview = items.slice(0, previewLimit).map(previewObservedHostileReportItem);
    const summary = report?.summary ?? null;
    const artifactSummary = {};
    if (options.jsonOut) {
        artifactSummary.jsonOut = path.resolve(repoRoot, options.jsonOut);
    }
    if (options.markdownOut) {
        artifactSummary.markdownOut = path.resolve(repoRoot, options.markdownOut);
    }

    return {
        ok: payload.ok !== false,
        protocolVersion: OBSERVED_HOSTILE_AX_PROTOCOL_VERSION,
        detail: "observed-hostile-report",
        generatedAt: payload.generatedAt ?? new Date().toISOString(),
        source: payload.source ?? null,
        reference: payload.reference ?? buildObservedHostileReferenceSummary(null),
        transport: payload.transport ?? { source: "store" },
        summary,
        previewCount: itemsPreview.length,
        previewTotal: items.length,
        itemsPreview,
        markdown: options.markdown ? payload.markdown : undefined,
        artifacts: artifactSummary,
        warnings,
        report: options.full ? report : undefined,
        error: payload.error,
    };
}

export function previewObservedHostileReportItem(item = {}) {
    const systems = Array.isArray(item.systems) ? item.systems : [];
    return {
        observedKey: item.observedKey ?? null,
        submissionReadiness: item.identity?.submissionReadiness ?? null,
        hullId: item.ids?.hullId ?? null,
        userLocaId: item.ids?.userLocaId ?? null,
        level: item.level ?? null,
        hullName: item.hullName ?? null,
        sightingCount: item.sightingCount ?? null,
        observationCount: item.observationCount ?? null,
        systemCount: systems.length,
        systems: systems.slice(0, 3).map((system) => ({
            systemId: system.systemId ?? null,
            sightingCount: system.sightingCount ?? null,
            observationCount: system.observationCount ?? null,
            firstSeen: system.firstSeen ?? null,
            lastSeen: system.lastSeen ?? null,
        })),
    };
}

function writeObservedHostileArtifacts(report, markdown, options = {}) {
    if (!options.jsonOut && !options.markdownOut) {
        return;
    }

    if (options.jsonOut) {
        const jsonPath = resolveOutputPath(options.jsonOut);
        mkdirSync(path.dirname(jsonPath), { recursive: true });
        writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    if (options.markdownOut) {
        const markdownPath = resolveOutputPath(options.markdownOut);
        mkdirSync(path.dirname(markdownPath), { recursive: true });
        const content = typeof markdown === "string" ? markdown : formatObservedHostileCommunityReportMarkdown(report);
        writeFileSync(markdownPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    }
}

function resolveOutputPath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function resolveSidecarBaseUrl(serverUrl) {
    const candidate = String(serverUrl ?? process.env.STFC_SIDECAR_URL ?? "").trim();
    if (candidate) {
        const trimmed = candidate.replace(/\/+$/, "");
        const match = /^(https?:\/\/.+?)\/api\/health\/?$/.exec(trimmed);
        return (match?.[1] ?? trimmed).replace(/\/+$/, "");
    }
    const port = normalizePositiveInteger(process.env.STFC_SIDECAR_PORT, 43127, 65535);
    return `http://127.0.0.1:${port}`;
}

function normalizeReportSource(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) {
        return "route";
    }
    if (normalized === "route" || normalized === "store" || normalized === "auto") {
        return normalized;
    }
    throw new Error(`Unsupported observed hostile report source: ${value}`);
}

export async function readObservedHostileStoreSnapshot(options = {}) {
    const backend = normalizeStoreBackend(process.env.STFC_SIDECAR_STORE_BACKEND ?? "sqlite");
    const generatedAt = new Date().toISOString();
    const limit = normalizePositiveInteger(
        options.limit,
        DEFAULT_PROJECTION_EVENT_LIMIT,
        MAX_PROJECTION_EVENT_LIMIT,
    );

    if (backend === "none") {
        return emptyObservedHostileSnapshot({
            generatedAt,
            source: "store",
            storageBackend: "none",
            exists: false,
        });
    }

    if (backend === "sqlite") {
        const connection = resolveStoreConnection(process.env.STFC_SIDECAR_STORE_CONNECTION ?? DEFAULT_STORE_PATH);
        if (!existsSync(connection)) {
            return emptyObservedHostileSnapshot({
                generatedAt,
                source: "store",
                storageBackend: "sqlite",
                exists: false,
            });
        }

        const store = await createSqlSidecarEventStore({
            backend: "sqlite",
            connection,
        });
        try {
            return await readObservedHostileStoreSnapshotFromStore(store, { generatedAt, limit });
        } finally {
            await store.close();
        }
    }

    if (backend === "postgres") {
        const connection = process.env.STFC_SIDECAR_STORE_CONNECTION ?? process.env.DATABASE_URL ?? "";
        if (!connection) {
            throw new Error("STFC_SIDECAR_STORE_CONNECTION or DATABASE_URL is required when STFC_SIDECAR_STORE_BACKEND=postgres");
        }

        const store = await createSqlSidecarEventStore({
            backend: "postgres",
            connection,
        });
        try {
            return await readObservedHostileStoreSnapshotFromStore(store, { generatedAt, limit });
        } finally {
            await store.close();
        }
    }

    throw new Error(`Unsupported STFC_SIDECAR_STORE_BACKEND: ${backend}`);
}

async function readObservedHostileStoreSnapshotFromStore(store, options) {
    const [totalLines, storedEvents] = await Promise.all([
        store.countByTypes(OBSERVED_HOSTILE_EVENT_TYPES),
        store.listRecentByTypes(OBSERVED_HOSTILE_EVENT_TYPES, options.limit),
    ]);

    return {
        ok: true,
        source: "store",
        storageBackend: store.backend,
        exists: true,
        detail: "full",
        generatedAt: options.generatedAt,
        totalLines,
        returnedLines: storedEvents.length,
        events: storedEvents.map((entry) => normalizeStoredObservedHostileEvent(entry.rawJson, entry.sequenceId)),
    };
}

function normalizeStoredObservedHostileEvent(rawLine, lineNumber) {
    const parsed = parseEventJsonLine(rawLine);
    if (!parsed.ok) {
        return {
            lineNumber,
            rawLine,
            parsed: false,
            error: parsed.error,
            timestamp: null,
            eventType: null,
        };
    }

    return {
        lineNumber,
        rawLine,
        parsed: true,
        detail: "full",
        eventType: parsed.event.type,
        source: parsed.event.source ?? null,
        level: parsed.event.level ?? null,
        sessionId: parsed.event.sessionId ?? null,
        timestamp: parsed.event.timestamp ?? null,
        event: parsed.event,
    };
}

function emptyObservedHostileSnapshot(options = {}) {
    return {
        ok: true,
        source: options.source ?? "store",
        storageBackend: options.storageBackend ?? null,
        exists: options.exists ?? false,
        detail: "full",
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        totalLines: 0,
        returnedLines: 0,
        events: [],
    };
}

function snapshotSourceMetadata(snapshot = {}) {
    return {
        source: snapshot.source ?? "store",
        storageBackend: snapshot.storageBackend ?? null,
        exists: snapshot.exists !== false,
        totalLines: finiteIntegerOrNull(snapshot.totalLines) ?? 0,
        returnedLines: finiteIntegerOrNull(snapshot.returnedLines) ?? 0,
    };
}

function buildRawEvidenceByKey(snapshot = {}, options = {}) {
    const rawLimit = normalizePositiveInteger(options.rawLimit, DEFAULT_RAW_EVENT_LIMIT, MAX_RAW_EVENT_LIMIT);
    const evidenceByKey = new Map();
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];

    for (const entry of events) {
        if (!entry?.parsed || entry?.eventType !== "observed.hostile" || !entry?.event?.observation) {
            continue;
        }

        const observation = entry.event.observation;
        const key = String(deriveObservedHostileIdentity(observation).key ?? "");
        if (!key) {
            continue;
        }

        const sourceSurface = observedHostileSourceSurfaceInfo(observation.sourceSurface);
        const evidence = evidenceByKey.get(key) ?? {
            totalMatchingEvents: 0,
            passiveEventCount: 0,
            supplementalEventCount: 0,
            ignoredEventCount: 0,
            firstSeen: null,
            lastSeen: null,
            systems: [],
            events: [],
        };

        evidence.totalMatchingEvents += 1;
        switch (sourceSurface.countBehavior) {
            case "passive":
                evidence.passiveEventCount += 1;
                break;
            case "supplemental":
                evidence.supplementalEventCount += 1;
                break;
            default:
                evidence.ignoredEventCount += 1;
                break;
        }
        evidence.firstSeen = olderTimestamp(evidence.firstSeen, entry.timestamp);
        evidence.lastSeen = newerTimestamp(evidence.lastSeen, entry.timestamp);
        addUnique(evidence.systems, asText(observation.systemId));
        evidence.events.push({
            lineNumber: finiteIntegerOrNull(entry.lineNumber),
            timestamp: asText(entry.timestamp) || null,
            sourceSurface: sourceSurface.surface,
            sourceTier: sourceSurface.tier,
            countBehavior: sourceSurface.countBehavior,
            confidence: asText(observation.confidence) || null,
            hullId: asText(observation.hullId) || null,
            hullName: asText(observation.hullName) || null,
            runtimeFleetId: asText(observation.runtimeFleetId) || null,
            userId: asText(observation.userId) || null,
            userLocaId: asText(observation.userLocaId) || null,
            locationTranslationId: asText(observation.locationTranslationId) || null,
            systemId: asText(observation.systemId) || null,
            galaxyId: asText(observation.galaxyId) || null,
            instanceId: asText(observation.instanceId) || null,
            userLevel: finiteIntegerOrNull(observation.userLevel),
            hullTypeValue: finiteIntegerOrNull(observation.hullTypeValue),
            hullTypeName: asText(observation.hullTypeName) || null,
            hullGrade: finiteIntegerOrNull(observation.hullGrade),
            hullFactionValue: finiteIntegerOrNull(observation.hullFactionValue),
            fleetTypeValue: finiteIntegerOrNull(observation.fleetTypeValue),
            fleetTypeName: asText(observation.fleetTypeName) || null,
        });
        evidenceByKey.set(key, evidence);
    }

    for (const [key, evidence] of evidenceByKey.entries()) {
        evidence.events.sort(compareRawEvidenceEvents);
        evidence.events = evidence.events.slice(0, rawLimit);
        evidenceByKey.set(key, evidence);
    }

    return evidenceByKey;
}

function emptyRawEvidence(rawLimit) {
    return {
        totalMatchingEvents: 0,
        passiveEventCount: 0,
        supplementalEventCount: 0,
        ignoredEventCount: 0,
        firstSeen: null,
        lastSeen: null,
        systems: [],
        events: [],
        rawLimit: normalizePositiveInteger(rawLimit, DEFAULT_RAW_EVENT_LIMIT, MAX_RAW_EVENT_LIMIT),
    };
}

function compareRawEvidenceEvents(left, right) {
    const rightTime = parseInstantMs(right?.timestamp);
    const leftTime = parseInstantMs(left?.timestamp);
    if (rightTime != null && leftTime != null && rightTime !== leftTime) {
        return rightTime - leftTime;
    }
    return (finiteIntegerOrNull(right?.lineNumber) ?? 0) - (finiteIntegerOrNull(left?.lineNumber) ?? 0);
}

function resolveStoreConnection(connection) {
    return path.isAbsolute(connection) ? connection : path.resolve(repoRoot, connection);
}

function normalizeStoreBackend(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized || "sqlite";
}

function normalizePositiveInteger(value, fallback, max) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.min(Math.max(normalized, 1), max);
}

function parseInstantMs(value) {
    const normalized = asText(value);
    if (!normalized) {
        return null;
    }

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function olderTimestamp(current, candidate) {
    if (!candidate) {
        return current ?? null;
    }
    if (!current) {
        return candidate;
    }

    const currentMs = parseInstantMs(current);
    const candidateMs = parseInstantMs(candidate);
    if (currentMs == null || candidateMs == null) {
        return current;
    }
    return candidateMs < currentMs ? candidate : current;
}

function newerTimestamp(current, candidate) {
    if (!candidate) {
        return current ?? null;
    }
    if (!current) {
        return candidate;
    }

    const currentMs = parseInstantMs(current);
    const candidateMs = parseInstantMs(candidate);
    if (currentMs == null) {
        return candidate;
    }
    if (candidateMs == null) {
        return current;
    }
    return candidateMs >= currentMs ? candidate : current;
}

function finiteIntegerOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    return null;
}

function asText(value) {
    const text = String(value ?? "").trim();
    return text ? text : "";
}

function addUnique(items, value) {
    if (!value || items.includes(value)) {
        return;
    }
    items.push(value);
}

export function readJsonFile(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}
