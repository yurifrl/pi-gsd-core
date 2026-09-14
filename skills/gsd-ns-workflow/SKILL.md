---
name: gsd-ns-workflow
description: "workflow | discuss plan execute verify phase progress"
allowed-tools:
  - Read
  - Skill
---
<gsd_runtime_cli>
**GSD CLI:** `~/.gsd/bin/gsd-tools` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled `@opengsd/gsd-core` engine — invoke engine commands as `~/.gsd/bin/gsd-tools <family> <subcommand> [args...]`.

**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from `GSD_AGENTS_DIR`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.
</gsd_runtime_cli>



Route to the appropriate phase-pipeline skill based on the user's intent.
Sub-skill names below are post-#2790 consolidated targets — `gsd-phase`
absorbs the former add/insert/remove/edit-phase commands and `gsd-progress`
absorbs the former next/do workflow-advance commands. The reclaimed
`gsd-next` target is the state-aware smart-entry launcher, not the retired
workflow-advance command.

| User wants | Invoke |
|---|---|
| Gather context before planning | gsd-discuss-phase |
| Clarify what a phase delivers | gsd-spec-phase |
| Create a PLAN.md | gsd-plan-phase |
| Execute plans in a phase | gsd-execute-phase |
| Verify built features through UAT | gsd-verify-work |
| Add / insert / remove / edit a phase | gsd-phase |
| Advance to the next logical step | gsd-progress |
| Open the state-aware smart-entry launcher | gsd-next |
| Offload planning to the ultraplan cloud | gsd-ultraplan-phase |
| Cross-AI plan review convergence loop | gsd-plan-review-convergence |
| Generate tests for a completed phase | gsd-add-tests |
| Design an AI-integration phase | gsd-ai-integration-phase |
| Run all remaining phases autonomously | gsd-autonomous |
| Execute a trivial task inline | gsd-fast |
| Plan a phase as a vertical MVP slice | gsd-mvp-phase |
| Execute a quick task with GSD guarantees | gsd-quick |
| Batch several quick-shaped tasks together | gsd-quick-batch |

Invoke the matched skill directly using the Skill tool.
