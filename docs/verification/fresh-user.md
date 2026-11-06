# reachgate: fresh-user transcript

## Setup

Sandbox: Docker container `rg-fresh3`, user `tester`, Node v22.23.4, npm 10.9.9, Python 3.11.2.

```console
$ git clone /srv/reachgate.git ~/reachgate
$ git -C ~/reachgate log -1 --format='%h %s'
cc7a138 Second audit fixes: no private paths or session IDs in docs, current outputs re-pasted, GIF re-recorded with committed frame checks, help text, VERIFICATION refs by subject
```

**Commit tested: `cc7a138`.** Read README.md and docs/wire-in-15-minutes.md (linked from the README). Did not read src/ or tests.

## Install

README: `npm install -g github:vulbsti/reachgate`. No GitHub in the sandbox, so I used the README's other form, "from a clone: `git clone ... && npm install -g ./reachgate`", with the mirror.

```console
$ npm install -g ./reachgate

added 1 package in 268ms
[exit 0]
```

```console
$ which reachgate; reachgate --version; reachgate --help
/home/tester/.npm-global/bin/reachgate
0.1.0
reachgate 0.1.0: explore your code's reachable states, check invariants, gate changes on a baseline.
... (full usage text, options and exit codes; matched README) ...
[exit 0]
```

Install was instant: zero dependencies, binary on PATH, `--help` is clear.

## Quickstart

Run from the clone, exactly as in the README:

```console
$ reachgate explore examples/dungeon/target.mjs
FAIL: 1 invariant violated · 10772 states, 35881 steps, 18 labels · state space exhausted · 519 ms
  ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
    witness (13 steps, shortest): down → right → right → right → right → right → right → up → right → down → down → up → wait
    replay: reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
warning: 16 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
[exit 1]
```

**Matches the README output line for line** (same 10772 states, 35881 steps, 18 labels, same 13-step witness, same warning). Only the timing differs (519 ms vs 505 ms). I also ran the printed replay command:

```console
$ reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
replaying 13 step(s) on dungeon (cellar, seeded bug) (recorded violation: no-softlock)
  0. initial()
       + room:cellar
  1. down
  2. right
       + picked:potion
  3. right
  4. right
       + room:passage
  5. right
       + room:well
  6. right
  7. right
  8. up
       + picked:key
  9. right
 10. down
 11. down
 12. up
 13. wait
       + key:knocked-loose
       ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
REPRODUCED: no-softlock at step 13
[exit 0]
```

`.reachgate/` written inside the clone is git-ignored (`git status --short` was empty).

## Wiring my own project

Project: a **document approval workflow** in `~/approval` (outside the clone, plain `git init`, no package.json). An author submits, reviewers approve or request changes, and two approvals are needed. **Planted bug:** `approve` doesn't check whether this reviewer already approved, so one reviewer approving twice counts as two approvals.

The planted-bug version of `approve`:

```js
export function approve(doc, reviewer) {
  if (doc.status !== 'in-review') return 'invalid';
  if (reviewer === doc.author) return 'forbidden';
  doc.approvals.push(reviewer);            // BUG: no duplicate check
  if (doc.approvals.length >= REQUIRED_APPROVALS) doc.status = 'approved';
  return 'ok';
}
```

### init

```console
$ reachgate init
wrote reachgate.target.mjs, reachgate.config.json
next:
  1. edit reachgate.target.mjs: point initial/affordances/step at your code, add invariants
  2. reachgate inspect        check the wiring
  3. reachgate explore        find violations
  4. reachgate baseline       record behaviour (commit reachgate.baseline.json; add .reachgate/ to .gitignore)
  5. reachgate check          after every change: the gate
[exit 0]
```

```console
$ cat reachgate.config.json
{
  "target": "./reachgate.target.mjs",
  "strategy": "bfs",
  "maxSteps": 200000,
  "maxStates": 100000,
  "baseline": "reachgate.baseline.json",
  "out": ".reachgate"
}
[exit 0]
```

The starter `reachgate.target.mjs` is a commented toy door target, and every hook is explained inline. I replaced it with:

`~/approval/reachgate.target.mjs`:

```js
import { createDoc, submit, approve, requestChanges, withdraw } from './src/approval.js';

const USERS = ['alice', 'bob', 'carol'];
const OPS = { submit, approve, requestChanges, withdraw };

export default {
  name: 'doc-approval',
  initial: () => ({ doc: createDoc('alice') }),
  // Anyone may try anything; the workflow decides what is allowed.
  // Bound the scenario: at most two rounds of requested changes, so the state space is finite.
  affordances: ({ doc }) =>
    USERS.flatMap((user) => Object.keys(OPS).map((op) => ({ op, user })))
      .filter((a) => a.op !== "requestChanges" || doc.revision < 3),
  step: (s, a) => {
    OPS[a.op](s.doc, a.user);
    return s;
  },
  invariants: {
    'approved-by-two-distinct-reviewers': ({ doc }) => {
      if (doc.status !== 'approved') return true;
      const distinct = new Set(doc.approvals);
      if (distinct.has(doc.author)) return `author ${doc.author} approved their own document`;
      return distinct.size >= 2 || `approved with approvals [${doc.approvals.join(', ')}]: only ${distinct.size} distinct reviewer(s)`;
    },
  },
  observe: ({ doc }) => [`status:${doc.status}`],
  label: (a) => `${a.user} ${a.op}`,
};
```

(The `affordances` bound on `requestChanges` was added after the first explore, see below.)

### inspect

```console
$ reachgate inspect
target: doc-approval (in-process: ./reachgate.target.mjs)
invariants: approved-by-two-distinct-reviewers
deadlock detection: off (define isTerminal to turn it on)
initial state: {"doc":{"approvals":[],"author":"alice","revision":1,"status":"draft"}}
  hash i7ktSB-UqLBDIYf1yVf2b4VCgX8
  labels: status:draft
  violations: none
  12 action(s):
    alice submit  →  new state
    alice approve  →  same state
    alice requestChanges  →  same state
    alice withdraw  →  same state
    bob submit  →  same state
    bob approve  →  same state
    bob requestChanges  →  same state
    bob withdraw  →  same state
    carol submit  →  same state
    carol approve  →  same state
    carol requestChanges  →  same state
    carol withdraw  →  same state
[exit 0]
```

Helpful: it shows every action and whether it leads to a new state.

### explore: bug found

```console
$ reachgate explore
FAIL: 1 invariant violated · 20376 states, 200000 steps, 16 labels · stopped by steps budget · 945 ms
  ✗ approved-by-two-distinct-reviewers: approved with approvals [bob, bob]: only 1 distinct reviewer(s)
    witness (3 steps, shortest): alice submit → bob approve → bob approve
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/approved-by-two-distinct-reviewers.json
report: .reachgate/report.md
[exit 1]
```

The bug was found right away (3-step shortest witness). Note `stopped by steps budget`: my `revision` counter grows forever. The guide's "Bound the scenario" section predicts exactly this, so after replaying the witness I capped `requestChanges` at revision < 3 in `affordances` and explored again:

```console
$ reachgate replay .reachgate/witnesses/approved-by-two-distinct-reviewers.json
replaying 3 step(s) on doc-approval (recorded violation: approved-by-two-distinct-reviewers)
  0. initial()
       + status:draft
  1. alice submit
       + status:in-review
  2. bob approve
  3. bob approve
       + status:approved
       ✗ approved-by-two-distinct-reviewers: approved with approvals [bob, bob]: only 1 distinct reviewer(s)
REPRODUCED: approved-by-two-distinct-reviewers at step 3
[exit 0]
```

```console
$ reachgate explore
FAIL: 1 invariant violated · 30 states, 261 steps, 16 labels · state space exhausted · 5 ms
  ✗ approved-by-two-distinct-reviewers: approved with approvals [bob, bob]: only 1 distinct reviewer(s)
    witness (3 steps, shortest): alice submit → bob approve → bob approve
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/approved-by-two-distinct-reviewers.json
report: .reachgate/report.md
[exit 1]
```

Now `state space exhausted` (30 states).

### fix, explore again, replay the previous witness

Fix: `if (doc.approvals.includes(reviewer)) return 'already approved';` before the push.

```console
$ reachgate explore
PASS: 0 invariants violated · 24 states, 261 steps, 16 labels · state space exhausted · 4 ms
report: .reachgate/report.md
[exit 0]
```

The guide says: "Each run moves the previous run's witnesses to `.reachgate/witnesses/previous/`". It did:

```console
$ reachgate replay .reachgate/witnesses/previous/approved-by-two-distinct-reviewers.json
replaying 3 step(s) on doc-approval (recorded violation: approved-by-two-distinct-reviewers)
  0. initial()
       + status:draft
  1. alice submit
       + status:in-review
  2. bob approve
  3. bob approve
NOT REPRODUCED: the trace replays, but approved-by-two-distinct-reviewers no longer happens (fixed?)
[exit 1]
```

Exit 1 with `NOT REPRODUCED ... (fixed?)`, exactly as the guide says.

### baseline

```console
$ reachgate baseline
PASS: 0 invariants violated · 24 states, 261 steps, 16 labels · state space exhausted · 5 ms
baseline: reachgate.baseline.json (16 labels, 2 invariants incl. built-in no-crash)
[exit 0]
```

(My first `git commit` failed because the container has no git identity, a sandbox issue. I set a local user.name/email and committed: `6e42042 approval workflow + reachgate baseline`.)

### behaviour-removing change, then check

A plausible refactor slip: `requestChanges` checks the old status name `'submitted'`, so "changes requested" can never happen. No invariant breaks.

```console
$ git diff src/
diff --git a/src/approval.js b/src/approval.js
index 8d1ded2..c3bf968 100644
--- a/src/approval.js
+++ b/src/approval.js
@@ -23,7 +23,7 @@ export function approve(doc, reviewer) {
 }
 
 export function requestChanges(doc, reviewer) {
-  if (doc.status !== 'in-review') return 'invalid';
+  if (doc.status !== 'submitted') return 'invalid';
   if (reviewer === doc.author) return 'forbidden';
   doc.status = 'changes-requested';
   doc.revision += 1;
[exit 0]
```

```console
$ reachgate check
# reachgate check: doc-approval

**FAIL: 1 label(s) no longer reachable.**

Before: 24 states (exhaustive). After: 6 states (exhaustive). Failing on: lost, violation.

## No longer reachable (1)

- `status:changes-requested`: the baseline witness still replays all 2 step(s), but "status:changes-requested" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: alice submit → bob requestChanges (`.reachgate/witnesses/lost_status_changes-requested.json`)

## What to do

1. Replay a witness to see the regression step by step: `reachgate replay ./reachgate.target.mjs <witness file>` (files listed above).
2. If the change in behaviour is a bug, fix the code and run `reachgate check` again.
3. If it is intended (a feature removed on purpose), say why in the PR and run `reachgate baseline` to accept it.

[exit 1]
```

Exit 1 with a clear explanation: the lost label, its baseline witness, and the fact that the witness still replays but the label no longer shows up. `.reachgate/diff.md` has the same content. Replaying the lost witness:

```console
$ reachgate replay .reachgate/witnesses/lost_status_changes-requested.json
replaying 2 step(s) on doc-approval
  0. initial()
       + status:draft
  1. alice submit
       + status:in-review
  2. bob requestChanges
NOT REACHED: the trace replays, but status:changes-requested is not reached along it (the baseline witness still replays all 2 step(s), but "status:changes-requested" no longer shows up anywhere along it: the code behaves differently on the same steps)
[exit 1]
```

### revert, then check passes

```console
$ git checkout -- src/approval.js && git status --short
[exit 0]
```

```console
$ reachgate check
# reachgate check: doc-approval

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 24 states (exhaustive). After: 24 states (exhaustive). Failing on: lost, violation.

## What to do

Nothing. If labels were added on purpose, run `reachgate baseline` to record them.

[exit 0]
```

### check --require-exhaustive

```console
$ reachgate check --require-exhaustive
# reachgate check: doc-approval

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 24 states (exhaustive). After: 24 states (exhaustive). Failing on: lost, violation.

## What to do

Nothing. If labels were added on purpose, run `reachgate baseline` to record them.

[exit 0]
```

I also checked that the flag bites when the budget is too small:

```console
$ reachgate check --require-exhaustive --max-steps 50
# reachgate check: doc-approval

**INCOMPLETE: nothing got worse in the states searched, but --require-exhaustive is set and the search stopped on the steps budget, so this is not a pass (exit 3).**

Before: 24 states (exhaustive). After: 8 states. Failing on: lost, violation.

## What to do

Bound the scenario (smaller value domains) or raise the budget until the report says "exhaustive", or drop --require-exhaustive if a partial search is acceptable here.
warning: --require-exhaustive: the search stopped on the steps budget after 8 states, so not every reachable state was checked. Bound the scenario or raise the budget.

[exit 3]
```

## Python

Fresh directory `~/thermo`: a **thermostat controller** (heater + A/C, modes off/heat/cool/auto). **Planted bug:** `set_mode` only clears the outputs on `off`, so switching from heat to cool leaves the heater running, and the next tick turns the A/C on as well.

```console
$ reachgate init --lang python
wrote reachgate_target.py, reachgate_adapter.py, reachgate.config.json
next:
  1. edit reachgate_target.py: point initial/affordances/step at your code, add invariants
  2. reachgate inspect        check the wiring
  3. reachgate explore        find violations
  4. reachgate baseline       record behaviour (commit reachgate.baseline.json; add .reachgate/ to .gitignore)
  5. reachgate check          after every change: the gate
[exit 0]
```

```console
$ ls; cat reachgate.config.json
reachgate.config.json
reachgate_adapter.py
reachgate_target.py
{
  "target": "./reachgate_target.py",
  "strategy": "bfs",
  "maxSteps": 200000,
  "maxStates": 100000,
  "baseline": "reachgate.baseline.json",
  "out": ".reachgate"
}
[exit 0]
```

The starter Python target (a toy door) runs out of the box, and its seeded bug is found:

```console
$ reachgate explore
FAIL: 1 invariant violated · 4 states, 5 steps, 7 labels · state space exhausted · 3 ms
  ✗ open-door-is-unlocked: the door is open and locked
    witness (2 steps, shortest): open → lock
    replay: reachgate replay ./reachgate_target.py .reachgate/witnesses/open-door-is-unlocked.json
report: .reachgate/report.md
[exit 1]
```

My code, with the planted bug shown in the original `set_mode`:

```python
def set_mode(t, mode):
    t["mode"] = mode
    if mode == "off":          # BUG: switching heat -> cool leaves the heater on
        t["heater"] = False
        t["cooler"] = False
```

`~/thermo/reachgate_target.py`:

```python
"""reachgate target for the thermostat controller."""
from reachgate_adapter import serve
from thermostat import new_thermostat, set_mode, tick

TEMP_MIN, TEMP_MAX = 16, 24  # bound the scenario


def affordances(s):
    acts = [{"type": "tick"}]
    acts += [{"type": "mode", "mode": m} for m in ("off", "heat", "cool", "auto") if m != s["mode"]]
    if s["temp"] < TEMP_MAX:
        acts.append({"type": "warmer"})  # environment: the room warms by 1 degree
    if s["temp"] > TEMP_MIN:
        acts.append({"type": "colder"})
    return acts


def step(s, a):
    if a["type"] == "tick":
        tick(s)
    elif a["type"] == "mode":
        set_mode(s, a["mode"])
    elif a["type"] == "warmer":
        s["temp"] += 1
    elif a["type"] == "colder":
        s["temp"] -= 1
    return s


serve(
    name="thermostat",
    initial=lambda: new_thermostat(),
    affordances=affordances,
    step=step,
    invariants={
        "never-heat-and-cool": lambda s: not (s["heater"] and s["cooler"]) or "heater and A/C are both on",
        "off-means-off": lambda s: s["mode"] != "off" or not (s["heater"] or s["cooler"]) or "mode is off but something is running",
    },
    observe=lambda s: [f"mode:{s['mode']}"] + (["heating"] if s["heater"] else []) + (["cooling"] if s["cooler"] else []),
    label=lambda a: f"mode {a['mode']}" if a["type"] == "mode" else a["type"],
)
```

```console
$ reachgate inspect
target: thermostat (adapter: python3 /home/tester/thermo/reachgate_target.py)
invariants: never-heat-and-cool, off-means-off
deadlock detection: off (define is_terminal (Python helper) or report terminal in visit to turn it on)
initial state: {"cooler":false,"heater":false,"mode":"off","setpoint":20,"temp":20}
  hash xo91IGCLDmLlBELyKwukPh0BVHg
  labels: mode:off
  violations: none
  6 action(s):
    tick  →  same state
    mode heat  →  new state
    mode cool  →  new state
    mode auto  →  new state
    warmer  →  new state
    colder  →  new state
[exit 0]
```

```console
$ reachgate explore
FAIL: 1 invariant violated · 98 states, 520 steps, 13 labels · state space exhausted · 39 ms
  ✗ never-heat-and-cool: heater and A/C are both on
    witness (7 steps, shortest): mode heat → colder → tick → mode cool → warmer → warmer → tick
    replay: reachgate replay ./reachgate_target.py .reachgate/witnesses/never-heat-and-cool.json
warning: 8 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
[exit 1]
```

Found: a 7-step shortest witness (heat on, switch to cool, warm up, tick: both running).

```console
$ reachgate replay .reachgate/witnesses/never-heat-and-cool.json
replaying 7 step(s) on thermostat (recorded violation: never-heat-and-cool)
  0. initial()
       + mode:off
  1. mode heat
       + mode:heat
  2. colder
  3. tick
       + heating
  4. mode cool
       + mode:cool
  5. warmer
  6. warmer
  7. tick
       + cooling
       ✗ never-heat-and-cool: heater and A/C are both on
REPRODUCED: never-heat-and-cool at step 7
[exit 0]
```

Fixed `set_mode` (clear any output the new mode does not drive), then:

```console
$ reachgate explore
PASS: 0 invariants violated · 72 states, 416 steps, 13 labels · state space exhausted · 126 ms
report: .reachgate/report.md
[exit 0]
```

```console
$ reachgate replay .reachgate/witnesses/previous/never-heat-and-cool.json
replaying 7 step(s) on thermostat (recorded violation: never-heat-and-cool)
  0. initial()
       + mode:off
  1. mode heat
       + mode:heat
  2. colder
  3. tick
       + heating
  4. mode cool
       + mode:cool
  5. warmer
  6. warmer
  7. tick
       + cooling
NOT REPRODUCED: the trace replays, but never-heat-and-cool no longer happens (fixed?)
[exit 1]
```

## Friction and suggestions

Nothing blocked me. Every step in the README and the guide worked the first time, and the outputs had the shape the docs show. In rough order of importance:

1. **Unbounded state hit me first, but the docs caught it.** My first real explore said `stopped by steps budget` because a revision counter grows forever. The guide's "Bound the scenario" section says exactly what to do, and the fix took one line. Suggestion: when a run stops on a budget, the summary could name the state fields whose values keep growing (or point to the guide section). A newcomer who only read the README Quickstart might not connect "stopped by steps budget" with "your counter is unbounded".
2. **ESM in `src/*.js` without a package.json.** The guide's example imports `./src/vending.js`, which uses `export`, and never mentions `"type": "module"`. I copied that pattern (no package.json) and it worked silently on Node 22. The README claims support for "Node.js 20 or newer". I could not test Node 20 here, but older Node 20 releases may refuse ESM syntax in a `.js` file with no `"type": "module"`. A one-line note in the guide ("if your code is ESM `.js`, make sure package.json has `\"type\": \"module\"`") would remove the doubt.
3. **The warning about unexpanded violating states was missing when I expected it.** The guide says: "While a violation is open, the other invariants are only checked on the states that don't violate anything, and reachgate prints a warning saying so." In my doc-approval run (1 violation open) no such warning printed. In the Quickstart and the Python run it did. This is probably correct (the violating state's successors may all be already-seen states), but the doc reads as if the warning always appears.
4. **Two replay spellings.** The guide uses `reachgate replay .reachgate/witnesses/money-conserved.json` (no target), but explore prints `reachgate replay ./reachgate.target.mjs <file>`. Both work (the target comes from the config). A short sentence saying the target argument is optional when a config exists would help.
5. **Minor wording.** On a PASS, `check` says "If labels were added on purpose, run `reachgate baseline` to record them" even when no labels were added. It could say "No new labels." in that case.
6. **Sandbox only, not reachgate:** `git commit` needs a git identity. Also, I could not test the `npm install -g github:vulbsti/reachgate` form itself (no GitHub access). The clone-and-install form from the README worked.

What worked especially well: `inspect` (showing "new state / same state" per action makes wiring mistakes obvious), shortest witnesses that read like a bug report, `witnesses/previous/` for confirming a fix, and the `check` diff explaining *why* a label is lost (the witness still replays, but the label no longer appears). The Python helper needed no installation at all.

## Verdict

**PASS.** Tasks 1 to 4 were done using only the README and the linked 15-minute guide, with no outside help, at commit `cc7a138`. Install worked, and the Quickstart matched the README apart from timing. In my JS project, explore found the planted bug, replay showed it, and after the fix the previous witness did not reproduce. `check` exited 1 with a clear explanation after a behaviour-removing change and 0 after the revert, and `--require-exhaustive` passed (it also exits 3 when the budget is too small). In Python, `init --lang python` worked and explore found the planted bug.
