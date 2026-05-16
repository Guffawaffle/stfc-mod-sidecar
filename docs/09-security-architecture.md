# Security Architecture

## Goal

The sidecar is local-first today, but future integrations will require credentials.

The design goal is to add that capability without contaminating the core event model, battle schema, or local diagnostic flow with secrets.

The main rule is simple:

- data plane and auth plane must stay separate from day one

The producer/consumer boundary, key classes, and pressure-valve rules are consolidated in [docs/22-producer-consumer-security-contract.md](22-producer-consumer-security-contract.md). This document provides the deeper credential model; the producer/consumer contract is the first stop for deciding whether a new route, event family, or target is allowed.

## Trust Zones

### 1. Game + Community Mod

This zone can observe STFC state and currently holds two kinds of sensitive material:

- game session headers used for Scopely journal retrieval such as `X-AUTH-SESSION-ID`
- sync target credentials such as the existing `stfc-sync-token`

These secrets are mod-local concerns. They must not be forwarded into the sidecar event stream just because the sidecar also runs on the same machine.

### 2. Sidecar Core

This zone ingests local files, validates events, stores session history, and may later perform explicit user-approved external exports.

It should be the only sidecar process allowed to touch provider tokens.

### 3. Local UI

The viewer, desktop shell, or overlay is a presentation client.

It should not be the credential authority. It can request operations from sidecar core, but it should not own provider tokens directly if a separate sidecar service exists.

### 4. External Providers

Majel, spocks.club, STFC Space, Overwolf-adjacent services, or any future provider are separate trust domains.

Each provider must get its own credential scope, policy, and audit trail.

## Secret Classes

There are three distinct secret families.

### Game Session Secrets

Examples:

- `X-AUTH-SESSION-ID`
- game server base URL when coupled with live auth context
- instance/session identifiers used to talk to Scopely APIs

Rules:

- mod-only
- never persisted to sidecar config
- never emitted in JSONL
- never exported in diagnostic bundles
- never reused for non-Scopely integrations

### Provider Credentials

Examples:

- bearer tokens
- API keys
- refresh tokens
- signed session cookies for external services

Rules:

- sidecar-only
- provider-scoped
- acquired only after explicit user action
- stored in OS-backed secret storage
- never written to event logs, battle capture, or normal config files

### Local Capability Secrets

Examples:

- per-launch loopback API bearer token
- ephemeral viewer session nonce

Rules:

- ephemeral
- local-only
- rotate per process launch or login session
- never reused as provider credentials

## Core Security Invariants

### 1. No Secrets In Event Payloads

The JSONL protocol is an observation stream, not a credential transport.

That means:

- no bearer tokens
- no API keys
- no cookies
- no Scopely session headers
- no provider refresh tokens
- no opaque secret blobs

If the sidecar needs to explain which credential was used, it should emit metadata only, such as:

- `provider`
- `profileId`
- `credentialRef`
- `scopeSet`

Never the secret value itself.

### 2. The Canonical Battle Schema Must Be Secret-Free

Battle capture, decode, analytics, and report payloads are long-lived artifacts that many consumers may store, replay, diff, or share.

They must contain battle data, not authorization material.

### 3. Credentials Must Be Provider-Scoped

Do not add a generic top-level `token` concept to sidecar config or protocol.

That shape caused acceptable coupling in the mod sync config because it targets a narrow upload channel. The sidecar will likely talk to multiple external services, so credentials must be modeled per provider and per profile.

### 4. Credentials Must Be Out-Of-Band

The sidecar event model should refer to credentials indirectly.

Preferred pattern:

- UI selects a provider profile
- sidecar core resolves the provider profile to secret material via a credential store
- sidecar core performs the outbound request
- emitted events record the provider/profile/result only

### 5. User Consent Gates Egress

No background export should occur just because data exists locally.

Outbound actions must be:

- user-initiated
- reviewable
- auditable in the event stream

### 6. Logging Must Be Redacted By Default

The mod already masks sync tokens for logs. The sidecar should adopt the same baseline rule:

- redact secrets before logging
- redact secrets before error serialization
- redact secrets before diagnostic bundle export

## Storage Model

## Bootstrap Simplicity

For a narrow first integration, a manually pasted bearer token in sidecar config can be acceptable if the shape really is just:

- one provider
- one long-lived user-generated token
- no refresh-token lifecycle
- no multi-profile switching
- no separate untrusted local UI process boundary

That is operationally simple and matches what the mod community is already used to.

The reason to name a `CredentialStore` anyway is not to complicate the auth model. It is to avoid coupling future integrations to plain-text durable config once the sidecar grows beyond that narrow case.

The credential store becomes useful when any of the following appear:

- multiple providers
- multiple profiles per provider
- refresh tokens or OAuth-style exchange
- a desktop shell or browser UI that should not own secrets directly
- a localhost API with privileged routes
- stronger expectations around redaction, export safety, and secret rotation

So the practical rule is:

- TOML bearer token is fine as a bootstrap path
- provider-scoped credential storage is the growth path once the sidecar is doing more than one simple outbound bearer-auth call

## Preferred Storage

Use OS-backed secret storage through a sidecar credential-store abstraction.

Recommended backends:

- Windows: Credential Manager or DPAPI-backed store
- macOS: Keychain
- Linux: Secret Service or libsecret-compatible store

The abstraction should expose metadata separately from secret values.

Example conceptual interface:

```ts
interface CredentialStore {
  listProfiles(provider: string): Promise<CredentialProfileMeta[]>;
  putSecret(input: PutSecretInput): Promise<CredentialProfileMeta>;
  resolveSecret(ref: CredentialRef): Promise<ResolvedSecret>;
  deleteSecret(ref: CredentialRef): Promise<void>;
}
```

Where metadata is safe to persist in normal config:

- `provider`
- `profileId`
- `displayName`
- `createdAt`
- `lastUsedAt`
- `scopes`

And secret material is not.

## Explicit Non-Goals

Do not plan on storing future provider tokens in:

- `community_patch_settings.toml`
- sidecar JSONL files
- battle report payloads
- sample event files
- exported diagnostic bundles by default

If a development override ever exists for local testing, it should be clearly marked insecure and disabled by default.

## Local API Security

If the sidecar grows a localhost HTTP or WebSocket API later, do not assume loopback alone is sufficient.

The concrete route/auth model for that future API lives in `docs/10-local-api-security-model.md`.

Required baseline:

- bind to loopback only by default
- use a random high port unless a fixed port is necessary
- require an ephemeral local capability token for privileged routes
- reject cross-origin browser requests by default
- do not allow mutating operations over unauthenticated GET routes

If a browser-based UI is supported, protect against local CSRF and cross-tab leakage.

## Diagnostic Bundle Rules

Diagnostic bundles are useful precisely because they are portable, which makes them a security risk if they contain secrets.

Default bundle policy:

- include event data
- include validation failures
- include provider/profile metadata only when necessary
- exclude all secret values
- exclude game session headers
- exclude raw auth cookies

If a support flow ever needs more, it should be opt-in and previewed before export.

## Recommended Protocol Shapes

Future integration-oriented events may include:

- `provider`
- `profileId`
- `requestedScopes`
- `grantedScopes`
- `status`
- `errorCode`

They should not include:

- `token`
- `refreshToken`
- `authorizationHeader`
- `cookie`
- `sessionHeader`

## Rollout Guidance

### Phase 1

- keep all sidecar data models secret-free
- document the auth-plane separation now
- avoid adding a generic `token` field anywhere in the sidecar protocol

### Phase 2

- introduce a provider-scoped `CredentialStore` abstraction in sidecar core
- persist only safe profile metadata outside secret storage

### Phase 3

- add outbound integration workers that resolve secrets only at request time
- emit redacted `integration.event` telemetry

### Phase 4

- if a local sidecar API exists, add local capability auth for privileged operations

## Design Summary

The safe way to leave room for future token handling is not to design tokens into the protocol. It is to design them out of the protocol.

The sidecar should treat credentials as side-band operational state owned by sidecar core, while the event stream and canonical battle schema remain portable, inspectable, and secret-free.