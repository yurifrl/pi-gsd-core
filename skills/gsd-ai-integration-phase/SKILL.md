---
name: gsd-ai-integration-phase
description: "Generate an AI-SPEC.md design contract for phases that involve building AI systems."
argument-hint: "[phase number]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - WebFetch
  - WebSearch
  - AskUserQuestion
  - mcp__context7__*
---

<objective>
Create an AI design contract (AI-SPEC.md) for a phase involving AI system development.
Orchestrates gsd-framework-selector → gsd-ai-researcher → gsd-domain-researcher → gsd-eval-planner.
Flow: Select Framework → Research Docs → Research Domain → Design Eval Strategy → Done
</objective>

<execution_context>
@~/.gsd/gsd-core/workflows/ai-integration-phase.md
@~/.gsd/gsd-core/references/ai-frameworks.md
@~/.gsd/gsd-core/references/ai-evals.md
</execution_context>

<gsd_runtime_cli>
**GSD CLI:** `~/.gsd/bin/gsd-tools` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled `@opengsd/gsd-core` engine — invoke engine commands as `~/.gsd/bin/gsd-tools <family> <subcommand> [args...]`.

**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from `GSD_AGENTS_DIR`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.
</gsd_runtime_cli>

<context>
Phase number: $ARGUMENTS — optional; when omitted, the orchestrating workflow reads ROADMAP.md and selects the next unplanned phase. This is not a `gsd-tools.cjs` CLI feature — the CLI's phase-lookup primitives require an explicit phase number.
</context>

<process>
Execute end-to-end.
Preserve all workflow gates.
</process>
