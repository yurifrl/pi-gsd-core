---
name: gsd-progress
description: "Check progress, advance workflow, or dispatch freeform intent — the unified GSD situational command"
argument-hint: "[--forensic | --next [--auto] [--converge] | --do \\\"task description\\\"]"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
  - AskUserQuestion
---

<objective>
Check project progress, summarize recent work and what's ahead, then intelligently route to the next action.

Three modes:
- **default**: Show progress report + intelligently route to the next action (execute or plan). Provides situational awareness before continuing work.
- **--next**: Automatically advance to the next logical step without manual route selection. Reads STATE.md, ROADMAP.md, and phase directories. Supports `--force` to bypass safety gates.
- **--do "task description"**: Analyze freeform natural language and dispatch to the most appropriate GSD command. Never does the work itself — matches intent, confirms, hands off.
- **--forensic**: Append a 6-check integrity audit after the standard progress report.
</objective>

<flags>
- **--next**: Detect current project state and automatically invoke the next logical GSD workflow step. Scans all prior phases for incomplete work before routing. `--next --force` bypasses safety gates.
- **--next --auto**: Like `--next`, but after the determined step completes, automatically re-invokes `/gsd-progress --next --auto` to continue chaining steps until completion or a blocking decision. Enables hands-free plan→execute→verify→complete progression.
- **--next --converge**: When the next action is planning (Route 3), route it through the plan-review **convergence** loop instead of the standard planner. Requires `workflow.plan_review_convergence=true` (enable with `gsd config-set workflow.plan_review_convergence true`). `--cross-ai` is an alias. Reviewer flags (`--codex`, `--gemini`, `--claude`, `--opencode`, `--ollama`, `--lm-studio`, `--llama-cpp`, `--all`) and `--max-cycles N` are forwarded to the convergence loop.
- **--do "..."**: Smart dispatcher — match freeform intent to the best GSD command using routing rules, confirm the match, then hand off.
- **--forensic**: Run 6-check integrity audit after the standard progress report.
- **(no flag)**: Standard progress check + intelligent routing (Routes A through F).
</flags>

<execution_context>
@~/.gsd/gsd-core/workflows/progress.md
@~/.gsd/gsd-core/workflows/next.md
@~/.gsd/gsd-core/workflows/do.md
@~/.gsd/gsd-core/references/ui-brand.md
</execution_context>

<gsd_runtime_cli>
**GSD CLI:** `~/.gsd/bin/gsd-tools` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled `@opengsd/gsd-core` engine — invoke engine commands as `~/.gsd/bin/gsd-tools <family> <subcommand> [args...]`.

**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from `GSD_AGENTS_DIR`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.
</gsd_runtime_cli>

<process>
Arguments provided: "$ARGUMENTS"
Parse the first token from the provided arguments:
- If it is `--next`: strip the flag, execute the next workflow (passing remaining args e.g. --force, --auto).
- If it is `--do`: strip the flag, pass remainder as freeform intent to the do workflow.
- Otherwise: execute the progress workflow end-to-end (pass --forensic through if present).

Preserve all routing logic from the target workflow.
</process>
