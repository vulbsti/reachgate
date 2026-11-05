# Decisions

Decisions made while building reachgate, newest last. The owner was not available for questions, so
each one records why, so it can be revisited.

## D1. Name: `reachgate`
- Checked 2026-11-05: npm `reachgate` → 404 (free), PyPI `reachgate` → 404 (free),
  `github.com/vulbsti/reachgate` → 404 (free).
- GitHub search finds two unrelated 0-star repos named `ReachGate` (one is a vulnerability-reachability
  triage tool). Acceptable: no package-registry conflict, and the name says what the tool does
  (explore what is *reachable*, then *gate* on it).
- Rejected: `tracebound` (taken on npm), `reachdiff` (taken on PyPI), `statehound` (less descriptive).

## D2. Primary language: JavaScript (Node.js ESM), no build step, zero runtime dependencies
- The source verifier (written for a browser game) is plain Node ES modules with no build step, and the task says the primary
  language is the source's own.
- Types ship as a hand-written `index.d.ts` so TypeScript users get completion without us adding a
  compile step. Zero runtime dependencies keeps `npx reachgate` fast and the supply-chain surface small.
- Node ≥ 20 (structuredClone, `node:test`, stable `fs/promises`).

## D3. Two state hooks, not one
- `hash(state)` is exact identity (BFS dedupe). Default: SHA-1 of canonical JSON (sorted keys).
- `abstract(state)` is the coarse *cell* used by Go-Explore's archive. Default: same as `hash`.
- One hook would force a choice between exhaustive BFS (needs exact identity) and Go-Explore (needs coarse
  cells to make progress). The original verifier's explorer used a hand-written coarse cell key; generalising that needs both.

## D4. "Shortest" is only claimed when it is proven
- BFS witnesses are shortest by construction (first discovery in breadth-first order), reported as
  `shortest: true`.
- Go-Explore witnesses are shrunk with delta debugging (ddmin) until no single step can be removed and
  are reported as `minimal: "1-minimal"`, `shortest: false`. Claiming more would be dishonest.
- Default strategy is BFS for that reason; Go-Explore is for state spaces BFS can't cover in budget.

## D5. Budgets are counted in steps, and time is only a safety cap
- Same as the original verifier: "a step budget, not a time budget, so the same code and seed always explore the same way".
  A run that stopped on the time cap is flagged `stoppedBy: "time"` with a warning that it is not
  reproducible.

## D6. Baseline gate replays old witnesses before declaring anything lost (from the original verifier)
- A label that the new search did not find is only *lost* if its baseline witness trace also no longer
  reaches it. This removes search-luck flakiness from the gate. The diff explains where the old trace
  diverged (which step, which action was no longer offered, what was offered instead).
- Default fail policy: a lost label or a newly violated invariant fails the gate. Newly reachable
  labels are reported but do not fail unless `--fail-on new` is passed (an invariant should catch a
  newly reachable *bad* state; new reachable behaviour is usually the point of a change).
- An invariant that was already violated in the baseline and still is does not fail the gate (same as
  the original verifier: only "worse than baseline" fails). It is listed as a known violation.

## D7. Exit codes follow an "unmeasured = FAIL" convention
- 0 pass, 1 fail (violation / regression), 2 usage or config error, 3 could not measure (target crashed
  on `initial()`, adapter died or spoke bad JSON, or a witness did not replay deterministically).
- A non-reproducing witness is never reported as a pass.

## D8. Adapter protocol: JSON Lines over stdio, stateless adapter
- The adapter never holds exploration state; reachgate sends the full (JSON) state with every request.
  This makes clone/restore free for Go-Explore, makes the adapter trivially restartable, and keeps the
  protocol to 4 methods (`hello`, `initial`, `visit`, `step`). Cost: state must be JSON-serialisable and
  is re-sent each call. Measured cost is in `docs/benchmarks.md`.
- `visit` returns actions, invariant violations, labels, hash and cell in one round trip, so each
  transition costs two round trips (`step` then `visit`).
- The Python helper is a single zero-dependency file (`adapters/python/reachgate_adapter.py`) that
  `reachgate init --lang python` copies into a project, so Python users need no pip package.
  Nothing is published to PyPI (OSS standard A).

## D9. Commit identity
- Commits use `vulbsti <29302849+vulbsti@users.noreply.github.com>` (GitHub noreply), so no personal
  email lands in the public history. No `Co-Authored-By` lines (owner's global rule and OSS standard).

## D10. Learning-style "human contribution" requests are skipped
- The session's output style asks for small code contributions from the human, but the owner said they
  will not answer questions during this build. Waiting would block the run, so all code is written by
  the agents and reviewed by the manager session instead.

## D11. A budget-limited PASS stays exit 0 by default; `--require-exhaustive` makes it exit 3
- A search that stops on its budget has measured what it searched, and the report says so
  ("stopped by steps budget"). Treating every partial search as a failure would make Go-Explore and
  large spaces unusable as a gate.
- But where the scenario is meant to be finite, a partial search hides states. `--require-exhaustive`
  (config `requireExhaustive`) turns it into exit 3, "could not measure", following the
  unmeasured = FAIL rule (D7). Found while checking the dungeon example's `#deep` variant, where BFS
  reports PASS after 200k steps without ever reaching the bug.

## D12. Adapter shutdown waits for the process to exit
- `close()` used to leave its 500 ms grace timer armed (+500 ms on every adapter run) and SIGTERM the
  adapter right after its shutdown reply. It now clears the timer and kills only if the process hasn't
  exited within the grace period. Found by the benchmark work.
