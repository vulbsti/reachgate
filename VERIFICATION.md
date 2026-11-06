# Verification

Each criterion (the project's own, then `OSS_STANDARD.md` A–G) is mapped to its evidence: a command and
its output, or a file. Commands run from the repo root. Test names refer to `npm test`
(`node --test test/*.test.mjs`): 23 tests, all passing (see [docs/verification/ci-local.md](docs/verification/ci-local.md)).

Status key: **met**, or **blocked** (needs the owner; see [BLOCKED.md](BLOCKED.md)).

## Project criteria

### 1. Core API and exploration strategies: met

| Requirement | Evidence |
| --- | --- |
| `initial()`, `affordances(state)`, `step(state, action)`, invariants | `Target` in [`index.d.ts`](index.d.ts); implementation in [`src/target.mjs`](src/target.mjs). Transition invariants (`transitions`) are also supported, e.g. auth-session's `locked-has-no-new-session`. |
| State abstraction / hash hook | `hash(s)` (exact identity, BFS dedupe) and `abstract(s)` (Go-Explore cell): `src/target.mjs`, `src/explore.mjs`; rationale in DECISIONS D3. Used by `examples/dungeon/target.mjs` (`abstract`). |
| BFS | `src/explore.mjs` `bfs()`. Test: *BFS: shortest witness, exhaustive space, and the witness replays* (31 states exactly, `exhaustive: true`). |
| Go-Explore-style cells | `src/explore.mjs` `goExplore()`: cell archive, `1/sqrt(1+visits)` selection, restoring a saved state, seeded rollouts. Tests: *Go-Explore: same seed, same result…*, *deep level: Go-Explore finds the softlock in a 200k-step budget, BFS does not*. |
| Step, state and time budgets | `--max-steps`, `--max-states`, `--max-seconds`, `--max-depth` ([docs/cli.md](docs/cli.md)). Steps are used in the tests above (`maxSteps: 20`, `200000`, `3000`); a time stop is flagged as not reproducible (`src/explore.mjs`, DECISIONS D5). `--require-exhaustive` test in *CLI exit codes…* (exit 3 at `--max-steps 1`). |

### 2. Shortest witnesses that replay; JSON and human reports; CI exit codes: met

| Requirement | Evidence |
| --- | --- |
| Shortest witness per violation | BFS first discovery = shortest (D4). Tests pin exact lengths: core (7), dungeon (13), todo-reducer (5), auth-session (7), checkout-py (6). Go-Explore witnesses are 1-minimal, and the test checks that removing any single step breaks them. |
| Deterministic replay | Each witness is replayed twice before it is reported (`src/explore.mjs`). Tests: *a nondeterministic target is caught…* (`replayed: false`, a warning, exit 3) and *replay refuses an action the code does not offer*. CLI: `reachgate replay` exits 0 = reproduced (*CLI exit codes…*). |
| JSON report + human report | `.reachgate/report.json` and `report.md`, plus `witnesses/*.json` (`src/report.mjs`, `src/cli.mjs`). The CLI test reads `report.json` and checks `exitCode` and `witnessFile`. Formats are documented in [docs/cli.md](docs/cli.md#output-files). |
| CI exit codes documented | [docs/cli.md](docs/cli.md#exit-codes), README "Exit codes", `reachgate help`. Test *CLI exit codes: 0 pass, 1 violation, 2 usage, 3 could not measure* covers each code. |

### 3. Baseline gate with an agent-readable diff: met

| Requirement | Evidence |
| --- | --- |
| Record a reachable-behaviour signature | `reachgate baseline` → `reachgate.baseline.json` (labels from `observe` and `action:<label>`, each with a witness, plus invariant status): `src/baseline.mjs` `signature()`. |
| Compare after a change | `reachgate check` → `compare()`. Tests: *baseline gate: a label the search misses is not "lost"…* (lost via `action-not-offered`, newly violated invariant, recovered via old witness), *baseline gate: the history refactor keeps every invariant but loses redo*, *baseline gate: the fixed reducer passes against its own baseline*. |
| Agent-readable diff (newly reachable / unreachable, and why) | `.reachgate/diff.json` + `diff.md`, with sections for newly violated, no longer reachable (with the step where the old witness diverged and what is offered now), newly reachable, fixed and still violated, plus a "What to do" section. Real output appears in [docs/wire-in-15-minutes.md](docs/wire-in-15-minutes.md#6-the-gate-after-every-change) and the demo GIF (`assets/demo.gif`). |

### 4. Primary language plus a JSON-over-stdio adapter with a second-language example: met

| Requirement | Evidence |
| --- | --- |
| Primary language = the source's own | The source verifier is plain Node ESM; reachgate is plain Node ESM (D2). |
| Adapter protocol | [docs/protocol.md](docs/protocol.md) (v1: `hello`, `initial`, `visit`, `step`, `shutdown`), `src/adapter.mjs`. Test: *adapter: a process that writes non-JSON is a measurement error, not a pass*. |
| Second-language example | [examples/checkout-py](examples/checkout-py/) (Python, stdlib only, via [`adapters/python/reachgate_adapter.py`](adapters/python/reachgate_adapter.py)). Tests: *BFS finds the retry double charge with a 6-step shortest witness…*, *the fixed checkout (--fixed)…*, *CLI: explore on the .py file exits 1…*. |

### 5. At least 3 examples, each with a seeded bug, a minimal witness and a test: met

| Example | Kind | Witness | Test |
| --- | --- | --- | --- |
| [dungeon](examples/dungeon/) | small game | 13 (shortest); `#deep`: Go-Explore 43–47 (1-minimal), seeds 1–5 | `test/example-dungeon.test.mjs` |
| [todo-reducer](examples/todo-reducer/) | UI reducer / state machine | 5 (shortest) + baseline `regressed` | `test/example-todo-reducer.test.mjs` |
| [auth-session](examples/auth-session/) | protocol flow (auth) | 7 (shortest) | `test/example-auth-session.test.mjs` |
| [checkout-py](examples/checkout-py/) | protocol flow (checkout, Python) | 6 (shortest) | `test/example-checkout-py.test.mjs` |

Each README explains why its N is minimal. Each fixed variant passes with `state space exhausted`.

### 6. Agent skill, 15-minute guide, and a fresh-user test that wires a new project: met

| Requirement | Evidence |
| --- | --- |
| Agent skill | [skills/reachgate/SKILL.md](skills/reachgate/SKILL.md) in a Claude Code plugin (`.claude-plugin/plugin.json`, `marketplace.json`). `claude plugin validate .` → `✔ Validation passed` (no warnings). |
| "Wire your project in 15 minutes" | [docs/wire-in-15-minutes.md](docs/wire-in-15-minutes.md): a vending-machine project wired from scratch, with every output from a real run. |
| Fresh-user test including wiring a new project | [docs/verification/fresh-user.md](docs/verification/fresh-user.md) (see C below). |

### 7. `docs/benchmarks.md`: met

[docs/benchmarks.md](docs/benchmarks.md) is generated by `npm run bench` (`bench/run.mjs`, raw data in
`bench/results.json`). For every example and variant it gives states explored, steps, deepest trace,
time to first violation (ms and steps), witness length, wall time, and peak RSS for Node (and for the
Python adapter). Each number is the median of 3 runs. The bad numbers are kept, e.g. BFS on `#deep` at
2M steps: 48 s, 700 MB, nothing found.

### 8. Factual Alternatives section: met

README "Alternatives" summarises [docs/alternatives.md](docs/alternatives.md), which covers fast-check,
Hypothesis, TLA+/TLC, Apalache, libFuzzer/AFL++/Jazzer.js/Atheris, `xstate/graph`, Jest snapshots and
Stateright. Every claim is sourced from pages fetched on 2026-11-05 (listed under "Sources"), and the
page says where each tool is stronger.

## OSS_STANDARD.md

### A. Repo and identity

| Item | Status | Evidence |
| --- | --- | --- |
| Own git repo under the owner's `oss/` folder | met | `git rev-parse --show-toplevel` → `…/oss/reachgate`, its own repository |
| Name checked free (GitHub, PyPI, npm), recorded | met | DECISIONS D1 (npm 404, PyPI 404, `vulbsti/reachgate` 404 on 2026-11-05) |
| Private GitHub repo under vulbsti, pushed | met | https://github.com/vulbsti/reachgate (`gh api repos/vulbsti/reachgate --jq .private` → `true`). Created from the parent session after the owner's explicit approval, since this session's classifier had refused it (BLOCKED.md B1, resolved). |
| Only the owner's own GitHub account used; no `gh auth switch`; no work-domain author | met | `git log --format='%an <%ae>' \| sort -u` → only `vulbsti <29302849+vulbsti@users.noreply.github.com>` (and Dependabot's noreply on its branches) |
| No `Co-Authored-By` lines; commits at milestones | met | `git log --format=%B \| grep -ci co-authored-by` → `0`; one commit per verified milestone (`git log --oneline`) |
| Not public, nothing published, go-public commands in RELEASE.md | met | [RELEASE.md](RELEASE.md); no `npm publish` or visibility change was run |

### B. Sources and privacy

| Item | Status | Evidence |
| --- | --- | --- |
| Sources read-only; no code, assets or story content from the source game | met | Only ideas and patterns were reused (Go-Explore cells, replaying old witnesses before blaming, mulberry32 PRNG, exit-code conventions). A list of the source game's character and place names and the owner's private identifiers is kept **outside** the repo; Current tree: `git grep -nIiwf <that list> -- .` → no matches. **History:** older commits on `main` still contain private terms and paths in several files (full list of kinds in BLOCKED.md B2). The scrubbed rewrite `scrubbed-main` has 0 matches over all its commits and an identical final tree. Publishing it needs the owner: a force-push was refused by the permission check, and wouldn't be enough anyway, since GitHub keeps old commits reachable through PR refs. So B2 archives the current repo and pushes the scrubbed history to a fresh one. **Blocked: BLOCKED.md B2**, required before going public (RELEASE.md step 0b). The adversarial audit also compared `src/` line by line against the source verifier: only import boilerplate matched. |
| The owner's live tools left untouched | met | Never accessed: no file, timer or data directory outside this repo, the source folders (read only) and the session-notes folder was written. |
| No personal data, tokens, `.env`, transcripts | met | Fixtures are synthetic (examples, guide). See the scan below. |
| gitleaks over full history: 0 findings | met | `docker run --rm -v "$PWD:/r" zricethezav/gitleaks git /r` → `no leaks found` (rerun on the final commit in the audit section). |
| grep for local paths, work domain, owner's name, emails | met for the tree / **blocked** for history (B2) | Two out-of-repo lists (whole-word terms; path and identifier substrings): current tree → 0 matches; `scrubbed-main` history → 0 matches. `main` history → many matches across older revisions of several files (docs, source comments, `VERIFICATION.md`, `BLOCKED.md`, `RELEASE.md`, `assets/src/hero-prompt.md`). The kinds are listed in BLOCKED.md B2 (the source game's short and character names, an earlier QA tool's name, a private tool's name, local paths and a session ID, the owner's name). Emails: `git grep -hIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' $(git rev-list main) \| sort -u` → only the GitHub noreply address. gitleaks finds no secrets. |

### C. Usable by other people

| Item | Status | Evidence |
| --- | --- | --- |
| One-command install; OS stated | met | README "Install": `npm install -g reachgate` / `npm install -g github:vulbsti/reachgate`; "Supported: Node.js 20+ on Linux and macOS…". The `npm pack --dry-run` file list ships bin, src, templates, adapters, skills and index.d.ts. |
| Fresh-user test in a clean container, transcript saved, passes unaided | met | Four runs, each by a fresh subagent given only the README, in a clean Docker container (`node:22` for runs 1–3, `node:20` for run 4) with a throwaway user, cloning a local mirror in place of the GitHub URL. Each wired a **new project of its own**. **Run 1** ([fresh-user-run1.md](docs/verification/fresh-user-run1.md)): a turnstile in JS (2-step witness) plus Python. PASS; 8 friction points fixed (D13). **Run 2** ([fresh-user-run2.md](docs/verification/fresh-user-run2.md)): a parking-garage gate in JS (3-step witness) and a library-loan system in Python (4-step witness). PASS; 7 points fixed (D14), mainly an INCOMPLETE verdict that now matches exit 3. **Run 3** ([fresh-user-run3.md](docs/verification/fresh-user-run3.md), on the commit "Second audit fixes: …", after all earlier fixes): the Quickstart matched the README line for line. It wired a document-approval workflow in JS: bug, witness, replay, fix, previous witness NOT REPRODUCED, `check` exit 1 then 0, and `--require-exhaustive` passing. Plus a thermostat in Python (7-step witness). PASS; its doc notes (an ESM `.js` note for Node 20, warning wording, the passing-check message) were fixed. **Run 4** ([fresh-user.md](docs/verification/fresh-user.md), Node 20.20, on the commit "Local CI evidence on the current commit", after the third audit's fixes): Quickstart and **every pasted output of the 15-minute guide** matched. It wired a new CommonJS order-fulfilment machine (witness `pay → pack → pack → cancel → ship`; `check` exit 1, then 0) and a Python rate limiter. PASS; its notes were fixed (the Node 20.19+/22.7+ ESM-detection wording, the rename-the-import note, the `inspect` labels hint, and the guide's `inspect` output pasted in full). |
| Few meaningful tests; CI (lint + tests) green | met | 23 tests (`npm test`). GitHub Actions on the private repo: run [42074948329](https://github.com/vulbsti/reachgate/actions/runs/42074948329): all 6 jobs green, including macOS (CI section below). The same jobs also pass locally in clean containers: [docs/verification/ci-local.md](docs/verification/ci-local.md). |
| Tag `v0.1.0`, CHANGELOG | met | `git tag` → `v0.1.0`; [CHANGELOG.md](CHANGELOG.md) |

### D. Maintainable

| Item | Status | Evidence |
| --- | --- | --- |
| LICENSE (Apache-2.0), README, CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY, issue templates (bug, feature), PR template, CODEOWNERS (`@vulbsti`), Dependabot | met | All present: [LICENSE](LICENSE), [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`, `.github/pull_request_template.md`, `.github/CODEOWNERS`, `.github/dependabot.yml` |
| `docs/architecture.md`, usage guides, `docs/ROADMAP.md` with 5+ good first issues | met | [architecture](docs/architecture.md); guides: [wire-in-15-minutes](docs/wire-in-15-minutes.md), [cli](docs/cli.md), [protocol](docs/protocol.md); [ROADMAP](docs/ROADMAP.md) lists 7 scoped good first issues |
| `AGENTS.md` | met | [AGENTS.md](AGENTS.md) |

### E. Visuals

| Item | Status | Evidence |
| --- | --- | --- |
| Hero image | met | `assets/hero.jpg` (149 KB, gpt image via codex; prompts in `assets/src/hero-prompt.md`) |
| Architecture diagram, SVG, light and dark | met | `assets/architecture-{light,dark}.svg` via `<picture>`; checked in `assets/src/preview-{light,dark}.png` |
| Demo GIF of the real tool | met | `assets/demo.gif` (342 KB, VHS in Docker running the real CLI; `assets/src/demo/{Dockerfile,demo.tape}`) |
| Explainer visual | met | `assets/explore-coverage-{light,dark}.svg`, drawn from real BFS and Go-Explore runs by `assets/src/explainer/coverage.mjs` |
| Sources in `assets/src/`; each image < 2 MB; README media < 10 MB | met | README media total 595 KB (`du -ch assets/hero.jpg assets/demo.gif assets/*.svg`) |
| Every asset checked in light and dark | met | Hero and diagrams: `assets/src/preview-{light,dark}.png` (README mock-up screenshots); the diagrams again after their last edit: `assets/src/checks/architecture-{light,dark}.png`. Explainer: `assets/src/checks/explainer-{light,dark}.png`. Demo GIF (re-recorded after the last output change): `assets/src/checks/demo-frame-{14,33}s.png`. |

### F. Honesty

| README claim | Evidence |
| --- | --- |
| BFS witnesses are shortest; "state space exhausted" means every state | core test 1; the example tests pin N and assert `stats.exhaustive` |
| Witnesses replayed twice; nondeterminism → exit 3 | *a nondeterministic target is caught…*; *CLI exit codes…* |
| The gate never fails on search luck | *baseline gate: a label the search misses is not "lost"…* (`maxSteps: 20` search, label recovered via its old witness) |
| Go-Explore finds the deep bug in 200k steps (seeds 1–5); BFS doesn't, even at 2M | *deep level: Go-Explore finds…* (seed 1); docs/benchmarks.md (seeds 1–5, BFS at 200k and 2M) |
| Same seed, same exploration | *Go-Explore: same seed, same result…* |
| Benchmark table numbers | docs/benchmarks.md (generated; medians) |
| Zero runtime dependencies | `package.json` has no `dependencies` field |
| Linux and macOS tested in CI | Matrix `[ubuntu-latest, macos-latest] × [20, 22]`, all green in run 42074948329 (CI section). |
| Alternatives section | docs/alternatives.md, sourced |

### G. How to work

| Item | Status | Evidence |
| --- | --- | --- |
| Manager delegated and verified | met | Subagents built the examples, hygiene, visuals and alternatives research. The manager re-ran every example command, found and fixed core bugs during review (un-awaited `return` in try/finally, EPIPE exit code, adapter shutdown timer, Node 22 `npm test`), and added `--require-exhaustive`. |
| No questions to the owner; decisions recorded | met | [DECISIONS.md](DECISIONS.md) D1–D14 |
| Owner-only items in BLOCKED.md | met | [BLOCKED.md](BLOCKED.md): **B2 open** (archive this repo and push the scrubbed history to a fresh one; gates going public); B1 resolved; also close the stale Dependabot PRs. |
| Final adversarial audit passes | met | See "Final audit" below. |

## CI on GitHub

Run [42074948329](https://github.com/vulbsti/reachgate/actions/runs/42074948329) (on the commit "VERIFICATION: state history-scrub status
precisely (B2)"), the full workflow:

| Job | Result |
| --- | --- |
| lint | success |
| gate | success |
| test (ubuntu-latest, 20) | success |
| test (ubuntu-latest, 22) | success |
| test (macos-latest, 20) | success |
| test (macos-latest, 22) | success |

Later commits run the same workflow. The latest run for the tagged commit is cited under "Final audit".
GitHub's macOS runners for this private repo sat queued for over an hour; superseded runs were cancelled
to clear the queue.

## Final audit

_Filled in after the audit runs._


Commit references here are by subject, not SHA, because the history rewrite in BLOCKED.md B2 changes every SHA.
