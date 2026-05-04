# Vision

STFC Mod Sidecar is a local diagnostic console and integration bridge that lives beside the STFC Community Mod, not inside it. Its job is to make runtime behavior visible without adding UI, desktop runtime, or integration dependencies to the injected mod.

The community mod should stay focused on observing game/mod state and emitting structured events. The sidecar should own display, parsing, local storage, diagnostics, and integrations.

The first useful version should be boring:

- Read JSONL events from a known path.
- Parse battle-log text defensively.
- Show or export hook health and session timeline data later.
- Keep integration actions explicit and user-initiated.

The long-term shape should let multiple renderers consume the same core: a desktop app, a local web UI, a CLI, Majel tooling, or an optional Overwolf overlay host.

The optional desktop companion should use an original LCARS-inspired interface
without making the injected mod own UI, installer, updater, or integration
dependencies. See `docs/15-companion-app-and-lcars-ui.md`.
