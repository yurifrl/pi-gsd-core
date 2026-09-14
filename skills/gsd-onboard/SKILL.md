---
name: gsd-onboard
description: "Guide existing codebase onboarding through mapping, doc ingest, and planning setup"
argument-hint: "[--fast] [--text]"
allowed-tools:
  - Read
  - Bash
  - Write
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`. They are equivalent — `vscode_askquestions` is the VS Code Copilot implementation of the same interactive question API.
</runtime_note>

<objective>
Guide brownfield onboarding for an existing codebase by routing through the existing GSD primitives in the safe order: codebase map → docs ingest → project initialization → onboarding summary.

**Creates or confirms:**
- `.planning/codebase/` — evidence-backed codebase map from `/gsd-map-codebase`
- `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` — project setup from `/gsd-new-project` or `/gsd-ingest-docs`
- `.planning/onboarding/SUMMARY.md` — lightweight index of what was learned and the next command

**Non-goals:** This command does not execute phases, ship work, or overwrite existing planning artifacts without an explicit gate.
</objective>

<execution_context>
@~/.gsd/gsd-core/workflows/onboard.md
@~/.gsd/gsd-core/references/ui-brand.md
@~/.gsd/gsd-core/references/gate-prompts.md
</execution_context>

<gsd_runtime_cli>
**GSD CLI:** `~/.gsd/bin/gsd-tools` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled `@opengsd/gsd-core` engine — invoke engine commands as `~/.gsd/bin/gsd-tools <family> <subcommand> [args...]`.

**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from `GSD_AGENTS_DIR`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.
</gsd_runtime_cli>

<context>
Arguments: $ARGUMENTS

Flags:
- `--fast` — prefer `/gsd-map-codebase --fast` for the mapping handoff; the complete map is still required before `/gsd-new-project`.
- `--text` — use plain-text numbered lists instead of TUI menus.
</context>

<process>
Execute the onboard workflow end-to-end. Preserve all safety gates, text-mode fallbacks, idempotency checks, and top-level handoff rules for nested interactive commands.
</process>
