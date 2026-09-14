import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');

/** Fake host ExtensionAPI recording every registration. */
function fakePi() {
  const calls = { commands: [], tools: [], handlers: {} };
  return {
    calls,
    registerCommand(name, options) {
      calls.commands.push({ name, options });
    },
    registerTool(tool) {
      calls.tools.push(tool);
    },
    on(event, handler) {
      (calls.handlers[event] ??= []).push(handler);
    },
  };
}

function testEnv({ host }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gsd-ext-'));
  const agentsDir = path.join(root, 'agents-target');
  mkdirSync(agentsDir, { recursive: true });
  return {
    root,
    agentsDir,
    env: {
      GSD_HOST_RUNTIME: host,
      GSD_RUNTIME_ROOT: path.join(root, 'gsd'),
      GSD_PI_AGENTS_DIR: agentsDir,
      GSD_RUNTIME: '',
      GSD_AGENTS_DIR: '',
      PI_GSD_CORE_UPDATE_CHECK: '0',
      HOME: root,
    },
  };
}

/** Run fn with env overrides applied; restores every key afterwards. */
function withEnv(env, fn) {
  const keys = Object.keys(env);
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

test('entry registers the omp adapter and maintains the runtime root', async () => {
  const { root, env } = testEnv({ host: 'omp' });
  try {
    const main = (await import('../extensions/gsd-core.ts')).default;
    const pi = fakePi();
    const observed = withEnv(env, () => {
      main(pi);
      return {
        gsdRuntime: process.env.GSD_RUNTIME,
        gsdAgentsDir: process.env.GSD_AGENTS_DIR,
      };
    });

    // omp adapter surface
    assert.ok(pi.calls.commands.some((c) => c.name === 'gsd'), '/gsd command registered');
    assert.ok(pi.calls.tools.some((t) => t.name === 'gsd_invoke'), 'gsd_invoke tool registered');
    assert.deepEqual(Object.keys(pi.calls.handlers).sort(), [
      'before_agent_start',
      'before_provider_request',
      'session_before_compact',
      'session_start',
    ]);
    // bound by the omp adapter (hook bridge) and the entry (update check)
    assert.ok(pi.calls.handlers.session_start.length >= 1);

    // runtime root maintenance
    const gsdRoot = env.GSD_RUNTIME_ROOT;
    assert.equal(statSync(path.join(gsdRoot, 'gsd-core')).isDirectory(), true, 'engine tree reachable through the link');
    const launcherBody = readFileSync(path.join(gsdRoot, 'bin', 'gsd-tools'), 'utf8');
    assert.match(launcherBody, /GSD_RUNTIME="omp" exec/);
    assert.equal(observed.gsdRuntime, 'omp');
    assert.equal(observed.gsdAgentsDir, path.join(PACKAGE_ROOT, 'agents'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('entry registers the upstream pi adapter and mirrors agents', async () => {
  const { root, agentsDir, env } = testEnv({ host: 'pi' });
  try {
    const main = (await import('../extensions/gsd-core.ts')).default;
    const pi = fakePi();
    const observed = withEnv(env, () => {
      main(pi);
      return { gsdAgentsDir: process.env.GSD_AGENTS_DIR };
    });

    assert.ok(pi.calls.commands.some((c) => c.name === 'gsd'), 'upstream adapter registered /gsd');
    assert.ok(pi.calls.tools.some((t) => t.name === 'gsd_invoke'), 'upstream adapter registered gsd_invoke');

    // agents mirror, byte-identical to the vendored set
    const engineAgentsDir = path.join(PACKAGE_ROOT, 'agents');
    const expected = readdirSync(engineAgentsDir).filter((n) => /^gsd-.*\.md$/.test(n));
    assert.equal(expected.length, 35);
    for (const name of expected) {
      assert.equal(
        readFileSync(path.join(agentsDir, name), 'utf8'),
        readFileSync(path.join(engineAgentsDir, name), 'utf8'),
        `${name} mirrored byte-identical`,
      );
    }
    const manifest = JSON.parse(readFileSync(path.join(env.GSD_RUNTIME_ROOT, 'cache', 'pi-agents.json'), 'utf8'));
    assert.equal(Object.keys(manifest.files).length, expected.length);
    assert.equal(observed.gsdAgentsDir, agentsDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the engine CLI dispatches through the adapter', async () => {
  const { root, env } = testEnv({ host: 'omp' });
  try {
    const main = (await import('../extensions/gsd-core.ts')).default;
    const pi = fakePi();
    withEnv(env, () => main(pi));

    const command = pi.calls.commands.find((c) => c.name === 'gsd');
    const notifications = [];
    const ctx = { cwd: root, ui: { notify: (message, type) => notifications.push({ message, type }) } };
    await command.options.handler('--help', ctx);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'info');
    assert.match(notifications[0].message, /gsd/i);

    const tool = pi.calls.tools.find((t) => t.name === 'gsd_invoke');
    const result = await tool.execute('id1', { family: '--help' }, undefined, undefined, ctx);
    assert.match(result.content[0].text, /gsd/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('engine dependency resolves and matches the vendor pin', () => {
  const enginePackageJson = require.resolve('@opengsd/gsd-core/package.json');
  const engineVersion = require(enginePackageJson).version;
  const pin = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'vendor', 'gsd-core.json'), 'utf8'));
  assert.equal(engineVersion, pin.version, 'installed engine matches the vendored pin');
  assert.equal(existsSync(path.join(path.dirname(enginePackageJson), 'pi', 'gsd.cjs')), true, 'upstream pi adapter present');
  assert.equal(existsSync(path.join(path.dirname(enginePackageJson), 'hooks')), true, 'shared hook bundle present');
});
