# reachgate: fresh-user transcript

Container `rg-fresh`, user `tester`, Node v22.23.4, npm global prefix `/home/tester/.npm-global`.
Started 17:10:13 UTC, finished tasks 1-4 at about 17:13 UTC (wall clock for the commands themselves is
tiny; every reachgate run took under 1.5 s).

## Setup

```
$ cd ~ && git clone /srv/reachgate.git reachgate
Cloning into 'reachgate'...
done.
$ cd reachgate && ls
AGENTS.md BLOCKED.md CHANGELOG.md CODE_OF_CONDUCT.md CONTRIBUTING.md DECISIONS.md LICENSE README.md
RELEASE.md SECURITY.md adapters assets bench bin docs eslint.config.mjs examples index.d.ts
package-lock.json package.json ruff.toml scripts skills src templates test
$ cat README.md
(read in full; sections: Install, Quickstart, How it works, Two strategies, Examples, Benchmarks,
 For coding agents, Exit codes, Other languages, Alternatives, Limits, Docs)
```

Notes: README is clear and well ordered. The hero promise ("three functions: initial(), affordances(state)
and step(state, action)") made the mental model obvious before I ran anything.

## Install

README: "Or from a clone: `git clone https://github.com/vulbsti/reachgate && npm install -g ./reachgate`."
(GitHub URL substituted with the mirror, per sandbox rules; I had already cloned.)

```
$ cd ~ && npm install -g ./reachgate
added 1 package in 297ms
$ reachgate --version
bash: line 1: reachgate: command not found
```

Cause: in this container `~/.bashrc` sets PATH after its non-interactive guard, so `bash -lc` did not
get `~/.npm-global/bin`. That is a sandbox/shell issue, not a README issue. Resolved with
`export PATH=$HOME/.npm-global/bin:$PATH` (bash -ic also worked: `which reachgate` ->
`/home/tester/.npm-global/bin/reachgate`, version `0.1.0`).

```
$ ls -la ~/.npm-global/lib/node_modules/
reachgate -> ../../../reachgate
$ reachgate --version
0.1.0
$ reachgate --help
reachgate 0.1.0: explore your code's reachable states, check invariants, gate changes on a baseline.

Usage:
  reachgate explore  [target]            explore, check invariants, write .reachgate/report.{json,md}
  reachgate baseline [target]            explore and record the behaviour baseline (reachgate.baseline.json)
  reachgate check    [target]            explore again and diff against the baseline (the gate)
  reachgate replay   [target] <witness>  replay a witness trace step by step
  reachgate inspect  [target]            show the initial state, its actions and invariants (wiring check)
  reachgate init     [--lang js|python]  write a starter target and reachgate.config.json
...
Exit codes: 0 pass · 1 fail (violation found, or check found a regression) · 2 usage/config error ·
            3 could not measure (target crashed in initial(), adapter died, witness not deterministic)
```

Notes: zero dependencies, installed in 0.3 s. `npm install -g ./folder` makes a symlink to the clone,
so deleting or moving the clone breaks the global CLI; the README does not say so (minor).
`npx reachgate --version` also printed 0.1.0, but only because the global install was present; I could
not verify the README's "`npx reachgate ...` works too, without a global install" while the package is
unpublished (npx would need the registry).

## Quickstart

```
$ cd ~/reachgate && reachgate explore examples/dungeon/target.mjs
FAIL: 1 invariant violated · 10772 states, 35881 steps, 18 labels · state space exhausted · 1282 ms
  ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
    witness (13 steps, shortest): down → right → right → right → right → right → right → up → right → down → down → up → wait
    replay: reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
report: .reachgate/report.md
exit=1
```

Matches the README byte for byte except timing (1282 ms vs 505 ms in README; fine). Exit 1, as the
exit-code table says.

```
$ reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
replaying 13 step(s) on dungeon (cellar, seeded bug) (recorded violation: no-softlock)
  0. initial()
       + room:cellar
  1. down
  2. right
       + picked:potion
  ...
 12. up
 13. wait
       + key:knocked-loose
       ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
REPRODUCED: no-softlock at step 13
exit=0
$ git status --short
(clean: .reachgate/ is gitignored in the repo)
```

Notes: replay exits 0 when the bug reproduces. That surprised me for a second ("I replayed a failure and
got success"), but docs/cli.md's exit-code table explains it ("the trace replays, and its recorded
violation reproduces"). The README's exit-code table only covers explore/check; a one-line note about
replay would help.

## Wiring my own project

Then I read docs/wire-in-15-minutes.md in full (vending-machine walk-through).

### My code (written first, no reachgate in mind): ~/myproj/src/turnstile.js

A coin-operated turnstile: a coin unlocks it, extra coins while unlocked are banked as rides, pushing
while locked sounds an alarm, coins are refused during an alarm. Seeded bug (off-by-one):
`if (t.credit >= 0)` in `push`, so with no banked rides the turnstile never re-locks and credit goes
negative. Committed to a fresh git repo.

### init

```
$ cd ~/myproj && reachgate init
wrote reachgate.target.mjs, reachgate.config.json
next:
  1. edit reachgate.target.mjs: point initial/affordances/step at your code, add invariants
  2. reachgate inspect        check the wiring
  3. reachgate explore        find violations
  4. reachgate baseline       record behaviour (commit reachgate.baseline.json; add .reachgate/ to .gitignore)
  5. reachgate check          after every change: the gate
exit=0
$ cat reachgate.config.json
{ "target": "./reachgate.target.mjs", "strategy": "bfs", "maxSteps": 200000, "maxStates": 100000,
  "baseline": "reachgate.baseline.json", "out": ".reachgate" }
```

Out of curiosity I ran the untouched starter:

```
$ reachgate inspect
target: door (in-process: ./reachgate.target.mjs)
invariants: open-door-is-unlocked
deadlock detection: off (define isTerminal to turn it on)
initial state: {"door":"closed","locked":false}
  ...
  2 action(s):
    open  →  new state
    lock  →  new state
$ reachgate explore
FAIL: 1 invariant violated · 4 states, 5 steps, 7 labels · state space exhausted · 1 ms
  ✗ open-door-is-unlocked: the door is open and locked
    witness (2 steps, shortest): open → lock
exit=1
```

Note: the guide calls it "a working toy target", but it fails on purpose (you can lock an open door).
Nice demo, but the guide should say "it has a deliberate bug" so nobody thinks init is broken.

### The target (~/myproj/reachgate.target.mjs)

```js
import { createTurnstile, insertCoin, push, resetAlarm } from "./src/turnstile.js";
export default {
  name: "turnstile",
  initial: () => ({ t: createTurnstile(), paid: 0 }),            // paid = ghost variable
  affordances: ({ t, paid }) => [
    ...(paid < 3 ? [{ type: "coin" }] : []),                     // bound: 3 coins
    ...(t.passes < 4 ? [{ type: "push" }] : []),                 // bound: 4 passes
    ...(t.alarm ? [{ type: "reset" }] : []),
  ],
  step: (s, a) => {
    if (a.type === "coin") { if (insertCoin(s.t) !== "rejected") s.paid += 1; }
    if (a.type === "push") push(s.t);
    if (a.type === "reset") resetAlarm(s.t);
    return s;
  },
  invariants: {
    "no-free-rides": ({ t, paid }) => t.passes <= paid || `${t.passes} passes for ${paid} coin(s)`,
    "credit-non-negative": ({ t }) => t.credit >= 0 || `credit is ${t.credit}`,
    "rides-accounted": ({ t, paid }) => t.passes + t.credit + (t.locked ? 0 : 1) === paid || `...`,
  },
  observe: ({ t }) => [...(t.alarm ? ["alarm"] : []), ...(t.credit > 0 ? ["banked-ride"] : []),
                       ...(t.locked ? ["locked"] : ["unlocked"])],
  label: (a) => a.type,
};
```

Writing it took about 3 minutes using the guide's hook table. "Bound the scenario" advice was
exactly what I needed: without the `passes < 4` cap, push is always offered and my bug makes the
space infinite.

### inspect

```
$ reachgate inspect
target: turnstile (in-process: ./reachgate.target.mjs)
invariants: no-free-rides, credit-non-negative, rides-accounted
deadlock detection: off (define isTerminal to turn it on)
initial state: {"paid":0,"t":{"alarm":false,"credit":0,"locked":true,"passes":0}}
  hash utAip3zo-7Uh7b4zyQYFpK5lKe4
  labels: locked
  violations: none
  2 action(s):
    coin  →  new state
    push  →  new state
exit=0
```

### explore (found the bug first try)

```
$ reachgate explore
FAIL: 1 invariant violated · 11 states, 14 steps, 7 labels · state space exhausted · 2 ms
  ✗ credit-non-negative: credit is -1
    witness (2 steps, shortest): coin → push
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/credit-non-negative.json
report: .reachgate/report.md
exit=1
$ ls .reachgate/witnesses
credit-non-negative.json
open-door-is-unlocked.json        <- stale, left over from the starter door target
$ head .reachgate/report.md
| `credit-non-negative` | **no** (3×) | 2 steps (shortest) · ... |
| `no-crash`: step(), affordances() and observe() never throw | yes |  |
| `no-free-rides` | yes |  |
| `rides-accounted` | yes |  |
```

The tool found my bug (coin → push leaves the turnstile unlocked with credit -1) without being told
where it was. Surprise: `no-free-rides` says "yes", although the bug obviously gives free rides. That is
because states that violate an invariant are not expanded by default; the free ride is one step past
the first violation. `--expand-violations` (only in `--help`) shows it:

```
$ reachgate explore --expand-violations
FAIL: 2 invariants violated · 16 states, 29 steps, 7 labels · state space exhausted · 2 ms
  ✗ credit-non-negative: credit is -1
    witness (2 steps, shortest): coin → push
  ✗ no-free-rides: 2 passes for 1 coin(s)
    witness (3 steps, shortest): coin → push → push
exit=1
```

### replay

```
$ reachgate replay ./reachgate.target.mjs .reachgate/witnesses/credit-non-negative.json
replaying 2 step(s) on turnstile (recorded violation: credit-non-negative)
  0. initial()
       + locked
  1. coin
       + unlocked
  2. push
       ✗ credit-non-negative: credit is -1
REPRODUCED: credit-non-negative at step 2
exit=0
$ reachgate replay .reachgate/witnesses/credit-non-negative.json     # the guide's shorter form
(same output) exit=0
```

### fix, explore again

```
$ sed -i "s/if (t.credit >= 0) {/if (t.credit > 0) {/" src/turnstile.js
$ reachgate explore
PASS: 0 invariants violated · 14 states, 27 steps, 7 labels · state space exhausted · 2 ms
report: .reachgate/report.md
exit=0
$ reachgate explore --expand-violations --require-exhaustive --quiet
PASS: 0 invariants violated · 14 states, 27 steps, 7 labels · state space exhausted · 2 ms
exit=0
```

### baseline

```
$ reachgate baseline
PASS: 0 invariants violated · 14 states, 27 steps, 7 labels · state space exhausted · 2 ms
baseline: reachgate.baseline.json (7 labels, 4 invariants)
exit=0
$ echo ".reachgate/" > .gitignore && git add -A && git commit -m "fix + reachgate baseline"
$ reachgate check
# reachgate check: turnstile
**PASS: nothing reachable was lost and no invariant got worse than the baseline.**
Before: 14 states (exhaustive). After: 14 states (exhaustive). Failing on: lost, violation.
exit=0
```

"4 invariants" for my 3: the 4th is the built-in `no-crash` (visible in report.md / baseline JSON).
The guide shows "(8 labels, 3 invariants)" for its 2 invariants without explaining this.

### a change that removes reachable behaviour (invariants intact) -> check exit 1

"Simplification": refuse coins while already unlocked instead of banking them.

```
$ git diff src
-  t.credit += 1; // bank an extra ride
-  return "banked";
+  return "rejected"; // simplification: already open, give the coin back
$ reachgate check
# reachgate check: turnstile

**FAIL: 1 label(s) no longer reachable.**

Before: 14 states (exhaustive). After: 11 states (exhaustive). Failing on: lost, violation.

## No longer reachable (1)

- `banked-ride`: the baseline witness still replays all 2 step(s), but "banked-ride" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: coin → coin (`.reachgate/witnesses/lost_banked-ride.json`)

## What to do

1. Replay a witness to see the regression step by step: `reachgate replay <target> <witness file>` (files listed above).
2. If the change in behaviour is a bug, fix the code and run `reachgate check` again.
3. If it is intended (a feature removed on purpose), say why in the PR and run `reachgate baseline` to accept it.

exit=1
$ reachgate replay .reachgate/witnesses/lost_banked-ride.json
replaying 2 step(s) on turnstile
  0. initial()
       + locked
  1. coin
       + unlocked
  2. coin
NOT REACHED: the trace replays, but banked-ride is not reached along it (...)
exit=1
```

Clear explanation, correct exit code, and diff.json carries the same data machine-readably
(`"verdict": "fail"`, `lost[0].diagnosis.reason: "label-not-observed"`, `"exitCode": 1`).

### revert -> check exit 0

```
$ git checkout src/turnstile.js && git status --short
(clean)
$ reachgate check
**PASS: nothing reachable was lost and no invariant got worse than the baseline.**
Before: 14 states (exhaustive). After: 14 states (exhaustive). Failing on: lost, violation.
exit=0
```

## Python (optional)

```
$ mkdir ~/mypy && cd ~/mypy && reachgate init --lang python
wrote reachgate_target.py, reachgate_adapter.py, reachgate.config.json
$ reachgate explore            # untouched starter
FAIL: 1 invariant violated · 4 states, 5 steps, 7 labels · state space exhausted · 3 ms
  ✗ open-door-is-unlocked: the door is open and locked
    witness (2 steps, shortest): open → lock
exit=1
```

Then I ported the buggy turnstile to `turnstile.py` and replaced the starter with a `serve(...)` target
importing it:

```
$ reachgate inspect
target: turnstile-py (adapter: python3 /home/tester/mypy/reachgate_target.py)
invariants: no-free-rides
initial state: {"paid":0,"t":{"credit":0,"locked":true,"passes":0}}
  labels: (none: add observe(state) to name behaviour for the baseline)
  2 action(s):
    coin  →  new state
    push  →  same state
$ reachgate explore
FAIL: 1 invariant violated · 13 states, 16 steps, 3 labels · state space exhausted · 6 ms
  ✗ no-free-rides: free ride
    witness (3 steps, shortest): coin → push → push
exit=1
$ reachgate replay .reachgate/witnesses/no-free-rides.json
REPRODUCED: no-free-rides at step 3
exit=0
$ (fix >= to >) reachgate explore
PASS: 0 invariants violated · 10 states, 16 steps, 3 labels · state space exhausted · 7 ms
$ reachgate baseline
baseline: reachgate.baseline.json (3 labels, 2 invariants)
$ reachgate check --quiet
**PASS: nothing reachable was lost and no invariant got worse than the baseline.**
exit=0
```

Python path worked first try. Importing my own module next to the target just worked (script dir on
sys.path). Nice touch: inspect's hint "(none: add observe(state) ...)".

## Friction and suggestions

1. **Stale witness files.** `.reachgate/witnesses/` is never cleaned. After my fix and a PASS,
   `credit-non-negative.json`, `no-free-rides.json` and the starter's `open-door-is-unlocked.json` were
   still there. An agent or human listing that folder would think there are open violations. Clear the
   folder at the start of each run, or document that only files named in report.json are current.
2. **First violation hides later ones.** By default exploration stops expanding at a violating state,
   so my more important invariant (`no-free-rides`) reported "yes" while the bug clearly allowed free
   rides. Neither the README nor the guide mentions this or `--expand-violations`. One sentence in the
   guide's explore step ("only the first invariant broken along each path is reported; use
   --expand-violations to see the rest") would prevent a false sense of safety. Saying "yes" in the
   report table for an invariant that was not checked past violating states is a bit strong; "not
   violated before another invariant failed" would be more honest.
3. **Guide: "contains a working toy target (a door with a lock)".** It fails on purpose
   (open → lock). Say so.
4. **Implicit `no-crash` invariant** is not mentioned in README or guide; it explains why the guide's
   "(8 labels, 3 invariants)" and my "(7 labels, 4 invariants)" are one more than I wrote.
5. **Replay exit codes** are only in docs/cli.md. README's table says nothing about `replay`, and
   "REPRODUCED ... exit 0" is counter-intuitive at first.
6. **Install from clone creates a symlink** (`node_modules/reachgate -> ../../../reachgate`); deleting
   the clone breaks the CLI. Worth a note, or suggest `npm pack` + install the tarball.
7. **"`npx reachgate ...` works too, without a global install"** cannot work until the package is on
   the registry (the README's first install line says "once published"). The guide repeats it ("or
   prefix every command with `npx reachgate`") and the CI snippet uses `npx reachgate check --quiet`.
   Qualify these until it is published, or show `npx github:vulbsti/reachgate`.
8. `--quiet` still prints the summary/diff (it only removes the stderr progress line, as cli.md says);
   the name suggests silence. Fine once read, but surprising.
9. Starter target has `/** @type {import('reachgate').Target} */`; with a global install that type
   import cannot resolve in an editor. Harmless, maybe mention.
10. Sandbox-only: `reachgate: command not found` came from this container's `.bashrc` guard, not the
    README.

What was excellent: Quickstart output matched exactly; the guide's hook table and "bound the scenario"
/ "no hidden state" advice were exactly right; inspect's per-action "new state / same state" is a great
wiring check; the check diff explains *why* a label was lost and what to do.

## Verdict

**PASS.** Tasks 1-3 (and optional 4) completed using only the README and docs/wire-in-15-minutes.md
(plus docs/cli.md to confirm exit codes). No outside help needed; the only error (`command not found`)
was a sandbox PATH quirk. Actual wiring time for my own project: about 5 minutes.
