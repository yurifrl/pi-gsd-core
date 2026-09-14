---
name: gsd-new-project
description: "Initialize a new project with deep context gathering and PROJECT.md"
argument-hint: "[--auto]"
allowed-tools:
  - Read
  - Bash
  - Write
  - Agent
  - AskUserQuestion
---

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`. They are equivalent — `vscode_askquestions` is the VS Code Copilot implementation of the same interactive question API.
</runtime_note>

<gsd_runtime_cli>
**GSD CLI:** `~/.gsd/bin/gsd-tools` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled `@opengsd/gsd-core` engine — invoke engine commands as `~/.gsd/bin/gsd-tools <family> <subcommand> [args...]`.

**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from `GSD_AGENTS_DIR`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.
</gsd_runtime_cli>

<context>
**Flags:**
- `--auto` — Automatic mode. After config questions, runs research → requirements → roadmap without further interaction. Expects idea document via @ reference.
</context>

<objective>
Initialize a new project through unified flow: questioning → research (optional) → requirements → roadmap.

**Creates:**
- `.planning/PROJECT.md` — project context
- `.planning/config.json` — workflow preferences
- `.planning/research/` — domain research (optional)
- `.planning/REQUIREMENTS.md` — scoped requirements
- `.planning/ROADMAP.md` — phase structure
- `.planning/STATE.md` — project memory

**After this command:** Run `/gsd-plan-phase 1` to start execution.
</objective>

<execution_context>
@~/.gsd/gsd-core/workflows/new-project.md
@~/.gsd/gsd-core/references/questioning.md
@~/.gsd/gsd-core/references/ui-brand.md
@~/.gsd/gsd-core/templates/project.md
@~/.gsd/gsd-core/templates/requirements.md
</execution_context>

<process>
Execute end-to-end.
Preserve all workflow gates (validation, approvals, commits, routing).
</process>
