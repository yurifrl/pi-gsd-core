'use strict';

/**
 * Upstream source resolution for the sync command.
 *
 * Two fetch modes, both pure Node (no dependencies):
 *
 * - npm (default): resolves the latest (or pinned) `@opengsd/gsd-core`
 *   through the user's configured registry (`npm view`), downloads the
 *   tarball and verifies its integrity. This guarantees the vendored prompts
 *   match the engine version the package depends on.
 * - git: downloads a GitHub tarball for a given ref — useful for syncing
 *   ahead of an npm release. The engine dependency is NOT bumped in this
 *   mode; the command prints a drift warning instead.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const UPSTREAM_REPO = 'open-gsd/gsd-core';
export const UPSTREAM_PACKAGE = '@opengsd/gsd-core';

/** Run `npm view <pkg> version dist.tarball dist.integrity --json`. */
export function npmPackageInfo({ pkg = UPSTREAM_PACKAGE, version = 'latest' } = {}) {
  const result = spawnSync('npm', ['view', version === 'latest' ? `${pkg}@latest` : `${pkg}@${version}`, 'version', 'dist.tarball', 'dist.integrity', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`npm view failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  const raw = JSON.parse(result.stdout);
  const info = Array.isArray(raw) ? raw[0] : raw;
  const resolved = info?.version;
  const tarball = info?.['dist.tarball'] ?? info?.dist?.tarball;
  const integrity = info?.['dist.integrity'] ?? info?.dist?.integrity ?? null;
  if (!resolved || !tarball) throw new Error(`Unexpected npm view output for ${pkg}`);
  return { version: resolved, tarball, integrity };
}

/** Download a URL into a Buffer, verifying `sha512-...` integrity when given. */
export async function downloadBuffer(url, { integrity } = {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (integrity) {
    const expected = integrity.replace(/^sha512-/, '');
    const actual = createHash('sha512').update(buffer).digest('base64');
    if (actual !== expected) throw new Error(`Integrity mismatch for ${url}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
  return buffer;
}

/** Resolve a git ref (tag, branch, sha) to a commit sha via the GitHub API. */
export async function gitRefSha(ref) {
  const response = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/commits/${encodeURIComponent(ref)}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'pi-gsd-core-sync' },
  });
  if (!response.ok) throw new Error(`Cannot resolve ref ${ref} on ${UPSTREAM_REPO} (${response.status})`);
  const info = await response.json();
  return info?.sha ?? null;
}

/** GitHub codeload tarball URL for a ref. */
export function gitTarballUrl(ref) {
  return `https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/${encodeURIComponent(ref)}`;
}

/** Extract a .tgz buffer into destination dir via system tar. Returns dest. */
export function extractTarball(buffer, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `pi-gsd-core-sync-${process.pid}-${Date.now()}.tgz`);
  fs.writeFileSync(tmp, buffer);
  try {
    const result = spawnSync('tar', ['-xzf', tmp, '-C', destDir], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    if (result.status !== 0) throw new Error(`tar extraction failed: ${String(result.stderr || result.stdout).trim()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return destDir;
}

/**
 * Locate the extracted package root: npm tarballs nest under `package/`,
 * GitHub tarballs under `<repo>-<ref>/`.
 */
export function findPackageRoot(destDir) {
  for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(destDir, entry.name, 'package.json'))) {
      return path.join(destDir, entry.name);
    }
  }
  throw new Error(`No package root found under ${destDir}`);
}

/** Resolve a full fetch plan. Returns { source, version, commit, buffer }. */
export async function resolveSource({ from = 'npm', ref } = {}) {
  if (from === 'npm') {
    const info = npmPackageInfo({ version: ref ?? 'latest' });
    const buffer = await downloadBuffer(info.tarball, { integrity: info.integrity });
    return { source: 'npm', version: info.version, commit: null, tarball: info.tarball, integrity: info.integrity, buffer };
  }
  if (from === 'git') {
    if (!ref) throw new Error('--from git requires --ref <tag|branch|sha> (e.g. --ref v1.14.0)');
    const sha = await gitRefSha(ref);
    const buffer = await downloadBuffer(gitTarballUrl(ref));
    return { source: 'git', version: null, commit: sha, ref, tarball: gitTarballUrl(ref), integrity: null, buffer };
  }
  throw new Error(`Unknown --from mode: ${from} (expected "npm" or "git")`);
}

/** Package root of this repository (…/pi-gsd-core) — anchored to this
 *  module's fixed location at <root>/scripts/lib/upstream.mjs, independent
 *  of which module imports it. */
export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
