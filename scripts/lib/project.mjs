'use strict';

/**
 * Content projection rules for pi-gsd-core.
 *
 * Turns upstream `@opengsd/gsd-core` skills and agents (written for Claude
 * Code, with `~/.claude/...` paths and Claude tool names) into runtime-neutral
 * artifacts that work identically under pi and Oh My Pi (omp):
 *
 * - `~/.claude/gsd-core/...`  → `~/.gsd/gsd-core/...`  (the extension keeps a
 *   symlink there pointing at the installed engine tree)
 * - any other `~/.claude/...` → `~/.gsd/...`
 * - `gsd:<command>` references → `gsd-<command>` (matches host skill-command
 *   names, e.g. `/gsd-quick`)
 * - every skill gains a portable `<gsd_runtime_cli>` block describing the
 *   launcher-managed CLI instead of a machine-specific absolute path
 * - agents are rebuilt with the host agent frontmatter (lowercase tools list,
 *   `spawns: "*"`) and the OMP native-orchestration contract
 *
 * The rules mirror tchivs/gsd-omp's `src/projection.cjs` (MIT) with the
 * absolute-path baking replaced by the stable `~/.gsd` runtime root, so one
 * vendored copy works on every machine and both hosts.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Tools granted to every projected agent (omp naming; pi shares the core set). */
export const AGENT_TOOLS = 'read, write, edit, bash, glob, grep, lsp, web_search, task';

/**
 * Native orchestration contract appended to every projected agent body.
 * Tells GSD workflows to use the host's native task tool instead of emulating
 * Claude's Agent(...) surface. Verbatim from tchivs/gsd-omp (MIT).
 */
export const OMP_ORCHESTRATION = `
## OMP native orchestration

OMP's native task tool owns subagents, jobs, progress, cancellation, artifacts, and isolation. When a GSD workflow asks to spawn an Agent(...), dispatch a native task instead; never emulate a subagent with shell backgrounding or a hand-written worktree.

- Use native task's batch schema: shared top-level \`context\` plus \`tasks[]\`; each item needs a stable \`name\`, an \`agent\`, and a complete self-contained \`task\`. Executor work must set \`isolated: true\`.
- Use \`job poll\` only when blocked on a wave barrier. IRC is coordination, not task completion.
- Preserve GSD's commit, merge, verification, SUMMARY.md, and STATE.md gates. Native task execution does not bypass workflow safety.
`;

/**
 * Extra terminal-yield contract appended to gsd-executor only. Verbatim from
 * tchivs/gsd-omp (MIT).
 */
export const OMP_EXECUTOR_PROTOCOL = `
## OMP executor result protocol

End the final report with exactly one lifecycle line, then follow OMP's terminal yield protocol:

\`\`\`text
[gsd-task-result] phase {PHASE} plan {PLAN} task {TASK_ID} completed
\`\`\`

Use \`failed\` or \`cancelled\` instead of \`completed\` when the plan did not complete.
`;

/** Agent files must be GSD-prefixed markdown; compact variants are excluded. */
export const AGENT_FILE_RE = /^gsd-.*\.md$/;

export function isAgentFile(name) {
  return AGENT_FILE_RE.test(name) && !name.endsWith('.compact.md');
}

export function isSkillDir(name) {
  return name.startsWith('gsd-');
}

/**
 * Read the upstream command name list (`commands/gsd/*.md`) used by
 * transformCommands. Pass the extracted package dir. Returns [] when absent
 * (git tarballs without commands/ still sync fine).
 */
export function readCommandNames(coreRoot) {
  const dir = path.join(coreRoot, 'commands', 'gsd');
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite `gsd:<name>` command references to `gsd-<name>` so they match the
 * host's skill-command names. Longest names first so `gsd:new-project` cannot
 * be shadowed by a shorter alternative.
 */
export function transformCommands(content, names) {
  if (!names || !names.length) return content;
  const alternatives = [...names].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const pattern = new RegExp(`(?<![a-zA-Z0-9_-])gsd:(${alternatives})(?=[^a-zA-Z0-9_-]|$)`, 'g');
  return content.replace(pattern, (_match, name) => `gsd-${name}`);
}

/**
 * Portable runtime-path rewrite. `runtimeRoot` defaults to the shared,
 * harness-independent `~/.gsd` root the extension maintains on load.
 */
export function rewriteRuntimePaths(content, { runtimeRoot = '~/.gsd' } = {}) {
  const root = String(runtimeRoot).split(path.sep).join('/');
  return content
    .replace(/~\/\.claude\/gsd-core/g, () => `${root}/gsd-core`)
    .replace(/\$HOME\/\.claude\/gsd-core/g, () => `${root}/gsd-core`)
    .replace(/~\/\.claude\//g, () => `${root}/`)
    .replace(/\$HOME\/\.claude\//g, () => `${root}/`)
    .replace(/~\/\.claude\b/g, () => root)
    .replace(/\$HOME\/\.claude\b/g, () => root);
}

/**
 * Host-agnostic project-context phrasing. Upstream agents assume Claude Code
 * conventions when inspecting the *user's* project: skill directories and the
 * project memory file. Extend the checks instead of replacing them — projects
 * on any host may still carry the Claude layout.
 */
export function rewriteProjectContextRefs(content) {
  return content
    .replaceAll(
      'Check `.claude/skills/` or `.agents/skills/` directory if either exists:',
      'Check `.claude/skills/`, `.agents/skills/`, or `.pi/skills/` directory if any exists:',
    )
    .replaceAll(
      'check for `.claude/skills/` or `.agents/skills/`',
      'check for `.claude/skills/`, `.agents/skills/`, or `.pi/skills/`',
    )
    .replaceAll('Read `./CLAUDE.md`', 'Read `./AGENTS.md` or `./CLAUDE.md`');
}

/** Portable replacement for gsd-omp's absolute-path `<omp_runtime_cli>` block. */
export function skillRuntimeBlock({ runtimeRoot = '~/.gsd' } = {}) {
  const root = String(runtimeRoot).split(path.sep).join('/');
  return `<gsd_runtime_cli>\n**GSD CLI:** \`${root}/bin/gsd-tools\` is the authoritative GSD CLI in this runtime. The pi-gsd-core extension maintains this launcher and points it at the bundled \`@opengsd/gsd-core\` engine — invoke engine commands as \`${root}/bin/gsd-tools <family> <subcommand> [args...]\`.\n\n**Agents:** GSD's agent checks (init.progress / init.new-project) resolve the agents directory from \`GSD_AGENTS_DIR\`; the pi-gsd-core extension exports it automatically on load, pointing at this installation's GSD agent set.\n</gsd_runtime_cli>`;
}

/**
 * Project one SKILL.md: rewrite paths, transform command references, then
 * insert the portable runtime CLI block before the first of <context> /
 * <process> / <objective> (falling back to just after the frontmatter).
 * Throws when no insertion point exists — upstream skills always carry one.
 */
export function projectSkill(name, content, context = {}) {
  const block = skillRuntimeBlock(context);
  const rewritten = rewriteProjectContextRefs(
    transformCommands(rewriteRuntimePaths(content, context), context.commandNames),
  );
  if (rewritten.includes(block.trim())) return rewritten;
  const marker = ['<context>', '<process>', '<objective>'].find((candidate) => rewritten.includes(candidate));
  const frontmatterEnd = rewritten.indexOf('\n---\n', 3);
  const index = marker ? rewritten.indexOf(marker) : frontmatterEnd < 0 ? -1 : frontmatterEnd + 5;
  if (index < 0) throw new Error(`Missing insertion point in ${name}/SKILL.md`);
  return `${rewritten.slice(0, index)}${block}\n\n${rewritten.slice(index)}`;
}

/**
 * Project one agent .md: rebuild the frontmatter for the host (lowercase tool
 * list + `spawns: "*"`), rewrite the body, and append the native
 * orchestration contract (plus the executor protocol for gsd-executor).
 */
export function projectAgent(content, sourcePath, context = {}) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${sourcePath}`);
  const [, frontmatter, rawBody] = match;
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !description) throw new Error(`Missing name or description: ${sourcePath}`);
  const body = rewriteProjectContextRefs(
    transformCommands(rewriteRuntimePaths(rawBody, context), context.commandNames),
  );
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `tools: ${context.agentTools ?? AGENT_TOOLS}`,
    'spawns: "*"',
    '---',
    '',
    body,
    OMP_ORCHESTRATION,
    name === 'gsd-executor' ? OMP_EXECUTOR_PROTOCOL : '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}
