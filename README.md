# STFC Community Mod Companion

STFC Community Mod Companion is a Windows desktop helper for the Star Trek Fleet Command Community Mod. It installs, updates, uninstalls, and inspects the Community Mod `version.dll` in your selected STFC game folder, then gives you diagnostic views for mod events and settings.

This is an alpha build. It is intended for people who are comfortable testing early mod tooling and reporting problems. It does not automate gameplay, click buttons, send inputs to STFC, claim rewards, navigate ships, or provide hidden combat advantages.

## Download

1. Open the repository's Releases page and choose `v0.1.0-alpha.3`.
2. Download the Windows installer named `STFC.Community.Mod.Companion-Setup-0.1.0-alpha.3-x64.exe`.
3. Run the installer.
4. Launch `STFC Community Mod Companion` from Windows.

The portable `.exe` is useful for testing, but the setup installer is the recommended path for alliance-mate testing because Windows can manage uninstall from Apps & Features.

## First Run

1. Close Star Trek Fleet Command.
2. Open the Companion.
3. Go to `Settings`.
4. Click `Select STFC Game Directory`.
5. Select the folder that contains `prime.exe`, usually:

```text
C:\Games\Star Trek Fleet Command\default\game
```

6. Pick a Community Mod profile:
   - `Official Basic`: release artifacts from `netniV/stfc-mod`.
   - `Advanced Alpha`: release artifacts from `Guffawaffle/stfc-mod`.

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

## Current Alpha Limits

- Windows only for Community Mod install/update/uninstall execution.
- macOS packaging is not part of this alpha release.
- The UI is functional alpha software, not a polished consumer app yet.
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