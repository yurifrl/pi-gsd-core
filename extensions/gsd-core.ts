/**
 * pi-gsd-core — GSD (Get Shit Done) for pi and Oh My Pi.
 *
 * One extension, two hosts. On load it:
 *
 *  1. detects the host runtime (omp or pi — see lib/runtime.ts),
 *  2. resolves the bundled `@opengsd/gsd-core` engine,
 *  3. maintains the shared `~/.gsd` runtime root the vendored skills and
 *     agents reference:
 *       - `~/.gsd/gsd-core`  → symlink to the engine tree (references,
 *         templates, workflows, bin/)
 *       - `~/.gsd/bin/gsd-tools` → launcher script baking the engine CLI
 *         path and the host runtime id,
 *       - `GSD_AGENTS_DIR` / `GSD_RUNTIME` env exports for the engine,
 *  4. under pi (which cannot discover package agents), mirrors the vendored
 *     agents into `~/.pi/agent/agents/` behind a manifest — omp discovers
 *     `<package>/agents/` by convention and needs no mirror,
 *  5. loads the host adapter (ours for omp, the upstream `pi/gsd.cjs` for
 *     pi), falling back to the other one if the primary throws,
 *  6. throttled-checks the registry for a newer gsd-core release on session
 *     start and says so once (maintainer: run `bun run update`).
 *
 * Vendored skills are discovered by the host from the package manifest;
 * agents under omp are discovered from `<package>/agents/` by convention.
 */

import { createRequire } from "node:module";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import registerOmpAdapter from "./omp-adapter.ts";
import {
  detectRuntime,
  launcherScript,
  planAgentsSync,
  runtimePaths,
  semverGt,
  type HostRuntime,
} from "./lib/runtime.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDORED_AGENTS_DIR = path.join(PACKAGE_ROOT, "agents");
const VENDOR_PIN_FILE = path.join(PACKAGE_ROOT, "vendor", "gsd-core.json");
const AGENT_FILE_RE = /^gsd-.*\.md$/;

interface VendorPin {
  name?: string;
  version?: string;
}

/** The slice of the host context the entry touches. */
interface ExtensionContextLike {
  cwd?: string;
  ui?: { notify?: (message: string, type?: string) => void };
}

/** Minimal ExtensionAPI slice the entry touches. */
interface ExtensionApiLike {
  registerCommand: (name: string, options: unknown) => void;
  registerTool: (tool: unknown) => void;
  on: (event: string, handler: (event: unknown, ctx?: ExtensionContextLike) => unknown) => void;
}

export default function main(pi: ExtensionApiLike) {
  const host = detectRuntime();
  const require = createRequire(import.meta.url);

  const engineRoot = path.dirname(require.resolve("@opengsd/gsd-core/package.json"));
  const engineCli = path.join(engineRoot, "gsd-core", "bin", "gsd-tools.cjs");

  maintainRuntimeRoot({ host, engineRoot, engineCli });
  if (host === "pi") mirrorAgentsForPi();

  loadAdapter(pi, { host, engineRoot });

  pi.on("session_start", (event: unknown, ctx?: ExtensionContextLike) => {
    // Deferred and fire-and-forget: the session-start path must never block
    // the host's event loop (a TUI waiting on it would feel frozen).
    const timer = setTimeout(() => {
      void checkForEngineUpdate({ ctx });
    }, UPDATE_CHECK_DELAY_MS);
    timer.unref?.();
    return event;
  });
}

// ── vendored state ──────────────────────────────────────────────────────────

function readVendorPin(): VendorPin {
  return safeParseJson<VendorPin>(readFileSyncSafe(VENDOR_PIN_FILE)) ?? {};
}

// ── runtime root maintenance (~/.gsd) ───────────────────────────────────────

interface MaintenanceInput {
  host: HostRuntime;
  engineRoot: string;
  engineCli: string;
}

function maintainRuntimeRoot({ host, engineRoot, engineCli }: MaintenanceInput) {
  const paths = runtimePaths();
  mkdirSync(paths.binDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });

  // Engine tree symlink — the single load-time answer to "where is the
  // engine?" for every vendored skill, agent, and embedded shim (upstream's
  // own fallback chain probes `${CLAUDE_CONFIG_DIR:-~/.gsd}/gsd-core`).
  linkEngineTree(paths.coreLink, path.join(engineRoot, "gsd-core"));

  // Launcher — rewritten whenever the interpreter, engine path, or host id
  // changes; byte-stable otherwise so nothing touches disk needlessly.
  const launcher = launcherScript(process.execPath, engineCli, host);
  if (readFileSyncSafe(paths.launcher) !== launcher) {
    writeFileSync(paths.launcher, launcher, { mode: 0o755 });
  }

  // Engine env exports. Respect pre-set values (the engine honors explicit
  // overrides). The pi agents mirror target defaults to ~/.pi/agent/agents
  // and is relocatable via GSD_PI_AGENTS_DIR (tests, custom agent homes).
  if (!process.env.GSD_RUNTIME) process.env.GSD_RUNTIME = host;
  if (!process.env.GSD_AGENTS_DIR) {
    process.env.GSD_AGENTS_DIR = host === "omp"
      ? VENDORED_AGENTS_DIR
      : piAgentsDir();
  }
}

/** Where the pi agents mirror lives. */
function piAgentsDir(): string {
  return process.env.GSD_PI_AGENTS_DIR || path.join(os.homedir(), ".pi", "agent", "agents");
}

/** Ensure linkPath is a symlink to target; repair anything else in place. */
function linkEngineTree(linkPath: string, target: string) {
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const current = path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
      if (current === path.resolve(target)) return;
      unlinkSync(linkPath);
    } else {
      rmSync(linkPath, { recursive: true, force: true });
    }
  } catch {
    /* absent — fall through and create */
  }
  try {
    symlinkSync(target, linkPath, "dir");
  } catch (error) {
    console.error(`[pi-gsd-core] could not link ${linkPath} → ${target}: ${errorMessage(error)}`);
  }
}

// ── pi agents mirror ────────────────────────────────────────────────────────

const KILL_SWITCH_RE = /^(0|false|off)$/i;

/**
 * pi cannot discover agents from packages, so mirror the vendored `gsd-*.md`
 * files into the pi agents directory. Idempotent, manifest-tracked, and
 * namespace-safe: only files the manifest previously tracked are removable.
 * Disable with PI_GSD_CORE_PI_AGENTS=0.
 */
function mirrorAgentsForPi() {
  if (KILL_SWITCH_RE.test(process.env.PI_GSD_CORE_PI_AGENTS ?? "")) return;
  const paths = runtimePaths();
  const targetDir = piAgentsDir();
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    console.error(`[pi-gsd-core] cannot create ${targetDir}: ${errorMessage(error)}`);
    return;
  }

  const vendored = new Map<string, string>();
  for (const name of listAgentNames()) {
    vendored.set(name, readFileSync(path.join(VENDORED_AGENTS_DIR, name), "utf8"));
  }
  const manifestFile = path.join(paths.cacheDir, "pi-agents.json");
  const previous = safeParseJson<{ files?: Record<string, string> }>(readFileSyncSafe(manifestFile));

  const plan = planAgentsSync(vendored, targetDir, previous, readFileSyncSafe);
  for (const [name, content] of plan.writes) writeFileSync(path.join(targetDir, name), content);
  for (const name of plan.removals) rmSync(path.join(targetDir, name), { force: true });
  if (plan.writes.size || plan.removals.length) {
    writeFileSync(manifestFile, `${JSON.stringify({ files: Object.fromEntries(vendored) }, null, 2)}\n`);
  }
}

function listAgentNames(): string[] {
  try {
    return readdirSync(VENDORED_AGENTS_DIR)
      .filter((name) => AGENT_FILE_RE.test(name) && !name.endsWith(".compact.md"))
      .sort();
  } catch {
    return [];
  }
}

// ── adapter dispatch ────────────────────────────────────────────────────────

function loadAdapter(pi: ExtensionApiLike, { host, engineRoot }: { host: HostRuntime; engineRoot: string }) {
  // Same runtime object, two static views: the host's ExtensionAPI is a
  // structural superset of the slice both adapters consume.
  const api = pi as unknown as Parameters<typeof registerOmpAdapter>[0];
  const loadOmp = () => registerOmpAdapter(api, { engineRoot, host });
  const loadPi = () => {
    const require = createRequire(import.meta.url);
    const upstream = require(path.join(engineRoot, "pi", "gsd.cjs")) as (api: unknown) => void;
    upstream(pi);
  };

  const primary = host === "omp" ? loadOmp : loadPi;
  const secondary = host === "omp" ? loadPi : loadOmp;
  try {
    primary();
  } catch (error) {
    console.error(`[pi-gsd-core] ${host} adapter failed (${errorMessage(error)}); trying the ${host === "omp" ? "pi" : "omp"} one`);
    secondary();
  }
}

// ── update check ────────────────────────────────────────────────────────────

const UPDATE_CHECK_DEFAULT_HOURS = 24;
const UPDATE_CHECK_DELAY_MS = 30_000;
const UPDATE_CHECK_TIMEOUT_MS = 15_000;

interface UpdateCheckState {
  checkedAt?: number;
  latest?: string;
}

/**
 * Throttled registry check: compares the vendored pin against the latest
 * `@opengsd/gsd-core` the configured registry knows about. Users update the
 * package (hosts auto-update git packages); maintainers run `bun run update`
 * in the pi-gsd-core checkout. Never touches the event loop synchronously —
 * the registry query runs in an unref'd child, so a host can exit without
 * waiting for it. Fails silently on every error path. Disable with
 * PI_GSD_CORE_UPDATE_CHECK=0 (or PI_OFFLINE=1), or tune the interval with a
 * number of hours.
 */
async function checkForEngineUpdate({ ctx }: { ctx?: ExtensionContextLike }) {
  try {
    if (/^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) return;
    const configured = process.env.PI_GSD_CORE_UPDATE_CHECK ?? "";
    if (KILL_SWITCH_RE.test(configured)) return;
    const hours = configured !== "" && Number.isFinite(Number(configured)) ? Number(configured) : UPDATE_CHECK_DEFAULT_HOURS;

    const paths = runtimePaths();
    const stateFile = path.join(paths.cacheDir, "update-check.json");
    const state = safeParseJson<UpdateCheckState>(readFileSyncSafe(stateFile)) ?? {};
    if (state.checkedAt && Date.now() - state.checkedAt < hours * 3_600_000) return;

    const latest = await registryEngineVersion();
    if (!latest) return;
    writeFileSync(stateFile, `${JSON.stringify({ checkedAt: Date.now(), latest } satisfies UpdateCheckState, null, 2)}\n`);

    const pin = readVendorPin();
    if (!pin.version || !semverGt(latest, pin.version)) return;
    ctx?.ui?.notify?.(
      `pi-gsd-core: gsd-core ${latest} available (vendored ${pin.version}) — update the pi-gsd-core package, or run \`bun run update\` in its checkout`,
      "info",
    );
  } catch {
    /* informational only — never surface check failures */
  }
}

/** Spawn the registry query detached from the event loop; resolves null on any failure. */
function registryEngineVersion(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  try {
    const child = execFile(
      "npm",
      ["view", "@opengsd/gsd-core@latest", "version", "--json"],
      { timeout: UPDATE_CHECK_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        const latest = error ? null : safeParseJson<string>(String(stdout).trim());
        resolve(typeof latest === "string" && latest ? latest : null);
      },
    );
    // Release every event-loop handle the child holds so an exiting host
    // never waits on a version check. Re-resolves are no-ops.
    child.unref();
    child.stdout?.unref?.();
    child.stderr?.unref?.();
    child.stdin?.unref?.();
    child.on("error", () => resolve(null));
  } catch {
    resolve(null);
  }
  return promise;
}

// ── small fs/json helpers ───────────────────────────────────────────────────

function readFileSyncSafe(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// test seams — wired to the real functions so tests can exercise them
// without a live host runtime.
export const _internals = { linkEngineTree, maintainRuntimeRoot, mirrorAgentsForPi, checkForEngineUpdate };
