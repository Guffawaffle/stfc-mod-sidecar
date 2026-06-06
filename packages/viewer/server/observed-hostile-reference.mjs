import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const referenceDataDir = path.resolve(__dirname, "..", "reference-data");
const manifestPath = path.join(referenceDataDir, "manifest.json");

let cachedCatalogPromise;

export async function loadObservedHostileReferenceCatalog() {
    cachedCatalogPromise ??= readObservedHostileReferenceCatalog();
    return cachedCatalogPromise;
}

export function buildObservedHostileReferenceSummary(catalog) {
    if (!catalog?.available) {
        return {
            available: false,
            source: "bundled",
            packId: null,
            version: null,
            entryCount: 0,
        };
    }

    return {
        available: true,
        source: "bundled",
        packId: catalog.pack.packId,
        version: catalog.pack.version,
        entryCount: catalog.pack.entryCount ?? catalog.entries.length,
    };
}

export function matchObservedHostileReference(entry, catalog) {
    if (!catalog?.available) {
        return unavailableReferenceMatch();
    }

    const observed = observedMatchSignals(entry);
    if (observed.systemIds.length === 0 && observed.levels.length === 0 && observed.hullTypeValues.length === 0 && observed.labelTokens.length === 0) {
        return {
            available: true,
            status: "insufficient_signal",
            confidence: "none",
            summary: "Stored observations do not yet include enough stable fields to compare against the bundled hostile baseline.",
            candidateCount: 0,
            matches: [],
        };
    }

    const candidates = scoredReferenceCandidates(observed, catalog);
    if (candidates.length === 0) {
        return {
            available: true,
            status: "unmapped",
            confidence: "none",
            summary: "No bundled hostile baseline entries matched the current observed fields.",
            candidateCount: 0,
            matches: [],
        };
    }

    const topScore = candidates[0].matchScore;
    const topMatches = candidates.filter((candidate) => candidate.matchScore === topScore);
    const matchStatus = topMatches.length === 1 && topScore >= 10
        ? "matched"
        : topMatches.length === 1
            ? "candidate"
            : "ambiguous";

    return {
        available: true,
        status: matchStatus,
        confidence: matchStatus === "matched" ? "high" : matchStatus === "candidate" ? "medium" : "low",
        summary: baselineSummary(matchStatus, topMatches, catalog),
        candidateCount: topMatches.length,
        rankedCandidateCount: candidates.length,
        matches: candidates.slice(0, 6),
    };
}

async function readObservedHostileReferenceCatalog() {
    try {
        const manifest = await readJson(manifestPath);
        const packDescriptor = Array.isArray(manifest?.packs)
            ? manifest.packs.find((item) => item?.packId === "stfc-space.hostiles" && item?.kind === "hostile_catalog")
            : null;
        if (!packDescriptor?.path) {
            return { available: false, error: "Bundled hostile reference pack is not installed." };
        }

        const packPath = path.join(referenceDataDir, packDescriptor.path);
        const pack = await readJson(packPath);
        const entries = Array.isArray(pack?.entries) ? pack.entries.map(normalizeReferenceEntry) : [];
        const bySystemId = buildSystemIndex(entries);
        return {
            available: true,
            manifest,
            pack,
            entries,
            bySystemId,
        };
    } catch (error) {
        return {
            available: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function readJson(filePath) {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
}

function normalizeReferenceEntry(entry) {
    const name = asText(entry?.name) || "Unknown hostile";
    const factionName = asText(entry?.factionName) || "";
    return {
        hostileId: asText(entry?.hostileId),
        name,
        normalizedName: normalizeSearchText(name),
        factionName,
        normalizedFactionName: normalizeSearchText(factionName),
        locaId: asText(entry?.locaId) || null,
        factionId: asText(entry?.factionId) || null,
        level: finiteIntegerOrNull(entry?.level),
        shipTypeValue: finiteIntegerOrNull(entry?.shipTypeValue),
        hullTypeValue: finiteIntegerOrNull(entry?.hullTypeValue),
        rarity: finiteIntegerOrNull(entry?.rarity),
        strength: finiteIntegerOrNull(entry?.strength),
        warp: finiteIntegerOrNull(entry?.warp),
        warpWithSuperhighway: finiteIntegerOrNull(entry?.warpWithSuperhighway),
        systemIds: uniqueTextList(entry?.systemIds),
        systemCount: Array.isArray(entry?.systemIds) ? entry.systemIds.length : 0,
        xpAmount: finiteIntegerOrNull(entry?.xpAmount),
        detailAvailable: entry?.detailAvailable === true,
        componentCount: finiteIntegerOrNull(entry?.componentCount),
        abilityCount: finiteIntegerOrNull(entry?.abilityCount),
        stats: isRecord(entry?.stats) ? entry.stats : null,
    };
}

function buildSystemIndex(entries) {
    const bySystemId = new Map();
    for (const entry of entries) {
        for (const systemId of entry.systemIds) {
            const items = bySystemId.get(systemId) ?? [];
            items.push(entry);
            bySystemId.set(systemId, items);
        }
    }
    return bySystemId;
}

function observedMatchSignals(entry) {
    const latest = asRecord(entry?.latestObservation);
    const hullNames = uniqueTextList([...(Array.isArray(entry?.hullNames) ? entry.hullNames : []), latest.hullName]);
    const labelTokens = hullNames.flatMap(tokensFromHullLabel);
    const factionTokens = uniqueTextList(hullNames.flatMap((name) => expandFactionAbbreviations(tokensFromHullLabel(name))));
    return {
        systemIds: uniqueTextList([...(Array.isArray(entry?.systemIds) ? entry.systemIds : []), latest.systemId]),
        levels: uniqueIntegerList([...(Array.isArray(entry?.userLevels) ? entry.userLevels : []), latest.userLevel]),
        hullTypeValues: uniqueIntegerList([...(Array.isArray(entry?.hullTypeValues) ? entry.hullTypeValues : []), latest.hullTypeValue]),
        labelTokens: uniqueTextList(labelTokens),
        factionTokens,
    };
}

function scoredReferenceCandidates(observed, catalog) {
    const baseCandidates = observed.systemIds.length > 0
        ? uniqueReferenceEntries(observed.systemIds.flatMap((systemId) => catalog.bySystemId.get(systemId) ?? []))
        : catalog.entries;
    const scored = [];
    for (const candidate of baseCandidates) {
        const matchSignals = [];
        let score = 0;

        if (observed.systemIds.some((systemId) => candidate.systemIds.includes(systemId))) {
            score += 3;
            matchSignals.push("system");
        }
        if (observed.levels.length > 0 && observed.levels.includes(candidate.level)) {
            score += 4;
            matchSignals.push("level");
        }
        if (observed.hullTypeValues.length > 0 && observed.hullTypeValues.includes(candidate.hullTypeValue)) {
            score += 4;
            matchSignals.push("hull_type");
        }

        const factionMatched = observed.factionTokens.some((token) => candidate.normalizedFactionName.includes(token));
        if (factionMatched) {
            score += 2;
            matchSignals.push("faction");
        }

        const labelMatched = observed.labelTokens.some((token) => token.length >= 4 && candidate.normalizedName.includes(token));
        if (labelMatched) {
            score += 1;
            matchSignals.push("label");
        }

        if (score <= 0) {
            continue;
        }

        scored.push({
            hostileId: candidate.hostileId,
            name: candidate.name,
            factionName: candidate.factionName || null,
            level: candidate.level,
            hullTypeValue: candidate.hullTypeValue,
            shipTypeValue: candidate.shipTypeValue,
            strength: candidate.strength,
            warp: candidate.warp,
            systemCount: candidate.systemCount,
            xpAmount: candidate.xpAmount,
            detailAvailable: candidate.detailAvailable,
            matchScore: score,
            matchSignals,
        });
    }

    return scored.sort(compareReferenceCandidates);
}

function baselineSummary(status, matches, catalog) {
    switch (status) {
        case "matched":
            return `Bundled ${catalog.pack.packId} baseline found one high-confidence hostile candidate.`;
        case "candidate":
            return `Bundled ${catalog.pack.packId} baseline found one likely hostile candidate.`;
        case "ambiguous":
            return `Bundled ${catalog.pack.packId} baseline found multiple plausible hostile candidates for this entry.`;
        default:
            return "Bundled hostile baseline comparison is unavailable.";
    }
}

function compareReferenceCandidates(left, right) {
    if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
    }
    if ((right.level ?? -1) !== (left.level ?? -1)) {
        return (right.level ?? -1) - (left.level ?? -1);
    }
    return String(left.hostileId).localeCompare(String(right.hostileId));
}

function unavailableReferenceMatch() {
    return {
        available: false,
        status: "unavailable",
        confidence: "none",
        summary: "Bundled hostile baseline data is unavailable.",
        candidateCount: 0,
        matches: [],
    };
}

function tokensFromHullLabel(value) {
    return normalizeSearchText(asText(value))
        .split(/[^a-z0-9]+/u)
        .filter(Boolean)
        .filter((token) => !/^hull$/u.test(token))
        .filter((token) => !/^l\d+$/u.test(token))
        .filter((token) => !/^g\d+$/u.test(token))
        .filter((token) => !["destroyer", "explorer", "battleship"].includes(token));
}

function expandFactionAbbreviations(tokens) {
    const expanded = [];
    for (const token of Array.isArray(tokens) ? tokens : []) {
        expanded.push(token);
        switch (token) {
            case "rom":
                expanded.push("romulan");
                break;
            case "fed":
                expanded.push("federation");
                break;
            case "kli":
            case "kling":
                expanded.push("klingon");
                break;
            case "dom":
                expanded.push("dominion");
                break;
            default:
                break;
        }
    }
    return expanded;
}

function uniqueReferenceEntries(entries) {
    const items = [];
    const seen = new Set();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const hostileId = asText(entry?.hostileId);
        if (!hostileId || seen.has(hostileId)) {
            continue;
        }
        seen.add(hostileId);
        items.push(entry);
    }
    return items;
}

function uniqueTextList(values) {
    const items = [];
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = asText(value);
        if (normalized && !items.includes(normalized)) {
            items.push(normalized);
        }
    }
    return items;
}

function uniqueIntegerList(values) {
    const items = [];
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = finiteIntegerOrNull(value);
        if (normalized != null && !items.includes(normalized)) {
            items.push(normalized);
        }
    }
    return items;
}

function finiteIntegerOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSearchText(value) {
    return asText(value).toLowerCase();
}

function asText(value) {
    return typeof value === "string"
        ? value.trim()
        : typeof value === "number" && Number.isFinite(value)
            ? `${Math.trunc(value)}`
            : "";
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value) {
    return isRecord(value) ? value : {};
}
