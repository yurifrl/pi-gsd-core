/**
 * omp adapter for the GSD engine.
 *
 * Registers the `/gsd` command family, the `gsd_invoke` tool, GSD-tier model
 * steering, and the shared-hook event bridge against the pi-compatible
 * ExtensionAPI that omp exposes. Functionally mirrors the upstream adapter
 * `@opengsd/gsd-core/pi/gsd.cjs` (MIT, OpenGSD) with two omp-specific
 * differences:
 *
 * - model steering resolves through `GSD_RUNTIME=omp` and honors
 *   `model_profile_overrides.omp[tier]` in the project's `.planning/config.json`
 *   (carrying over the #2460 fail-open guard: steering only fires when the
 *   user explicitly configured the tier, so ordinary conversations are never
 *   rewritten),
 * - the subprocess bridge sets `GSD_RUNTIME=omp` for spawned hook scripts.
 *
 * Vendored skills and agents are NOT registered here — the host loads them
 * from the package manifest (`skills`) and the package `agents/` directory.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { nodeInterpreterOf, type HostRuntime } from "./lib/runtime.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Curated top-level command families, from gsd-tools.cjs TOP_LEVEL_USAGE. */
const GSD_COMMAND_FAMILIES = Object.freeze([
  "agent", "capability", "check", "commit", "config-get", "config-path",
  "config-set", "effort", "git", "graphify", "init", "intel", "learnings",
  "list-todos", "loop", "milestone", "phase", "phases", "progress",
  "requirements", "research-plan", "research-store", "resolve-granularity",
  "resolve-model", "roadmap", "scaffold", "smart-entry", "state", "task",
  "template", "user-story", "validate", "verify", "workstream", "worktree",
]);

const HOOK_TIMEOUT_MS = 8_000;
const CLI_TIMEOUT_MS = 120_000;

/** The slice of the host command/tool context this adapter touches. */
interface HostContext {
  cwd?: string;
  ui?: { notify?: (message: string, type?: string) => void };
}

interface GsdDispatch {
  family: string;
  subcommand?: string;
  args: string[];
}

interface TypeBoxLite {
  Object: (fields: Record<string, unknown>) => unknown;
  String: () => unknown;
  Optional: (schema: unknown) => unknown;
  Array: (schema: unknown) => unknown;
}

export interface OmpAdapterOptions {
  /** Root of the installed @opengsd/gsd-core package (has gsd-core/ + hooks/). */
  engineRoot: string;
  /** Detected host id, baked into spawned hook payloads and steering. */
  host: HostRuntime;
}

/**
 * Runtime guard for the optional typebox peer the host may provide. When the
 * host does not expose typebox, callers fall back to plain JSON Schema — the
 * host accepts both (upstream pi/gsd.cjs #3022 ships exactly that fallback).
 */
function typeBoxOf(module: unknown): TypeBoxLite | null {
  if (!module || typeof module !== "object") return null;
  const Type = (module as { Type?: unknown }).Type;
  if (!Type || typeof Type !== "object") return null;
  const pick = (name: string): unknown => (Type as Record<string, unknown>)[name];
  if (typeof pick("Object") !== "function" || typeof pick("String") !== "function") return null;
  return {
    Object: pick("Object") as TypeBoxLite["Object"],
    String: pick("String") as TypeBoxLite["String"],
    Optional: pick("Optional") as TypeBoxLite["Optional"],
    Array: pick("Array") as TypeBoxLite["Array"],
  };
}

/** require() that degrades to undefined instead of throwing on a miss. */
function safeRequire(require: NodeRequire, id: string): unknown {
  try {
    return require(id);
  } catch {
    return undefined;
  }
}

/** require() a gsd-core lib module, typed at the two call sites that use it. */
function coreModule<T>(require: NodeRequire, gsdCoreDir: string, name: string): T {
  return require(path.join(gsdCoreDir, "bin", "lib", name)) as T;
}

export default function registerOmpAdapter(pi: ExtensionAPI, options: OmpAdapterOptions) {
  const require = createRequire(import.meta.url);
  const gsdCoreDir = path.join(options.engineRoot, "gsd-core");
  const hooksDir = path.join(options.engineRoot, "hooks");

  const parseArgs = (rawArgs: unknown): GsdDispatch => {
    const tokens = String(rawArgs ?? "").split(/\s+/).filter(Boolean);
    return { family: tokens[0] || "--help", subcommand: tokens[1], args: tokens.slice(2) };
  };

  /** Run one engine CLI dispatch synchronously; never throws. */
  const dispatchGsd = (input: GsdDispatch, cwd: string) => {
    const cli = path.join(gsdCoreDir, "bin", "gsd-tools.cjs");
    const argv = [cli];
    if (input.family === "--help" || input.family === "-h") argv.push(input.family);
    else argv.push(input.family, input.subcommand || "help", ...input.args);
    try {
      const result = spawnSync(nodeInterpreterOf(process.execPath), argv, {
        encoding: "utf8",
        cwd,
        windowsHide: true,
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GSD_RUNTIME: options.host },
      });
      const ok = (result.status ?? 1) === 0;
      return {
        ok,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        code: result.status ?? -1,
      };
    } catch (error) {
      return { ok: false, stdout: "", stderr: String(error), code: -1 };
    }
  };

  // ── /gsd command ──────────────────────────────────────────────────────────
  pi.registerCommand("gsd", {
    description: "Invoke a GSD command via the embedded engine (pi-gsd-core).",
    getArgumentCompletions(prefix: string) {
      const matches = GSD_COMMAND_FAMILIES.filter((name) => name.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args: string | undefined, ctx?: HostContext) => {
      const cwd = ctx?.cwd || process.cwd();
      const notify = ctx?.ui?.notify;
      const { family, subcommand, args: rest } = parseArgs(args);
      const result = dispatchGsd({ family, subcommand, args: rest }, cwd);
      const message = result.ok
        ? result.stdout
        : `GSD error: ${result.stderr || result.stdout || `dispatch failed (exit ${result.code})`}`;
      notify?.(message, result.ok ? "info" : "error");
    },
  });

  // ── gsd_invoke tool ───────────────────────────────────────────────────────
  const typebox = typeBoxOf(safeRequire(require, "typebox"));
  const invokeParameters: unknown = typebox
    ? typebox.Object({
        family: typebox.String(),
        subcommand: typebox.Optional(typebox.String()),
        args: typebox.Optional(typebox.Array(typebox.String())),
      })
    : {
        type: "object",
        properties: {
          family: { type: "string" },
          subcommand: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["family"],
      };

  pi.registerTool({
    name: "gsd_invoke",
    label: "GSD Invoke",
    description: "Invoke a GSD command family/subcommand through the embedded engine.",
    // Host accepts plain JSON Schema here; see invokeParameters above.
    parameters: invokeParameters as never,
    execute: async (_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, ctx?: HostContext) => {
      const invalid = { content: [{ type: "text", text: 'gsd_invoke requires a non-empty string "family".' }] };
      if (!params || typeof params !== "object" || !("family" in params)) return invalid;
      const family: unknown = params.family;
      if (typeof family !== "string" || family.length === 0) return invalid;
      const subcommand = "subcommand" in params && typeof params.subcommand === "string" ? params.subcommand : undefined;
      const args = "args" in params && Array.isArray(params.args)
        ? params.args.filter((a): a is string => typeof a === "string")
        : [];
      const cwd = ctx?.cwd || process.cwd();
      const result = dispatchGsd({ family, subcommand, args }, cwd);
      const text = result.ok
        ? result.stdout
        : result.stderr || result.stdout || `dispatch failed (exit ${result.code})`;
      return { content: [{ type: "text", text }] };
    },
  });

  // ── before_provider_request: tier steering, strictly opt-in ───────────────
  // Fires only when the project's .planning/config.json explicitly sets
  // model_profile_overrides[<runtime>][tier]; otherwise undefined so the
  // host's model choice flows through untouched (#2460 guard, adapted to the
  // omp runtime key).
  pi.on("before_provider_request", async (event: unknown, ctx?: HostContext) => {
    try {
      const effectiveCwd = ctx?.cwd || process.cwd();
      const { loadConfig } = coreModule<{ loadConfig: (cwd: string) => { model_profile_overrides?: Record<string, Record<string, string>> } | null }>(require, gsdCoreDir, "config-loader.cjs");
      const overrides = loadConfig(effectiveCwd)?.model_profile_overrides;
      const tier = "sonnet";
      if (!overrides?.[options.host]?.[tier]) return undefined;

      const { resolveTierEntry } = coreModule<{ resolveTierEntry: (input: { runtime: string; tier: string; overrides?: unknown }) => { model?: string } | null }>(require, gsdCoreDir, "model-resolver.cjs");
      const entry = resolveTierEntry({ runtime: options.host, tier, overrides });
      if (!entry || typeof entry.model !== "string" || entry.model.length === 0) return undefined;
      if (!event || typeof event !== "object" || !("payload" in event)) return undefined;
      const payload: unknown = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
      return { ...payload, model: entry.model };
    } catch {
      return undefined;
    }
  });

  // ── shared-hook bridge (bounded subprocess, fail-open) ────────────────────
  const runHook = (hookFile: string, payload: Record<string, unknown>, opts: { cwd?: string } = {}) => {
    const hookPath = path.join(hooksDir, hookFile);
    try {
      if (!existsSync(hookPath)) return;
      spawnSync(nodeInterpreterOf(process.execPath), [hookPath], {
        encoding: "utf8",
        timeout: HOOK_TIMEOUT_MS,
        cwd: opts.cwd || process.cwd(),
        windowsHide: true,
        env: { ...process.env, GSD_RUNTIME: options.host },
      });
    } catch {
      /* fail-open: a hook problem must never block the host */
    }
  };

  pi.on("session_start", async (_event: unknown, ctx?: HostContext) => {
    runHook("gsd-ensure-canonical-path.js", { cwd: ctx?.cwd || process.cwd() });
  });

  pi.on("session_before_compact", async (_event: unknown, ctx?: HostContext) => {
    runHook("gsd-context-monitor.js", { hook_event_name: "PreCompact", cwd: ctx?.cwd || process.cwd() });
  });

  pi.on("before_agent_start", async (_event: unknown, ctx?: HostContext) => {
    runHook("gsd-workflow-guard.js", { cwd: ctx?.cwd || process.cwd() });
  });
}
