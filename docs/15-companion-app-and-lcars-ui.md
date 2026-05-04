# Companion App And LCARS UI Plan

## Decision

The sidecar should become the optional STFC Community Mod Companion app: a local
installer, updater, settings UI, event viewer, and diagnostics console that lives
outside the injected mod.

The visual direction should be LCARS-inspired. This fits the project and gives
the sidecar a strong product identity, especially for the future desktop shell
and optional overlay hosts.

## Packaging Shape

Release packaging should support two user paths:

- raw mod artifact: current `version.dll` or macOS dylib/launcher assets for
  manual installs;
- companion installer: an `.exe` or `.dmg` that can install/update the mod, host
  settings and viewer UI, and talk to the runtime config bridge when STFC is
  running.

The companion should be optional. Existing users should not be forced out of the
manual DLL/dylib path.

Initial implementation uses Electron through `packages/desktop`:

- `npm run desktop:dev` starts the desktop shell in development.
- `npm run desktop:pack` creates an unpacked app directory for inspection.
- `npm run desktop:dist` creates installer artifacts.

The Electron shell should start the existing local viewer server and display the
same renderer. Do not fork UI logic between browser and desktop.

Packaging constraint: the sidecar currently uses Node's `node:sqlite` module, so
the Electron runtime must carry Node 22 or newer. The initial desktop package
targets Electron 41, which carries Node 24.

## Runtime Boundary

The companion app can edit settings while STFC is running only through the
runtime config bridge owned by the injected mod.

The bridge must accept typed, schema-validated setting patches only. It must not
be a gameplay command channel, arbitrary object bridge, input injector, or live
TOML reload mechanism.

## UI Host Strategy

Build the UI as renderer-neutral web code around `@stfc-mod-sidecar/core`.

Preferred order:

1. Local web UI continues to prove core screens and API shape.
2. Electron packages the same UI as a Windows-first desktop companion.
3. Tauri remains an option if binary size or update policy becomes the main
   constraint.
4. Overwolf can become another renderer/client later, not the core architecture.

The renderer should consume sidecar APIs and the config schema. It should not own
mod parsing rules, gameplay state logic, or integration policy.

## LCARS Direction

Use an original LCARS-inspired design system for the sidecar. Do not copy or
vendor external LCARS template files unless the project has distribution rights.

Design targets:

- dark operational console by default;
- segmented rails and elbow panels for navigation;
- dense status strips for session, feed, config, and game state;
- strong color roles for status, warning, disabled, pending, and applied states;
- tabs and segmented controls for settings groups;
- compact tables and event timelines for repeated diagnostic work;
- responsive layout that stays usable in a desktop app, browser, and possible
  overlay host.

Avoid turning every surface into a decorative fan page. The sidecar is an
operational tool first.

## TheLCARS.com License Assessment

The TheLCARS.com template is useful reference material, but its published license
is not an open-source license suitable for direct bundling in this project without
permission.

Based on the license page reviewed on 2026-05-03:

- free personal/non-commercial website use is allowed with attribution;
- attribution with a link to TheLCARS.com is required when using the template;
- hotlinking template files is forbidden;
- commercial use requires written consent;
- selling, distributing, or retransmitting the template is forbidden;
- resulting works based on the template remain subject to that license.

Implication: do not download the template into this repo, commit its assets, or
ship it inside an `.exe`/`.dmg` unless written permission covers that exact use.

Safe path for now:

- build original CSS/components inspired by LCARS interface language;
- use project-authored shapes, spacing, colors, and layout code;
- include a general attribution/disclaimer page if the UI explicitly references
  LCARS or TheLCARS.com inspiration;
- keep third-party template files out of the repository and release artifacts.

Permission path later:

1. Contact TheLCARS.com before using the template assets directly.
2. Ask specifically about GPL/open-source repository use, free release builds,
   bundled desktop apps, Overwolf packaging, and attribution placement.
3. Store the permission text in project records before importing assets.

This is an engineering/license-risk assessment, not legal advice.

## Attribution Surface

If the sidecar uses only original LCARS-inspired styling, use a conservative
credits entry such as:

```text
LCARS interface concept inspired by Star Trek production design. This project is
not affiliated with, endorsed by, or sponsored by CBS Studios Inc. or Scopely.
```

If the project later receives permission to use TheLCARS.com template assets,
also include attribution in the app credits and documentation, for example:

```text
LCARS Inspired Website Template by www.TheLCARS.com, with modifications.
```

Do not use this second attribution unless the template is actually used and the
license/permission terms are satisfied.

## First UI Slice

The first LCARS-inspired implementation should be small and reversible:

1. Create design tokens for background, rail, panel, alert, text, and status
   colors.
2. Replace the current beige viewer shell with an LCARS-inspired shell.
3. Keep existing page routes and APIs unchanged.
4. Convert navigation, status strips, settings rows, and event lists first.
5. Add an app credits/about surface with project and license disclaimers.
6. Verify desktop and narrow viewports before packaging.

Do not start by importing the TheLCARS.com download.