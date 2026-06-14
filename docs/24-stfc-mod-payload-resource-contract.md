# STFC-Mod Payload Resource Contract

Status: base architecture direction, not an implementation mandate.

This document defines the minimum shared contract model for interoperable
STFC-Mod payloads. It is inspired by FHIR's modular resource approach, but it
is not a FHIR clone and should not grow into a generic schema framework before
the sidecar has multiple real resource families to compare.

The current fleet alert work remains valid. This document names the broader
contract shape that future payload families should converge toward.

## Root Concept

STFC-Mod payload resources are the canonical interoperable contract layer
between the native mod, sidecar core, sidecar UI, AX tools, and future external
consumers.

Alerts are one resource family/profile under that contract. They are not the
root architecture.

The root model should stay small:

- a stable resource envelope
- a resource kind and profile/schema version
- domain-specific details owned by that profile
- provenance/source attribution
- optional disciplined extensions
- explicit support for partial or unknown facts

## Architectural Flow

```text
native/game seams or sidecar observations
-> STFC-Mod payload resource
-> sidecar store/projections/read APIs
-> UI/external consumers
-> optional dispatcher/providers later
```

Each step may add derived resources, indexes, or read models, but those layers
must not erase provenance or pretend unknown facts are known.

## Resource Rules

### Canonical Envelope

The shared envelope should be stable and boring. It should identify what the
payload is, when it was observed or produced, which profile owns its details,
and where it came from.

Do not put every possible domain field in the envelope. Domain-specific data
belongs in typed details owned by a profile.

### Typed Details

Each resource family owns its own details/profile payload. A battle capture,
fleet alert evidence record, fleet alert intent, observed hostile observation,
and future dispatch attempt do not need to share one giant field set.

Profiles should keep exact IDs as strings when they may exceed JavaScript safe
integer range.

### Extensions

Extensions are allowed for future-safe expansion, but they must be disciplined:

- use them for additive facts that are not stable enough for the profile yet
- keep extension names scoped and descriptive
- do not use extensions to bypass provenance, versioning, or security rules
- promote repeated extension patterns only after real consumers need them

### Provenance

Provenance is first-class. Payloads should preserve enough source attribution
for consumers to understand whether a fact was copied from a game/client seam,
derived by sidecar logic, or produced by a later provider/dispatcher attempt.

Useful provenance can include source component, seam, reason, timestamps,
session/mod version, event keys, sequence IDs, and derivation links. The exact
fields belong to each profile until a common shape is justified.

### Partial Data

Missing and partial evidence is valid. Consumers must treat unknown facts as
displayable state, not fatal parse errors.

Payloads should explicitly carry missing-evidence markers when the producer or
projection knows a relevant fact is absent, such as `systemId` in early fleet
alert evidence.

### Versioning

Versioning should be meaningful but not bureaucratic.

- Shared envelope changes use a shared protocol/resource version.
- Domain profile changes use that profile's schema version.
- Additive fields normally do not require a major version bump.
- Removal, rename, requiredness change, type change, or semantic repurposing
  does require a major version bump.

## Resource Categories

### Observation Resources

Observation resources are copied evidence from game/client seams or sidecar
observations. They should be as close to the source as practical and should not
hide uncertainty.

Examples:

- battle captures
- observed hostile sightings
- fleet alert evidence copied from native seams

### Derived Resources

Derived resources are sidecar-produced interpretations, joins, summaries, or
projections. They should link back to source observations when possible.

Examples:

- battle report summaries
- fleet projections
- observed hostile catalog entries

### Intent Resources

Intent resources represent things the sidecar believes are actionable,
display-worthy, or worth presenting to a later dispatcher. Intent resources are
data records, not provider actions by themselves.

Examples:

- fleet alert intents derived from fleet alert evidence

### Dispatch Resources

Dispatch resources are later provider attempt/result records. They belong after
intent creation and should remain separate from evidence and intent payloads.

Examples:

- future desktop notification attempt records
- future TTS/audio provider attempt records
- future provider delivery result records

Dispatch resources do not exist in the current fleet alert implementation.

## Current Mapping

- `fleet.alert_evidence` is an observation resource. It carries copied fleet
  alert evidence from native/game seams through sidecar ingest and storage.
- `FleetAlertIntent` is an intent resource and derived resource. It is produced
  by the sidecar from stored fleet alert evidence and remains provider-neutral.
- `GET /api/fleet/alert-intents?limit=N` is a feature-scoped v0 read contract.
  It exposes projected fleet alert intents for Fleet Watch before the broader
  shared payload-resource envelope is fully formalized.
- `/api/events` remains raw evidence-oriented and should not be overloaded with
  projected intent read models.

## Boundaries

The payload resource model does not authorize gameplay automation.

Native evidence seams copy observations. They should not make hidden sidecar or
provider decisions.

Safe native intervention seams, if they are ever added, are separate from
observation seams and must be explicitly classified before implementation.

Dispatcher/provider behavior comes later and only when enabled. Providers such
as desktop notifications, audio, TTS, Piper, or external integrations must
fulfill sidecar-owned intent data through separate provider/dispatch resources
or state, not by changing the meaning of observation resources.

## Migration Stance

Current fleet alert contracts can remain in place.

Future work should converge toward a shared payload-resource envelope, but the
project should avoid churn until a second resource family proves what the shared
base actually needs.

Before introducing a reusable schema/type package, prefer:

1. documenting the profile and its category,
2. preserving provenance and string IDs,
3. adding narrow tests around the actual consumer path,
4. waiting for repeated patterns across at least two resource families.
