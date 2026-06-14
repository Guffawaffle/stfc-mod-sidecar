# STFC Agent Guidance

This workspace is intentional. Related STFC roots may be open nearby, but they are not interchangeable. Start in the repo/root named or implied by the task and treat that checkout as the task home.

## Paved path

Use AXF/Lex first for workspace navigation, repo selection, task context, validation, deploy, and runtime workflows.

Preferred discovery order:
- AXF MCP/capability router, if available
- AXF CLI commands such as `ax`, `axf`, or repo/workspace docs/scripts
- normal repo-local discovery only after AXF/Lex is unavailable or insufficient

If AXF/Lex command discovery is unclear, inspect available entrypoints before guessing.

## Runtime/process permission

During STFC development sessions, agents may cycle or restart the STFC game client and the sidecar when needed for build, deploy, or runtime validation/testing. This is a default permission unless the human prompt revokes it for the session.

Use AXF/Lex or repo-provided lifecycle commands when available, keep the scope to the STFC client and sidecar, do not touch unrelated processes, do not wipe stores, logs, or configs unless explicitly asked, and report when a cycle was performed. A reasonable game/sidecar cycle in service of the task is normal workflow.

## Game config permission

Agents may edit TOML configuration files under the workspace folder named `game` when a task requires mod/runtime configuration changes. In the current STFC workspace, `game` points to `C:\Games\Star Trek Fleet Command\default\game`.

This permission is limited to TOML/config edits. Use AXF/Lex or repo-provided config flows when available, do not modify game binaries, assets, packaged data, executable files, or unrelated install contents unless the human prompt explicitly authorizes it, do not wipe stores, logs, or configs unless explicitly asked, and report any TOML/config changes made.

## Nearby roots

Common workspace roots may include:
- `stfc-mod` — primary community mod repo in this checkout
- `stfc-mod-guffa` — primary community mod repo in a parallel checkout when present
- `stfc-mod-ax-private` — private AX/automation support
- `STFC Diagnostics Logs (read-only)` — logs and evidence only; do not edit
- `game` — local game install/runtime files
- `majel` — Majel/service-related work
- `stfc-mod-sidecar` — sidecar companion service/viewer
- `netniv` — related upstream/reference repo

## Working agreement

- Use the intended checkout. Only create a new clone, worktree, or sibling checkout when the task explicitly calls for it.
- If that checkout is already dirty in unrelated or unclear ways, report the branch and dirty files before implementation.
- Read-only roots stay read-only.
- Outside approved TOML/config edits under `game`, only mutate non-config game install/runtime files when the task explicitly needs deploy, copy, or runtime changes.
- For cross-root work, name the roots you will touch before editing.
