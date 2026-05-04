# Desktop Companion Package

This package is the Electron shell for the optional STFC Community Mod Companion.

It reuses the local sidecar viewer instead of duplicating UI code. The desktop
main process starts `packages/viewer/server.mjs` as a local child process, waits
for `/api/health`, then opens the LCARS-inspired viewer in a desktop window.

The bundled Electron runtime must support Node's `node:sqlite` module because
the sidecar event store uses it. Keep Electron on a release line with Node 22 or
newer. The initial package targets Electron 41, which carries Node 24.

The UI must not send gameplay input to STFC or expose gameplay automation
commands.

The intended visual direction is an original LCARS-inspired sidecar interface. Do
not vendor or ship third-party LCARS template files unless their license or
written permission explicitly allows redistribution inside this app. See
`docs/15-companion-app-and-lcars-ui.md`.

## Development

After adding the desktop dependencies with `npm install`, run:

```powershell
npm run desktop:dev
```

## Packaging

Directory package for inspection:

```powershell
npm run desktop:pack
```

Installer artifacts:

```powershell
npm run desktop:dist
```

Expected outputs:

- Windows: NSIS installer and portable `.exe`
- macOS: `.dmg`

Windows artifact names are split into `Setup` and `Portable` builds so the two
targets do not overwrite each other in `dist/`.

The packaged app copies the core server's runtime dependencies into
`resources/node_modules` so the bundled `viewer/server.mjs` can import
`core/dist` without relying on the development checkout.

The prototype Windows config disables Electron Builder's executable
signing/editing step so local unpacked builds do not require symlink privileges
for the `winCodeSign` helper cache. Re-enable signing/editing before publishing a
real release artifact.

Signing is controlled by `packages/desktop/electron-builder.config.cjs`:

- no `WIN_SIGN_MODE`: unsigned local build, `signAndEditExecutable` disabled;
- `WIN_SIGN_MODE=azure`: Azure Artifact Signing official release path;
- `WIN_SIGN_MODE=cert-store`: Windows certificate-store fallback path.

The intended individual publisher identity is `Joseph Gustavson`. The exact
publisher name must match the Azure certificate profile or certificate subject.
See `docs/16-windows-code-signing.md`.

The package copies the viewer server/assets and `@stfc-mod-sidecar/core` build
output as Electron resources. Run `npm run check` before producing release
artifacts. Signed release smoke coverage is tracked in
`docs/18-signed-release-qa-matrix.md`.

The desktop app stores user bootstrap settings in Electron's user-data folder as
`desktop-settings.json`. The selected STFC game directory is passed to the
bundled server as `--game-dir`, which derives the battle feed and mod settings
paths from that directory.

The same file stores `developerMode`. Standard Companion mode is the default.
When Developer Tools are enabled from About, the main process persists the
preference, restarts the bundled server with `STFC_SIDECAR_DEVELOPER_MODE=1`,
and exposes developer-only surfaces. Standard Mode hides those surfaces and the
server denies `/api/dev/*` routes.

The assisted Windows installer includes a first-launch companion mode page. It
writes `resources\desktop-initial-settings.json` under the install directory;
the app reads that file only if the durable user settings file has not been
created yet. This lets the installer seed Developer Tools without making the
installer the mode authority.

Security is Paramount: the main process validates the selected game directory
before saving, opening, or passing it to the server. A selected directory must be
a canonical local directory and must contain `prime.exe` directly inside it.
