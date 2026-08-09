import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORPUS_SCHEMA = "stfc.battle-bridge.golden.v1";
const FIXTURE_SCHEMA = "stfc.battle-bridge.payload-fixture.v1";
const INVENTORY_PIN_SCHEMA = "stfc.battle-bridge.capability-evidence-pin.v1";
const PERMITTED_EVIDENCE_STATUSES = new Set([
  "payload-fixture-only",
  "source-observed-outside-bounded-corpus",
  "unproven-current-producer",
]);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const corpusDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(scriptDirectory, "..", "examples", "battle-bridge-golden-v1");

const corpus = readJson("corpus.json");
const fixtures = new Map([
  ["battle-capture.json", readJson("battle-capture.json")],
  ["fleet-runtime.json", readJson("fleet-runtime.json")],
]);

validateCorpus(corpus, fixtures);
for (const [name, fixture] of fixtures) {
  validateRedaction(fixture, name);
  validateFixture(name, fixture);
}
validateRedaction(corpus, "corpus.json");

const acceptedRuntimeContracts = corpus.capabilityEvidence
  .filter((entry) => entry.acceptedRuntimeContract === true)
  .map((entry) => entry.id);
const alertEvidence = corpus.capabilityEvidence.find((entry) => entry.id === "fleet.alert-evidence.v0");
process.stdout.write(`${JSON.stringify({
  ok: true,
  corpusSchema: corpus.corpusSchema,
  payloadFixtures: fixtures.size,
  provisionalCapabilities: corpus.capabilityEvidence.length,
  acceptedRuntimeContracts,
  fleetAlertProducerEvidence: alertEvidence.status,
}, null, 2)}\n`);

function readJson(fileName) {
  const raw = readFileSync(path.join(corpusDirectory, fileName), "utf8");
  rejectDuplicateJsonKeys(raw, fileName);
  validateRawRedaction(raw, fileName);
  return JSON.parse(raw);
}

function validateCorpus(value, loadedFixtures) {
  assert(value?.corpusSchema === CORPUS_SCHEMA, `corpusSchema must be ${CORPUS_SCHEMA}`);
  assert(value.status === "planning-evidence-only", "corpus must remain planning evidence only");
  assert(value.provisionalIds === true, "corpus IDs must remain explicitly provisional");

  const evidence = requireArray(value.capabilityEvidence, "capability evidence");
  const evidenceById = new Map();
  for (const entry of evidence) {
    assert(nonEmptyString(entry?.id), "capability evidence ID is required");
    assert(!evidenceById.has(entry.id), `duplicate capability evidence '${entry.id}'`);
    assert(nonEmptyString(entry.schema), `${entry.id} evidence schema is required`);
    assert(nonEmptyString(entry.status), `${entry.id} evidence status is required`);
    assert(PERMITTED_EVIDENCE_STATUSES.has(entry.status), `${entry.id} has a status this provisional schema cannot represent`);
    assert(entry.acceptedRuntimeContract === false, `${entry.id} cannot be an accepted runtime contract in this schema`);
    evidenceById.set(entry.id, entry);
    for (const file of requireArray(entry.fixtures, `fixtures for ${entry.id}`)) {
      assert(loadedFixtures.has(file), `${entry.id} references unknown fixture '${file}'`);
    }
  }

  const accepted = evidence.filter((entry) => entry.acceptedRuntimeContract === true);
  assert(accepted.length === 0, "this provisional corpus schema cannot contain accepted runtime contracts");
  validateCapabilityInventoryPin(value.capabilityInventoryPin, evidence);

  const contracts = requireArray(value.fixtureContracts, "fixture contracts");
  assert(contracts.length === loadedFixtures.size, "every bounded fixture needs one fixture contract");
  const contractFiles = new Set();
  for (const contract of contracts) {
    assert(!contractFiles.has(contract.file), `duplicate fixture contract '${contract.file}'`);
    contractFiles.add(contract.file);
    const fixture = loadedFixtures.get(contract.file);
    assert(fixture, `fixture contract references unknown file '${contract.file}'`);
    assertDeepEqual(contract.evidence, fixture.evidence, `${contract.file} evidence declaration`);
    const labels = new Set();
    for (const reference of requireArray(contract.evidence, `${contract.file} evidence`)) {
      assert(!labels.has(reference.label), `${contract.file} has duplicate evidence label '${reference.label}'`);
      labels.add(reference.label);
      const entry = evidenceById.get(reference.label);
      assert(entry, `${contract.file} references evidence outside the provisional inventory: '${reference.label}'`);
      assert(reference.schema === entry.schema, `${contract.file}/${reference.label} schema does not match inventory`);
      assert(entry.fixtures.includes(contract.file), `${reference.label} does not inventory ${contract.file}`);
    }
  }
  assertDeepEqual(
    [...contractFiles].sort(),
    [...loadedFixtures.keys()].sort(),
    "fixture contract file set",
  );

  const statuses = new Set(evidence.map((entry) => entry.status));
  for (const transition of requireArray(value.evidenceTransitions, "evidence transitions")) {
    assert(nonEmptyString(transition?.id), "evidence transition ID is required");
    assert(statuses.has(transition.fromStatus), `${transition.id} starts from an unreferenced evidence status`);
    assert(transition.outcome === "requires-new-separately-reviewed-schema", `${transition.id} must require a new schema`);
    assert(transition.allowedInThisSchema === false, `${transition.id} must not silently elevate fixture evidence`);
    assert(nonEmptyString(transition.gate), `${transition.id} requires an explicit review gate`);
  }

  const alert = evidenceById.get("fleet.alert-evidence.v0");
  assert(alert?.status === "unproven-current-producer", "Fleet alert producer evidence must remain unproven");
  assert(alert.fixtures.length === 0, "Fleet alert evidence must not have a fabricated producer fixture");
  assert(alert.acceptedRuntimeContract === false, "Fleet alert evidence must not be an accepted runtime contract");
}

function validateCapabilityInventoryPin(pin, evidence) {
  assert(pin?.schema === INVENTORY_PIN_SCHEMA, `capability inventory pin must use ${INVENTORY_PIN_SCHEMA}`);
  const entries = requireArray(pin.entries, "capability inventory pin entries");
  const canonicalEntries = evidence
    .map((entry) => ({ id: entry.id, schema: entry.schema }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  assertDeepEqual(entries, canonicalEntries, "capability inventory pin entries");
  const digest = createHash("sha256").update(JSON.stringify(canonicalEntries)).digest("hex");
  assert(pin.sha256 === digest, `capability inventory digest mismatch: expected ${digest}`);
}

function validateFixture(name, fixture) {
  assert(fixture?.fixtureSchema === FIXTURE_SCHEMA, `${name} fixture schema is invalid`);
  assert(fixture.synthetic === true && fixture.redacted === true, `${name} must be synthetic and redacted`);
  assertDeepEqual(fixture.envelope, fixture.expectedParsedEnvelope, `${name} frozen parser expectation`);
  const envelope = fixture.envelope;
  assert(envelope?.protocolVersion === "stfc.sidecar.ingest.v1", `${name} outer protocol is invalid`);
  assert(nonEmptyString(envelope.batchId) && nonEmptyString(envelope.sessionId), `${name} requires synthetic IDs`);
  assert(!Number.isNaN(Date.parse(envelope.producedAt)), `${name} requires a timestamp`);

  if (name === "battle-capture.json") {
    assert(envelope.kind === "battle.events" && envelope.payloadProtocol === "stfc.sidecar.events.v0", "Battle envelope contract changed");
    const events = requireArray(envelope.payload, "Battle events");
    assert(events.length === 1 && events[0].schemaVersion === "stfc.battle.capture.v1", "Battle fixture must contain one capture");
    const capture = events[0];
    assert(/^\d+$/u.test(capture.journalId) && BigInt(capture.journalId) > BigInt(Number.MAX_SAFE_INTEGER), "Battle journal ID must exercise exact string handling");
    assert(/^\d+$/u.test(capture.battleId) && BigInt(capture.battleId) > BigInt(Number.MAX_SAFE_INTEGER), "Battle ID must exercise exact string handling");
    const participants = requireArray(capture.capture?.participants, "Battle participants");
    assert(participants.length > 0, "Battle fixture requires synthetic participants");
    assert(participants.every((item) => /^redacted-(?:player|hostile)-\d+$/u.test(item.participantId)), "Battle participant IDs must be visibly synthetic");
    assert(participants.every((item) => Object.keys(item).every((key) => ["participantKind", "participantId"].includes(key))), "Battle participants may not carry names, alliances, or locations");
  } else {
    assert(envelope.kind === "fleet.runtime" && envelope.payloadProtocol === "stfc.fleet.runtime_snapshot.v1", "Fleet envelope contract changed");
    assert(envelope.payload?.schemaVersion === "stfc.fleet.runtime_snapshot.v1", "Fleet payload schema changed");
    const present = requireArray(envelope.payload.slots, "Fleet slots").filter((slot) => slot.present === true);
    assert(present.length > 0, "Fleet fixture requires a present synthetic hull");
    assert(present.every((slot) => /^Redacted Test /u.test(slot.hullName)), "Fleet hull labels must be visibly synthetic");
    assert(Array.isArray(fixture.expectedTelemetryEvents) && fixture.expectedTelemetryEvents.length > 0, "Fleet production projection expectation is required");
  }
}

function validateRedaction(value, name) {
  const forbiddenPrivateKeys = new Set([
    "playerid", "playername", "alliancename", "allianceid",
    "location", "coordinates", "coordinate", "latitude", "longitude", "ip", "ipaddress", "remoteaddress",
  ]);
  walk(value, "$", name);

  function walk(current, location, fixtureName) {
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${location}[${index}]`, fixtureName));
    } else if (isRecord(current)) {
      for (const [key, item] of Object.entries(current)) {
        const canonical = canonicalKey(key);
        const allowedBattleTokenField = fixtureName === "battle-capture.json"
          && (location === "$.envelope.payload[0].capture.battleLog"
            || location === "$.expectedParsedEnvelope.payload[0].capture.battleLog")
          && (canonical === "tokens" || canonical === "tokencount");
        assert(
          !forbiddenPrivateKeys.has(canonical)
            && (allowedBattleTokenField || !isSensitiveKey(canonical)),
          `${fixtureName} contains forbidden key ${location}.${key}`,
        );
        walk(item, `${location}.${key}`, fixtureName);
      }
    }
  }
}

function canonicalKey(key) {
  return key.normalize("NFKC").toLowerCase().replace(/[-_.\s]/gu, "");
}

function isSensitiveKey(canonical) {
  return canonical.includes("secret")
    || canonical.includes("credential")
    || canonical.includes("password")
    || canonical.includes("authorization")
    || canonical.includes("cookie")
    || canonical.includes("token")
    || canonical.includes("apikey")
    || canonical.includes("privatekey")
    || canonical.includes("authheader")
    || canonical === "auth";
}

function validateRawRedaction(raw, name) {
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+\/-]+/iu,
    /https?:\/\//iu,
    /(?:[A-Z]:\\|\/Users\/|\/home\/)/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
    /"(?:lat(?:itude)?|lon(?:gitude)?|coordinates?|player(?:id|name)|alliance(?:id|name)|location|ip(?:address)?)"\s*:/iu,
  ];
  for (const pattern of patterns) {
    assert(!pattern.test(raw), `${name} contains a private/secret raw pattern (${pattern})`);
  }
}

function rejectDuplicateJsonKeys(raw, name) {
  let index = 0;
  parseValue("$");
  whitespace();
  assert(index === raw.length, `${name} has trailing JSON content at offset ${index}`);

  function parseValue(location) {
    whitespace();
    const char = raw[index];
    if (char === "{") return parseObject(location);
    if (char === "[") return parseArray(location);
    if (char === '"') return parseString();
    const match = raw.slice(index).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u);
    assert(match, `${name} has invalid JSON at offset ${index}`);
    index += match[0].length;
  }
  function parseObject(location) {
    index++;
    whitespace();
    const keys = new Set();
    if (raw[index] === "}") { index++; return; }
    while (true) {
      assert(raw[index] === '"', `${name} object key expected at offset ${index}`);
      const key = parseString();
      assert(!keys.has(key), `${name} contains duplicate key '${key}' at ${location}`);
      keys.add(key);
      whitespace();
      assert(raw[index++] === ":", `${name} missing ':' after ${location}.${key}`);
      parseValue(`${location}.${key}`);
      whitespace();
      if (raw[index] === "}") { index++; return; }
      assert(raw[index++] === ",", `${name} missing ',' at ${location}`);
      whitespace();
    }
  }
  function parseArray(location) {
    index++;
    whitespace();
    if (raw[index] === "]") { index++; return; }
    let item = 0;
    while (true) {
      parseValue(`${location}[${item++}]`);
      whitespace();
      if (raw[index] === "]") { index++; return; }
      assert(raw[index++] === ",", `${name} missing ',' at ${location}`);
    }
  }
  function parseString() {
    const start = index++;
    while (index < raw.length) {
      if (raw[index] === "\\") { index += 2; continue; }
      if (raw[index++] === '"') return JSON.parse(raw.slice(start, index));
    }
    throw new Error(`${name} has an unterminated string at offset ${start}`);
  }
  function whitespace() {
    while (/\s/u.test(raw[index] ?? "")) index++;
  }
}

function requireArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertDeepEqual(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} mismatch`);
}
function assert(condition, message) { if (!condition) throw new Error(message); }
