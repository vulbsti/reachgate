# Alternatives

reachgate explores the reachable states of real code. You give it `initial()`, `affordances(state)` and `step(state, action)`, plus invariants and an optional state hash. It explores by BFS or by a Go-Explore-style cell archive (Ecoffet et al., below), returns a shortest or 1-minimal replayable witness for each invariant violation, and diffs the reachable-label baseline across code changes. Several existing tools overlap with parts of this, and most are stronger than reachgate in their own domain. This page tries to say where each one is the better choice. Every claim here comes from the sources listed at the end, checked 2026-11-05.

| Tool | Explores by | Real code or spec | Counterexample | Baseline diff of reachable behaviour | Languages | License |
|---|---|---|---|---|---|---|
| fast-check (`fc.commands`) | Random command sequences, then shrinking | Real code, optionally checked against a simplified model | Shrunk command sequence, replayable via `seed`/`path`/`replayPath` | No | JS/TS | MIT |
| Hypothesis (`RuleBasedStateMachine`) | Random rule sequences, then shrinking | Real code | Minimal failing program, printed as near-Python; failures are saved to `.hypothesis/examples` and replayed | No (the database replays past failures, not reachable behaviour) | Python | MPL-2.0 |
| TLA+ / TLC | Exhaustive explicit-state BFS (DFID and simulation modes also available) | Separate TLA+ spec | Shortest trace for safety violations under BFS; liveness traces are not guaranteed shortest | No | TLA+ (tools in Java) | MIT |
| Apalache | Symbolic: bounded model checking and inductive-invariant checks via SMT (Z3, CVC5) | Separate TLA+ (or Quint) spec | Bounded counterexample | No | TLA+, Quint (Scala) | Apache-2.0 |
| libFuzzer / AFL++ | Coverage-guided mutation of inputs | Real code (instrumented) | Crash input, minimised with `-minimize_crash` / `afl-tmin` | Corpus only (`-merge`, `afl-cmin` keep coverage-increasing inputs) | C/C++ and others via LLVM | Apache-2.0 w/ LLVM exceptions / AGPL-3.0-or-later (parts Apache-2.0) |
| Jazzer.js, Atheris | libFuzzer-based coverage-guided mutation | Real code | Crash input | Corpus only | JS (Node), Python | Apache-2.0 |
| XState `xstate/graph` | Graph traversal: shortest and simple paths | XState machine (the model) | Path (`state`, `steps`) to each state; no invariant checking built in | No | JS/TS | MIT |
| Jest snapshots | None (records the output of each test) | Real code | Diff of the serialised value | Yes, but only for outputs a test already produces | JS/TS | MIT |
| Stateright | BFS, DFS, on-demand, seeded simulation | Real Rust code (the `Model` trait or the actor runtime) | Shortest path per discovery (single-threaded BFS) | No | Rust | MIT |

## Tool by tool

**fast-check.** `fc.commands` generates command sequences. Each command has `check(model)`, `run(model, real)` and `toString()`, and `modelRun`, `asyncModelRun` and `scheduledModelRun` execute them. `scheduledModelRun` is aimed at race conditions in async code. Shrinking works on the commands that actually ran, and a failure can be replayed exactly. fast-check is much better than reachgate at generating rich, structured arguments and shrinking them. reachgate's affordances are enumerated, not generated. Pick fast-check when the bug depends on the data, not only on the order of actions, or when you need interleavings of async operations. It does not enumerate states exhaustively, and it keeps no record of which states were reached.

**Hypothesis.** `RuleBasedStateMachine` provides `@rule`, `@precondition`, `@invariant`, `@initialize` and `Bundle`s, which pass generated values between steps. On failure it prints a short program that reproduces the bug. Its example database saves failures and replays them on later runs. That is a regression mechanism for failures, not for reachable behaviour. Pick Hypothesis for Python code where the arguments to the actions matter, and where shrinking quality matters more than exhaustiveness.

**TLA+ with TLC.** TLC is an explicit-state checker for TLA+ specs. Under BFS it returns a shortest behaviour for a safety violation. It checks liveness and temporal properties, scales to many cores and can distribute across machines. It is strictly stronger than reachgate for designs where liveness matters, or where a spec is worth writing. The trade-off is that you check a spec, not the code, and the two can drift apart. Pick TLC for protocol and algorithm design.

**Apalache.** Apalache translates TLA+ into SMT. It offers randomised symbolic execution, bounded model checking of every execution up to length k, and inductive-invariant checking that covers executions of any length. Symbolic checking handles large or unbounded data domains that explicit enumeration, reachgate's included, cannot. Pick it when you already have a TLA+ or Quint spec and the state space is too large to enumerate.

**Coverage-guided fuzzers (libFuzzer, AFL++, Jazzer.js, Atheris).** These tools mutate inputs to reach new code coverage and save the inputs that do. Crash inputs can be minimised (libFuzzer `-minimize_crash`, AFL++ `afl-tmin`), and corpora can be reduced to the inputs that add coverage (`-merge`, `afl-cmin`). They are far better than reachgate for parsers, decoders and anything else that takes byte-level input. They need no action model at all. Jazzer.js runs inside Jest through `it.fuzz`. Atheris also fuzzes native CPython extensions. The libFuzzer docs say it now gets only important bug fixes, because its authors moved to Centipede. A fuzzer's notion of progress is code coverage, not reachable application states.

**XState graph utilities.** These are now part of the `xstate` package as `xstate/graph`, and the standalone `@xstate/graph` package is deprecated. `getShortestPaths`, `getSimplePaths`, `getPathsFromEvents` and `createTestModel` generate paths through a machine. A `TestModel` path can run itself against the system with your state assertions. If your app is already an XState machine, this is the most direct route to model-based tests. Use it instead of reachgate there. The docs show only machines as input, and the library checks no invariants and keeps no baseline.

**Jest snapshots.** A snapshot stores a serialised value, and Jest fails when the value changes. You accept an intended change with `-u`. In CI, Jest does not write new snapshots, so they cannot silently pass. This is the closest existing idea to reachgate's baseline, and it is the right tool when the thing you care about is concrete output. It records only outputs that a hand-written test produces. It does not discover new reachable states or explain how to reach them.

**Stateright.** Stateright is the closest match we found. Its `Model` trait (`init_states`, `actions`, `next_state`, `properties`) is nearly the same interface as reachgate's. It checks actual Rust code, and actor systems built with it can run on a real network. It offers BFS (shortest paths when single-threaded), DFS, on-demand and seeded simulation checkers. It has `always` and `sometimes` properties, plus an experimental `eventually`. It also has symmetry reduction, linearizability testing and a web Explorer. For Rust, prefer it. It does not diff baselines.

## Where reachgate fits

reachgate is narrow. It is for JS code, or other languages through its JSON-over-stdio adapter, whose state is small, cloneable and JSON-serialisable, and whose actions can be listed. It enumerates states explicitly, so it hits state explosion where Apalache would not. It checks invariants only, with no liveness checking. It generates data much less well than fast-check or Hypothesis. What it adds is narrow too:

- It explores your real code, not a separate spec.
- Runs are deterministic, within budgets you set.
- Witnesses are shortest (BFS) or 1-minimal (shrunk).
- It keeps a reachable-behaviour baseline and replays old witnesses before reporting a label as lost.

That combination is meant as a fast "did this change alter what the system can do?" gate for coding agents. It complements property-based testing and model checking. It does not replace them.

## Sources (checked 2026-11-05)

- fast-check model-based testing: https://fast-check.dev/docs/advanced/model-based-testing/
- fast-check repository (MIT): https://github.com/dubzzz/fast-check
- Hypothesis stateful testing: https://hypothesis.readthedocs.io/en/latest/stateful.html
- Hypothesis API reference (database, shrink phase): https://hypothesis.readthedocs.io/en/latest/reference/api.html
- Hypothesis license (MPL-2.0): https://raw.githubusercontent.com/HypothesisWorks/hypothesis/master/LICENSE.txt
- TLA+ tools overview: https://lamport.azurewebsites.net/tla/tools.html
- TLC options (BFS shortest behaviour, DFID, simulation): https://nightly.tlapl.us/doc/model/tlc-options-page.html
- TLA+ tools repository (MIT): https://github.com/tlaplus/tlaplus
- Apalache: https://apalache-mc.org/ and https://github.com/apalache-mc/apalache
- libFuzzer: https://llvm.org/docs/LibFuzzer.html
- LLVM compiler-rt license: https://raw.githubusercontent.com/llvm/llvm-project/main/compiler-rt/LICENSE.TXT
- AFL++: https://github.com/AFLplusplus/AFLplusplus and https://aflplus.plus/docs/fuzzing_in_depth/
- Jazzer.js: https://github.com/CodeIntelligenceTesting/jazzer.js
- Atheris: https://github.com/google/atheris
- XState graph utilities: https://stately.ai/docs/graph and https://github.com/statelyai/xstate
- Jest snapshot testing: https://jestjs.io/docs/snapshot-testing and https://github.com/jestjs/jest
- Stateright: https://github.com/stateright/stateright, https://docs.rs/stateright/latest/stateright/, https://docs.rs/stateright/latest/stateright/struct.CheckerBuilder.html
- Go-Explore: A. Ecoffet, J. Huizinga, J. Lehman, K. O. Stanley, J. Clune. "First return, then explore." *Nature* 590, 580–586 (2021). doi:10.1038/s41586-020-03157-9. arXiv:2004.12919. https://arxiv.org/abs/2004.12919
- Go-Explore (earlier preprint): A. Ecoffet et al. "Go-Explore: a New Approach for Hard-Exploration Problems." arXiv:1901.10995 (2019). https://arxiv.org/abs/1901.10995
