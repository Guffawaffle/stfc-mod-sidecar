import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

const DEFAULT_FEED_PATH = "C:\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_battle_feed.jsonl";
const TOP_COMPONENT_LIMIT = 16;

const feedPath = resolveFeedPath(process.argv[2] ?? process.env.STFC_SIDECAR_FEED_PATH ?? DEFAULT_FEED_PATH);
const rows = [];
const componentNames = new Map();
let lineCount = 0;
let analyticsEventCount = 0;
let catalogSnapshotCount = 0;
let parseFailureCount = 0;

for await (const line of createInterface({ input: createReadStream(feedPath), crlfDelay: Infinity })) {
    lineCount += 1;
    if (!line.trim()) {
        continue;
    }

    let event;
    try {
        event = JSON.parse(line);
    } catch {
        parseFailureCount += 1;
        continue;
    }

    if (event?.type === "catalog.snapshot") {
        catalogSnapshotCount += 1;
        rememberComponentNames(event);
        continue;
    }

    if (event?.type !== "battle.analytics") {
        continue;
    }

    analyticsEventCount += 1;
    const attackRows = event.analytics?.attackRows;
    if (!Array.isArray(attackRows)) {
        continue;
    }

    for (const attack of attackRows) {
        const damage = attack.damage ?? {};
        const hull = numeric(damage.hull);
        const shield = numeric(damage.shield);
        const mitigated = numeric(damage.mitigated);
        const totalIsolytic = numeric(damage.totalIsolytic);
        const slot14 = numeric(damage.unknownScalarA);
        const slot15 = numeric(damage.unknownScalarB);

        if (!Number.isFinite(slot14) || !Number.isFinite(slot15)) {
            continue;
        }

        rows.push({
            battleId: String(event.battleId ?? event.journalId ?? ""),
            timestamp: String(event.timestamp ?? ""),
            battleType: event.battleType ?? null,
            componentId: String(attack.componentId ?? ""),
            attackerKind: String(attack.attacker?.participantKind ?? "unknown"),
            targetKind: String(attack.target?.participantKind ?? "unknown"),
            critical: Boolean(attack.critical),
            triggeredEffectCount: numeric(attack.triggeredEffectCount),
            hull,
            shield,
            mitigated,
            totalIsolytic,
            slot14,
            slot15,
            rawDamage: hull + shield,
            totalDamage: hull + shield + mitigated,
        });
    }
}

const report = {
    feedPath,
    generatedAt: new Date().toISOString(),
    corpus: {
        lines: lineCount,
        catalogSnapshots: catalogSnapshotCount,
        analyticsEvents: analyticsEventCount,
        parseFailures: parseFailureCount,
        attackRows: rows.length,
        battles: new Set(rows.map((row) => row.battleId)).size,
    },
    payloadSlots: {
        slot14: "damage.unknownScalarA",
        slot15: "damage.unknownScalarB",
        candidatePrimeColumns: [
            "mitigatedIsolyticDamage",
            "mitigatedApexBarrier",
            "chargingWeaponsPercent",
        ],
        note: "These are correlation candidates only. Keep labels unresolved until matched against a known Prime row or confirmed marker semantics.",
    },
    overall: {
        slot14: numericStats(rows, "slot14"),
        slot15: numericStats(rows, "slot15"),
    },
    correlations: {
        slot14: correlations(rows, "slot14"),
        slot15: correlations(rows, "slot15"),
    },
    byCombatFlow: groupBy(rows, (row) => `${row.attackerKind}->${row.targetKind}`)
        .map(([flow, flowRows]) => flowStats(flow, flowRows)),
    topComponents: groupBy(rows, (row) => row.componentId)
        .sort((left, right) => right[1].length - left[1].length)
        .slice(0, TOP_COMPONENT_LIMIT)
        .map(([componentId, componentRows]) => ({
            componentId,
            componentName: componentNames.get(componentId) ?? null,
            rows: componentRows.length,
            flows: Object.fromEntries(groupBy(componentRows, (row) => `${row.attackerKind}->${row.targetKind}`)
                .map(([flow, flowRows]) => [flow, flowRows.length])),
            slot14: numericStats(componentRows, "slot14"),
            slot15: numericStats(componentRows, "slot15"),
            ratios: ratioBlock(componentRows),
        })),
};

console.log(`${JSON.stringify(report, null, 2)}\n`);

function rememberComponentNames(event) {
    const components = event.catalog?.domains?.components;
    if (!components || typeof components !== "object") {
        return;
    }

    for (const [id, component] of Object.entries(components)) {
        if (componentNames.has(id)) {
            continue;
        }

        const name = typeof component?.name === "string" ? component.name : null;
        if (name) {
            componentNames.set(id, name);
        }
    }
}

function flowStats(flow, flowRows) {
    return {
        flow,
        rows: flowRows.length,
        slot14: numericStats(flowRows, "slot14"),
        slot15: numericStats(flowRows, "slot15"),
        ratios: ratioBlock(flowRows),
    };
}

function ratioBlock(sourceRows) {
    return {
        slot14OverRawDamage: ratioStats(sourceRows, "slot14", "rawDamage"),
        slot15OverRawDamage: ratioStats(sourceRows, "slot15", "rawDamage"),
        slot14OverTotalIsolytic: ratioStats(sourceRows, "slot14", "totalIsolytic"),
        slot15OverTotalDamage: ratioStats(sourceRows, "slot15", "totalDamage"),
    };
}

function correlations(sourceRows, scalarKey) {
    return Object.fromEntries(["hull", "shield", "rawDamage", "mitigated", "totalIsolytic", "totalDamage"]
        .map((metric) => [metric, round(correlation(sourceRows, scalarKey, metric), 4)]));
}

function numericStats(sourceRows, key) {
    const values = sourceRows.map((row) => row[key]).filter(Number.isFinite).sort((left, right) => left - right);
    if (values.length === 0) {
        return null;
    }

    return {
        n: values.length,
        zero: values.filter((value) => value === 0).length,
        min: quantile(values, 0),
        p10: quantile(values, 0.1),
        median: quantile(values, 0.5),
        p90: quantile(values, 0.9),
        max: quantile(values, 1),
        smallDistinctSample: [...new Set(values
            .filter((value) => Math.abs(value) <= 2)
            .map((value) => round(value, 9)))]
            .slice(0, 20),
    };
}

function ratioStats(sourceRows, numeratorKey, denominatorKey) {
    const values = sourceRows
        .map((row) => row[denominatorKey] ? row[numeratorKey] / row[denominatorKey] : NaN)
        .filter(Number.isFinite)
        .sort((left, right) => left - right);

    if (values.length === 0) {
        return null;
    }

    return {
        n: values.length,
        min: quantile(values, 0),
        p10: quantile(values, 0.1),
        median: quantile(values, 0.5),
        p90: quantile(values, 0.9),
        max: quantile(values, 1),
    };
}

function correlation(sourceRows, leftKey, rightKey) {
    const pairs = sourceRows
        .map((row) => [row[leftKey], row[rightKey]])
        .filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right));

    if (pairs.length < 2) {
        return null;
    }

    const leftMean = mean(pairs.map(([left]) => left));
    const rightMean = mean(pairs.map(([, right]) => right));
    let numerator = 0;
    let leftVariance = 0;
    let rightVariance = 0;

    for (const [left, right] of pairs) {
        const leftDelta = left - leftMean;
        const rightDelta = right - rightMean;
        numerator += leftDelta * rightDelta;
        leftVariance += leftDelta * leftDelta;
        rightVariance += rightDelta * rightDelta;
    }

    const denominator = Math.sqrt(leftVariance * rightVariance);
    return denominator === 0 ? null : numerator / denominator;
}

function groupBy(values, keyFn) {
    const groups = new Map();
    for (const value of values) {
        const key = keyFn(value);
        const group = groups.get(key) ?? [];
        group.push(value);
        groups.set(key, group);
    }
    return [...groups.entries()];
}

function quantile(sortedValues, p) {
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * p)));
    return sortedValues[index];
}

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numeric(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, places) {
    if (!Number.isFinite(value)) {
        return null;
    }

    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

function resolveFeedPath(feedPath) {
    const platformPath = normalizeWindowsPathForWsl(feedPath);
    return path.resolve(platformPath);
}

function normalizeWindowsPathForWsl(feedPath) {
    if (process.platform !== "linux" || !isWsl()) {
        return feedPath;
    }

    const match = /^([A-Za-z]):[\\/](.*)$/.exec(feedPath);
    if (!match) {
        return feedPath;
    }

    return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

function isWsl() {
    if (process.env.WSL_DISTRO_NAME) {
        return true;
    }

    try {
        return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
    } catch {
        return false;
    }
}
