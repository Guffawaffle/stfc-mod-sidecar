import fs from "node:fs";
import path from "node:path";

export const RUNTIME_NAME_SNAPSHOT_DIR_ENV = "STFC_LOCAL_NAME_SNAPSHOT_DIR";
export const LEGACY_RUNTIME_NAME_SNAPSHOT_DIR_ENV = "STFC_SIDECAR_RUNTIME_NAME_SNAPSHOT_ROOT";
const DEFAULT_SNAPSHOT_ROOTS = Object.freeze([
    "D:\\dev\\stfc-local-name-snapshot",
    "D:\\dev\\majel\\data\\.stfc-snapshot",
    "\\\\wsl.localhost\\rt-trans\\srv\\majel\\data\\.stfc-snapshot",
    "/srv/majel/data/.stfc-snapshot",
]);

let cachedCatalog = null;

export function getRuntimeEffectNameCatalog(options = {}) {
    if (cachedCatalog) {
        return cachedCatalog;
    }

    cachedCatalog = loadRuntimeEffectNameCatalog(options);
    return cachedCatalog;
}

export function resetRuntimeEffectNameCatalogForTests() {
    cachedCatalog = null;
}

export function buildRuntimeEffectNameCatalog({
    officerSummary = [],
    officerNames = [],
    officerBuffs = [],
    provenance = {},
} = {}) {
    const officerNameByLocaId = buildTranslationIndex(officerNames, "officer_name");
    const abilityNameByLocaId = buildTranslationIndex(officerBuffs, "officer_ability_name");
    const officersById = new Map();
    const abilitiesById = new Map();

    for (const record of officerSummary.filter(isRecord)) {
        const officerId = toId(record.game_id ?? record.id);
        if (!officerId) {
            continue;
        }

        const officerLocaId = toId(record.loca_id);
        const officerName = officerLocaId ? officerNameByLocaId.get(officerLocaId)?.text ?? null : null;
        const officerEntry = {
            officerId,
            locaId: officerLocaId,
            name: officerName,
            captainManeuverId: null,
            captainManeuverLocaId: null,
            officerAbilityId: null,
            officerAbilityLocaId: null,
            belowDecksAbilityId: null,
            belowDecksAbilityLocaId: null,
        };

        for (const slot of OFFICER_ABILITY_SLOTS) {
            const abilityRef = isRecord(record[slot.recordKey]) ? record[slot.recordKey] : null;
            if (!abilityRef) {
                continue;
            }

            const abilityId = toId(abilityRef.id);
            const abilityLocaId = toId(abilityRef.loca_id);
            if (!abilityId) {
                continue;
            }

            officerEntry[slot.effectSlot] = abilityId;
            officerEntry[slot.locaSlot] = abilityLocaId;

            const translation = abilityLocaId ? abilityNameByLocaId.get(abilityLocaId) ?? null : null;
            abilitiesById.set(abilityId, {
                abilityId,
                locaId: abilityLocaId,
                name: translation?.text ?? null,
                sourceRef: translation?.sourceRef ?? null,
                officerId,
                effectSlot: slot.effectSlot,
            });
        }

        officersById.set(officerId, officerEntry);
    }

    const rootPath = text(provenance.rootPath);
    const configuredPath = text(provenance.configuredPath);
    const configuredFrom = text(provenance.configuredFrom);
    const snapshotVersion = text(provenance.snapshotVersion);
    const status = text(provenance.status) ?? (rootPath ? "loaded" : "unavailable");
    const sourceLabel = text(provenance.sourceLabel) ?? (status === "loaded" ? "local_snapshot" : "unavailable");
    const availableFiles = {
        officerSummary: officerSummary.length > 0,
        officerNames: officerNames.length > 0,
        officerBuffs: officerBuffs.length > 0,
        forbiddenTech: false,
        chaosTech: false,
        buffDebuffCatalog: false,
    };

    return {
        status,
        sourceLabel,
        configuredPath,
        configuredFrom,
        rootPath,
        snapshotVersion,
        officerCount: officersById.size,
        abilityCount: abilitiesById.size,
        availableFiles,
        sourceReconciliationNote: status === "loaded"
            ? "Names come from a local snapshot. Other catalogs may label the same IDs differently."
            : "No local snapshot is loaded. Names fall back to catalog.snapshot when present, otherwise exact refs remain visible.",
        resolveOfficer({ officerId, locaKey } = {}) {
            const directMatch = officerId ? officersById.get(String(officerId)) ?? null : null;
            if (directMatch?.name) {
                return {
                    name: directMatch.name,
                    resolution: "local_snapshot",
                    source: buildSourceLabel(sourceLabel, "officer_names", directMatch.locaId),
                };
            }

            const locaId = toId(locaKey);
            const byLocaId = locaId ? officerNameByLocaId.get(locaId) ?? null : null;
            if (byLocaId) {
                return {
                    name: byLocaId.text,
                    resolution: "local_snapshot",
                    source: byLocaId.sourceRef,
                };
            }

            return unresolvedNameMatch();
        },
        resolveAbility({ officerId, effectId, effectSlot } = {}) {
            const directMatch = effectId ? abilitiesById.get(String(effectId)) ?? null : null;
            if (directMatch?.name) {
                return {
                    name: directMatch.name,
                    resolution: "local_snapshot",
                    source: directMatch.sourceRef ?? buildSourceLabel(sourceLabel, "officer_buffs", directMatch.locaId),
                };
            }

            const officer = officerId ? officersById.get(String(officerId)) ?? null : null;
            if (!officer || !effectSlot) {
                return unresolvedNameMatch();
            }

            const locatedAbilityId = officer[effectSlot];
            if (!locatedAbilityId) {
                return unresolvedNameMatch();
            }

            const slotMatch = abilitiesById.get(String(locatedAbilityId)) ?? null;
            if (!slotMatch?.name) {
                return unresolvedNameMatch();
            }

            return {
                name: slotMatch.name,
                resolution: "local_snapshot",
                source: slotMatch.sourceRef ?? buildSourceLabel(sourceLabel, "officer_buffs", slotMatch.locaId),
            };
        },
    };
}

function loadRuntimeEffectNameCatalog(options = {}) {
    const candidates = snapshotRootCandidates(options);
    for (const candidate of candidates) {
        const catalog = loadRuntimeEffectNameCatalogFromRoot(candidate);
        if (catalog) {
            return catalog;
        }
    }

    return buildRuntimeEffectNameCatalog({
        provenance: {
            sourceLabel: "unavailable",
            configuredPath: candidates[0]?.rootPath ?? null,
            configuredFrom: candidates[0]?.configuredFrom ?? null,
            rootPath: null,
            snapshotVersion: null,
            status: "unavailable",
        },
    });
}

function loadRuntimeEffectNameCatalogFromRoot(candidate) {
    const rootPath = candidate?.rootPath;
    if (!rootPath) {
        return null;
    }
    const summaryPath = path.join(rootPath, "officer", "summary.json");
    const officerNamesPath = path.join(rootPath, "translations", "en", "officer_names.json");
    const officerBuffsPath = path.join(rootPath, "translations", "en", "officer_buffs.json");
    if (!fs.existsSync(summaryPath) || !fs.existsSync(officerNamesPath) || !fs.existsSync(officerBuffsPath)) {
        return null;
    }

    try {
        const officerSummary = parseJsonFile(summaryPath);
        const officerNames = parseJsonFile(officerNamesPath);
        const officerBuffs = parseJsonFile(officerBuffsPath);
        const versionPath = path.join(rootPath, "version.txt");
        const snapshotVersion = fs.existsSync(versionPath) ? safeReadText(versionPath) : null;

        return buildRuntimeEffectNameCatalog({
            officerSummary: Array.isArray(officerSummary) ? officerSummary : [],
            officerNames: Array.isArray(officerNames) ? officerNames : [],
            officerBuffs: Array.isArray(officerBuffs) ? officerBuffs : [],
            provenance: {
                sourceLabel: "local_snapshot",
                configuredPath: candidate.configuredPath,
                configuredFrom: candidate.configuredFrom,
                rootPath,
                snapshotVersion,
                status: "loaded",
            },
        });
    } catch {
        return null;
    }
}

function snapshotRootCandidates(options = {}) {
    const env = isRecord(options.env) ? options.env : process.env;
    const fallbackRoots = Array.isArray(options.fallbackRoots) ? options.fallbackRoots : DEFAULT_SNAPSHOT_ROOTS;
    const explicitRoot = firstConfiguredRoot(env);
    const candidates = [];

    if (explicitRoot) {
        candidates.push(explicitRoot);
    }

    for (const rootPath of fallbackRoots) {
        const normalizedPath = text(rootPath);
        if (!normalizedPath) {
            continue;
        }
        if (candidates.some((candidate) => candidate.rootPath === normalizedPath)) {
            continue;
        }
        candidates.push({
            rootPath: normalizedPath,
            configuredPath: normalizedPath,
            configuredFrom: "developer_fallback",
        });
    }

    return candidates;
}

function firstConfiguredRoot(env) {
    const explicit = text(env[RUNTIME_NAME_SNAPSHOT_DIR_ENV]);
    if (explicit) {
        return {
            rootPath: explicit,
            configuredPath: explicit,
            configuredFrom: RUNTIME_NAME_SNAPSHOT_DIR_ENV,
        };
    }

    const legacy = text(env[LEGACY_RUNTIME_NAME_SNAPSHOT_DIR_ENV]);
    if (legacy) {
        return {
            rootPath: legacy,
            configuredPath: legacy,
            configuredFrom: LEGACY_RUNTIME_NAME_SNAPSHOT_DIR_ENV,
        };
    }

    return null;
}

function buildTranslationIndex(entries, expectedKey) {
    const index = new Map();
    for (const entry of entries.filter(isRecord)) {
        if (text(entry.key) !== expectedKey) {
            continue;
        }

        const externalId = toId(entry.id);
        const translationText = text(entry.text);
        if (!externalId || !translationText) {
            continue;
        }

        index.set(externalId, {
            text: translationText,
            sourceRef: buildSourceLabel("local_snapshot", expectedKey === "officer_name" ? "officer_names" : "officer_buffs", externalId),
        });
    }
    return index;
}

function parseJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeReadText(filePath) {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value || null;
}

function buildSourceLabel(prefix, translationPack, externalId) {
    return `${prefix}:${translationPack}:${externalId ?? "unknown"}`;
}

function unresolvedNameMatch() {
    return {
        name: null,
        resolution: "fallback_ref",
        source: null,
    };
}

function toId(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized || null;
    }
    return null;
}

function text(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OFFICER_ABILITY_SLOTS = Object.freeze([
    { recordKey: "captain_ability", effectSlot: "captainManeuverId", locaSlot: "captainManeuverLocaId" },
    { recordKey: "ability", effectSlot: "officerAbilityId", locaSlot: "officerAbilityLocaId" },
    { recordKey: "below_decks_ability", effectSlot: "belowDecksAbilityId", locaSlot: "belowDecksAbilityLocaId" },
]);
