import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TOOLS,
  OMP_ORCHESTRATION,
  OMP_EXECUTOR_PROTOCOL,
  isAgentFile,
  isSkillDir,
  readCommandNames,
  rewriteRuntimePaths,
  transformCommands,
  skillRuntimeBlock,
  rewriteProjectContextRefs,
  projectSkill,
  projectAgent,
} from '../scripts/lib/project.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('isAgentFile keeps gsd-*.md and excludes compact variants', () => {
  assert.equal(isAgentFile('gsd-planner.md'), true);
  assert.equal(isAgentFile('gsd-executor.md'), true);
  assert.equal(isAgentFile('gsd-planner.compact.md'), false);
  assert.equal(isAgentFile('other-agent.md'), false);
  assert.equal(isAgentFile('gsd-'), false);
});

test('isSkillDir only admits gsd-prefixed skill directories', () => {
  assert.equal(isSkillDir('gsd-quick'), true);
  assert.equal(isSkillDir('skills'), false);
});

test('rewriteRuntimePaths moves claude paths to the gsd runtime root', () => {
  const out = rewriteRuntimePaths('read ~/.claude/gsd-core/references/x.md and ~/.claude/plans/y.md, $HOME/.claude/ too', {});
  assert.match(out, /~\/\.gsd\/gsd-core\/references\/x\.md/);
  assert.match(out, /~\/\.gsd\/plans\/y\.md/);
  assert.match(out, /\$?HOME?\/\.gsd\/ too|~\/\.gsd\/ too/);
  assert.ok(!out.includes('.claude'));
});

test('rewriteRuntimePaths handles the $HOME/.claude} template artifact', () => {
  const out = rewriteRuntimePaths('$HOME/.claude}/gsd-core/bin/gsd-tools.cjs', {});
  assert.match(out, /~\/\.gsd\}\/gsd-core\/bin\/gsd-tools\.cjs/);
});

test('rewriteRuntimePaths honors a custom runtime root', () => {
  const out = rewriteRuntimePaths('~/.claude/gsd-core', { runtimeRoot: '/tmp/rr' });
  assert.equal(out, '/tmp/rr/gsd-core');
});

test('transformCommands rewrites gsd: refs, longest first, word-bounded', () => {
  const out = transformCommands('run /gsd:new-project then gsd:phase and xgsd:quick stays, gsd:quick-batch too', [
    'quick', 'quick-batch', 'phase', 'new-project',
  ]);
  assert.match(out, /\/gsd-new-project/);
  assert.match(out, /gsd-phase/);
  assert.match(out, /xgsd:quick/); // not word-bounded → untouched
  assert.equal((out.match(/gsd:/g) ?? []).length, 1); // the only survivor is the x-prefixed one
});

test('transformCommands is a no-op with an empty name list', () => {
  assert.equal(transformCommands('gsd:quick', []), 'gsd:quick');
});

test('projectSkill inserts the runtime CLI block before the first marker', () => {
  const content = ['---', 'name: gsd-x', 'description: x', '---', '', '<objective>', 'do it', '</objective>'].join('\n');
  const out = projectSkill('gsd-x', content, { commandNames: ['quick'] });
  const blockStart = out.indexOf('<gsd_runtime_cli>');
  const objectiveStart = out.indexOf('<objective>');
  assert.ok(blockStart > 0 && objectiveStart > blockStart, 'block must precede <objective>');
  assert.match(out, /~\/\.gsd\/bin\/gsd-tools/);
  assert.ok(!out.includes('.claude'));
});

test('projectSkill falls back to inserting after the frontmatter', () => {
  const content = ['---', 'name: gsd-x', 'description: x', '---', '', 'body without markers'].join('\n');
  const out = projectSkill('gsd-x', content, {});
  assert.match(out, /---\n<gsd_runtime_cli>/s);
  assert.match(out, /<\/gsd_runtime_cli>\n+body without markers$/);
});

test('projectSkill throws without any insertion point', () => {
  assert.throws(() => projectSkill('gsd-x', 'no frontmatter, no markers', {}));
});

test('projectAgent rebuilds frontmatter and appends orchestration', () => {
  const content = [
    '---',
    'name: gsd-executor',
    'description: Executes plans.',
    'tools: Read, Write',
    'color: yellow',
    '---',
    '',
    'Read ~/.claude/gsd-core/references/agent-skills-bootstrap.md and /gsd:execute-phase.',
  ].join('\n');
  const out = projectAgent(content, 'gsd-executor.md', { commandNames: ['execute-phase'] });
  assert.match(out, /^---\nname: gsd-executor\ndescription: Executes plans\.\ntools: read, write, edit, bash, glob, grep, lsp, web_search, task\nspawns: "\*"\n---/s);
  assert.match(out, /~\/\.gsd\/gsd-core\/references\/agent-skills-bootstrap\.md/);
  assert.ok(out.includes(OMP_ORCHESTRATION.trim()));
  assert.ok(out.includes(OMP_EXECUTOR_PROTOCOL.trim()));
  assert.ok(!out.includes('color:'));
  assert.ok(!out.includes('.claude'));
  assert.ok(out.includes(AGENT_TOOLS));
});

test('rewriteProjectContextRefs extends project-skill checks for pi and AGENTS.md', () => {
  const out = rewriteProjectContextRefs(
    '**Project skills:** Check `.claude/skills/` or `.agents/skills/` directory if either exists:\n' +
    'Load project context: Read `./CLAUDE.md` and check for `.claude/skills/` or `.agents/skills/` (as described in `<project_context>`).',
  );
  assert.match(out, /Check `\.claude\/skills\/`, `\.agents\/skills\/`, or `\.pi\/skills\/` directory if any exists:/);
  assert.match(out, /check for `\.claude\/skills\/`, `\.agents\/skills\/`, or `\.pi\/skills\/`/);
  assert.match(out, /Read `\.\/AGENTS\.md` or `\.\/CLAUDE\.md`/);
  // shim code and scratch paths are left untouched
  assert.equal(rewriteProjectContextRefs('${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/x'), '${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/x');
  assert.equal(rewriteProjectContextRefs('$repo/.claude/worktrees/rf-1'), '$repo/.claude/worktrees/rf-1');
});

test('projectAgent skips the executor protocol for other agents', () => {
  const content = '---\nname: gsd-planner\ndescription: Plans.\n---\n\nBody.';
  const out = projectAgent(content, 'gsd-planner.md', {});
  assert.ok(!out.includes(OMP_EXECUTOR_PROTOCOL.trim()));
  assert.ok(out.includes(OMP_ORCHESTRATION.trim()));
});

test('projectAgent requires name and description', () => {
  assert.throws(() => projectAgent('---\nname: gsd-x\n---\n\nBody.', 'gsd-x.md', {}));
});

test('readCommandNames lists and sorts the upstream command markdown names', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gsd-cmds-'));
  try {
    mkdirSync(path.join(dir, 'commands', 'gsd'), { recursive: true });
    for (const name of ['quick.md', 'new-project.md', 'ignore.txt']) {
      writeFileSync(path.join(dir, 'commands', 'gsd', name), '# x\n');
    }
    assert.deepEqual(readCommandNames(dir), ['new-project', 'quick']);
    assert.deepEqual(readCommandNames(path.join(os.tmpdir(), 'does-not-exist')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skillRuntimeBlock is stable and root-parameterized', () => {
  assert.match(skillRuntimeBlock({}), /~\/\.gsd\/bin\/gsd-tools/);
  assert.match(skillRuntimeBlock({ runtimeRoot: '/x/y' }), /\/x\/y\/bin\/gsd-tools/);
});
