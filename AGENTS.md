# AGENTS.md: working on reachgate as a coding agent

reachgate is a tool coding agents use to prove a change didn't break reachable behaviour. This repo
gates itself the same way, so the rules here are the ones the tool teaches.

## Setup

- Node.js 20+ and Python 3.9+. Run `npm install`, which installs dev dependencies only (eslint).
  reachgate has **zero runtime dependencies**; keep it that way.
- `npm test` runs the suite (`node:test`). `npm run lint` runs eslint plus py_compile, and ruff if
  it's installed. `npm run bench` regenerates `docs/benchmarks.md` and takes a few minutes.

## Before calling a change done

1. `npm test` and `npm run lint` pass.
2. If you touched `src/explore.mjs`, `src/replay.mjs` or `src/baseline.mjs`, run each example on its own
   variants. The example READMEs list the exact commands and the expected witness lengths, and those
   numbers must not change unless you explain why. The tests check them too.
3. If you changed the CLI's output, options or exit codes, update `docs/cli.md`, `README.md`,
   `skills/reachgate/SKILL.md` and `index.d.ts` together. Agents rely on those exit codes, so changing
   one is a breaking change.
4. If you changed performance-relevant code, rerun `npm run bench` and commit the new
   `docs/benchmarks.md`, including numbers that got worse.

## Rules that keep the tool honest

- **"Shortest" means proven shortest.** Only BFS witnesses may say `shortest: true`. Anything shrunk
  is `1-minimal`. Don't blur the two in code, docs or output.
- **Unmeasured = FAIL.** Anything reachgate couldn't measure (a crash in `initial`, an adapter
  failure, a non-reproducing witness) must exit 3, never 0.
- **Budgets are steps, not time.** Exploration must stay deterministic for a given seed and step
  budget. Don't add time-dependent behaviour to the search, and use the seeded PRNG in `src/rng.mjs`.
- **Every README claim has a test or a benchmark.** If you add a claim, add the evidence, and update
  `VERIFICATION.md`.
- **Witness files are a public format** (`docs/cli.md`). The baseline format has a version field
  (`reachgate: 1`). Bump it on incompatible changes and handle old files.

## Layout

See `docs/architecture.md`. In short: `src/` holds the library and CLI, `adapters/python/` the
Python helper (copied into user projects by `reachgate init --lang python`), `templates/` the `init`
starters, `examples/` the examples (each with a seeded bug, a fixed variant, a README and a test),
`bench/` the benchmark runner, and `skills/reachgate/` the agent skill shipped with the Claude Code
plugin.

## Commits

No `Co-Authored-By` lines. Make one commit per verified change, with a message that says what changed
and why.
