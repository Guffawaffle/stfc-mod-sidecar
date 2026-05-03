# Hotkey Settings Page

The sidecar settings page is the first editable configuration surface for the production C++ community mod.

## V1 Scope

- Read `community_patch_settings.toml` through the sidecar server.
- Show hard keyboard settings from `[control]` and `[ui]`.
- Show bindable actions from `[shortcuts]` grouped by user-facing category.
- Let the user draft add, remove, reset, and Off changes in the browser.
- Save allowlisted changes back to the TOML file for the next game launch.

V1 does not live-apply bindings to a running game process.

## Shortcut Semantics

The UI preserves the C++ mod's existing behavior:

- Missing `[shortcuts]` key means use the compiled default.
- Explicit `NONE` means intentionally unbound.
- Pipe-delimited values are multiple bindings for one action, such as `SPACE|MOUSE1`.

The UI presents Off as a first-class state, but saving Off writes `NONE` rather than deleting the key.

The editor currently limits new saves to two bindings per action. The mod parser can accept more, but two slots matches common game-control UX and keeps conflict handling readable.

## Hard Settings Included

- `control.hotkeys_enabled`
- `control.hotkeys_extended`
- `control.use_scopely_hotkeys`
- `control.allow_key_fallthrough`
- `control.select_timer`
- `control.enable_experimental`
- `ui.disable_move_keys`
- `ui.disable_escape_exit`
- `ui.escape_exit_timer`

## Save Boundary

The save API is a privileged mutation route. It requires the settings token through `Authorization: Bearer <token>` or `x-sidecar-settings-token`.

The server writes only allowlisted settings and creates `community_patch_settings.toml.bak.sidecar` before replacing an existing config file.

## V2 Direction

Live apply remains secondary. When added, it should use the documented dynamic settings boundary: allowlisted commands, bounded payloads, monotonic request IDs, and explicit mod acknowledgments. The sidecar should request binding changes; it should not synthesize gameplay input.
