#!/usr/bin/env node
'use strict';

/**
 * sync-gsd-core.mjs — the maintainer-only update command for pi-gsd-core.
 *
 * Pulls the latest skills and agents from the gsd-core upstream, projects
 * them into this package (portable `~/.gsd` runtime root), pins the version,
 * bumps the package release, and optionally commits and tags — producing the
 * new release end users receive when they update the dependency.
 *
 * This is NOT a user-facing command: end users just add pi-gsd-core as a
 * package dependency and let the host keep it updated. Only maintainers run:
 *
 *   node scripts/sync-gsd-core.mjs [--from npm|git] [--ref <version|tag>]
 *        [--major|--minor|--no-bump] [--commit] [--tag] [--dry-run]
 *
 *   bun run update        # sync + version bump + commit + tag (default flow)
 *   bun run update:check  # dry run: show what would change, write nothing
 *
 * Source modes:
 *   npm (default) — resolves @opengsd/gsd-core through the configured
 *     registry and verifies tarball integrity. The engine dependency in
 *     package.json is bumped to match, so vendored prompts and engine stay
 *     on the same version.
 *   git — downloads https://github.com/open-gsd/gsd-core at --ref for
 *     prerelease sync. The engine dependency is left alone and a drift
 *     warning is printed when the vendored tree is ahead of it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findPackageRoot,
  extractTarball,
  resolveSource,
  packageRoot,
  UPSTREAM_PACKAGE,
} from './lib/upstream.mjs';
import {
  isAgentFile,
  isSkillDir,
  projectAgent,
  projectSkill,
  readCommandNames,
} from './lib/project.mjs';
import { bumpVersion, semverGt, withEngineDependency } from './lib/versioning.mjs';

const ROOT = packageRoot();
const PKG_JSON = path.join(ROOT, 'package.json');
const VENDOR_PIN = path.join(ROOT, 'vendor', 'gsd-core.json');

function parseArgs(argv) {
  const args = { from: 'npm', ref: null, bump: 'patch', commit: false, tag: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--from': args.from = argv[++i]; break;
      case '--ref': args.ref = argv[++i]; break;
      case '--major': args.bump = 'major'; break;
      case '--minor': args.bump = 'minor'; break;
      case '--no-bump': args.bump = null; break;
      case '--commit': args.commit = true; break;
      case '--tag': args.tag = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${arg} (see --help)`);
    }
  }
  if (args.tag) args.commit = true;
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/sync-gsd-core.mjs [flags]

Flags:
  --from npm|git    Source mode (default: npm)
  --ref <value>     npm: exact version (default latest). git: tag/branch/sha
  --major|--minor   Bump level (default: patch)
  --no-bump         Do not bump the package version
  --commit          Stage and commit the synced content
  --tag             Tag the release as v<version> (implies --commit)
  --dry-run         Compute and print the plan without writing anything`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pkgVersionFromPackageJson(pkgRoot) {
  try {
    return readJson(path.join(pkgRoot, 'package.json')).version ?? null;
  } catch {
    return null;
  }
}

function engineBaseVersion(pkg) {
  const match = /\d+\.\d+\.\d+/.exec(pkg?.dependencies?.[UPSTREAM_PACKAGE] ?? '');
  return match ? match[0] : '0.0.0';
}

/** Extract upstream package into projected artifacts. */
function projectPackage(pkgRoot, { runtimeRoot = '~/.gsd' } = {}) {
  const context = { commandNames: readCommandNames(pkgRoot), runtimeRoot };
  const skills = new Map();
  const agents = new Map();

  const skillsRoot = path.join(pkgRoot, 'skills');
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSkillDir(entry.name)) continue;
    const sourcePath = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(sourcePath)) continue;
    const projected = projectSkill(entry.name, fs.readFileSync(sourcePath, 'utf8'), context);
    skills.set(`skills/${entry.name}/SKILL.md`, projected);
  }

  const agentsRoot = path.join(pkgRoot, 'agents');
  for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !isAgentFile(entry.name)) continue;
    const sourcePath = path.join(agentsRoot, entry.name);
    agents.set(`agents/${entry.name}`, projectAgent(fs.readFileSync(sourcePath, 'utf8'), sourcePath, context));
  }

  return { skills, agents };
}

/** Write a relativePath→content map under ROOT; prune stale gsd-* entries. */
function applyFiles(files, { dryRun }) {
  let written = 0;
  let removed = 0;
  let unchanged = 0;

  for (const [relPath, content] of files) {
    const target = path.join(ROOT, relPath);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === content) {
      unchanged++;
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    written++;
  }

  for (const [relDir, isOwned] of [
    ['skills', (entry, owned) => entry.isDirectory() && owned.has(`skills/${entry.name}/SKILL.md`)],
    ['agents', (entry, owned) => entry.isFile() && owned.has(`agents/${entry.name}`)],
  ]) {
    const dirAbs = path.join(ROOT, relDir);
    if (!fs.existsSync(dirAbs)) continue;
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      // Only prune entries in the GSD domain (gsd-* prefix); never touch
      // anything else that lives alongside (hand-maintained additions, .mdc
      // docs, etc.).
      if (!entry.name.startsWith('gsd-')) continue;
      if (isOwned(entry, files)) continue;
      if (!dryRun) fs.rmSync(path.join(dirAbs, entry.name), { recursive: true, force: true });
      removed++;
    }
  }
  return { written, removed, unchanged };
}

function updatePackageJson({ engineVersion, bump, dryRun }) {
  const pkg = readJson(PKG_JSON);
  let next = pkg;
  let newVersion = pkg.version;
  if (bump) {
    newVersion = bumpVersion(pkg.version, bump);
    next = { ...next, version: newVersion };
  }
  if (engineVersion) next = withEngineDependency(next, engineVersion);
  const changed = next !== pkg;
  if (!dryRun && changed) fs.writeFileSync(PKG_JSON, `${JSON.stringify(next, null, 2)}\n`);
  return { newVersion, pkgChanged: changed };
}

function git(args, { dryRun, check = true } = {}) {
  if (dryRun) {
    console.log(`  [dry-run] git ${args.join(' ')}`);
    return { status: 0, stdout: '', stderr: '' };
  }
  const run = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (check && run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(run.stderr || run.stdout).trim()}`);
  return run;
}

function gitCommitTag({ newVersion, pin, dryRun }) {
  const message = `chore: sync gsd-core ${pin.version}${pin.commit ? ` (${pin.commit.slice(0, 12)})` : ''}`;
  git(['add', 'skills', 'agents', 'vendor', 'package.json'], { dryRun });
  git(['commit', '-m', message], { dryRun });
  console.log(`  committed: ${message}`);
  if (newVersion) {
    git(['tag', '-f', `v${newVersion}`], { dryRun });
    console.log(`  tagged: v${newVersion}`);
  }
  console.log('\nNext: git push origin main --follow-tags');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = readJson(PKG_JSON);
  const pin = fs.existsSync(VENDOR_PIN) ? readJson(VENDOR_PIN) : null;

  console.log(`▸ pi-gsd-core sync — upstream ${UPSTREAM_PACKAGE} (${args.from}${args.ref ? `, ref ${args.ref}` : ''})`);
  const plan = await resolveSource({ from: args.from, ref: args.ref });
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gsd-core-'));
  extractTarball(plan.buffer, destDir);
  const pkgRoot = findPackageRoot(destDir);
  const sourceVersion = plan.version ?? pkgVersionFromPackageJson(pkgRoot);

  console.log(`  source: ${plan.source} ${sourceVersion ?? '(version unknown)'}${plan.commit ? ` @ ${plan.commit.slice(0, 12)}` : ''}`);
  if (plan.source === 'git' && semverGt(sourceVersion ?? '0.0.0', engineBaseVersion(pkg))) {
    console.log('  ⚠ vendored content is AHEAD of the npm engine dependency — prompts may reference engine features the installed CLI lacks. Bump the dependency once the version reaches npm.');
  }
  if (pin && sourceVersion === pin.version && !args.dryRun) {
    console.log(`  ℹ already pinned to ${sourceVersion} — re-syncing anyway (use --dry-run to preview)`);
  }

  const { skills, agents } = projectPackage(pkgRoot);
  console.log(`  projected ${skills.size} skills, ${agents.size} agents`);

  const applied = applyFiles(new Map([...skills, ...agents]), { dryRun: args.dryRun });
  console.log(`  files: ${applied.written} written, ${applied.removed} removed, ${applied.unchanged} unchanged`);

  const engineVersion = plan.source === 'npm' ? plan.version : null;
  const { newVersion, pkgChanged } = updatePackageJson({ engineVersion, bump: args.bump, dryRun: args.dryRun });
  if (engineVersion) console.log(`  engine dependency → ^${engineVersion}`);
  if (args.bump && newVersion !== pkg.version) console.log(`  version ${pkg.version} → ${newVersion}`);

  const nextPin = {
    name: UPSTREAM_PACKAGE,
    version: sourceVersion ?? null,
    source: plan.source,
    tarball: plan.tarball,
    integrity: plan.integrity,
    commit: plan.commit,
    ref: plan.ref ?? null,
    engineDependency: engineVersion,
    skills: skills.size,
    agents: agents.size,
    syncedAt: new Date().toISOString(),
    syncedBy: 'sync-gsd-core.mjs',
  };
  if (!args.dryRun) {
    fs.mkdirSync(path.dirname(VENDOR_PIN), { recursive: true });
    fs.writeFileSync(VENDOR_PIN, `${JSON.stringify(nextPin, null, 2)}\n`);
  }

  if (args.commit) {
    if (pkgChanged || applied.written || applied.removed) {
      gitCommitTag({ newVersion: args.bump ? newVersion : null, pin: nextPin, dryRun: args.dryRun });
    } else {
      console.log('  nothing changed — skipping commit');
    }
  } else {
    console.log('\nNext: review the diff, then run with --commit --tag (or bun run update) to release.');
  }
}

main().catch((error) => {
  console.error(`✗ sync failed: ${error?.message ?? error}`);
  process.exit(1);
});
