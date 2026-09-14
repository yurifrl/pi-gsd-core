# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-14

Initial release.

### Added

- Dual-host (pi + omp) extension entry (`extensions/gsd-core.ts`) with host detection, `~/.gsd` runtime wiring (engine symlink, `gsd-tools` launcher, `GSD_RUNTIME` / `GSD_AGENTS_DIR` exports), manifest-tracked pi agents mirror, primary/secondary adapter dispatch, and a throttled upstream update check.
- omp adapter (`extensions/omp-adapter.ts`): `/gsd` command family with argument completion, `gsd_invoke` tool, GSD-tier model steering, shared-hook event bridge.
- 72 GSD skills and 35 GSD agents vendored from `@opengsd/gsd-core` 1.13.0 and projected for both hosts (runtime paths, command spelling, agent frontmatter, `<gsd_runtime_cli>` blocks).
- Maintainer sync CLI (`bun run update` / `update:check`): npm-or-git upstream resolution with integrity verification, full projection, engine-dependency rewrite, version bump, commit and tag.
- `vendor/gsd-core.json` upstream pin (version, tarball URL, integrity, counts, timestamp).
- Test suite (32 tests) covering projection transforms, runtime helpers, versioning, and an end-to-end load under both runtime ids.
- CI (GitHub Actions): syntax lint + tests on Node 22 and 24.
- README with install, usage, update, configuration, architecture, and development guide.

[0.1.0]: https://github.com/yurifrl/pi-gsd-core/releases/tag/v0.1.0
