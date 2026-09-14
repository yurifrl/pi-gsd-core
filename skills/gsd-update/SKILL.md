---
name: gsd-update
description: "Update GSD to latest version with changelog display"
argument-hint: "[--sync | --reapply | --next | --rc]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---


<objective>
Check for GSD updates, install if available, and display what changed.

Routes to the update workflow which handles:
- Version detection (local vs global installation)
- npm version checking
- Changelog fetching and display
- User confirmation with clean install warning
- Update execution and cache clearing
- Restart reminder
</objective>

<execution_context>
@~/.gsd/gsd-core/workflows/update.md
</execution_context>

<flags>
- **--sync**: Sync managed GSD skills across runtime roots so multi-runtime users stay aligned after an update. Runs the sync-skills workflow (--from, --to, --dry-run, --apply flags supported).
- **--reapply**: Reapply local modifications after a GSD update. Uses three-way comparison (pristine baseline, user-modified backup, newly installed version) to merge user customizations back. Runs the reapply-patches workflow.
- **--next** (alias **--rc**): Target the `@next` RC dist-tag instead of `@latest` so you can install or refresh a release candidate (e.g. `1.4.0-rc.1`) through the normal update flow — scope/runtime detection, changelog preview, custom-file backup, and cache clearing all still apply. Omitting it keeps targeting `@latest` (no change). See ADR #660 for the RC channel.
- **(no flag)**: Standard update — check for new version, show changelog, install.
</flags>

<gsd_runtime_cli>
**GSD CLI:** `~/.gsd/bin/gsd-tools` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled `@opengsd/gsd-core` engine — invoke engine commands as `~/.gsd/bin/gsd-tools <family> <subcommand> [args...]`.

**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from `GSD_AGENTS_DIR`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.
</gsd_runtime_cli>

<process>
Parse the first token of $ARGUMENTS:
- If it is `--sync`: strip the flag, execute the sync-skills workflow (passing remaining args for --from/--to/--dry-run/--apply).
- If it is `--reapply`: strip the flag, execute the reapply-patches workflow.
- Otherwise (including `--next` / `--rc`): execute the update workflow end-to-end, passing `$ARGUMENTS` through so the workflow's parse_update_channel step can select the release channel.

</process>

<execution_context_extended>
@~/.gsd/gsd-core/workflows/sync-skills.md
@~/.gsd/gsd-core/workflows/reapply-patches.md
</execution_context_extended>
