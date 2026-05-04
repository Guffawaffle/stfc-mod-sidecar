# User Bootstrap And Paths

The desktop companion should not assume every user has STFC installed at the
development default path:

```text
C:\Games\Star Trek Fleet Command\default\game
```

The viewer server now accepts a game directory and derives the mod files from it:

```powershell
node packages\viewer\server.mjs --game-dir "C:\Games\Star Trek Fleet Command\default\game"
```

Derived files:

- feed: `community_patch_battle_feed.jsonl`
- settings: `community_patch_settings.toml`

Explicit paths still win for development and troubleshooting:

```powershell
node packages\viewer\server.mjs --feed-path "D:\samples\feed.jsonl" --settings-path "D:\samples\settings.toml"
```

The Electron companion stores the selected game directory in its user-data
folder as `desktop-settings.json`, then restarts the bundled sidecar server with
`--game-dir`. The Settings page shows the active directory and feed path, and in
desktop mode exposes native directory selection.

The same desktop settings file also owns the runtime companion mode:

- `developerMode: false` is the default Standard Companion experience.
- `developerMode: true` enables Developer Tools until the user turns it off.
- `STFC_SIDECAR_INITIAL_DEVELOPER_MODE=1` can seed the initial value for future
  installer/bootstrap flows when no desktop settings file exists yet.
- The Windows installer writes `resources\desktop-initial-settings.json` with the
  selected first-launch mode. The app reads that seed only when the durable
  `desktop-settings.json` file does not exist, so upgrades and later About-page
  changes keep the user's existing mode.

Mode changes restart the bundled viewer server with `STFC_SIDECAR_DEVELOPER_MODE`
set for that process. Renderer navigation hides Developer Tools in Standard
Mode, and the server also denies developer-only public and `/api/dev/*` routes
unless Developer Tools are enabled.

Security is Paramount: desktop directory selection is a trust boundary. The main
process canonicalizes the selected path, rejects relative, non-local, missing,
or non-directory paths, and requires `prime.exe` to exist directly inside the
selected directory before persisting it or deriving mod file paths. This limits
path traversal and arbitrary path access mistakes in the user-facing bootstrap
flow while keeping explicit `--feed-path` and `--settings-path` overrides
available for development and troubleshooting.

Future installer bootstrap should detect common install roots, but user choice
must remain the source of truth because players can move STFC or run non-default
install layouts.
