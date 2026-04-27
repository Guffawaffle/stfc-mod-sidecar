# Desktop Package Placeholder

This package is reserved for a future desktop UI shell. It is intentionally empty in v0.

The first UI should consume `@stfc-mod-sidecar/core` events and remain replaceable. Electron, Tauri, Overwolf, or a plain local web UI should all be implementation details around the same sidecar core.

The UI must not send gameplay input to STFC or expose gameplay automation commands.
