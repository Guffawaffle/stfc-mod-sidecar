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

Future installer bootstrap should detect common install roots, but user choice
must remain the source of truth because players can move STFC or run non-default
install layouts.