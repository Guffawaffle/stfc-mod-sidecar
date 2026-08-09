# Battle Bridge Golden Corpus v1

This bounded corpus supports Battle Bridge planning issues #55 and #75. It is
portable evidence, not an accepted runtime manifest or a claim about any
released mod artifact.

The candidate capability IDs are provisional evidence labels copied from the
capability/disposition ledger. The validator deliberately limits itself to:

- corpus and fixture structure;
- capability-evidence labels and their review gates;
- redaction and synthetic-data guarantees; and
- transitions that must not elevate fixture evidence into an accepted runtime
  contract.

Provider activation scenarios live in the Mod Bridge Core test corpus, where
they exercise the real `LauncherRuntimeManifestDetector` and
`LauncherFeatureResolver`. Player preference and runtime effects are
deliberately outside this immutable evidence corpus and remain product-design
decisions.

`corpus.json` inventories the bounded payload evidence and the explicit review
gates required before any provisional label can become a runtime contract.

`battle-capture.json` and `fleet-runtime.json` are synthetic, redacted,
deterministic payloads distilled from existing Sidecar tests. They preserve
large identifiers as strings and contain no player, alliance, coordinate,
credential, or endpoint data.

No Fleet alert-evidence payload is included. The Sidecar has a consumer schema
and tests, but the reviewed Guffawaffle source snapshot had no matching
producer. The corpus therefore records `fleet.alert-evidence.v0` as
`unproven-current-producer`.

Run from the repository root:

```powershell
npm run golden:battle-bridge
```

The validator uses Node built-ins only and performs no network, child-process,
database, game-directory, or user-state access. The tests also reject duplicate
JSON keys before parsing and compare the fixture with the complete production
ingest/parser and Fleet projector results.
