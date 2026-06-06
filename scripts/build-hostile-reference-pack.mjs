import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_CRAWL_ROOT = process.env.STFC_SPACE_CRAWL_ROOT?.trim() || "/srv/crawlers/stfc.space";
const REFERENCE_DIR = path.join(repoRoot, "packages", "viewer", "reference-data");
const PACK_DIR = path.join(REFERENCE_DIR, "packs");
const MANIFEST_PATH = path.join(REFERENCE_DIR, "manifest.json");
const MANIFEST_SCHEMA = "stfc.sidecar.reference-manifest.v0";
const PACK_SCHEMA = "stfc.sidecar.reference-pack.v0";
const PACK_ID = "stfc-space.hostiles";

const args = parseArgs(process.argv.slice(2));
const crawlRoot = path.resolve(args.crawlRoot || DEFAULT_CRAWL_ROOT);

await mkdir(PACK_DIR, { recursive: true });

const hostileMetadata = await readJson(crawlPath("data", "raw", "hostile", "_metadata.json"));
const hostileSummary = await readJson(crawlPath("data", "raw", "hostile", "summary.json"));
const navigationTranslations = await readJson(crawlPath("data", "raw", "translations", "navigation.json"));
const officerNameTranslations = await readJson(crawlPath("data", "raw", "translations", "officer_names.json"));
const factionTranslations = await readJson(crawlPath("data", "raw", "translations", "factions.json"));

const hostileNameByLocaId = buildTranslationMap(
    [...navigationTranslations, ...officerNameTranslations],
    ["marauder_name_only", "officer_name", "marauder_name"],
);
const factionNameByLocaId = buildTranslationMap(factionTranslations, ["faction_name", "faction_name_upper"]);
const detailDirectory = crawlPath("data", "raw", "hostile", "details");
const packVersion = versionFromCapturedAt(hostileMetadata?.capturedAt);
const generatedAt = new Date().toISOString();
const packFileName = `${PACK_ID}.v${packVersion}.json`;
const packRelativePath = `packs/${packFileName}`;
const packPath = path.join(PACK_DIR, packFileName);

const entries = [];
for (const hostile of Array.isArray(hostileSummary) ? hostileSummary : []) {
    const detailPath = path.join(detailDirectory, `${hostile?.id}.json`);
    const detail = await readJsonIfExists(detailPath);
    const stats = detailStats(detail?.stats);
    const componentIds = uniqueStringList(Array.isArray(detail?.components) ? detail.components.map((component) => component?.id) : []);

    entries.push({
        hostileId: exactString(hostile?.id),
        name: exactString(hostileNameByLocaId.get(exactString(hostile?.loca_id) || "")) || null,
        locaId: exactString(hostile?.loca_id),
        factionId: exactString(hostile?.faction?.id),
        factionLocaId: exactString(hostile?.faction?.loca_id),
        factionName: exactString(factionNameByLocaId.get(exactString(hostile?.faction?.loca_id) || "")) || null,
        level: finiteIntegerOrNull(hostile?.level),
        shipTypeValue: finiteIntegerOrNull(hostile?.ship_type),
        hullTypeValue: finiteIntegerOrNull(hostile?.hull_type),
        rarity: finiteIntegerOrNull(hostile?.rarity),
        strength: finiteIntegerOrNull(hostile?.strength),
        warp: finiteIntegerOrNull(hostile?.warp),
        warpWithSuperhighway: finiteIntegerOrNull(hostile?.warp_with_superhighway),
        systemIds: uniqueStringList(hostile?.systems),
        resourceIds: uniqueStringList(Array.isArray(hostile?.resources) ? hostile.resources.map((resource) => resource?.resource_id) : []),
        xpAmount: finiteIntegerOrNull(detail?.xp_amount),
        detailAvailable: Boolean(detail),
        componentIds,
        componentCount: componentIds.length,
        abilityCount: Array.isArray(detail?.ability) ? detail.ability.length : 0,
        stats,
    });
}

entries.sort((left, right) => {
    const levelDelta = (left.level ?? -1) - (right.level ?? -1);
    if (levelDelta !== 0) {
        return levelDelta;
    }

    const leftName = left.name || "";
    const rightName = right.name || "";
    const nameDelta = leftName.localeCompare(rightName);
    if (nameDelta !== 0) {
        return nameDelta;
    }

    return String(left.hostileId).localeCompare(String(right.hostileId));
});

const pack = {
    schemaVersion: PACK_SCHEMA,
    packId: PACK_ID,
    kind: "hostile_catalog",
    version: packVersion,
    generatedAt,
    source: {
        name: "stfc.space",
        summaryUrl: exactString(hostileMetadata?.summaryUrl) || null,
        capturedAt: exactString(hostileMetadata?.capturedAt) || null,
        summaryCount: finiteIntegerOrNull(hostileMetadata?.summaryCount) ?? entries.length,
    },
    entryCount: entries.length,
    entries,
};

const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    generatedAt,
    packs: [
        {
            packId: PACK_ID,
            kind: "hostile_catalog",
            version: packVersion,
            path: packRelativePath,
            entryCount: entries.length,
            generatedAt,
            source: {
                name: "stfc.space",
                capturedAt: exactString(hostileMetadata?.capturedAt) || null,
            },
        },
    ],
};

await writeJson(packPath, pack);
await writeJson(MANIFEST_PATH, manifest);

const packStats = await stat(packPath);
console.log(JSON.stringify({
    ok: true,
    packId: PACK_ID,
    version: packVersion,
    crawlRoot,
    manifestPath: MANIFEST_PATH,
    packPath,
    entryCount: entries.length,
    bytes: packStats.size,
}, null, 2));

function crawlPath(...parts) {
    return path.join(crawlRoot, ...parts);
}

async function readJson(filePath) {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
}

async function readJsonIfExists(filePath) {
    try {
        return await readJson(filePath);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function writeJson(filePath, value) {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = String(argv[index] ?? "").trim();
        if (!token.startsWith("--")) {
            continue;
        }

        const key = token.slice(2);
        const next = argv[index + 1];
        if (next && !String(next).startsWith("--")) {
            result[key] = String(next);
            index += 1;
            continue;
        }

        result[key] = "true";
    }
    return result;
}

function buildTranslationMap(rows, preferredKeys) {
    const keyRank = new Map(preferredKeys.map((key, index) => [key, index]));
    const best = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const id = exactString(row?.id);
        const key = exactString(row?.key);
        const text = exactString(row?.text);
        if (!id || !key || !text) {
            continue;
        }

        const rank = keyRank.has(key) ? keyRank.get(key) : preferredKeys.length + 1;
        const current = best.get(id);
        if (!current || rank < current.rank) {
            best.set(id, { rank, text: text.trim() });
        }
    }

    return new Map([...best.entries()].map(([id, value]) => [id, value.text]));
}

function detailStats(stats) {
    if (!isRecord(stats)) {
        return null;
    }

    const summarized = {
        health: finiteNumberOrNull(stats.health),
        defense: finiteNumberOrNull(stats.defense),
        attack: finiteNumberOrNull(stats.attack),
        dpr: finiteNumberOrNull(stats.dpr),
        hullHp: finiteNumberOrNull(stats.hull_hp),
        shieldHp: finiteNumberOrNull(stats.shield_hp),
        armor: finiteNumberOrNull(stats.armor),
        absorption: finiteNumberOrNull(stats.absorption),
        dodge: finiteNumberOrNull(stats.dodge),
        accuracy: finiteNumberOrNull(stats.accuracy),
        armorPiercing: finiteNumberOrNull(stats.armor_piercing),
        shieldPiercing: finiteNumberOrNull(stats.shield_piercing),
        criticalChance: finiteNumberOrNull(stats.critical_chance),
        criticalDamage: finiteNumberOrNull(stats.critical_damage),
    };

    return Object.values(summarized).some((value) => value != null) ? summarized : null;
}

function uniqueStringList(values) {
    const items = [];
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = exactString(value);
        if (normalized && !items.includes(normalized)) {
            items.push(normalized);
        }
    }
    return items;
}

function versionFromCapturedAt(value) {
    const instant = exactString(value);
    if (!instant) {
        return "unknown";
    }

    const matched = /^(\d{4}-\d{2}-\d{2})/.exec(instant);
    return matched ? matched[1] : instant.replaceAll(/[^0-9A-Za-z._-]+/g, "-");
}

function finiteIntegerOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function finiteNumberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exactString(value) {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized ? normalized : "";
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return `${Math.trunc(value)}`;
    }

    return "";
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
