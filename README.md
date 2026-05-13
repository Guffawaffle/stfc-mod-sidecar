# STFC Community Mod Companion

STFC Community Mod Companion is a Windows desktop helper for the Star Trek Fleet Command Community Mod. It installs, updates, uninstalls, and inspects the Community Mod `version.dll` in your selected STFC game folder, then gives you diagnostic views for mod events and settings.

This is a release candidate build. It is intended for people who are comfortable testing early mod tooling and reporting problems. It does not automate gameplay, click buttons, send inputs to STFC, claim rewards, navigate ships, or provide hidden combat advantages.

## Download

1. Open the repository's Releases page and choose `v0.1.0-rc.3`.
2. Download the Windows installer named `STFC.Community.Mod.Companion-Setup-0.1.0-rc.3-x64.exe`.
3. Run the installer.
4. Launch `STFC Community Mod Companion` from Windows.

The portable `.exe` is useful for testing, but the setup installer is the recommended path for alliance-mate testing because Windows can manage uninstall from Apps & Features.

## First Run

1. Close Star Trek Fleet Command.
2. Open the Companion.
3. Go to `Settings` -> `General`.
4. If the Companion does not auto-detect STFC, click `Select STFC Game Directory`.
5. Select the folder that contains `prime.exe`, usually:

```text
C:\Games\Star Trek Fleet Command\default\game
```

6. Pick a Community Mod profile:
   - `Basic`: release artifacts from `netniV/stfc-mod`.
   - `Waffle Basic`: release artifacts from `Guffawaffle/stfc-mod`, including `v1.1.0-guffa.rc3`, with notification and audio settings enabled.
   - `Waffle Advanced`: the Waffle profile with Battle Log, event-store, and developer-facing views enabled.
7. Open `Settings` -> `Notifications` for desktop notification and audio cue controls when using a Waffle profile.

## Which Install Path Should I Use?

### New User: Easiest Install

Use this path when you do not want to manually download `version.dll` or edit TOML before you know the mod is working.

1. Close Star Trek Fleet Command.
2. Install and launch the Companion.
3. Open `Settings` -> `General`, select the STFC game directory, and keep `Basic` unless you specifically want Waffle notifications or advanced views.
4. Open `About`.
5. Click `Install Community Mod`.
6. Approve the GitHub release check.
7. Review the confirmation dialog and click `Install`.
8. Start STFC after the install completes.

The Companion downloads the selected release, verifies the artifact hash, stages `version.dll`, checks that STFC is closed, and copies the DLL into the selected game directory. You can return to `Settings` later to adjust supported config without hunting for the TOML file.

### Existing User: Keep Your DLL, Use Settings UI

Use this path when the mod is already installed and you mainly want safer config access instead of direct TOML edits.

1. Launch the Companion.
2. Open `Settings` -> `General` and select the STFC game directory that contains your existing `version.dll` and `community_patch_settings.toml`.
3. Keep the profile that matches your installed DLL. Use `Basic` for netniV releases, `Waffle Basic` for Waffle notifications without Battle Log, or `Waffle Advanced` for the full Waffle/dev surface.
4. Use the settings and hotkey controls to make supported changes.
5. Click `Save for next launch`.
6. Restart STFC so the C++ mod reloads the saved TOML.

The current settings UI is intentionally narrower than the full TOML surface. It is good for common settings, hotkeys, notifications, and audio cues. Advanced sync targets still require manual TOML edits for now.

### Existing User: Replace netniV With Waffle RC

Use this path when you already have the official mod installed but want the Waffle fork's release-quality behavior, including the redesigned input/action path, fork diagnostics, notification/audio settings, and Windows-verified `v1.1.0-guffa.rc3` release.

1. Close Star Trek Fleet Command.
2. Launch the Companion.
3. Open `Settings` -> `General`, select the STFC game directory, and choose `Waffle Basic` or `Waffle Advanced`.
4. Open `About`.
5. Click `Check Mod Release`; the Waffle profile should resolve to `Guffawaffle/stfc-mod` `v1.1.0-guffa.rc3` while that is the newest compatible Waffle release.
6. Click through `Verify Artifact`, `Prepare Confirmation`, and `Install` or `Replace` when prompted.
7. Confirm the replacement. The Companion backs up the existing `version.dll` before copying the Waffle release.
8. Start STFC and check `community_patch.log` or the Companion status if something looks wrong.

This path preserves your existing `community_patch_settings.toml` unless you explicitly uninstall with `Also delete settings and logs` checked.

### Advanced User: Waffle Advanced Plus Realtime Battle Log

Use this path when you want the Waffle fork and are willing to enable incomplete sidecar-facing features manually.

1. Install or replace the mod with the `Waffle Advanced` profile first.
2. Choose a local sync token. For a packaged Companion run, set it as a Windows user environment variable and restart the Companion:

```powershell
setx STFC_SIDECAR_SYNC_TOKEN "choose-a-long-local-token"
```

For source/dev runs, set the token in the shell before launching the viewer or desktop app:

```powershell
$env:STFC_SIDECAR_SYNC_TOKEN = "choose-a-long-local-token"
npm run desktop:dev
```

3. Edit `community_patch_settings.toml` in the selected STFC game directory and add or update this block:

```toml
[sync]
sidecar_jsonl = true
sidecar_jsonl_recent_logs = 300

[sync.targets.sidecar]
token = "choose-a-long-local-token"
url = "http://127.0.0.1:43127/api/events"
battlelogs = false
battlelogs_realtime = true
```

4. Optional: enable richer decoded battle records. Without this, the mod can still emit `battle.capture` events for the sidecar contract, but report/catalog/analytics output stays off.

```toml
[battle_log_decoder]
enabled = true
emit_segments = true
emit_feed = true
```

5. Keep the Companion running, then start STFC.
6. Open the Companion `Battle Log` page after battles resolve.

`sidecar_jsonl = true` keeps the zero-service JSONL fallback at `community_patch_battle_feed.jsonl`. `battlelogs_realtime = true` sends canonical battle events to the local Companion ingest API while the Companion is running. This advanced path is local-only, token-protected, and still evolving.

### Advanced User: Experimental Fleet Telemetry To Majel

Fleet telemetry reuses the mod's existing async `ships`/`slots` sync workers and posts only to the local Companion. Cloud upload is opt-in from the Companion process and targets Majel's strict `POST /api/sidecar/telemetry` route. This release uses an in-memory upload queue for advanced testing; it is not the durable telemetry outbox design yet.

Set the local sync token and Majel upload values before launching the Companion:

```powershell
$env:STFC_SIDECAR_SYNC_TOKEN = "choose-a-long-local-token"
$env:STFC_SIDECAR_CLOUD_TELEMETRY_URL = "https://your-majel-service/api/sidecar/telemetry"
$env:STFC_SIDECAR_CLOUD_TELEMETRY_TOKEN = "choose-a-long-cloud-telemetry-token"
npm run desktop:dev
```

Add a separate sync target in `community_patch_settings.toml`:

```toml
[sync.targets.sidecar_fleet]
token = "choose-a-long-local-token"
url = "http://127.0.0.1:43127/api/fleet/sync"
battlelogs = false
battlelogs_realtime = false
ships = true
slots = true
```

The Companion hashes ship identifiers locally, converts sync items to `stfc.telemetry.v1` events, and uploads batches only when both the URL and cloud token are configured. The mod never receives commands or cloud data.

## Install Community Mod

1. Close Star Trek Fleet Command.
2. Open `About` in the Companion.
3. Click `Install Community Mod`.
4. Approve the GitHub release check.
5. Review the confirmation dialog and click `Install`, `Update`, or `Replace`.

The Companion downloads only from the selected GitHub release profile, verifies the release artifact hash, stages `version.dll` in the Companion cache, checks that STFC is closed, then copies the DLL into the selected game directory. If it replaces an existing DLL, it creates a backup first.

## Uninstall Community Mod

1. Close Star Trek Fleet Command.
2. Open `About` in the Companion.
3. Click `Uninstall`.
4. Review the confirmation dialog.

By default, uninstall removes or restores the Community Mod DLL and leaves `community_patch_settings.toml` plus logs alone. Check `Also delete settings and logs` when you want a fuller cleanup of mod settings and extra mod artifacts.

The Companion app itself can be removed from Windows Apps & Features. The About page shows whether you are running an installed copy, a portable copy, or a source/dev copy.

## Safety Model

- The Companion only writes inside the STFC game directory you selected.
- Install and uninstall require the local desktop app token and an explicit confirmation payload.
- GitHub network calls require an in-app consent prompt.
- The app blocks install/uninstall when the target STFC process is running from the selected game folder.
- Symlinked `version.dll` paths and unsafe path boundaries are blocked.
- Unknown/manual `version.dll` installs require explicit replacement or removal confirmation.

## Current Beta Limits

- Windows only for Community Mod install/update/uninstall execution.
- macOS packaging is not part of this beta release.
- The UI is functional beta software, not a polished consumer app yet.
- The Companion can install the Community Mod, but it does not configure every mod setting for you.
- Diagnostics and battle-log views are still evolving.

## Development

Install dependencies:

```bash
npm install
```

Run the standard local check:

```bash
npm run ax -- check
```

Run the full CI gate:

```bash
npm run ax -- ci
```

Run the desktop shell in development:

```bash
npm run desktop:dev
```

Browser smoke tests exercise the local viewer server and settings APIs, but native setup controls such as profile, Developer Tools mode, and game directory require the Electron desktop bridge. To test the browser surface with a real game directory and Waffle profile:

```powershell
$env:STFC_SIDECAR_MOD_PROFILE = "waffle-basic"
npm run viewer:run -- --game-dir "C:\Games\Star Trek Fleet Command\default\game" --developer-mode --port 43127
```

Then open `http://127.0.0.1:43127/settings/#general`. Use `npm run desktop:dev` or the packaged executable for the full executable test, including directory picker, profile persistence, Developer Tools toggle, and install/update controls.

Create Windows artifacts locally:

```bash
npm run desktop:dist:win
```

Official Windows signing uses Azure Artifact Signing through the release workflow. The signed release QA matrix is documented in [docs/18-signed-release-qa-matrix.md](docs/18-signed-release-qa-matrix.md).

## Project Layout

```text
docs/                  planning, protocol, and release notes
examples/              placeholder JSONL and battle-log samples
packages/core/         event model, parser, diagnostics helpers, storage
packages/desktop/      Electron desktop companion shell
packages/viewer/       local Companion UI and API server
scripts/               validation, smoke, and release helper scripts
```

## Boundary

The C++ Community Mod remains the production mod. The Companion is a local helper around install/update/uninstall, settings, diagnostics, and event viewing. It does not control gameplay and should not grow gameplay automation features.

Architecture notes live in [docs/12-production-mod-boundary.md](docs/12-production-mod-boundary.md), and the current C++ mod feed contract is documented in [docs/13-cpp-mod-feed-contract.md](docs/13-cpp-mod-feed-contract.md).