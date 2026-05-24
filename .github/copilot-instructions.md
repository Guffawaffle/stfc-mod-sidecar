# GitHub Copilot Instructions for STFC Community Mod Companion

## Preferred Validation Interface: axf

This workspace is registered in axf as the `sidecar` family (`axf.workspace.json`). **Prefer axf as the primary interface** when available — it routes through the declared manifest and outputs structured JSON.

```bash
axf run sidecar status       # repository health and git status
axf run sidecar build        # build all packages
axf run sidecar test         # run all tests
axf run sidecar check        # build + test (pre-push gate)
axf run sidecar ci           # full gate: build, test, package Windows dist
```

- Use `axf run sidecar ci` as the default end-to-end gate before marking work complete.
- Use `axf list` to discover all registered capabilities.
- axf output is structured JSON; treat it as the primary source of pass/fail status.

axf discovers the workspace by walking up from the current directory for `axf.workspace.json`. Override with `$env:AXF_WORKSPACE` or `--workspace`.

## Direct ax (Fallback)

If axf is unavailable, use `npm run ax --` directly:

```bash
npm run ax -- ci
npm run ax -- check
npm run ax -- status
```

## Monorepo Structure

Packages live in `packages/`. The primary build target is `packages/desktop` (Electron app). Do not run package-level scripts directly unless both axf and the top-level `npm run ax --` are unavailable.

## Critical Execution Rules

- Do not pipe ax or axf output through text filters (`grep`, `tail`, `tee`). The output is JSON; parse it directly.
- `dist:win` and `ci` trigger an Electron Builder packaging run — they take longer than test/check. Allow sufficient time before treating them as hung.
- If a command must run asynchronously, use a background process and explicitly wait for completion before reporting status.
