'use strict';

/**
 * Minimal semver helpers for the sync command. Only what this package needs:
 * strict `major.minor.patch` comparison and patch/minor/major bumps. No
 * prerelease handling — release versions only, matching how gsd-core tags.
 */

const UPSTREAM_KEY = '@opengsd/gsd-core';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(value) {
  const match = SEMVER_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** True when semver a is strictly greater than semver b. */
export function semverGt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  return pa.patch > pb.patch;
}

export function bumpVersion(version, level = 'patch') {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Cannot bump non-semver version: ${version}`);
  if (level === 'major') return `${parsed.major + 1}.0.0`;
  if (level === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

/**
 * Rewrite the `@opengsd/gsd-core` dependency range in a package.json object
 * to `^<version>`. Returns a new object; leaves everything else untouched.
 */
export function withEngineDependency(packageJson, version) {
  const deps = packageJson.dependencies ?? {};
  if (!(UPSTREAM_KEY in deps)) return packageJson;
  return {
    ...packageJson,
    dependencies: { ...deps, [UPSTREAM_KEY]: `^${version}` },
  };
}
