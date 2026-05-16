# Security And TOS Boundaries

This project must stay read-only with respect to STFC gameplay.

The mod/sidecar producer-consumer contract, including pressure valves and local-vs-remote key ownership, lives in [docs/22-producer-consumer-security-contract.md](22-producer-consumer-security-contract.md). Treat that contract as the first gate before broadening AX, UI, or integration behavior.

## Hard Rules

- No automation.
- No input injection.
- No auto-clicking.
- No combat automation.
- No navigation automation.
- No auto-claiming.
- No account manipulation.
- No hidden gameplay advantage behavior.
- No sidecar-to-mod command channel for gameplay control.

## Data Rules

- Local-first by default.
- No credential collection except explicit future user-configured integration tokens.
- Integration tokens must be stored only after clear user action and should be scoped to the provider.
- Integration tokens must not be written into JSONL events, battle payloads, or ordinary config files.
- Scopely game session headers used by the mod are a separate secret class and must never be reused as sidecar integration credentials.
- Sidecar credentials should live in OS-backed secret storage behind a provider-scoped credential abstraction.
- Integrations must be user-initiated.
- Diagnostic exports must be explicit and reviewable.
- Diagnostic exports must exclude secret material by default.

## Privacy Notes

Logs may contain sensitive account, alliance, session, location, timing, or battle information. Export flows should show what will be included before anything leaves the machine.

## Process Boundary

The sidecar should read files or local event APIs. It must not inject into STFC, patch the game process, synthesize input, or bypass gameplay.

If the sidecar later exposes a local API for UI clients, privileged routes should use an ephemeral local capability token rather than assuming loopback alone is a sufficient trust boundary.
