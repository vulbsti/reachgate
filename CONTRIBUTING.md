# Contributing to reachgate

Thanks for helping. Bug reports, examples, adapters for other languages and docs
fixes are all welcome. By taking part you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). For security problems, see
[SECURITY.md](SECURITY.md) instead of opening an issue.

## Development setup

Requirements:

- Node.js 20 or newer
- Python 3.9 or newer (for the Python adapter tests and `npm run lint`)
- Optional: [ruff](https://docs.astral.sh/ruff/) on your PATH, so `npm run lint` also lints Python

```sh
git clone https://github.com/vulbsti/reachgate.git
cd reachgate
npm install   # dev dependencies only (ESLint); reachgate has no runtime dependencies
```

There is no build step: `src/` is the code that ships. Run the CLI from the checkout with
`node bin/reachgate.mjs <command>`.

## Running tests, lint and benchmarks

```sh
npm test        # node --test test/
npm run lint    # ESLint on the JavaScript, then py_compile (and ruff if present) on the Python
npm run bench   # benchmarks; results are described in docs/benchmarks.md
```

Please run `npm test` and `npm run lint` before opening a pull request. CI runs both on
Linux and macOS with Node 20 and 22.

As a quick end-to-end check, the bundled examples should still give the expected verdicts:

```sh
node bin/reachgate.mjs explore examples/dungeon/target.mjs#fixed --quiet   # exit 0
node bin/reachgate.mjs explore examples/dungeon/target.mjs --quiet         # exit 1 (seeded bug)
```

## Adding an example

Each example lives in its own folder under `examples/<name>/` and has:

1. **A target file**: `target.mjs` for an in-process JavaScript target, or `target.py` for a
   target run through the Python adapter. Keep it small and self-contained. If the example
   shows a bug, export the fixed variant too (for example as `fixed`) so it can be selected
   with `target.mjs#fixed`.
2. **A `README.md`** explaining what the program models, which invariant or label matters,
   the command to run and the output to expect.
3. **A test** under `test/` that runs the example and asserts the verdict (and, where it
   matters, the witness length), so the example cannot rot silently.
4. **Optionally a `bench.json`** in the example folder, so `npm run bench` includes it.

Examples must not need network access or extra dependencies.

## Commit style

- Short imperative subject line (about 72 characters at most), for example
  `Add todo reducer example` or `Fix witness replay when an action is not offered`.
- Explain the why in the body when it is not obvious.
- One logical change per commit where practical.
- No `Co-Authored-By` trailer lines.
- Do not commit generated output such as `.reachgate/`, `node_modules/` or `*.tgz`.

If a change alters reachable behaviour on purpose (a label is gained or lost), say so in the
pull request and update any affected baseline in the same change.

## Release steps (maintainer)

1. Bump `version` in `package.json` and in `.claude-plugin/plugin.json` (keep them equal).
2. Move the `Unreleased` entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD`
   heading and update the compare links at the bottom.
3. Run `npm test` (and `npm run lint`).
4. Commit, then tag: `git tag vX.Y.Z`.
5. Push the tag: `git push origin vX.Y.Z`.
6. Publishing to npm is done by the maintainer with `npm publish`.
