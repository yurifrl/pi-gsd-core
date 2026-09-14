# pi-gsd-core

GSD (Get Shit Done) for [pi](https://github.com/badlogic/pi-mono) and [Oh My Pi (omp)](https://github.com/can1357/omp) — one extension package that ships the full GSD workflow: **72 skills, 35 agents, the `/gsd` command family, the `gsd_invoke` tool**, and the spec-driven development engine behind them.

Skills and agents are vendored from upstream [`@opengsd/gsd-core`](https://www.npmjs.com/package/@opengsd/gsd-core) and re-projected for both hosts (host paths, command spelling, agent tools, model steering). A maintainer-only sync command keeps the vendored content in lockstep with upstream.

```
┌────────────────────────────── pi-gsd-core ──────────────────────────────┐
│  skills/gsd-*          72 projected GSD skills (host-native paths)      │
│  agents/gsd-*.md       35 GSD agents (omp discovers; pi gets a mirror)  │
│  extensions/gsd-core.ts  entry: runtime wiring + adapter dispatch       │
│  extensions/omp-adapter.ts  omp adapter (/gsd, gsd_invoke, steering)    │
│  vendor/gsd-core.json  upstream pin: version, tarball, integrity, count │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ dependency
                    @opengsd/gsd-core  (the compiled engine + CLI)
                             │ maintains at load
                   ~/.gsd/  (skills' runtime root, engine symlink, launcher)
```

## Install

Requirements: Node ≥ 22. One install per host — the package self-configures on load.

### pi

```bash
pi install github:yurifrl/pi-gsd-core
# or pin a tag:
pi install github:yurifrl/pi-gsd-core#v0.1.1
```

Restart pi. The extension:

- mirrors the vendored agents into `~/.pi/agent/agents/` (pi cannot load agents from packages; the mirror is manifest-tracked and removes exactly what it wrote),
- registers the upstream `pi/gsd.cjs` adapter (the `/gsd` command family and `gsd_invoke`),
- links the engine into `~/.gsd/gsd-core` and writes the `~/.gsd/bin/gsd-tools` launcher.

### omp

```bash
npm install --global https://github.com/yurifrl/pi-gsd-core/archive/refs/tags/v0.1.1.tar.gz
```

Then register the package in `~/.omp/agent/settings.json` (or the project-level equivalent):

```json
{
  "packages": ["pi-gsd-core"]
}
```

omp discovers the manifest's `omp` keys: extensions from `omp.extensions`, skills from `omp.skills`, and agents from `<package>/agents/` by convention. On load the omp adapter registers `/gsd`, `gsd_invoke`, model steering, and the hook bridge.

## What you get

| Surface | Example |
| --- | --- |
| Commands | `/gsd help`, `/gsd new-project`, `/gsd new-milestone`, `/gsd next`, `/gsd execute-phase 3`, `/gsd fast "fix the flaky test"` |
| Tool | the model calls `gsd_invoke { family, subcommand?, args? }` — e.g. `gsd_invoke { "family": "progress" }` |
| Skills | `gsd-quick`, `gsd-explore`, `gsd-debug`, `gsd-ship`, … — invoked by the host's skill loader |
| Agents | `gsd-executor`, `gsd-planner`, `gsd-verifier`, … — dispatched by GSD's own orchestration |

Quickstart:

```text
/gsd new-project        # scope + roadmap + milestones
/gsd next               # pick up the next work unit
/gsd fast <task>        # one-shot: plan → execute → verify
/gsd progress           # where am I?
```

## How updates work

**Users do nothing special.** The engine (`@opengsd/gsd-core`) is a normal npm dependency — `npm update pi-gsd-core` (or re-installing a newer git tag) brings it along. On session start the extension throttled-checks (default once per 24h) whether upstream published a newer gsd-core and notifies once if so. Disable or tune with `PI_GSD_CORE_UPDATE_CHECK=0` (off) or a number of hours.

**Maintainers (this is you, Yuri) run:**

```bash
git clone https://github.com/yurifrl/pi-gsd-core && cd pi-gsd-core
bun install            # or npm install
bun run update         # sync from upstream → commit → tag vX.Y.Z
bun run update:check   # preview only (dry-run)
```

`sync-gsd-core.mjs`:

1. resolves the latest upstream (npm registry `@opengsd/gsd-core@latest`, or `--ref vX.Y.Z` / `--tarball <url>` for pins and forks; integrity is verified against the registry's `dist.integrity`),
2. downloads and unpacks it,
3. **projects** every skill and agent for both hosts (see Architecture), skips `.compact.md` duplicates, records counts,
4. rewrites the engine dependency range and the `vendor/gsd-core.json` pin,
5. bumps the package version (`patch` on content-only syncs, `minor` when the engine major/minor moves — override with `--bump`), then with `--commit --tag` commits `chore: sync gsd-core <ver> (<skills> skills, <agents> agents)` and tags.

Push the tag and users pick it up by updating the package. That is the whole release flow.

## Configuration

Environment variables (all optional; set-and-forget):

| Variable | Default | Meaning |
| --- | --- | --- |
| `GSD_HOST_RUNTIME` | auto | Force `omp` or `pi` detection |
| `GSD_RUNTIME_ROOT` | `~/.gsd` | Shared runtime root (skills reference it) |
| `GSD_AGENTS_DIR` | omp: package `agents/`, pi: `~/.pi/agent/agents` | Where the engine resolves agents |
| `GSD_PI_AGENTS_DIR` | `~/.pi/agent/agents` | Relocate the pi agents mirror |
| `PI_GSD_CORE_PI_AGENTS` | on | `0` disables the pi agents mirror |
| `PI_GSD_CORE_UPDATE_CHECK` | `24` (hours) | `0` disables the upstream check; number = interval |

Every file the extension writes is idempotent: byte-stable content is left alone, symlinks are repaired only when they point somewhere else, and the pi agents mirror removes only files its own manifest previously wrote. Nothing outside `~/.gsd/` (and the mirror) is touched.

## Architecture

```
extensions/gsd-core.ts      entry — detects host, wires ~/.gsd, dispatches adapter
extensions/omp-adapter.ts   omp adapter — /gsd family, gsd_invoke tool, model
                            steering, shared-hook event bridge
extensions/lib/runtime.ts   pure helpers: host detection, launcher, agent-sync
                            planning, semver (unit-tested, no I/O)
scripts/sync-gsd-core.mjs   maintainer CLI (bun run update)
scripts/lib/upstream.mjs    registry resolve + tarball download/verify
scripts/lib/project.mjs     upstream → both-hosts projection transforms
scripts/lib/versioning.mjs  semver bumps + engine dependency rewrite
vendor/gsd-core.json        the upstream pin (what/when/how, with integrity)
test/                       node --test suite (projection, runtime, sync, e2e)
```

The projection layer (`scripts/lib/project.mjs`) is the only place upstream content is transformed. Upstream skills/agents speak Claude-Code dialect (`~/.claude/...` paths, `gsd:` command refs, `tools:`/`color:` frontmatter). Projection rewrites, per host:

- **paths**: `~/.claude/gsd-core/…` and `~/.claude/plans|config|…` → `~/.gsd/gsd-core/…` / `~/.gsd/…`, honoring `GSD_RUNTIME_ROOT`;
- **commands**: `gsd:foo` / `/gsd:foo` → `gsd-foo` / `/gsd-foo` (longest-name-first, word-bounded so `xgsd:quick` survives);
- **skills**: injects the `<gsd_runtime_cli>` block (the authoritative CLI pointer) before the first structural marker;
- **agents**: rebuilds frontmatter (host-native `tools:` list, `spawns: "*"`, no `color:`), and appends the omp orchestration preamble (+ executor protocol for `gsd-executor`).

The runtime wiring exists so the *vendored* content never hardcodes an install location: every projected file points at `~/.gsd`, and `extensions/gsd-core.ts` makes `~/.gsd` true at load — engine symlink, launcher script, `GSD_*` env exports. Upstream's own fallback chain (`${CLAUDE_CONFIG_DIR:-~/.gsd}/gsd-core`) probes exactly that path, so the vendored skills and the engine agree without rewriting the engine.

Adapter dispatch is belt-and-braces: omp loads *our* adapter (the upstream `pi/gsd.cjs` works there too, but its Claude-era assumptions make ours the better fit); pi loads the *upstream* adapter (battle-tested, maintained upstream). If the primary throws, the entry logs and loads the other one — the engine CLI is host-agnostic.

## Development

```bash
git clone https://github.com/yurifrl/pi-gsd-core && cd pi-gsd-core
bun install            # installs @opengsd/gsd-core (the only runtime dep)

bun test               # node --test — 32 tests: projection, runtime, sync, e2e
bun run lint           # node --check on all .mjs
bun run update:check   # dry-run sync against the live registry
```

Test layout:

- `test/project.test.mjs` — projection transforms (paths, commands, skills, agents) against fixture content;
- `test/runtime.test.mjs` — host detection, launcher, semver, agent-sync planning;
- `test/versioning.test.mjs` — version bumps and engine-dependency rewrites;
- `test/extension.test.mjs` — e2e: loads the real entry with a recording host API under both runtime ids, asserts the full registration surface, agents mirror, runtime root, and a live `/gsd --help` dispatch through the engine CLI.

To add behavior: extend `scripts/lib/project.mjs` (content transforms) or `extensions/lib/runtime.ts` (wiring), and pin the behavior with a test first. Keep `extensions/*.ts` to erasable-TS-only syntax (no enums, no decorators) — both hosts strip types at load, they do not typecheck.

To work against a gsd-core fork or an unreleased build:

```bash
node scripts/sync-gsd-core.mjs --ref main --from git   # a git ref instead of npm
node scripts/sync-gsd-core.mjs --tarball ./gsd-core.tgz
```

## Troubleshooting

- **`/gsd` unknown** — the extension did not load. Check `pi install` / the omp `packages` entry; run the host with extension logs visible; `[pi-gsd-core] …` lines are prefixed on stderr.
- **Skills can't find the engine** — `ls -la ~/.gsd/gsd-core` should be a symlink into `node_modules/@opengsd/gsd-core/gsd-core`. It is re-created on every load; if a tool deletes `~/.gsd` mid-session, restart the host.
- **Agents missing under pi** — check `~/.pi/agent/agents/gsd-*.md` and `~/.gsd/cache/pi-agents.json`; re-run after deleting the cache file to force a re-mirror.
- **Wrong host detected** (e.g. omp launched via a wrapper) — set `GSD_HOST_RUNTIME=omp`.

## Credits

- [GSD / open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) — the workflow, skills, agents, and engine. pi-gsd-core only packages and projects it.
- [tchivs/gsd-omp](https://github.com/tchivs/gsd-omp) — the omp distribution this packaging approach was modeled on.
- MIT — see [LICENSE](LICENSE).
