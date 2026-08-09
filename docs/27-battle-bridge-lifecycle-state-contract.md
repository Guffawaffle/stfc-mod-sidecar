# Battle Bridge Lifecycle, State Location, And Recovery Contract

Status: candidate owner contract for issue #59. It fixes the lifecycle and
physical-state boundary needed by #56, #62, and #63; it does not implement a
listener, database schema, provider resolver, configuration writer, or Windows
startup registration.

## Purpose And Authority

Battle Bridge is an optional composition of the native STFC Mod Bridge process.
It does not own a second executable, service, updater, provider model, game
detector, TOML editor, or preference store. The native Bridge remains the sole
authority for:

- per-user state-root resolution;
- provider selection, artifact trust, deployment, and provider transitions;
- game discovery, process state, and launch;
- launcher preferences, staged Settings/Data Sync edits, and sparse TOML writes;
- the existing provider-switch admission/application-operation lease hierarchy
  and recovery owners; and
- feature eligibility through the immutable `LauncherActivationPlan`.

The capability/readiness rules in
[`25-battle-bridge-capability-disposition-ledger.md`](25-battle-bridge-capability-disposition-ledger.md)
and
[`26-battle-bridge-state-readiness-contract.md`](26-battle-bridge-state-readiness-contract.md)
remain authoritative. The native
[`BATTLE_BRIDGE_ACTIVATION_ADR.md`](https://github.com/Guffawaffle/stfc-mod-bridge/blob/main/docs/windows-launcher/BATTLE_BRIDGE_ACTIVATION_ADR.md)
defines feature eligibility and the native
[`BATTLE_BRIDGE_STORAGE.md`](https://github.com/Guffawaffle/stfc-mod-bridge/blob/main/docs/windows-launcher/BATTLE_BRIDGE_STORAGE.md)
defines stored evidence. This contract consumes those decisions without
re-resolving them.

## Closed Lifecycle Decisions

1. Battle state uses the existing unpackaged per-user state root,
   `%LOCALAPPDATA%\STFC Mod Bridge`, in both MSIX and standalone installations.
   It never uses a package-family `LocalCache`, `LocalState`, or virtualized
   AppData path.
2. No Battle directory, credential, database, cache, log, provider instance,
   native SQLite module, worker, listener, timer, or runtime lock is created by
   install, update, passive capability detection, navigation, Home selection,
   or an ineligible feature request.
3. The first allowed Battle write follows either an explicit eligible feature
   activation or an explicit reviewed import. Import may create storage without
   granting collection eligibility or generating an ingest credential.
4. Closing the last Bridge window means **Exit**. Bridge stops accepting ingest,
   drains or rolls back bounded in-flight work, releases all Battle resources,
   and terminates. V1 has no tray-only process, Windows service, scheduled task,
   helper daemon, or invisible collector.
5. Minimizing is not Exit. A running, minimized Bridge may continue collection
   when the player previously enabled it, but it remains a normal restorable
   taskbar application. A future notification-area experience requires its own
   visible, keyboard-accessible restore/exit contract; it cannot silently change
   close semantics.
6. Switching between Base Home and Battle Home is presentation only. It does not
   start, stop, pause, resume, reconfigure, migrate, or dispose collection or
   storage.
7. Collection consent and lifecycle are per feature family. Disabling Battle
   capture must not stop Fleet collection, and disabling Fleet must not stop
   Battle. The shared target/listener/credential stays active while any eligible,
   opted-in category requires it. `Disable all collection` is a separately named
   aggregate command. Disable retains the database, credential, caches, logs,
   Home preference, and readable history. Data removal is a separate explicit
   destructive operation.
8. Runtime and storage readiness are capability- and schema-driven. Provider
   names never select a listener, path, lock, or lifecycle behavior.

## Canonical Per-User Layout

`PerUserInstallLayout.StateDirectory` remains the sole root resolver. All code
receives the normalized root by dependency injection; no Battle component calls
`Environment.GetFolderPath`, reads a package-family path, or reconstructs the
root itself.

The exact v1 layout is:

```text
%LOCALAPPDATA%\STFC Mod Bridge\
  operation.lock                              existing shared operation lease
  provider-switch\
    operation.lock                            existing provider-switch admission lease
  battle-delete-v1.dpapi                      deletion recovery marker, only while needed
  battle-delete-v1.dpapi.next                 bound marker successor, only while needed
  battle.delete.<operation-id>\               displaced subtree, only while deleting
  battle\
    runtime.lock                              owner lease plus clean/unclean runtime record
    battle-store-v1.sqlite3                   authoritative SQLite store
    battle-store-v1.sqlite3-journal           SQLite DELETE-mode transient, when present
    ingest-credential-v1.dpapi                protected loopback credential record
    cache-v1\                                  bounded, rebuildable files only
    logs\
      battle-v1.log                           bounded, redacted Battle diagnostic log
    backups\
      <operation-id>\
        battle-store-v1.sqlite3               verified recovery backup
        backup-manifest-v1.json               hashes, schema, operation identity
    recovery\
      active-operation-v1.dpapi               one protected active-operation marker
      <operation-id>\
        candidate\                            same-volume candidate files
        displaced\                            preserved pre-commit files
```

An `<operation-id>` is a lowercase 32-hex GUID generated by Bridge. Code rejects
non-canonical IDs, reparse points, unexpected path escapes, duplicate marker
properties, and files exceeding their type-specific bound before acting on a
path. All replacements use same-volume sibling staging, flush, verify, and
atomic rename/replace semantics. A path's presence is evidence, never permission
to delete it.

The database's normal rollback journal is the only permitted SQLite side file in
the Battle root for the v1 `DELETE`-journal candidate. #63 must reject unexpected
`-wal`, `-shm`, native DLL, or provider-extraction files until a separately
reviewed provider/journal decision accepts them. Provider-owned temporary files
must be qualified and removed on close; they never become recovery evidence.

`cache-v1` is reserved for explicitly versioned, bounded, reproducible cache
files. It may remain absent forever because database projections are preferred.
Unknown files are never recursively removed as “cache.” `battle-v1.log` uses the
shared launcher logging/redaction sink and retention policy; Battle code does
not configure another logger. Final log rotation and byte/count budgets belong
to the existing diagnostics budget review, but logging is bounded before #62 can
ship.

`backups` contains only verified recovery snapshots created for migration,
restore, destructive cleanup, or compaction. It is not player export storage.
Player exports use a player-selected destination. Final automatic backup count
and aging remain #78 decisions; until then Bridge never deletes the last verified
backup automatically. Production operations that would accumulate automatic
backups do not ship until #78 supplies a finite count/aging rule; qualification
fixtures may create and explicitly clean isolated test backups.

Bootstrap creates `battle` with inheritance disabled and full control only for
the current user SID and `SYSTEM`; every owned child inherits that DACL unless a
stricter file contract applies. Existing directories are verified rather than
silently re-ACL'd. An unexpected owner/allow ACE is a privacy diagnostic and
blocks secret/database creation until the player uses the reviewed repair action.

MSIX qualification must positively prove this exact path is unvirtualized and
survives package update/uninstall according to the accepted external-state
policy. Standalone and MSIX builds must open the same database format at the same
nominal path. An installation topology mismatch is `contract-error`, not a cue
to copy or merge two stores.

The root-level `battle-delete-v1.dpapi` and
`battle.delete.<operation-id>` exist only because Windows cannot remove an open
`runtime.lock` or its parent directory. They are bounded deletion-recovery
artifacts, not another state root or lock. Their exact use and cleanup are defined
under Disable and removal.

## Inactive Zero-Side-Effect Boundary

The following operations are read-only with respect to the `battle` subtree:

- installing, updating, repairing, or launching base Mod Bridge;
- opening Base Home, Settings, Data Sync, Diagnostics, or an activation explainer;
- passive provider/runtime discovery and activation-plan composition;
- displaying `empty`, `unavailable`, or `not-offerable` projections;
- rejecting an ineligible activation or a provider-transition discovery lead;
- checking launch-with-Windows/minimized registration; and
- a second process activating the already-running Bridge window.

They do not call `Directory.CreateDirectory`, initialize a database/provider,
load `winsqlite3.dll`, create a factory, take `runtime.lock`, generate a token,
open a log, schedule cleanup, or start a worker. Enumeration uses the parent
state root only and treats an absent exact `battle` path as `Absent` without
creating it.

After an explicit activation/import begins, the first marker is created directly
at `active-operation-v1.dpapi` with `FileMode.CreateNew`, an exclusive handle, a
bounded complete DPAPI record, and flush-to-disk. First creation never uses an
unbound temporary sibling. A crash before `CreateNew` begins can leave only known
empty directories. Startup may remove those directories only when every known
directory is empty, no marker/credential/store exists, and the correct inherited
operation context is held. Once any final marker bytes exist, even a torn or
noncanonical record is preserved as `recovery-failed`; it is never treated as the
no-marker empty-directory case. Later stage updates may use only the
marker-bound `recovery\<operation-id>\candidate` directory and the replacement
rules below. Any unknown entry or non-empty unbound file fails closed and is
presented for recovery; Bridge does not guess that it is disposable.

In the no-`battle` bootstrap case, `runtime.lock` is a marker-owned after-state:
it must not be created before the canonical first marker is durable. Bridge first
generates the exact bounded `running` record in memory, including the random
process-start nonce, and binds its final relative path, byte count, SHA-256, and
closed-schema fields in that initial marker. Only then does it create/open the
lock through the exact final path and write/flush the already-bound bytes. The
next marker stage records verified completion; it does not introduce or change
the lock identity. No provider, repository, worker, or listener is constructed
before that readback. A missing, torn, or mismatched bootstrap lock is therefore
recoverable from the initial marker and is never accepted as an unjournalled
runtime owner.

## Process, Window, And Collection Lifetime

The Bridge process is the Battle runtime lifetime. Exactly one process owns the
Battle runtime at a time:

- the first composed process opens `battle\runtime.lock` with read/write access
  and `FileShare.None` and retains that handle until every listener, repository
  connection, and worker has stopped. Ordinary maintenance retains it through
  the participant; full subtree deletion follows the explicitly journalled
  release-before-rename exception below;
- file existence is not ownership; only the live exclusive handle is a lease.
  While holding it, Bridge reads then rewrites a maximum-4-KiB closed-schema
  record through that same exclusive handle (truncate, write, flush-to-disk; do
  not path-replace the leased file). The record contains schema version,
  `running`/`clean` state, process ID, random process-start nonce, start UTC, and
  last clean-close UTC. It contains no token, endpoint, raw event, or private
  path. `running`, malformed, or torn content from a prior owner means the
  previous Battle runtime was unclean and triggers the storage contract's bounded
  startup checks before composition. Clean shutdown writes and flushes `clean`
  only after every Battle resource closes, then releases the handle;
- a second process activates/restores the existing Bridge instance and exits;
  it does not start a second listener, open a second writer, or steal a stale
  path; and
- if single-instance activation cannot reach the owner, the second process
  remains mutation-free and reports that another Bridge instance must be closed.

The runtime lock is defense in depth beneath product-level single-instance
activation. It is not a second feature resolver or operation coordinator.
Ordinary Base Bridge can remain usable if Battle runtime ownership fails, but it
must not open Battle storage in that process.

Collection lifetime is deterministic:

| Window/process event | Collection result |
| --- | --- |
| Main window open or restored | Compose every collection family's preference, immutable eligibility decision, recovery state, and coordinator evidence; aggregate shared-host demand afterward. |
| Main window minimized | Continue an already allowed collector; do not interpret minimize as pause or consent. |
| Battle Home changed to Base Home | No lifecycle change. |
| Base Home changed to Battle Home | No lifecycle change. |
| Last window receives Close/Exit | Stop accepting requests, drain bounded accepted work, cancel/roll back any unfinished repository transaction, close the listener/store, release `runtime.lock`, then exit. |
| Process crash or forced termination | OS releases handles while `runtime.lock` retains `running`; next startup performs bounded storage and operation recovery before any listener starts. |
| OS shutdown/sign-out | Use the same bounded close path; never delay shutdown indefinitely or detach a helper. |

The shutdown drain timeout and maximum in-flight request count are empirical #62
host limits. Before release they must be finite, checked in, and crash-tested.
Expiry stops new work, cancels any operation that has not committed, leaves the
runtime record `running`, and exits. It never spawns a hidden continuation
process. A repository transaction is either fully committed before shutdown or
rolled back by SQLite; accepted transport bytes are not acknowledged as durable
until their commit succeeds.

Player **Pause** is session-scoped and per feature family: it stops new writes
for that category without changing TOML or deleting state, and returns that
enabled feature to `dormant` on the next clean process start. The shared listener
remains open for any other active category. **Pause all collection** applies the
same session pause to every collection family and may close the now-unused host.
Player **Disable** is durable and per feature; **Disable all collection** is the
explicit aggregate transaction described below.

### Per-feature consent and shared-host aggregation

For each collection feature, the coordinator consumes that exact feature's
resolver decision, launcher-owned preference, session pause, blocker, and
recovery state. It never stores one `battleEnabled` preference. The shared local
transport is derived only after those per-feature decisions:

```text
category desired = exact feature eligible + exact feature preference enabled
category runnable = category desired + not paused + no blocking recovery/runtime state
shared target desired = any category desired
shared listener runnable = any category runnable
```

The existing Data Sync transaction writes each accepted producer category field
independently (`battlelogs_realtime`, `fleet_runtime`, or its reviewed successor)
and sets `[sidecar.sync].enabled` from `shared target desired`. Turning one
category off leaves the shared target, credential, listener, and other category
unchanged when another category remains desired. Temporary pause/recovery does
not rewrite TOML; it changes only `category runnable`. If every category becomes
durably disabled, the aggregate transaction sets the Bridge-owned target
inactive but preserves its URL/token and the protected credential.

`Disable all collection` is not a hidden global preference. It is one reviewed,
journalled command that writes every currently accepted collection preference to
`disabled`, stages every Bridge-owned category off, and then derives the shared
target inactive. Recovery records each before/after per-feature value so retry is
idempotent. A future collection feature joins the aggregate only through its
checked-in feature/category mapping; it is never disabled by a provider-wide
wildcard.

## Lease Model And Acquisition Order

Battle adds no mutation authority. Direct Battle operations—activation, durable
disable, credential rotation, import bootstrap, schema migration, restore,
destructive cleanup, compaction, and Battle-state deletion—acquire the existing
root `LauncherOperationLock` as their cross-process lease.

Provider switches retain their existing higher-level hierarchy. The existing
provider-switch coordinator first holds
`provider-switch\operation.lock` as its admission lease, then coordinated
deployment holds root `operation.lock`. A Battle provider-transition participant
is entered with an inherited operation context proving both leases are already
held. It must not acquire, release, or wrap either lease; root
`LauncherOperationLock` is non-reentrant. The existing provider-switch journal
remains outer durable owner. Battle work must not create `battle-operation.lock`,
a third filesystem lock, or another provider journal.

`runtime.lock` answers only “which process owns Battle resources?” Within that
owner, the coordinator supplies a serialized short-write gate and an exclusive
maintenance state. Those are in-process lifecycle states, not new filesystem
authorities.

The acquisition and release orders are fixed:

```text
direct Battle operation against existing Battle state:
root application operation lease
  -> confirm this process owns runtime.lock, or require the other process to exit
  -> request listener stop and drain
  -> close repository readers/writer
  -> enter exclusive maintenance state
  -> perform the journalled operation
  -> reopen/recompose only from a fresh immutable readiness snapshot
  -> release maintenance state
  -> release root application operation lease

first activation/import with no battle path:
root application operation lease
  -> create only known empty bootstrap directories
  -> generate runtime record and pre-bind its exact after-identity
  -> CreateNew and flush canonical operation marker containing that identity
  -> create/open/write/flush the already-bound runtime.lock bytes
  -> read back and record completion in the monotonic successor marker
  -> enter maintenance and create only marker-bound candidates
  -> perform/verify the journalled operation
  -> release maintenance and root operation lease normally

provider transition:
existing provider-switch admission lease
  -> root application operation lease acquired by coordinated deployment
  -> enter Battle participant with both leases inherited (never reacquire)
  -> confirm runtime ownership, stop/drain, close, and enter maintenance
  -> perform only the participant's journalled/quiesce/recompose work
  -> release maintenance and return from the participant
  -> coordinated deployment releases root application operation lease
  -> provider-switch coordinator releases admission lease
```

Normal ingest holds only the bounded repository write gate and never waits for
root `operation.lock`. When a mutation requests quiescence, the coordinator
stops new accepts first, lets the current bounded write commit or roll back, then
grants maintenance. Reads use bounded repository read scopes; an exclusive
maintenance request prevents new reads and waits only for the configured bounded
read-drain period.

No lease acquisition waits indefinitely. Cross-process contention returns a
typed `operation-in-progress`/`another-instance` result and gives the player
`Open running Bridge` or `Try again`. An operation releases only leases it
acquired. An inherited provider-transition participant releases neither existing
lease, including on cancellation or failure. Code never breaks a lock based on
file age or process-name guesses.

### Operation precedence

Startup and command execution use this order:

1. complete or surface existing self-update/provider/deployment recovery;
2. inspect and complete or surface Battle recovery;
3. reject a new mutation while any applicable operation/recovery is in progress;
4. require staged Settings/Data Sync edits to be saved or discarded;
5. require a pending mod restart to be resolved where the requested operation
   depends on the new runtime;
6. require the game closed where the game/config safety table says so; and
7. for a direct Battle command, acquire root `operation.lock`; for a provider
   transition, enter only from the existing coordinator's inherited two-lease
   context. An existing-state direct command confirms runtime ownership before
   its operation marker; a no-path activation/import writes the canonical marker
   first and creates `runtime.lock` only as its after-state. It then enters the
   appropriate maintenance state and executes one operation.

This is execution ordering, not recovery severity normalization. The readiness
composer still reports every owner under the rules in document 26 and never
chooses an owner itself. No background FIFO persists mutation requests; the
player retries after the visible blocker is resolved.

## Credential Contract

All activated collection families share one Bridge-generated loopback bearer
credential:

- generate exactly 32 bytes with the Windows cryptographic RNG;
- encode as unpadded base64url for the TOML value;
- assign a lowercase 32-hex GUID credential ID and monotonically increasing
  generation in the protected record;
- store the canonical closed-schema record in
  `battle\ingest-credential-v1.dpapi`, protected with Windows DPAPI
  `CurrentUser` scope and exact UTF-8 entropy
  `STFC Mod Bridge Battle ingest credential v1`;
- cap the protected file at 16 KiB and atomically replace it after flush;
- apply a protected DACL with inheritance disabled, full control for the current
  user SID and `SYSTEM`, and no broad `Users`/`Everyone` ACE; and
- retain the selected exact loopback origin and creation/rotation UTC in the
  protected record so TOML drift can be diagnosed without guessing.

The mod must read the same token from `[sidecar.sync].token`, so the game TOML is
necessarily a user-readable plaintext deployment projection. DPAPI protects the
launcher-owned authoritative copy; it does not make the TOML secret from the
current user or same-user processes. Documentation and diagnostics must state
that boundary honestly.

The existing Data Sync edit session/coordinator is the only TOML writer. The
lifecycle transaction asks it to stage and atomically save the exact accepted
loopback URL, token, enabled state, and independently accepted category fields.
It preserves comments, unknown settings, line endings, and protected backups.
Battle code never edits `community_patch_settings.toml` directly.

The first collection activation creates a fresh credential; it never adopts or
copies a legacy Sidecar token. Enabling a later feature family reuses the exact
verified shared credential and changes only that family's preference/category
plus the derived target state. A retry of the same incomplete activation reuses
the marker-bound candidate rather than generating another credential. A
successful activation retry is a no-op when the protected record, exact TOML
projection, per-feature preferences, and runtime receipt already agree.

Rotation is an explicit journalled operation and is also required after a
reported disclosure, an unreadable/missing protected record paired with a
Bridge-owned target, or a failed activation recovery that cannot prove which
candidate committed. It requires the game closed, updates protected record and
TOML as one recoverable operation, and invalidates the old token before the
listener reopens. Rotation does not alter the database.

A provider transition does not rotate the credential merely because a provider
name changed. The existing transition closes the game and revalidates capability,
trust, and configuration; after success the exact same local credential may be
retained. Rotation occurs only when its own security/recovery predicate matches,
avoiding a second secret side effect inside provider deployment.

Credential contents never enter logs, diagnostics, support exports, recovery
copy, exception text, UI Automation names, screenshots, fixtures, hashes exposed
to the player, or telemetry. Diagnostics report only present/readable/drifted,
credential ID prefix if needed for local correlation, generation, and last
rotation reason. The complete ID remains local; the token is never revealed by
ordinary UI.

## Journalled Operations

The Battle lifecycle owner uses exactly one
`battle\recovery\active-operation-v1.dpapi`. It is closed-schema canonical JSON
protected with DPAPI CurrentUser and exact UTF-8 entropy
`STFC Mod Bridge Battle recovery marker v1`. It
contains:

- schema version, operation ID/kind, owner ID, and current stage;
- exact normalized primary, candidate, displaced, and backup relative paths;
- pre-operation and expected candidate size/SHA-256 where a file exists;
- database application/format/schema identity where applicable;
- protected credential generation and protected-file hash, never the token;
- source TOML revision/hash, protected backup receipt, and expected sparse
  mutation receipt where configuration participates;
- exact per-feature preference before/after values and derived shared-target
  state;
- start/update UTC and implementation version; and
- mutation-block and safe-read effects consumed by readiness composition.

Absolute paths, secret values, raw events, provider credentials, and arbitrary
error text are prohibited. The loader derives absolute paths from the injected
state root, rejects traversal/reparse points and duplicate properties, reads the
file through one non-shared handle, and verifies it did not change during read.
An unreadable, oversized, invalid, or out-of-root marker is `recovery-failed` and
authorizes no cleanup.

After the canonical first marker exists, a stage update writes one complete
protected successor to
`recovery\<operation-id>\candidate\active-operation-v1.dpapi.next`, flushes it,
then atomically replaces the final marker on the same volume. A leftover
successor can be deleted only when the final marker is canonical, both records
name the same operation, and the candidate is exactly the final stage or its one
allowed monotonic successor. A missing/invalid final marker, mismatched operation,
skipped/regressed stage, or two competing candidates is `recovery-failed`; Bridge
preserves all bytes and never promotes by timestamp.

Stages are total and monotonic:

| Stage | Durable fact | Startup behavior |
| --- | --- | --- |
| `prepared` | Inputs/preconditions and candidate identities are frozen; no authoritative target mutation is allowed yet. | Validate that primaries still match. Remove only marker-bound disposable candidates, or require review on mismatch. |
| `quiesced` | Listener/store handles are closed and pre-operation identities still match. | Same as `prepared`; reopening prior state is safe after candidate cleanup. |
| `backup-verified` | Required protected config/database backup exists and its manifest verifies. | Prior primary remains authoritative until `commit-started`; cleanup candidate or resume only after exact validation. |
| `commit-started` | One or more authoritative replacements may have occurred. | Compare every primary with marker-bound before/after identity. All-before rolls back candidates; all-after advances to verify; a mixed or unknown set is `recovery-required` and is never chosen by time. |
| `commit-verified` | Every after-state and cross-resource invariant verifies. | Preserve the committed state and finish only bounded displaced/candidate cleanup. |
| `cleanup-pending` | Commit is complete; only exact marker-owned cleanup remains. | Finish bounded cleanup, record completion, then remove the marker last. |
| `failed` | Automatic recovery exhausted a safe path or found contradictory evidence. | Preserve every file, block affected mutation, expose details and an owner-declared safe Retry only. |

The marker is removed last, after the database maintenance ledger or existing
configuration/provider journal records completion and all required fsync/rename
steps succeed. Failure to remove it produces an idempotent `cleanup-pending`
recovery, not a repeated mutation.

Only exact marker-owned candidates/displaced files can be deleted automatically.
Unknown files, a second active marker, mismatched hashes, multiple plausible
primaries, a missing required backup, or an unexpected database side file fail
closed. Startup never chooses newest, largest, or most recently modified.

### Operation ownership

| Operation | Durable owner and effect |
| --- | --- |
| First/later eligible feature activation | An absent-state activation writes its marker before creating `runtime.lock`; existing-state activation confirms runtime ownership before its marker. The marker coordinates the exact feature preference/category, derived shared-target state, existing Data Sync transaction, shared credential creation/reuse, and optional empty store creation. The listener starts only after all after-state checks pass. |
| Explicit import into an absent store | Under root lease, write/flush the bootstrap marker before marker-owned `runtime.lock` and same-volume store creation; the database import receipt owns subsequent bounded import progress. No credential/TOML mutation occurs. |
| Per-feature pause/resume | Session coordinator changes only that category's runnable state; no marker, TOML mutation, or file deletion. Shared host closes only when no category remains runnable. |
| Per-feature durable disable/re-enable | Battle marker plus existing preference/Data Sync writers. It changes one category and derives the shared target; another desired category keeps the target/listener/credential active. It retains all Battle files and never changes provider. |
| Pause/Disable all collection | Explicit aggregate command over checked-in collection feature/category mappings; never an implicit provider-wide switch. |
| Credential rotation | Battle marker plus existing Data Sync writer; database remains untouched. |
| Provider switch | Existing provider-switch admission/deployment leases and provider journal remain outer owners. Battle enters with inherited context, never reacquires either lock, and writes no duplicate provider journal. |
| Ordinary provider install/update/remove | Existing deployment coordinator/root lease remains owner. Any Battle quiesce participant inherits that operation context and does not reacquire root. |
| Schema migration, restore, destructive cleanup, or compaction | Battle marker owns physical replacement; #63 database maintenance ledger records the completed logical operation. |
| Non-destructive backup/export/integrity read | Repository snapshot/maintenance scope. A marker is required only when persistent candidates or replacement state could survive a crash. |
| Delete Battle data | Separate destructive review; the root deletion marker binds the exact displaced subtree while preferences/TOML change through existing owners. Unknown files stop deletion. |

## Activation, Disable, And Recomposition

### Eligible activation

Activation requires an explicit player request, an active immutable feature
decision for the exact collection feature, accepted product policy, that
feature's consent,
`ManagedVerified` installed evidence for any managed configuration mutation,
no staged edits/recovery/operation, and a closed game. The transaction:

1. acquires root `operation.lock` as a direct Battle operation and revalidates
   every input;
2. when `battle` is absent, creates only known empty directories, writes/flushes
   `prepared` with the exact intended runtime-record path/bytes/hash already
   bound, then creates/flushes and reads back the marker-owned `runtime.lock`
   before recording completion; when Battle state already exists, confirms this
   process owns `runtime.lock` before writing `prepared`;
3. generates/protects a credential candidate only for the first collection
   feature, or verifies the existing shared credential for a later feature;
4. asks the existing Data Sync coordinator to prepare a source-preserving local
   target mutation and protected TOML backup;
5. creates/validates an empty database candidate only when the selected feature
   actually needs storage now; mere Home enablement does not create it;
6. quiesces existing Battle resources and records `quiesced`/`backup-verified`;
7. records `commit-started`, applies the existing per-category/derived-target
   TOML transaction, promotes exact credential/store candidates, and writes only
   the requested feature preference;
8. verifies the protected credential, exact resolved TOML topology, database
   identity if created, every affected per-feature preference, derived shared
   target, and fresh activation/readiness snapshot;
9. records `commit-verified`, removes only marker-owned staging, records
   `cleanup-pending`, then removes the marker; and
10. starts/retains the listener only when the recomposed shared-host aggregate
    has at least one eligible, enabled, recovery-free runnable category. A
    restart-required result remains `dormant` until the next game process uses
    the new TOML.

If the player already has an unrelated or externally managed `[sidecar.sync]`
target, activation shows the exact source-preserving change and requires review.
It never adopts the old token, overwrites unsupported TOML, or declares the
target Bridge-owned merely because it is loopback.

### Disable and removal

Per-feature Pause is immediate and non-durable. Per-feature durable Disable
requires the game closed when it changes TOML. It stops/drains only that category,
revalidates the protected credential against the exact current target, writes
that feature's preference/category through existing owners, and derives the
shared target state. Another desired category keeps the listener/target active.
Drift blocks the write and offers `Review Data Sync`; it never overwrites the
player's newer values.

Disable persists only the requested collection preference as `disabled` and
retains every Battle file. Re-enable reuses the credential only after its DPAPI
record and exact TOML projection agree; otherwise it routes to credential
repair/rotation. `Disable all collection` applies the checked-in aggregate
mapping above; it is the only disable action that intentionally stops every
category and marks the shared target inactive. Removing the mod or losing a
runtime capability stops only dependent collection, but does not change its
player preference or delete readable history.

`Remove Battle data` is a separate preview naming exact evidence counts, bytes,
backups, credential, cache, and log effects. It requires collection stopped,
game closed if TOML will change, verified export when future policy requires it,
and the root application operation lease. It never recursively deletes an
unknown entry.

Windows cannot delete `runtime.lock` or `battle` while the exclusive runtime
handle is open. Full removal therefore uses this fixed exception, under
product-level single-instance authority and the still-held root operation lease:

1. require no other recovery/operation and verify the complete allowlisted Battle
   inventory plus the reviewed `Disable all collection` preference/TOML plan;
2. directly `CreateNew` and flush root `battle-delete-v1.dpapi`, protected with
   DPAPI CurrentUser and exact UTF-8 entropy
   `STFC Mod Bridge Battle delete recovery v1`; it binds operation ID, exact
   original `battle` path, exact displaced path, inventory identities,
   per-feature/config before/after receipts, and stage;
3. complete the marker-owned `Disable all collection` mutation;
4. stop/drain every category, close repository/provider resources, write/flush
   `runtime.lock` as `clean`, then close and release that handle;
5. without reacquiring any Battle resource, atomically rename `battle` to the
   exact sibling `battle.delete.<operation-id>`;
6. delete only the marker-bound, still-matching allowlisted files, then their
   empty directories; and
7. record delete completion, remove the displaced directory, remove the root
   marker last, and release root `operation.lock`.

Every startup checks `battle-delete-v1.dpapi` before acquiring `runtime.lock` or
composing Battle services. Marker updates use one exact sibling
`battle-delete-v1.dpapi.next` with the same flush/atomic-replace and monotonic
successor rules as the ordinary marker. Before rename, exact original-only state
may open `runtime.lock` exclusively under the root lease only to prove no live
owner and complete/cancel the recorded delete; it constructs no Battle service
and closes the handle before rename. After rename, exact displaced-only state
resumes the already-confirmed deletion without opening a Battle runtime. Both
paths present, neither path present before completion, lock contention, a torn/
noncanonical root marker, mismatched inventory, or an unexpected file is
`recovery-failed` and preserves all remaining bytes. A crash after the displaced
tree is gone but before marker cleanup finishes only the marker cleanup. No
process may recreate `battle` while the root delete marker exists. Successful
removal returns to the exact no-`battle` clean state.

### Home and provider transitions

Home preference changes are launcher-preference writes only. They require no
Battle lease and do not touch the collector. A capability loss can select Base
Home while an enabled collection quiesces and retained history remains readable.

Provider transition remains the existing explicit, verified, game-closed,
rollback-capable provider transaction from document 26. Its Battle participant:

1. stops/drains collection before deployment begins;
2. preserves database, credential, and preferences;
3. performs no independent provider/config write;
4. waits for installed identity, artifact trust, runtime profile, activation
   plan, and configuration migration to be recaptured by existing owners; and
5. recomposes each feature independently. Only still-eligible, enabled features
   may reopen. Others become unavailable with retained readers unchanged.

Rollback recomposes from the restored artifact/config evidence. A provider
transition never changes Battle Home or collection consent automatically.

## Game-Running Safety Boundaries

| Action while STFC runs | Decision and reason |
| --- | --- |
| Read history/detail, export, diagnostics | Allowed when the reader/storage owner says safe; use bounded read scopes. |
| Continue already-active collection | Healthy normal state per feature. Game running is not a warning. |
| Pause one category | Allowed after warning that new events for that feature will not be saved until resume. Other categories and the shared listener remain active. It does not edit TOML or terminate the game. |
| Pause all / resume an already-configured category | Allowed when exact credential/config/readiness checks pass and no restart is required. Pause all may close the unused listener but does not edit TOML. |
| Activate, durable disable, rotate credential, provider install/update/switch/remove, or change local target TOML | Blocked: close the game, then revalidate. The existing process cannot adopt those changes safely. |
| Import with collection inactive | Allowed when it does not initialize or mutate game configuration; the repository serializes writes. |
| Import with collection active | Stop/drain collection and require the game closed before import. V1 does not knowingly drop live producer events to make an import concurrent. |
| Schema migration, restore, compaction, destructive cleanup, or data deletion | Stop collection and require the game closed. This is the deterministic v1 boundary even when a narrower case might be technically possible. |
| Low-disk emergency | Stop accepting new ingest immediately, finish/roll back the bounded active transaction, preserve old data, and surface `Storage full—collection paused`. Never delete automatically. |

No action terminates STFC automatically. Every blocked command is re-evaluated
from a fresh snapshot after the player closes the game; Bridge does not pollute
eligibility with process state.

## Windows Startup And Minimized Interaction

Launch-with-Windows and Launch-minimized remain two independent, default-off
launcher preferences owned by Bridge issues #116 and #118.

- Enabling either preference is not Battle activation or collection consent and
  creates no Battle state.
- Windows startup uses the accepted per-user MSIX/standalone registration and
  single-instance activation. Battle code creates no Run key or scheduled task.
- `Launch minimized` means a restorable taskbar window with no initial full-window
  flash. It applies according to the exact product wording accepted by #118; it
  never means tray-only or headless.
- Any enabled category may resume after an automatic/minimized launch only after
  startup recovery, runtime ownership, credential/config, schema, eligibility,
  and restart checks pass. Otherwise Bridge stays dormant/blocked and makes the
  actionable state discoverable on restore.
- A second launch restores/focuses the existing instance. Explicit Exit always
  stops collection and unregisters no startup preference.
- A blocking recovery, failed update, port collision, or credential drift cannot
  remain only in an invisible modal dialog. The taskbar state and accessible
  window expose the reason and next action.

Automatic collection from Windows startup must not ship until #116/#118 prove
single-instance activation, restore/exit accessibility, Explorer restart, update,
and uninstall behavior. Manual visible/minimized process lifetime may qualify
independently.

## Deterministic Transition Matrix

Every command is idempotent against the same immutable input and durable receipt.

| Starting condition | Command/event | Required result |
| --- | --- | --- |
| Clean: no Battle path; preference unset; feature ineligible | Passive launch/navigation | Remain clean; Base Bridge works; no Battle side effect. |
| Clean; feature eligible; preference unset | Passive launch/navigation | Project `available`; do not create paths/token/store/listener. |
| Clean; one feature eligible | Confirm that feature's activation | One marker-bound activation; on success one shared credential, that category/config projection, and only required storage; repeated confirmation is no-op. |
| One category active; another eligible/unset | Enable the second category | Reuse the verified credential/listener/store, enable only the requested preference/category, and keep the first unchanged. |
| Clean or disabled | Explicit import | Create/validate store through bootstrap marker; no credential, listener, capability, or provider mutation. |
| Active collection | Switch Home | Collection/store/credential unchanged; only Home preference changes. |
| Active collection | Minimize | Continue; healthy status remains non-warning. |
| Active collection | Close/Exit | Bounded stop/drain, clean close, release runtime lease, process exits. |
| Multiple active categories | Pause/Resume one | Session-only category stop/start; other categories and durable preferences/TOML unchanged. |
| Multiple active categories | Disable one | Stop/drain that category; game-closed category update; its preference disabled; shared target stays active for the other; all data retained. Retry is no-op. |
| Any active categories | Disable all collection | One reviewed aggregate writes every accepted collection preference/category off and derives the shared target inactive; all data retained. |
| All categories disabled with readable history | Launch/open Battles | No listener; read supported data; Home remains independently selectable when policy permits. |
| One disabled category, exact credential/config agree | Re-enable it | Reuse shared credential, write only its managed category/preference plus derived target state, recompose; do not duplicate token/store. |
| Disabled category, credential/config drift | Re-enable it | Block; review and rotate/repair. Never choose one secret by timestamp. |
| Active/disabled | Compatible Bridge upgrade | Preserve paths/credential/preferences; inspect schema; migrate only through reviewed marker/backup flow. |
| Active/disabled | Runtime capability lost | Stop dependent collection, retain preference/history, expose typed unavailable reason. |
| Active/disabled | Provider transition | Existing provider journal owns; Battle quiesces and recomposes; no duplicate state or auto-consent. |
| Any state | Crash before `commit-started` | Validate prior state, remove only bound candidates, resume prior state or surface mismatch. |
| Any state | Crash during `commit-started` | Compare exact before/after identities; all-before or all-after recover deterministically; mixed/unknown requires review. |
| Any state | Crash after `commit-verified` | Preserve committed state and finish idempotent bounded cleanup. |
| Recovery required/failed | Any new mutation | Reject; safe readers remain available only when the recovery owner explicitly permits them. |
| Low disk | New ingest | Pause before storage harm; preserve committed data; explicit storage review only. |
| Explicit Remove Battle data complete | Next launch | No `battle` path/delete marker/listener; Base preferences/providers/game config outside the exact reviewed disable-all/removal mutation remain untouched. |

## Player Actions And Diagnostics

Collection rows are instantiated with the exact feature name (`Battle
collection`, `Fleet collection`, or a later checked-in feature); they never use
one provider-wide Battle status.

| Lifecycle state | Player-safe status | Primary action | Secondary action |
| --- | --- | --- | --- |
| Eligible, never activated | `Battle collection is available and off` | `Enable collection` | `Learn what is stored` |
| Enabled, awaiting game restart | `Collection is ready after the game restarts` | Existing safe restart/launch action | `View changes` |
| Active, window visible/minimized | `<Feature> collection is active while you play` | `Pause <feature>` | Open its workspace |
| Paused | `<Feature> collection is paused; saved history is unchanged` | `Resume <feature>` | `Disable <feature>` |
| Disabled | `<Feature> collection is off; saved history is unchanged` | `Enable <feature>` | Open its workspace when readable |
| Another process owns runtime | `Battle features are open in another Bridge window` | `Open running Bridge` | `Try again` |
| Game blocks mutation | `Close Star Trek Fleet Command to make this change safely` | `Check again` | `Cancel` |
| Credential/config drift | `Bridge found a local connection setting it will not overwrite` | `Review Data Sync` | `Rotate connection key` after review |
| Port/listener unavailable | `Collection could not start on this PC` plus typed reason | #62-defined safe retry/repair | `View diagnostics` |
| Storage migration needed | `Saved Battle data needs an upgrade before it can open` | `Review upgrade` | `Export support details` |
| Recovery in progress | `Bridge is recovering the last Battle change` | No mutation action | Read-only progress/details |
| Recovery failed | `Bridge could not recover the last Battle change automatically` | `View recovery details` | Safe owner-declared `Retry` only when no operation is active |
| Low disk | `Storage is full; collection is paused and saved data was kept` | `Review storage` | `Export` |

Diagnostics expose stable structured facts:

- nominal layout version and relative path IDs, never the full user-profile path
  in ordinary support export;
- runtime owner `none`/`this-process`/`other-process`, process ID only in local
  diagnostics, and clean/unclean last shutdown;
- listener state, bounded pending/in-flight counts, last safe transition, and
  typed start/stop failure without endpoint credential;
- credential `absent`/`readable`/`drifted`/`unreadable`, generation, and rotation
  reason without token or protected bytes;
- store `Absent`/`Unavailable`/`Readable`/`MigrationRequired`/`TooNew`/
  `Unsupported`/`UnknownCodec`/`Corrupt`/`RecoveryReady`, schema identity, and
  bounded counts/bytes under the storage contract;
- exact application-operation and Battle recovery owner/stage/reference IDs,
  mutation/read effects, and marker validation result;
- every per-feature collection preference/session pause/decision, the derived
  shared-target/listener demand, Home preference, provider/install evidence, and
  game state as separate fields; and
- whether startup/minimized registration is effective, without private paths.

Logs and support export omit raw events, TOML values, token/DPAPI bytes, player or
alliance identity, exact local paths, provider credentials, and database pages.
Raw evidence export remains a separate explicit player operation.

## Accessibility And Automation Acceptance

- Close, Exit, Minimize, per-feature Pause/Disable, Pause/Disable all collection,
  and Remove data are distinct names and never rely on window chrome, color, or
  icon alone.
- The first-run activation review states that closing Bridge stops collection,
  minimizing may continue it, where data is stored in friendly terms, and that
  disabling does not delete history.
- Every blocked action puts focus on a concise reason and one primary resolution
  path. Recovery progress uses a polite live region only on meaningful state
  change; ingest events are never individually announced.
- A minimized/startup instance has a keyboard-accessible restore and explicit
  Exit path. A second launch restores it instead of producing a hidden failure.
- Recovery and destructive previews list exact affected categories and counts;
  confirmation defaults to cancel, remains operable at 100/150/200% scaling,
  and does not trap focus.
- Automation names include feature, state, and reason, for example
  `Battle collection, active, continues while this window is minimized` and
  `Battle storage recovery, failed, view recovery details`.
- A game-running collector is presented as healthy. Warning color/status appears
  only for an independent typed blocker or failure.

## Acceptance Handoff For #56, #62, And #63

The native implementation must prove, with table-driven filesystem/process
fixtures and signed-package smoke where relevant:

1. MSIX and standalone resolve the same unvirtualized nominal layout; absent
   Battle mode performs zero Battle filesystem/provider/module/worker/log/timer
   work.
2. Single-instance activation plus `runtime.lock` permits exactly one listener
   and writer. Absent-state activation/import proves canonical-marker-first,
   marker-owned runtime-lock creation and every intervening crash; existing-state
   operations prove runtime-owner-first. Forced kill, second launch, stale lock
   file, Explorer restart, and app update leave no hidden/orphaned process.
3. Close/Exit, minimize, Home switch, pause/resume, Windows startup, startup
   minimized, sign-out, and OS shutdown follow the exact lifetime table.
4. Direct Battle mutations use root `operation.lock`; provider transitions use
   existing provider-switch admission then root operation order and pass both as
   inherited context to a non-reentrant Battle participant. Contention,
   cancellation, failure, and crash injection prove no reacquisition, deadlock,
   leaked lease, stolen lock, or third Battle filesystem lock.
5. Per-feature activation/pause/disable/re-enable, aggregate Pause/Disable all,
   shared-host demand, import bootstrap, credential rotation, provider-transition
   participant behavior, upgrade, capability loss, and post-runtime-handle
   deletion/recovery pass every transition row idempotently.
6. Credential randomness/encoding, DPAPI scope/entropy, canonical schema/size,
   DACL, atomic replacement, TOML plaintext boundary, redaction, drift, retry,
   rotation, and crash cases pass without exposing a token.
7. Every journal stage is crash-injected before/after flush and replacement.
   Pre-CreateNew empty directories, torn first markers, bound successor files,
   all-before, all-after, mixed, corrupt marker, missing backup, unexpected file,
   reparse point, duplicate property, oversized marker, cleanup-pending, and
   every pre/post-runtime-handle deletion crash produce the specified
   non-guessing result.
8. #62 binds only after eligible enabled recovery-free recomposition, stops new
   accepts before drain, acknowledges only committed work, and uses finite
   checked-in request/in-flight/drain bounds. Provider identity is not a gate.
9. #63 uses the lifecycle fake runtime/maintenance lease and exact marker paths
   for database creation, migration, restore, cleanup, compaction, and recovery;
   it adds no connection-lifetime or cross-process policy of its own.
10. UI Automation tests cover every status/action row, restore/exit, no hidden
    modal, focus placement, live-region restraint, text scaling, and non-color
    game/collection health.

## Decisions Deliberately Reserved For Evidence

Only these empirical release choices remain open:

- #62's exact loopback host component, port/allocation rule, request/rate/
  in-flight bounds, and shutdown-drain timeout;
- #63/#78's qualified SQLite provider, pragmas, connection count, compression
  gate, storage limits, backup count/aging, and retention/compaction policy;
- #116/#118's supported Windows registration mechanism and exact wording for
  whether Launch minimized applies to manual launches, startup launches, or both;
- the accepted Battle Home offer predicate and one-time prompt owned by #55/#75;
  and
- any future tray/background/service mode, which requires a new explicit player
  preference, visible restore/exit UX, update/uninstall lifecycle proof, and a
  separate privacy/resource review.

Those gates may tune bounded constants or optional presentation. They may not
change the v1 guarantees that Exit stops collection, inactive mode is zero-side-
effect, one native Bridge owns configuration/provider/lifecycle authority, and
retained readable history survives capability, provider, Home, and collection
state changes.
