# Basic Companion Milestone Closeout

Date: 2026-05-04

## Status

The Basic companion install/update sprint is complete enough to move to the
next milestone. The next planned milestone is full uninstall behavior for both
the Community Mod and the installed Companion app.

## Completed Scope

- Official Basic and Advanced Alpha profile selection exists in desktop
  settings.
- Basic profile gates event-heavy UI and APIs away from the standard netniV
  compatibility path.
- Community Mod install detection uses manifest, SHA-256, and release
  fingerprint evidence instead of file version alone.
- Community Mod release catalog, dry-run install plan, artifact verification,
  cache-only staging, preflight, confirmation, and guarded execution endpoints
  are implemented.
- About page exposes the install/update flow and reports blocked or completed
  execution receipts.
- Windows is the only implemented Community Mod write path; macOS and other
  platforms report unsupported without probing the Windows `version.dll` path.
- Recovery guidance and temp-directory smoke coverage exist for guarded install
  and replacement.

## Validation Actually Run

- `npm run ax -- check` passed on 2026-05-04.
- `npm run ax -- ci` passed on 2026-05-04, including Windows NSIS and portable
  packaging.
- VS Code diagnostics reported no errors after the final LCARS CSS polish.
- `git diff --check` passed after the final LCARS CSS polish.
- Earlier full smoke pass covered helper install/replace, live endpoint
  install/replace/profile handling, About-page execution, packaged launch,
  silent setup, silent uninstall, and manual recovery scenarios.

## PM Closeout

- #15, #16, #17, #18, and #19 are closed.
- #12 is closed as the Basic companion compatibility parent record.
- #20 is tagged `status:planned` and assigned to the `0.0.2-Alpha - Installer
  Plus and Dev Mode` milestone for full uninstall behavior.
- #14 remains open for interactive installer smoke before a signed release.
- #8 and #9 remain broader release/security roadmap work before declaring the
  product signed-release-ready.

## Next Planned Milestone

Issue #20 owns the full uninstall plan:

- durable install manifest and backup metadata that survive app restart;
- Community Mod uninstall plan, confirmation, and execution helpers;
- fresh install removal and replacement rollback through the companion;
- stale manifest/hash mismatch blocking;
- installed Companion app uninstall status and handoff;
- release QA rows for uninstall behavior and user-data retention.

Implementation and unit tests should not require STFC to be closed. Live
endpoint smoke for uninstall execution must be run with `prime.exe` closed,
matching the install execution safety model.
