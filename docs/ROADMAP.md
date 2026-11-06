# Roadmap

reachgate 0.1 does one thing: explore, witness, gate. These are the next steps, roughly in priority
order. Items marked **good first issue** are scoped so a new contributor can finish them in a few hours
with only the files named.

## Good first issues

1. **`--prove-shortest` for Go-Explore witnesses** (good first issue). After Go-Explore finds a violation
   at length L, run a depth-limited BFS (`maxDepth: L - 1`) with the remaining budget. If it exhausts
   without the violation, mark the witness `shortest: true`. Files: `src/explore.mjs`, one test in
   `test/core.test.mjs`.
2. **`reachgate explain <label>`** (good first issue). Print the shortest trace that reaches a label
   in the current baseline, as `replay` does. Files: `src/cli.mjs`, `docs/cli.md`.
3. **JUnit XML output** (good first issue). `--junit FILE` writes one test case per invariant (a
   violation is a failure, with the witness in the message), so CI dashboards show it. Files:
   `src/report.mjs`, `src/cli.mjs`.
4. **Witness replay in the Python helper** (good first issue). `python3 reachgate_adapter.py
   --replay witness.json` replays a witness without Node, for Python-only debugging sessions. Files:
   `adapters/python/reachgate_adapter.py`, a test in `test/`.
5. **Progress as JSON Lines** (good first issue). `--progress-json` writes the progress stats to stderr
   as JSON Lines, so agents and CI logs can parse them. Files: `src/cli.mjs`.
6. **Coverage-of-actions summary** (good first issue). List affordances that were never offered in any
   explored state but appear in the target's action vocabulary, if the target exports `actions` (a
   list of every action it knows). Files: `src/explore.mjs`, `src/report.mjs`.
7. **A Go adapter helper and example** (good first issue). The same protocol in Go, about 150 lines,
   plus a small example in `examples/`. Files: `adapters/go/`, `examples/<name>-go/`, `docs/protocol.md`.

## Bigger items

- **Name the unbounded field.** When BFS stops on its budget, compare the deepest states and name
  the fields that keep growing ("`s.history.length` grew in every level"), so users know what to bound.
- **Batched adapter calls.** Each transition costs two JSON round trips (`step`, then `visit`). A
  `expand` method that steps every offered action of a state and visits the results in one call would
  cut adapter overhead several-fold (see the checkout-py rows in `docs/benchmarks.md`).
- **Adapter restart policy.** The adapter is stateless, so a crashed adapter could be restarted and the
  request retried, instead of ending the run with exit code 3.
- **Parallel BFS.** Shard the frontier across worker threads (in-process) or adapter processes, keyed
  by hash. This keeps shortest witnesses, as long as levels are synchronised.
- **Liveness-style checks.** "From every reachable state, a terminal state is reachable", found by
  reverse reachability on the explored graph. This needs the edges kept, which costs memory, so it
  would be opt-in.
- **Symmetry reduction.** Let the target canonicalise interchangeable IDs in `hash(s)`, with a
  documented helper.
- **Baseline per-label budgets.** Record the search effort that first reached each label, and warn
  when a label gets much harder to reach after a change (a performance regression in reachability).
- **TypeScript targets without a build step.** Load `.ts` targets via Node's type stripping
  (`--experimental-strip-types`) where available.
