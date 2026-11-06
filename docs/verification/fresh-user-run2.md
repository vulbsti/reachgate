# reachgate: fresh-user transcript

Every command below ran inside container `rg-fresh2` as user `tester` via
`docker exec -u tester rg-fresh2 bash -ic '<command>'`. Outputs are real; long outputs are trimmed
(marked `...`). Bash's "no job control" noise from `-i` is omitted.

## Setup

```console
$ git clone /srv/reachgate.git ~/reachgate      # README's GitHub URL substituted with the mirror
Cloning into '/home/tester/reachgate'...
done.
$ git -C ~/reachgate rev-parse --short HEAD
669b6a1
$ cat ~/reachgate/README.md
(read in full)
$ node --version && npm --version
v22.23.4
10.9.9
```

**Commit tested: `669b6a1`**

## Install

README: "Or from a clone: `git clone https://github.com/vulbsti/reachgate && npm install -g ./reachgate`".

```console
$ cd ~ && npm install -g ./reachgate
added 1 package in 189ms
$ which reachgate
/home/tester/.npm-global/bin/reachgate
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

Notes: worked first time. The first line of the Install block (`npm install -g reachgate  # once
published`) does not work today; the working options come second and third.

## Quickstart

```console
$ cd ~/reachgate && reachgate explore examples/dungeon/target.mjs; echo EXIT=$?
FAIL: 1 invariant violated · 10772 states, 35881 steps, 18 labels · state space exhausted · 363 ms
  ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
    witness (13 steps, shortest): down → right → right → right → right → right → right → up → right → down → down → up → wait
    replay: reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
warning: 16 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
EXIT=1
```

**Comparison with README:** identical except timing (363 ms vs 505 ms). Same states/steps/labels,
same 13-step witness, same warning.

Followed the printed replay hint:

```console
$ reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json; echo EXIT=$?
replaying 13 step(s) on dungeon (cellar, seeded bug) (recorded violation: no-softlock)
  0. initial()
       + room:cellar
  1. down
  2. right
       + picked:potion
...
 13. wait
       + key:knocked-loose
       ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
REPRODUCED: no-softlock at step 13
EXIT=0
```

`git status --short` in the clone stays clean afterwards (`.reachgate/` is gitignored). Good.

## Wiring my own project

Project: **parking-garage gate controller** in `~/garage` (outside the clone), ordinary ES module code,
with a planted off-by-one in the capacity check.

```console
$ mkdir -p ~/garage/src && cd ~/garage && git init -q
$ cat package.json
{ "name": "garage", "version": "1.0.0", "type": "module", "private": true }
$ cat src/garage.js
// Parking-garage gate controller.
export const RATE_PER_HOUR = 3;

export function createGarage(capacity = 2) {
  return { capacity, occupied: 0, tickets: {}, nextTicket: 1, revenue: 0, gate: "closed", log: [] };
}

// A car pulls up to the entry gate.
export function enter(g) {
  if (g.occupied > g.capacity) { g.log.push("full"); return null; } // BUG: should be >=
  const id = g.nextTicket++;
  g.tickets[id] = { paid: false };
  g.occupied += 1;
  g.gate = "entry-open";
  g.log.push("entered");
  return id;
}

// Driver pays at the machine for a ticket.
export function pay(g, id, hours) { ... marks ticket paid, revenue += hours * RATE_PER_HOUR ... }

// Car pulls up to the exit gate with a ticket.
export function exit(g, id) { ... refuses unpaid tickets; else deletes ticket, occupied -= 1 ... }
$ echo ".reachgate/" > .gitignore
```

### init

```console
$ reachgate init; echo EXIT=$?
wrote reachgate.target.mjs, reachgate.config.json
next:
  1. edit reachgate.target.mjs: point initial/affordances/step at your code, add invariants
  2. reachgate inspect        check the wiring
  3. reachgate explore        find violations
  4. reachgate baseline       record behaviour (commit reachgate.baseline.json; add .reachgate/ to .gitignore)
  5. reachgate check          after every change: the gate
EXIT=0
$ cat reachgate.config.json
{
  "target": "./reachgate.target.mjs",
  "strategy": "bfs",
  "maxSteps": 200000,
  "maxStates": 100000,
  "baseline": "reachgate.baseline.json",
  "out": ".reachgate"
}
$ reachgate explore; echo EXIT=$?        # the starter toy door, which the guide says fails
FAIL: 1 invariant violated · 4 states, 5 steps, 7 labels · state space exhausted · 1 ms
  ✗ open-door-is-unlocked: the door is open and locked
    witness (2 steps, shortest): open → lock
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/open-door-is-unlocked.json
report: .reachgate/report.md
EXIT=1
```

Matches the guide.

### The target I wrote (`reachgate.target.mjs`)

Following the guide's advice: thin hooks calling real code, a ghost variable (`arrivals`) capped in
`affordances` to bound the scenario (ticket numbers otherwise grow forever).

```js
import { createGarage, enter, pay, exit } from "./src/garage.js";

/** @type {import("reachgate").Target} */
export default {
  name: "garage",
  initial: () => ({ g: createGarage(2), arrivals: 0 }),
  affordances: ({ g, arrivals }) => [
    ...(arrivals < 4 ? [{ type: "arrive" }] : []),
    ...Object.keys(g.tickets).flatMap((id) => [
      ...(!g.tickets[id].paid ? [{ type: "pay", id: Number(id), hours: 1 }, { type: "pay", id: Number(id), hours: 3 }] : []),
      { type: "exit", id: Number(id) },
    ]),
  ],
  step: (s, a) => {
    if (a.type === "arrive") { enter(s.g); s.arrivals += 1; }
    if (a.type === "pay") pay(s.g, a.id, a.hours);
    if (a.type === "exit") exit(s.g, a.id);
    s.g.log = s.g.log.slice(-1); // keep only the last event so states do not differ by history
    return s;
  },
  invariants: {
    "never-over-capacity": ({ g }) => g.occupied <= g.capacity || `${g.occupied} cars parked in a ${g.capacity}-space garage`,
    "tickets-match-cars": ({ g }) => Object.keys(g.tickets).length === g.occupied || `${Object.keys(g.tickets).length} open tickets but ${g.occupied} cars`,
  },
  observe: ({ g }) => [`parked:${g.occupied}`, ...(g.log.length ? [`event:${g.log[0]}`] : []), ...(g.revenue >= 6 ? ["revenue:6+"] : [])],
  label: (a) => (a.type === "arrive" ? "arrive" : a.type === "pay" ? `pay #${a.id} ${a.hours}h` : `exit #${a.id}`),
};
```

### inspect

```console
$ reachgate inspect; echo EXIT=$?
target: garage (in-process: ./reachgate.target.mjs)
invariants: never-over-capacity, tickets-match-cars
deadlock detection: off (define isTerminal to turn it on)
initial state: {"arrivals":0,"g":{"capacity":2,"gate":"closed","log":[],"nextTicket":1,"occupied":0,"revenue":0,"tickets":{}}}
  hash vaxp9mtNaZ5Q8Q19KWTxTJn4Po8
  labels: parked:0
  violations: none
  1 action(s):
    arrive  →  new state
EXIT=0
```

### explore (finds the bug)

```console
$ reachgate explore; echo EXIT=$?
FAIL: 1 invariant violated · 389 states, 1096 steps, 21 labels · state space exhausted · 19 ms
  ✗ never-over-capacity: 3 cars parked in a 2-space garage
    witness (3 steps, shortest): arrive → arrive → arrive
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/never-over-capacity.json
warning: 32 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
EXIT=1
```

Found on the first run, shortest witness, exhaustive.

### replay

```console
$ reachgate replay .reachgate/witnesses/never-over-capacity.json; echo EXIT=$?
replaying 3 step(s) on garage (recorded violation: never-over-capacity)
  0. initial()
       + parked:0
  1. arrive
       + parked:1
       + event:entered
  2. arrive
       + parked:2
  3. arrive
       + parked:3
       ✗ never-over-capacity: 3 cars parked in a 2-space garage
REPRODUCED: never-over-capacity at step 3
EXIT=0
```

`.reachgate/report.md` (excerpt):

```
**FAIL: 1 invariant violated · 389 states, 1096 steps, 21 labels · state space exhausted · 19 ms**
- Explored 389 distinct states, deepest trace 12 steps. Every reachable state was visited.
- First violation (`never-over-capacity`) after 2 ms, 6 steps, 7 states.
...
Replay: `reachgate replay <target> .reachgate/witnesses/never-over-capacity.json`
...
| `action:exit #1` | 1 steps |
```

(Small nits: "`<target>`" placeholder in the report while the CLI prints the real path; "1 steps".)

### fix, explore again

Changed `>` to `>=` in `enter`.

```console
$ reachgate explore; echo EXIT=$?
PASS: 0 invariants violated · 567 states, 1687 steps, 21 labels · state space exhausted · 31 ms
report: .reachgate/report.md
EXIT=0
$ reachgate replay .reachgate/witnesses/never-over-capacity.json; echo EXIT=$?
reachgate: witness not found: /home/tester/garage/.reachgate/witnesses/never-over-capacity.json
EXIT=2
```

**Surprise:** the passing `explore` deleted the old witness, so I could not use the README's
"`replay` ... 1 when it replays but the violation no longer happens (fixed?)" to confirm the fix.
Neither the README nor the guide mentions this. Workaround: recreate the bug, copy the witness out,
fix, replay the copy:

```console
$ sed -i "s|g.occupied >= g.capacity|g.occupied > g.capacity|" src/garage.js && reachgate explore --quiet >/dev/null
warning: 32 state(s) that violate an invariant were not explored further, ...
$ cp .reachgate/witnesses/never-over-capacity.json /tmp/capacity-witness.json
$ sed -i "s|g.occupied > g.capacity|g.occupied >= g.capacity|" src/garage.js
$ reachgate replay /tmp/capacity-witness.json; echo EXIT=$?
replaying 3 step(s) on garage (recorded violation: never-over-capacity)
  0. initial()
       + parked:0
  1. arrive
       + parked:1
       + event:entered
  2. arrive
       + parked:2
  3. arrive
       + event:full
NOT REPRODUCED: the trace replays, but never-over-capacity no longer happens (fixed?)
EXIT=1
$ reachgate explore --quiet; echo EXIT=$?
PASS: 0 invariants violated · 567 states, 1687 steps, 21 labels · state space exhausted · 24 ms
report: .reachgate/report.md
EXIT=0
```

That replay output is very nice: you can see the gate now says `event:full` at step 3.

### baseline

```console
$ reachgate baseline; echo EXIT=$?
PASS: 0 invariants violated · 567 states, 1687 steps, 21 labels · state space exhausted · 26 ms
baseline: reachgate.baseline.json (21 labels, 3 invariants)
EXIT=0
$ git add -A && git commit -qm "garage + reachgate baseline" && git log --oneline
6170c0b garage + reachgate baseline
```

"3 invariants" with my 2: the third is the built-in `no-crash` (the guide's hook table mentions it).

### check on unchanged code

```console
$ reachgate check; echo EXIT=$?
# reachgate check: garage

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 567 states (exhaustive). After: 567 states (exhaustive). Failing on: lost, violation.

## What to do

Nothing. If labels were added on purpose, run `reachgate baseline` to record them.

EXIT=0
```

### regression: "keep one space free for staff"

First attempt was my own sed mistake (a `//` comment swallowed the rest of the line), which gave:

```console
$ reachgate check; echo EXIT=$?
reachgate: could not measure: could not import /home/tester/garage/reachgate.target.mjs: Unexpected token 'export'
EXIT=3
```

Exit 3 is right, but the message names the target file, not `src/garage.js` where the syntax error
actually was, which sent me looking in the wrong file first. Redone correctly:

```console
$ git checkout src/garage.js
$ sed -i "s|if (g.occupied >= g.capacity) {|if (g.occupied >= g.capacity - 1) { /* keep one space free for staff */|" src/garage.js
$ reachgate check; echo EXIT=$?
# reachgate check: garage

**FAIL: 1 label(s) no longer reachable.**

Before: 567 states (exhaustive). After: 148 states (exhaustive). Failing on: lost, violation.

## No longer reachable (1)

- `parked:2`: the baseline witness still replays all 2 step(s), but "parked:2" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: arrive → arrive (`.reachgate/witnesses/lost_parked_2.json`)

## What to do

1. Replay a witness to see the regression step by step: `reachgate replay <target> <witness file>` (files listed above).
2. If the change in behaviour is a bug, fix the code and run `reachgate check` again.
3. If it is intended (a feature removed on purpose), say why in the PR and run `reachgate baseline` to accept it.

EXIT=1
$ reachgate replay .reachgate/witnesses/lost_parked_2.json; echo EXIT=$?
replaying 2 step(s) on garage
  0. initial()
       + parked:0
  1. arrive
       + parked:1
       + event:entered
  2. arrive
       + event:full
NOT REACHED: the trace replays, but parked:2 is not reached along it (the baseline witness still replays all 2 step(s), but "parked:2" no longer shows up anywhere along it: the code behaves differently on the same steps)
EXIT=1
```

Invariants all still hold; only the baseline caught it, exit 1, clear explanation. Exactly as advertised.

### revert, check passes

```console
$ git checkout src/garage.js && reachgate check; echo EXIT=$?
Updated 1 path from the index
# reachgate check: garage

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**
...
EXIT=0
```

### --require-exhaustive

```console
$ reachgate check --require-exhaustive --quiet; echo EXIT=$?
# reachgate check: garage

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 567 states (exhaustive). After: 567 states (exhaustive). Failing on: lost, violation.
...
EXIT=0
```

Forcing a budget stop to see exit 3:

```console
$ reachgate check --require-exhaustive --max-steps 100; echo EXIT=$?
# reachgate check: garage

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 567 states (exhaustive). After: 56 states. Failing on: lost, violation.

## Not found by this search but still reachable via the baseline witness (3)

- `action:exit #4` (8 steps)
- `action:pay #4 1h` (8 steps)
- `action:pay #4 3h` (8 steps)

## What to do

Nothing. If labels were added on purpose, run `reachgate baseline` to record them.
warning: --require-exhaustive: the search stopped on the steps budget after 56 states, so not every reachable state was checked. Bound the scenario or raise the budget.

EXIT=3
$ reachgate explore --require-exhaustive --max-steps 100; echo EXIT=$?
PASS: 0 invariants violated · 56 states, 100 steps, 18 labels · stopped by steps budget · 4 ms
warning: --require-exhaustive: the search stopped on the steps budget after 56 states, so not every reachable state was checked. Bound the scenario or raise the budget.
report: .reachgate/report.md
EXIT=3
```

**Surprise:** the bold verdict line says **PASS** and "What to do: Nothing", yet the exit code is 3
("could not measure"). The README tells agents to "Quote its verdict line in the PR"; an agent would
quote PASS for a run that actually failed the gate.

## Python

Project: **library loan system** in `~/library` (a `Library` class with holds queue). Planted bug:
collecting a held book does not remove the member from the hold queue.

```console
$ python3 --version
Python 3.11.2
$ mkdir -p ~/library && cd ~/library && reachgate init --lang python; echo EXIT=$?
wrote reachgate_target.py, reachgate_adapter.py, reachgate.config.json
next:
  1. edit reachgate_target.py: point initial/affordances/step at your code, add invariants
  ...
EXIT=0
$ cat reachgate.config.json
{
  "target": "./reachgate_target.py",
  ...
}
```

`library.py` (excerpt):

```python
class Library:
    def __init__(self, books):
        self.status = {b: "shelf" for b in books}   # shelf | loaned | hold-shelf
        self.loans = {}                              # book -> member
        self.holds = {b: [] for b in books}          # book -> queue of members

    def checkout(self, member, book):
        st = self.status[book]
        if st == "loaned":
            return "on loan"
        if st == "hold-shelf" and self.holds[book][0] != member:
            return "held for someone else"
        self.status[book] = "loaned"
        self.loans[book] = member
        # BUG: forgot to remove the member from the hold queue when they collect a held book
        return "ok"
    # place_hold, return_book, to_dict, from_dict ...
```

`reachgate_target.py` (excerpt): members `ann`, `bob`, one book `dune`; `step` does
`Library.from_dict(s)`, calls the real method, returns `lib.to_dict()`; invariants
`borrower-not-in-own-queue` and `status-matches-loans`; then `serve(name="library", ...)`.

My first version had a Python 3.11 f-string mistake; the adapter error came through clearly:

```console
$ reachgate inspect; echo EXIT=$?
reachgate: could not measure: adapter exited (code 1): File "/home/tester/library/reachgate_target.py", line 45 |     return f"{book} status {st} but loans={s[\"loans\"]}" |                                                          ^ | SyntaxError: f-string expression part cannot include a backslash
EXIT=3
```

After fixing my typo:

```console
$ reachgate inspect; echo EXIT=$?
target: library (adapter: python3 /home/tester/library/reachgate_target.py)
invariants: borrower-not-in-own-queue, status-matches-loans
deadlock detection: off (define isTerminal to turn it on)
initial state: {"holds":{"dune":[]},"loans":{},"status":{"dune":"shelf"}}
  hash _V9pF83U1JpfUpodLSnX33gSwNo
  labels: dune:shelf, holds:0
  violations: none
  4 action(s):
    checkout ann dune  →  new state
    hold ann dune  →  same state
    checkout bob dune  →  new state
    hold bob dune  →  same state
EXIT=0
$ reachgate explore; echo EXIT=$?
FAIL: 1 invariant violated · 13 states, 40 steps, 11 labels · state space exhausted · 10 ms
  ✗ borrower-not-in-own-queue: bob has dune on loan and is still in its hold queue
    witness (4 steps, shortest): checkout ann dune → hold bob dune → return dune → checkout bob dune
    replay: reachgate replay ./reachgate_target.py .reachgate/witnesses/borrower-not-in-own-queue.json
report: .reachgate/report.md
warning: 4 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
EXIT=1
$ reachgate replay ./reachgate_target.py .reachgate/witnesses/borrower-not-in-own-queue.json; echo EXIT=$?
replaying 4 step(s) on library (recorded violation: borrower-not-in-own-queue)
  0. initial()
       + dune:shelf
       + holds:0
  1. checkout ann dune
       + dune:loaned
  2. hold bob dune
       + holds:1
  3. return dune
       + dune:hold-shelf
  4. checkout bob dune
       ✗ borrower-not-in-own-queue: bob has dune on loan and is still in its hold queue
REPRODUCED: borrower-not-in-own-queue at step 4
EXIT=0
```

Fixed (`if st == "hold-shelf": self.holds[book].pop(0)`):

```console
$ reachgate explore; echo EXIT=$?
PASS: 0 invariants violated · 9 states, 40 steps, 11 labels · state space exhausted · 8 ms
report: .reachgate/report.md
EXIT=0
$ reachgate baseline --quiet; echo EXIT=$?
PASS: 0 invariants violated · 9 states, 40 steps, 11 labels · state space exhausted · 8 ms
baseline: reachgate.baseline.json (11 labels, 3 invariants)
EXIT=0
$ reachgate check --quiet | head -3
# reachgate check: library

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**
EXIT=0
```

Notes: `inspect` on a Python target says "define isTerminal", but the guide says the Python hook is
`is_terminal`. In the Python run the `report:` line printed before the `warning:` line (opposite order
to JS); cosmetic.

## Friction and suggestions

Most to least important:

1. **Verdict line says PASS when the exit code is 3.** With `--require-exhaustive` and a budget stop,
   both `explore` ("PASS: 0 invariants violated · ... stopped by steps budget") and `check`
   ("**PASS: nothing reachable was lost...**", "What to do: Nothing.") print PASS and exit 3. The
   README's agent snippet says "`reachgate check` must pass. Quote its verdict line in the PR." An
   agent quoting the verdict line would report PASS. Suggest a distinct verdict (e.g. "INCOMPLETE") or
   document that exit code, not the headline, is authoritative.
2. **A passing `explore` deletes old witness files**, so you can't confirm a fix with the replay exit
   code 1 that the README advertises ("1 when it replays but the violation no longer happens
   (fixed?)"). The guide says "Fix it (...) and explore again" with no hint. Suggest documenting
   "replay before re-exploring, or copy the witness" (or keep stale witnesses somewhere).
3. **Import error names the wrong file.** A syntax error in `src/garage.js` was reported as
   "could not import /home/tester/garage/reachgate.target.mjs: Unexpected token 'export'". Including
   the underlying file/line (or the error stack) would save time.
4. **Install section leads with a command that doesn't work yet:**
   "`npm install -g reachgate          # once published (see RELEASE.md)`". Put the working
   GitHub/clone commands first.
5. **`inspect` on a Python target** says "define isTerminal to turn it on", while the guide says
   Python uses snake_case "`is_terminal`".
6. **Placeholders in generated reports:** `report.md` says "Replay: `reachgate replay <target> ...`"
   and `check` says "`reachgate replay <target> <witness file>`", while `explore`'s terminal output
   prints the real command. Fill in the real target. Also "1 steps" in the labels table.
7. The invariant count in "baseline: ... (21 labels, 3 invariants)" includes the built-in `no-crash`;
   briefly confusing when you wrote 2. A short "(incl. no-crash)" would help.

What went well: install, init, inspect and explore all worked first time. The Quickstart output
matched the README exactly apart from timing. The guide's "bound the scenario" and "ghost variable"
advice was exactly what my garage target needed (ticket IDs grow forever otherwise). The lost-label
diagnosis in `check` was precise and easy to act on. The Python adapter error passthrough was clear.

## Verdict

**PASS.** Tasks 1-4 done using only the README and docs/wire-in-15-minutes.md (plus a grep of
docs/cli.md to confirm the witness-deletion behaviour isn't documented). No outside help. The only
errors I hit were my own typos, and the tool's messages were enough to fix them.
