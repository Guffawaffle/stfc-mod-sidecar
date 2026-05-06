# Signed Release QA Matrix

This checklist records what must be exercised before publishing a signed STFC
Community Mod Companion release. It is intentionally explicit about what was
actually run; do not mark a row as passed from inference alone.

## Automated Gates

Run these before release packaging or require the release workflow to run them:

```powershell
npm ci
npm run check
git diff --check
```

For local Windows artifact smoke testing:

```powershell
npm run desktop:dist:win
```

Official release artifacts are built by `.github/workflows/release-windows.yml`
with `WIN_SIGN_MODE=azure`. That workflow must verify every generated `.exe`
with `signtool verify /pa /v` and `Get-AuthenticodeSignature` before upload.

## Latest Local Readiness Snapshot

Recorded on 2026-05-04 after the Basic companion install/update sprint:

- `npm run ax -- check`: passed.
- `npm run ax -- ci`: passed, including Windows NSIS and portable packaging.
- VS Code diagnostics: no errors.
- `git diff --check`: passed.
- Packaged launch, silent setup, silent uninstall, source-server install flow,
  About-page install execution, different-DLL profile handling, and manual
  recovery smokes were run in the preceding full smoke pass.

This snapshot does not make the product signed-release-ready. Interactive
installer smoke, signed artifact verification, full uninstall behavior, and the
remaining release/security roadmap work still need their own release records.

## Manual Smoke Matrix

Record each result as `pass`, `fail`, `not run`, or `blocked`, with a short note.

| Area | Check | Expected Result |
| --- | --- | --- |
| Installer | Launch NSIS setup from a clean user profile or disposable VM. | Installer opens without SmartScreen/signature surprises beyond expected reputation warnings. |
| Installer | Change install directory. | App installs under the chosen directory and resources are present. |
| Installer | Leave Developer Tools unchecked. | First launch starts in Standard Companion mode. |
| Installer | Check Developer Tools. | First launch starts with Developer Tools enabled. |
| Installer | Launch after install. | App opens About/Home without a blank window or server startup error. |
| Portable | Run portable `.exe` from a writable folder. | App starts without installer state and uses the same in-app mode model. |
| Bootstrap | Start with no saved game directory. | Settings shows bootstrap state and can select an STFC game directory. |
| Bootstrap | Select a valid directory containing `prime.exe`. | Directory is persisted, feed/settings paths derive from that directory, and the server restarts cleanly. |
| Bootstrap | Select a directory without `prime.exe`. | Directory is rejected and not persisted. |
| Bootstrap | Select a relative, network, namespace, or malformed path if the picker/test harness can provide one. | Path is rejected before any derived file access. |
| Mode | Start fresh in Standard Companion. | Workbench nav and `/battle-log/workbench/` are unavailable; `/api/dev/*` returns a denial. |
| Mode | Enable Developer Tools from About. | Mode persists, server restarts, Workbench nav appears, and `/api/dev/status` succeeds. |
| Mode | Disable Developer Tools from About. | Mode persists, server restarts, Workbench nav disappears, and `/api/dev/*` returns a denial. |
| Mode | Toggle mode, then immediately navigate to another page. | The chosen mode still persists and the app reloads the active page after restart. |
| Settings | Edit a supported hotkey or hard setting. | Save writes a sparse TOML change and creates a backup when replacing an existing settings file. |
| Settings | Save with an invalid/conflicting binding where the UI warns. | Warning remains visible and the saved result matches the user's explicit choice. |
| Battle Log | Open Battle Log against the live feed. | Existing entries render and detail views open without console/runtime errors. |
| Battle Log | Wait for new live entries. | Live updates arrive through `/api/events/stream` without the old two-second browser polling loop; record observed delay, reconnect behavior, and any stale state. |
| Release Info | Open About and run Check for Updates. | Version, release channel, update mode, signing expectation, and manual update result match the artifact being tested. No unsigned asset is downloaded automatically. |
| Companion Uninstall | Open About from an installed NSIS copy. | Packaging card reports Installed Companion and exposes Uninstall Companion plus Windows Apps handoff. |
| Companion Uninstall | Click Uninstall Companion. | App launches the NSIS uninstaller and exits. Community Mod files in the selected STFC directory are not touched by app uninstall. |
| Companion Uninstall | Open About from portable and source/dev runs. | Portable/source state is clear and no misleading app-uninstaller action is shown. |
| Community Mod Install | Run `npm run smoke:mod-install`. | Temporary install and replacement both succeed, replacement creates a backup, and the real STFC directory is not touched. |
| Community Mod Install | With STFC closed and a disposable game directory selected, enable `STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION=1`, prepare confirmation, and click Execute Install. | Endpoint returns installed/replaced receipt, About shows recovery guidance, and writes are limited to the disposable directory. |
| Community Mod Install | Repeat the live endpoint smoke while `prime.exe` is running. | Execution is blocked with no game-directory write attempted. |
| Community Mod Uninstall | Click the primary Uninstall action for a disposable Community Mod install. | The tool chooses the correct removal/restore flow, asks for confirmation, and reports the receipt without exposing the diagnostic steps as the normal path. |
| Community Mod Recovery | For a replacement receipt with a backup path, manually restore the backup over `version.dll` in the disposable directory. | Refresh Status reclassifies the restored DLL and no stale manifest is trusted when the DLL hash differs. |
| Upgrade | Install over an existing version with `desktop-settings.json`. | Existing game directory and `developerMode` remain authoritative. |
| Uninstall | Run Windows Apps/Add or Remove Programs uninstall. | Installed app files are removed. Companion user-data settings/logs remain by design unless a future explicit cleanup action is implemented. |

## Signature And Provenance Checks

For each release asset, record the file name, size, SHA-256 hash, and signature
status. The expected Windows assets are:

- `STFC Community Mod Companion-Setup-<version>-x64.exe`
- `STFC Community Mod Companion-Setup-<version>-x64.exe.blockmap`
- `STFC Community Mod Companion-Portable-<version>-x64.exe`

Verify Windows executables:

```powershell
signtool verify /pa /v "packages\desktop\dist\STFC Community Mod Companion-Setup-<version>-x64.exe"
signtool verify /pa /v "packages\desktop\dist\STFC Community Mod Companion-Portable-<version>-x64.exe"
Get-AuthenticodeSignature "packages\desktop\dist\STFC Community Mod Companion-Setup-<version>-x64.exe"
Get-AuthenticodeSignature "packages\desktop\dist\STFC Community Mod Companion-Portable-<version>-x64.exe"
```

Verify Git provenance when a signed tag is used:

```powershell
git tag -v v<version>
git log --show-signature -1 v<version>
```

## Release Record Template

Copy this into the release issue, pull request, or release notes draft.

```markdown
## Release QA Record

- Version:
- Commit:
- Tag:
- Build workflow run:
- Tester:
- Test date:
- Environment:

### Automated Gates

- npm ci:
- npm run check:
- git diff --check:
- npm run desktop:dist:win:
- npm run smoke:mod-install:
- CI Authenticode verification:

### Manual Smoke

| Area | Result | Notes |
| --- | --- | --- |
| Installer clean install | not run | |
| Installer custom path | not run | |
| Installer Standard first launch | not run | |
| Installer Developer Tools first launch | not run | |
| Portable launch | not run | |
| Valid game directory | not run | |
| Invalid game directory | not run | |
| Standard mode gates | not run | |
| Developer mode gates | not run | |
| Immediate mode toggle navigation | not run | |
| Settings save | not run | |
| Battle Log live feed | not run | |
| About release info | not run | |
| Companion uninstall status | not run | |
| Companion uninstaller handoff | not run | |
| Portable/source uninstall status | not run | |
| Community Mod temp-dir smoke | not run | |
| Community Mod live endpoint smoke | not run | |
| Community Mod primary uninstall action | not run | |
| Community Mod running-game block | not run | |
| Community Mod rollback restore | not run | |
| Upgrade preserves settings | not run | |
| Uninstall | not run | |

### Assets

| File | SHA-256 | Authenticode | Notes |
| --- | --- | --- | --- |
| Setup exe | | not checked | |
| Setup blockmap | | n/a | |
| Portable exe | | not checked | |
```
