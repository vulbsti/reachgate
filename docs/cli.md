# CLI reference

```
reachgate explore  [target]            explore, check invariants, write .reachgate/report.{json,md}
reachgate baseline [target]            explore and record the behaviour baseline (reachgate.baseline.json)
reachgate check    [target]            explore again and diff against the baseline (the gate)
reachgate replay   [target] <witness>  replay a witness trace step by step
reachgate inspect  [target]            show the initial state, its actions and invariants (wiring check)
reachgate init     [--lang js|python]  write a starter target and reachgate.config.json
```

## Targets

| Form | Runs as |
| --- | --- |
| `path/to/target.mjs` | In-process. Uses the default export, or the export named `target`. |
| `path/to/target.mjs#fixed` | In-process, using the named export `fixed`. An export may also be a (sync or async) function returning the target. |
| `path/to/target.py` | Through the stdio adapter, as `python3 path/to/target.py`. |
| `--cmd "<command>"` | Through the stdio adapter, as any command. Quotes are honoured, and no shell is used. |
| _(nothing)_ | `target` or `cmd` from `reachgate.config.json`, resolved relative to that file. |

## Exit codes

These are stable, and safe to gate CI and agents on.

| Code | `explore` | `baseline` | `check` | `replay` |
| --- | --- | --- | --- | --- |
| **0** | no invariant violated | baseline written | nothing got worse than the baseline | the trace replays, and its recorded violation reproduces (or, for a label witness, the label is reached) |
| **1** | at least one invariant violated (witnesses written) | — | a regression: a label is no longer reachable, or an invariant is newly violated (see `--fail-on`) | the trace replays, but the recorded violation no longer happens or the label is not reached |
| **2** | usage or config error: unknown option, missing target, missing baseline for `check`, bad witness path | same | same | same |
| **3** | could not measure: `initial()` threw, the adapter died or broke protocol, a witness did not replay deterministically, or `--require-exhaustive` was set and the search stopped on a budget | same | same | the trace diverged: a step is no longer offered by `affordances()`, or it throws |

The rule behind 3 comes from "unmeasured = FAIL": reachgate never reports a pass it couldn't measure.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--strategy bfs\|go-explore` | `bfs` | BFS dedupes exact states and its witnesses are shortest. Go-Explore keeps a cell archive keyed by `abstract(s)` and reaches deeper within a budget; its witnesses are shrunk to 1-minimal. |
| `--max-steps N` | 200000 | `step()` calls. The primary budget: with the same seed, the same steps explore the same way. |
| `--max-states N` | 100000 | Distinct states (by `hash`). |
| `--max-seconds N` | 120 | Wall-clock safety cap. A run stopped by it is flagged as not reproducible. |
| `--max-depth N` | unlimited | Longest trace explored. |
| `--seed N` | 1 | PRNG seed for Go-Explore. |
| `--rollout N` | 12 | Go-Explore: most steps taken per return to a cell. |
| `--no-action-labels` | off | Leaves `action:<label>` out of the signature, so only `observe()` labels are tracked. |
| `--expand-violations` | off | Keeps exploring past states that violate an invariant. |
| `--require-exhaustive` | off | Exits 3 instead of 0 when the search stopped on a budget rather than exhausting the state space. Use it in CI when the scenario is meant to be finite, so a pass always means "every reachable state was checked". Config key: `"requireExhaustive": true`. |
| `--cmd "<command>"` | | Runs the target through the adapter. |
| `--config FILE` | `reachgate.config.json` | |
| `--baseline FILE` | `reachgate.baseline.json` | |
| `--out DIR` | `.reachgate` | Where reports, diffs and witnesses go. |
| `--fail-on LIST` | `lost,violation` | `check` only: any of `lost` (label no longer reachable), `violation` (newly violated invariant), `new` (label newly reachable), `removed` (invariant removed). |
| `--json` | off | Prints the JSON report to stdout instead of the summary. |
| `--quiet` | off | No progress line on stderr. |

## `reachgate.config.json`

Every key is optional. Command-line flags win over config values.

```json
{
  "target": "./reachgate.target.mjs",
  "strategy": "bfs",
  "maxSteps": 200000,
  "maxStates": 100000,
  "maxSeconds": 120,
  "baseline": "reachgate.baseline.json",
  "out": ".reachgate",
  "failOn": "lost,violation"
}
```

Use `"cmd": "python3 my_target.py"` (or an argv array) instead of `target` for adapters.

`check` explores with the options recorded in the baseline (strategy, seed and budgets), so the before
and after runs are comparable. Flags still override them.

## Output files

| File | Written by | Contents |
| --- | --- | --- |
| `.reachgate/report.json` | explore, baseline, check | stats, invariants with status, violations with witness traces, labels with their shortest traces, `exitCode` |
| `.reachgate/report.md` | explore, baseline, check | the same, for people |
| `.reachgate/witnesses/<invariant>.json` | explore, baseline, check | one witness per violated invariant, one step per line |
| `.reachgate/witnesses/lost_<label>.json` | check | the baseline witness of each label that is no longer reachable |
| `.reachgate/diff.json`, `.reachgate/diff.md` | check | `verdict`, `reasons`, `lost` (with `diagnosis`), `added`, `regressed`, `fixed`, `stillViolated`, `recovered`, `removedInvariants`, before/after stats |
| `reachgate.baseline.json` | baseline | format version, options, stats, invariant status, `labels` (label → witness trace). Commit it. |

A witness file:

```json
{"reachgate":1,"target":"vending","kind":"violation","id":"money-conserved","message":"inserted 100, but ...","length":2,"shortest":true,"minimal":"shortest","trace":[
  {"label":"insert 100","action":{"type":"insert","coin":100}},
  {"label":"select chips","action":{"type":"select","item":"chips"}}
]}
```

`replay` also accepts a bare JSON array of actions.

## Library API

```js
import { run, replayTrace, recordBaseline, checkBaseline, loadDriver, explore } from 'reachgate';

const result = await run(target, { strategy: 'bfs', maxSteps: 50000 });
for (const v of result.violations) console.log(v.id, v.length, v.trace);

const baseline = await recordBaseline(target);
const { diff } = await checkBaseline(changedTarget, baseline);
if (diff.verdict === 'fail') console.log(diff.lost, diff.regressed);

// any target the CLI accepts, including adapters:
const driver = await loadDriver({ cmd: 'python3 target.py' });
const r = await explore(driver, { strategy: 'go-explore', maxSteps: 20000, seed: 2 });
await driver.close();
```

Types are in [`index.d.ts`](../index.d.ts).
