import test from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, semverGt, withEngineDependency } from '../scripts/lib/versioning.mjs';

test('bumpVersion handles all three levels', () => {
  assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(bumpVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.1.9', 'major'), '1.0.0');
  assert.throws(() => bumpVersion('not-a-version', 'patch'));
});

test('withEngineDependency rewrites only the engine range', () => {
  const pkg = {
    name: 'pi-gsd-core',
    version: '0.1.0',
    dependencies: { '@opengsd/gsd-core': '^1.12.0', other: '^1.0.0' },
  };
  const next = withEngineDependency(pkg, '1.13.0');
  assert.equal(next.dependencies['@opengsd/gsd-core'], '^1.13.0');
  assert.equal(next.dependencies.other, '^1.0.0');
  assert.equal(next.version, '0.1.0');
  // input untouched
  assert.equal(pkg.dependencies['@opengsd/gsd-core'], '^1.12.0');
});

test('withEngineDependency is a no-op when the engine dep is absent', () => {
  const pkg = { name: 'x', dependencies: {} };
  assert.equal(withEngineDependency(pkg, '1.13.0'), pkg);
});

test('semverGt re-export stays consistent with the extension copy', () => {
  assert.equal(semverGt('1.14.0', '1.13.9'), true);
});
