# Security And TOS Boundaries

This project must stay read-only with respect to STFC gameplay.

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
- Integrations must be user-initiated.
- Diagnostic exports must be explicit and reviewable.

## Privacy Notes

Logs may contain sensitive account, alliance, session, location, timing, or battle information. Export flows should show what will be included before anything leaves the machine.

## Process Boundary

The sidecar should read files or local event APIs. It must not inject into STFC, patch the game process, synthesize input, or bypass gameplay.
