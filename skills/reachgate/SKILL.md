---
name: reachgate
description: Prove a code change didn't break reachable behaviour. Use when changing a reducer, state machine, game engine, protocol/checkout/auth flow, or anything with a reachgate.config.json or reachgate.baseline.json in the repo; before calling such a change done; when asked to wire state-space exploration, invariants or a behavioural baseline gate into a project; or to turn a bug into a replayable witness trace.
---

# reachgate: the behavioural baseline gate

reachgate explores the reachable states of the project's real code (BFS or Go-Explore), checks
invariants in every state, returns the shortest replayable witness trace for each violation, and
compares reachable behaviour against a recorded baseline (`reachgate.baseline.json`).

Run it with `reachgate`, or `npx reachgate` if it isn't installed globally.

## Before calling a change done (the project is already wired)

1. Run `reachgate check`. It uses `reachgate.config.json` and the committed baseline.
2. Exit code 0 means PASS. Quote the first line of `.reachgate/diff.md` in your summary or PR.
3. Exit code 1 means FAIL. Read `.reachgate/diff.md`, which lists:
   - **Newly violated invariants**, each with a shortest witness. Replay it with
     `reachgate replay .reachgate/witnesses/<id>.json` to see each step and the state where it breaks.
     Fix the code; don't weaken the invariant unless it is wrong, and if it is, say so explicitly.
   - **No longer reachable**: labels that the old witness can't reach any more, with the step where it
     diverged and what is offered there now. If the change removed that behaviour on purpose, explain
     why in the PR and run `reachgate baseline` to accept it. Otherwise it's a regression: fix it.
4. Exit code 2 is a usage or config error. Exit code 3 means it couldn't measure: the target crashed
   in `initial()`, the adapter died, or a witness didn't replay (hidden state, time or randomness in
   the code). Never report 2 or 3 as a pass.
5. Never edit `reachgate.baseline.json` by hand, and never re-record it just to make `check` pass
   without saying what changed and why.

## Wiring a project in (about 15 minutes)

1. `reachgate init` (JS/TS) or `reachgate init --lang python`. This writes a starter target and
   `reachgate.config.json`.
2. In the target, import the project's real code. Don't re-implement it:
   - `initial()`: the start state, which must be deterministic (inject clocks, seeds and IDs).
   - `affordances(s)`: every action possible in `s`, including the environment's (network replies,
     timeouts, other users). Keep value domains small and bounded: 2 to 3 ids, quantity caps.
   - `step(s, a)`: apply the action with the real reducer, engine or service.
   - `invariants`: what must always hold. Return `true`, or a string explaining the failure.
   - `observe(s)`: labels for behaviour worth keeping reachable (`screen:checkout`, `paid`, `won`).
   - optional: `isTerminal` (turns on deadlock detection), `label(a)`, `hash(s)`, and `abstract(s)`
     (a coarse cell for `--strategy go-explore`).
3. Run `reachgate inspect` to check the wiring, then `reachgate explore`. Fix real bugs, or fix wrong
   invariants.
4. Run `reachgate baseline` on the known-good code. Commit `reachgate.baseline.json` and
   `reachgate.config.json`, and add `.reachgate/` to `.gitignore`.
5. Add this to the project's agent instructions (`CLAUDE.md` / `AGENTS.md`):
   "Before calling a change done, `reachgate check` must pass. Quote its verdict line. If behaviour
   was removed on purpose, say why and run `reachgate baseline`."
6. In CI, run `reachgate check --quiet`. A non-zero exit fails the build. If the scenario is meant to be finite,
   add `--require-exhaustive` (or `"requireExhaustive": true` in the config), so a pass always means every
   reachable state was checked, not just the ones that fit the budget.

## Choosing a strategy

- `bfs` (default) visits every state up to the budget, and its witnesses are the shortest possible.
  Use it whenever the state space fits the budget. The report says "state space exhausted" when it does.
- `--strategy go-explore` returns to rarely visited `abstract(s)` cells and explores from there. It
  reaches deep states that BFS can't cover in the budget. Its witnesses are shrunk to 1-minimal but
  aren't guaranteed shortest. Define `abstract(s)` to drop irrelevant detail (counters, positions)
  and keep progress (which stage, what the player holds).

Full docs: docs/wire-in-15-minutes.md, docs/cli.md and docs/protocol.md in the reachgate repo.
