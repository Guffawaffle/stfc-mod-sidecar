# Community Mod Install Recovery

The companion install/update flow is intentionally conservative. Execution is
disabled by default and only runs when the local server process has
`STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION=1`, the request opts in, and the
prepared confirmation values match exactly.

## Supported Close-Out State

- Windows `version.dll` install/update is the only implemented write path.
- macOS and other non-Windows platforms return `platform_unsupported` and do not
  probe or write the Windows DLL path.
- The About-page Execute Install button remains disabled until confirmation is
  ready and includes acknowledgement text, staged SHA-256, and destination path.
- Execution always checks `prime.exe` again immediately before writing.
- Replacement actions copy the existing DLL to `.stfc-sidecar/backups/` before
  writing the staged DLL.
- After copy, the destination hash must match the staged DLL before the install
  manifest is written.

## Recovery Instructions

If execution is blocked before writing, no recovery action is required. Resolve
the blocker, refresh status, and prepare confirmation again.

If a fresh install succeeds and the user wants to undo it, close STFC, remove
the installed `version.dll`, and remove `.stfc-sidecar/community-mod-install.json`
from the selected game directory.

If a replacement succeeds and the user wants to roll back, close STFC and copy
the reported backup file over the reported destination `version.dll`. Keep the
install manifest with the execution receipt until the rollback is complete.

If execution fails after writes begin, read the execution receipt first:

- `rollback.restoredBackup: true` means the previous DLL was restored.
- `rollback.removedDestination: true` means a partial fresh install DLL was
  removed.
- `rollback.error` means manual attention is required before retrying; restore
  the reported backup over the destination if a backup path exists.

Do not retry execution while STFC is running. Refresh status after any manual
restore so the companion re-reads the selected game directory.

## Temp-Directory Smoke

Run the helper-level smoke when changing the execution contract:

```powershell
npm run smoke:mod-install
```

The smoke creates temporary game directories, enables execution only for the
fixture request, installs a staged DLL, replaces an existing DLL with backup,
and verifies the resulting manifest/classification without touching the real
STFC directory.

The live endpoint smoke still requires STFC to be closed because the endpoint
uses real process detection and must block while `prime.exe` is running.
