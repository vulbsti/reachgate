# reachgate: fresh-user transcript

Everything below was run inside container `rg-fresh4` as user `tester`. Every command block was
captured by a small wrapper (`~/rec`) that prints `<cwd> $ <command>`, the combined stdout+stderr,
and the exit code. Outputs are pasted, not retyped. Timings differ from the docs and are ignored.

## Setup

Cloned the mirror (`git clone /srv/reachgate.git ~/reachgate`) and read README.md.

```console
~ $ git -C ~/reachgate log -1 --format="%h %s"
d3ab4e3 Local CI evidence on the current commit
[exit 0]
```

```console
~ $ node --version
v20.20.2
[exit 0]
```

- Commit: **d3ab4e3 Local CI evidence on the current commit**
- Node: **v20.20.2** (npm global prefix is user-owned: `~/.npm-global`), Python 3.11.2

## Install

The README says `npm install -g github:vulbsti/reachgate`. No GitHub access in the sandbox, so I used
the README's own clone form: "Or from a clone: `git clone https://github.com/vulbsti/reachgate && npm
install -g ./reachgate`" with the mirror substituted.

```console
~ $ npm install -g ./reachgate

added 1 package in 187ms
[exit 0]
```

```console
~ $ which reachgate && reachgate --version
/home/tester/.npm-global/bin/reachgate
0.1.0
[exit 0]
```

```console
~ $ ls -l $(npm root -g)
total 0
lrwxrwxrwx 1 tester tester 18 Nov  6 01:29 reachgate -> ../../../reachgate
[exit 0]
```

As the README warns, the global install is a symlink to the clone ("That links the clone, so keep it"). Install: OK.

## Quickstart

Run from the clone, exactly as in the README, then the `replay:` line it prints.

```console
~/reachgate $ reachgate explore examples/dungeon/target.mjs
FAIL: 1 invariant violated · 10772 states, 35881 steps, 18 labels · state space exhausted · 620 ms
  ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
    witness (13 steps, shortest): down → right → right → right → right → right → right → up → right → down → down → up → wait
    replay: reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
warning: 16 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
[exit 1]
```

```console
~/reachgate $ reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
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

Comparison with the README: the summary line (10772 states, 35881 steps, 18 labels, state space
exhausted), the violation message, the 13-step witness, the replay hint, the warning and the
`report:` line all match exactly; only the timing differs (620 ms vs 505 ms). Exit code 1, as the
exit-code table says. The replay reproduces at step 13. `.reachgate/` in the clone is gitignored
(`git status` stayed clean).

## The 15-minute guide

Fresh directory `~/vending`, `git init`. I pasted `src/vending.js` from section 0 (only change: my
shell quoting forced double-quoted strings, e.g. `"sold out"`, which does not change behaviour).

About ES modules, the guide says: "It's an ES module, so the project's `package.json` has `"type":
"module"`. Without that, name the file `vending.mjs`: Node 22 detects ES module syntax in `.js` files
on its own, but Node 20 does not." I first ran without a package.json out of curiosity (below), then
followed the guide and added `package.json` with `"type": "module"`.

```console
~/vending $ reachgate init
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
~/vending $ reachgate explore   # on the scaffolded toy door target, guide says it fails
FAIL: 1 invariant violated · 4 states, 5 steps, 7 labels · state space exhausted · 1 ms
  ✗ open-door-is-unlocked: the door is open and locked
    witness (2 steps, shortest): open → lock
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/open-door-is-unlocked.json
report: .reachgate/report.md
[exit 1]
```

```console
~/vending $ reachgate inspect   # BEFORE adding package.json (Node 20, src/vending.js is ESM)
target: vending (in-process: ./reachgate.target.mjs)
invariants: money-conserved, stock-non-negative
deadlock detection: off (define isTerminal to turn it on)
initial state: {"inserted":0,"m":{"cashbox":0,"credit":0,"dispensed":[],"returned":0,"stock":{"chips":2,"cola":1}}}
  hash QpL9RsiledAyblPloAqHZUj3aRA
  labels: (none: add observe(state) to name behaviour for the baseline)
  violations: none
  4 action(s):
    insert 50  →  new state
    insert 100  →  new state
    select cola  →  same state
    select chips  →  same state
[exit 0]
```

```console
~/vending $ node --input-type=module -e "import(\"./src/vending.js\").then(m=>console.log(Object.keys(m)))"
[ 'PRICES', 'createMachine', 'insert', 'refund', 'select' ]
[exit 0]
```

```console
~/vending $ cat package.json
{
  "name": "vending",
  "private": true,
  "type": "module"
}
[exit 0]
```

```console
~/vending $ reachgate inspect
target: vending (in-process: ./reachgate.target.mjs)
invariants: money-conserved, stock-non-negative
deadlock detection: off (define isTerminal to turn it on)
initial state: {"inserted":0,"m":{"cashbox":0,"credit":0,"dispensed":[],"returned":0,"stock":{"chips":2,"cola":1}}}
  hash QpL9RsiledAyblPloAqHZUj3aRA
  labels: (none: add observe(state) to name behaviour for the baseline)
  violations: none
  4 action(s):
    insert 50  →  new state
    insert 100  →  new state
    select cola  →  same state
    select chips  →  same state
[exit 0]
```

```console
~/vending $ reachgate explore
FAIL: 1 invariant violated · 118 states, 224 steps, 8 labels · state space exhausted · 6 ms
  ✗ money-conserved: inserted 100, but cashbox 100 + credit 100 + returned 0 = 200
    witness (2 steps, shortest): insert 100 → select chips
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/money-conserved.json
warning: 64 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
[exit 1]
```

```console
~/vending $ reachgate replay .reachgate/witnesses/money-conserved.json
replaying 2 step(s) on vending (recorded violation: money-conserved)
  0. initial()
  1. insert 100
  2. select chips
       + dispensed:chips
       ✗ money-conserved: inserted 100, but cashbox 100 + credit 100 + returned 0 = 200
REPRODUCED: money-conserved at step 2
[exit 0]
```

```console
~/vending $ sed -n 10,20p src/vending.js   # after the fix
export function select(m, item) {
  const price = PRICES[item];
  if (m.stock[item] === 0) return "sold out";
  if (m.credit < price) return "insert more";
  m.stock[item] -= 1;
  m.cashbox += price;
  m.dispensed.push(item);
  m.returned += m.credit - price; // give change
  m.credit = 0;
  return "enjoy";
}
[exit 0]
```

```console
~/vending $ reachgate explore
PASS: 0 invariants violated · 179 states, 681 steps, 8 labels · state space exhausted · 11 ms
report: .reachgate/report.md
[exit 0]
```

```console
~/vending $ ls .reachgate/witnesses/ .reachgate/witnesses/previous/
.reachgate/witnesses/:
previous

.reachgate/witnesses/previous/:
money-conserved.json
[exit 0]
```

```console
~/vending $ reachgate replay .reachgate/witnesses/previous/money-conserved.json
replaying 2 step(s) on vending (recorded violation: money-conserved)
  0. initial()
  1. insert 100
  2. select chips
       + dispensed:chips
NOT REPRODUCED: the trace replays, but money-conserved no longer happens (fixed?)
[exit 1]
```

```console
~/vending $ reachgate baseline
PASS: 0 invariants violated · 179 states, 681 steps, 8 labels · state space exhausted · 15 ms
baseline: reachgate.baseline.json (8 labels, 3 invariants incl. built-in no-crash)
[exit 0]
```

```console
~/vending $ git diff
diff --git a/src/vending.js b/src/vending.js
index f522880..622e025 100644
--- a/src/vending.js
+++ b/src/vending.js
@@ -9,7 +9,7 @@ export function insert(m, coin) {
 }
 export function select(m, item) {
   const price = PRICES[item];
-  if (m.stock[item] === 0) return "sold out";
+  if (m.stock[item] <= 1) return "sold out"; // keep one for display
   if (m.credit < price) return "insert more";
   m.stock[item] -= 1;
   m.cashbox += price;
[exit 0]
```

```console
~/vending $ reachgate check
# reachgate check: vending

**FAIL: 2 label(s) no longer reachable.**

Before: 179 states (exhaustive). After: 89 states (exhaustive). Failing on: lost, violation.

## No longer reachable (2)

- `dispensed:cola`: the baseline witness still replays all 3 step(s), but "dispensed:cola" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: insert 50 → insert 100 → select cola (`.reachgate/witnesses/lost_dispensed_cola.json`)
- `sold-out:cola`: the baseline witness still replays all 3 step(s), but "sold-out:cola" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: insert 50 → insert 100 → select cola (`.reachgate/witnesses/lost_sold-out_cola.json`)

## What to do

1. Replay a witness to see the regression step by step: `reachgate replay ./reachgate.target.mjs <witness file>` (files listed above).
2. If the change in behaviour is a bug, fix the code and run `reachgate check` again.
3. If it is intended (a feature removed on purpose), say why in the PR and run `reachgate baseline` to accept it.
[exit 1]
```

```console
~/vending $ reachgate check   # after reverting the display change
# reachgate check: vending

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 179 states (exhaustive). After: 179 states (exhaustive). Failing on: lost, violation.

## What to do

Nothing.
[exit 0]
```


Comparison with the guide's pasted outputs (timings ignored):

| Step | Guide | Mine | Match |
| --- | --- | --- | --- |
| `init` | wrote reachgate.target.mjs, reachgate.config.json + 5 next steps | identical | yes |
| toy target fails | "`reachgate explore` on it fails" | FAIL, `open → lock`, exit 1 | yes |
| `inspect` | first two lines, then `...` | first two lines identical; rest not pasted in the guide | yes (partial paste) |
| `explore` (bug) | 118 states, 224 steps, 8 labels; `insert 100 → select chips`; warning 64 states | identical | yes |
| `replay` | REPRODUCED at step 2 | identical | yes |
| `explore` (fixed) | PASS 179 states, 681 steps, 8 labels | identical (+ a `report:` line the guide omits) | yes |
| replay previous | "NOT REPRODUCED: ... (fixed?)" and exits 1 | identical, exit 1 | yes |
| `baseline` | 179 states; 8 labels, 3 invariants incl. built-in no-crash | identical | yes |
| `check` after "keep one for display" | FAIL 2 labels lost, 179 -> 89 states, `dispensed:cola` witness `insert 50 → insert 100 → select cola` | identical; `sold-out:cola` entry (elided as `...` in the guide) is the same shape; plus a "What to do" section | yes |

Extra (not in guide): reverting the display change gives `check` PASS with exit 0.
Side note: `git commit` failed the first time only because the sandbox had no git identity; not a reachgate issue.

## Wiring my own project

An **order-fulfilment state machine** (`~/orders`). The app module is **CommonJS** (no `"type": "module"`)
to try the guide's claim that "A CommonJS project can `import` its `require`-style modules from the
target as usual". The customer can pay and cancel; the warehouse (environment) packs two items and
ships any complete box. Planted bug: `ship()` only checks that the box is complete, not that the order
was cancelled, so a cancelled and refunded order can still ship. I also defined `isTerminal` to turn on
deadlock detection.

`src/orders.js` (as written, before the fix):

```js
function ship(o) {
  if (o.packed !== o.items) return "box not complete"; // BUG: ignores a cancellation
  o.shipped = true;
  o.status = "shipped";
  return "ok";
}
function cancel(o) {
  if (["shipped", "delivered", "cancelled"].includes(o.status)) return "too late";
  if (o.paid) o.refunded = true;
  o.status = "cancelled";
  return "ok";
}
```

```console
~/orders $ reachgate init
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
~/orders $ cat reachgate.target.mjs
// Drives the real CommonJS order module from an ES-module target.
import orders from "./src/orders.js";
const { createOrder, pay, packItem, ship, deliver, cancel } = orders;

const done = (o) => ["shipped", "delivered", "cancelled"].includes(o.status);

/** @type {import("reachgate").Target} */
export default {
  name: "order-fulfilment",
  initial: () => createOrder(2),
  // Customer actions plus the warehouse (the environment): the warehouse ships any complete box it sees.
  affordances: (o) => [
    ...(o.status === "placed" ? [{ type: "pay" }] : []),
    ...(o.status === "paid" || o.status === "packing" ? [{ type: "pack" }] : []),
    ...(o.packed === o.items && o.status !== "shipped" && o.status !== "delivered" ? [{ type: "ship" }] : []),
    ...(o.status === "shipped" ? [{ type: "deliver" }] : []),
    ...(!done(o) ? [{ type: "cancel" }] : []),
  ],
  step: (o, a) => {
    ({ pay, pack: packItem, ship, deliver, cancel })[a.type](o);
    return o;
  },
  invariants: {
    "no-goods-for-free": (o) => !(o.shipped && o.refunded) || `order was refunded and shipped (status ${o.status})`,
    "ship-only-paid": (o) => !o.shipped || o.paid || "shipped an unpaid order",
    "packed-within-items": (o) => o.packed <= o.items,
  },
  isTerminal: (o) => o.status === "delivered" || o.status === "cancelled",
  observe: (o) => [`status:${o.status}`, ...(o.refunded ? ["refunded"] : [])],
  label: (a) => a.type,
};
[exit 0]
```

```console
~/orders $ reachgate inspect
target: order-fulfilment (in-process: ./reachgate.target.mjs)
invariants: no-goods-for-free, ship-only-paid, packed-within-items
deadlock detection: on (isTerminal is defined)
initial state: {"items":2,"packed":0,"paid":false,"refunded":false,"shipped":false,"status":"placed"}
  hash rKP9p49eidCwz2Qwe2jDSQMekoQ
  labels: status:placed
  violations: none
  2 action(s):
    pay  →  new state
    cancel  →  new state
[exit 0]
```

```console
~/orders $ reachgate explore
FAIL: 1 invariant violated · 11 states, 10 steps, 13 labels · state space exhausted · 4 ms
  ✗ no-goods-for-free: order was refunded and shipped (status shipped)
    witness (5 steps, shortest): pay → pack → pack → cancel → ship
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/no-goods-for-free.json
warning: 1 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
[exit 1]
```

```console
~/orders $ reachgate replay .reachgate/witnesses/no-goods-for-free.json
replaying 5 step(s) on order-fulfilment (recorded violation: no-goods-for-free)
  0. initial()
       + status:placed
  1. pay
       + status:paid
  2. pack
       + status:packing
  3. pack
       + status:packed
  4. cancel
       + status:cancelled
       + refunded
  5. ship
       + status:shipped
       ✗ no-goods-for-free: order was refunded and shipped (status shipped)
REPRODUCED: no-goods-for-free at step 5
[exit 0]
```

```console
~/orders $ grep -n "shippable" src/orders.js   # the fix
19:  if (o.status !== "packed") return "not shippable"; // fixed: a cancelled box stays put
[exit 0]
```

```console
~/orders $ reachgate explore
PASS: 0 invariants violated · 10 states, 10 steps, 13 labels · state space exhausted · 1 ms
report: .reachgate/report.md
[exit 0]
```

```console
~/orders $ reachgate replay .reachgate/witnesses/previous/no-goods-for-free.json
replaying 5 step(s) on order-fulfilment (recorded violation: no-goods-for-free)
  0. initial()
       + status:placed
  1. pay
       + status:paid
  2. pack
       + status:packing
  3. pack
       + status:packed
  4. cancel
       + status:cancelled
       + refunded
  5. ship
NOT REPRODUCED: the trace replays, but no-goods-for-free no longer happens (fixed?)
[exit 1]
```

```console
~/orders $ reachgate baseline
PASS: 0 invariants violated · 10 states, 10 steps, 13 labels · state space exhausted · 1 ms
baseline: reachgate.baseline.json (13 labels, 5 invariants incl. built-in no-crash)
[exit 0]
```

```console
~/orders $ git add -A && git commit -qm "orders + reachgate baseline" && git log --oneline
67e2eb8 orders + reachgate baseline
[exit 0]
```

```console
~/orders $ cat reachgate.baseline.json | head -40
{
 "reachgate": 1,
 "tool": "0.1.0",
 "target": "order-fulfilment",
 "options": {
  "strategy": "bfs",
  "seed": 1,
  "maxSteps": 200000,
  "maxStates": 100000,
  "maxSeconds": 120,
  "maxDepth": null
 },
 "stats": {
  "states": 10,
  "steps": 10,
  "exhaustive": true,
  "stoppedBy": "exhausted"
 },
 "invariants": {
  "deadlock": "holds",
  "no-crash": "holds",
  "no-goods-for-free": "holds",
  "packed-within-items": "holds",
  "ship-only-paid": "holds"
 },
 "labels": {
  "action:cancel": [],
  "action:deliver": [
   {
    "type": "pay"
   },
   {
    "type": "pack"
   },
   {
    "type": "pack"
   },
   {
    "type": "ship"
   }
[exit 0]
```

```console
~/orders $ git diff
diff --git a/src/orders.js b/src/orders.js
index b73a969..541c59f 100644
--- a/src/orders.js
+++ b/src/orders.js
@@ -27,7 +27,7 @@ function deliver(o) {
   return "ok";
 }
 function cancel(o) {
-  if (["shipped", "delivered", "cancelled"].includes(o.status)) return "too late";
+  if (o.status !== "placed") return "too late"; // simplify: no cancelling once paid
   if (o.paid) o.refunded = true;
   o.status = "cancelled";
   return "ok";
[exit 0]
```

```console
~/orders $ reachgate check
# reachgate check: order-fulfilment

**FAIL: 1 label(s) no longer reachable.**

Before: 10 states (exhaustive). After: 7 states (exhaustive). Failing on: lost, violation.

## No longer reachable (1)

- `refunded`: the baseline witness still replays all 2 step(s), but "refunded" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: pay → cancel (`.reachgate/witnesses/lost_refunded.json`)

## What to do

1. Replay a witness to see the regression step by step: `reachgate replay ./reachgate.target.mjs <witness file>` (files listed above).
2. If the change in behaviour is a bug, fix the code and run `reachgate check` again.
3. If it is intended (a feature removed on purpose), say why in the PR and run `reachgate baseline` to accept it.
[exit 1]
```

```console
~/orders $ reachgate replay .reachgate/witnesses/lost_refunded.json
replaying 2 step(s) on order-fulfilment
  0. initial()
       + status:placed
  1. pay
       + status:paid
  2. cancel
NOT REACHED: the trace replays, but refunded is not reached along it (the baseline witness still replays all 2 step(s), but "refunded" no longer shows up anywhere along it: the code behaves differently on the same steps)
[exit 1]
```

```console
~/orders $ git checkout src/orders.js && git status --short && reachgate check
Updated 1 path from the index
# reachgate check: order-fulfilment

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 10 states (exhaustive). After: 10 states (exhaustive). Failing on: lost, violation.

## What to do

Nothing.
[exit 0]
```

```console
~/orders $ reachgate check --quiet --require-exhaustive; echo "exit=$?"
# reachgate check: order-fulfilment

**PASS: nothing reachable was lost and no invariant got worse than the baseline.**

Before: 10 states (exhaustive). After: 10 states (exhaustive). Failing on: lost, violation.

## What to do

Nothing.

exit=0
[exit 0]
```


All steps behaved as documented: CommonJS import worked; BFS found the 5-step shortest witness
`pay → pack → pack → cancel → ship`; replay reproduced it (exit 0); after the fix the previous witness
reported NOT REPRODUCED (exit 1); baseline recorded 13 labels; a behaviour-removing "simplification"
(no cancelling once paid) broke no invariant but `check` failed with exit 1 naming `refunded` as lost,
with a 2-step witness; `replay` of the lost-label witness explains it (NOT REACHED, exit 1); reverting
gave `check` exit 0 (also with `--quiet --require-exhaustive`, the CI line from the guide).

## Python

Fresh directory `~/ratelimit`. A **sliding-window rate limiter** (`app/limiter.py`: at most 3 accepted
requests in any 4 ticks; the clock is passed in, state is a JSON dict). Planted off-by-one: `<=`
instead of `<`. The target keeps a ghost list of accepted times and bounds the scenario to 6 ticks.

My first attempt had a typo of my own in the invariant (shell quoting stripped the quotes in
`lim['window']`). That run is kept because reachgate's report was useful: it said the invariant
itself threw, with the Python exception, rather than reporting a fake violation.

```console
~/ratelimit $ reachgate init --lang python
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
~/ratelimit $ reachgate inspect
target: rate-limiter (adapter: python3 /home/tester/ratelimit/reachgate_target.py)
invariants: within-limit
deadlock detection: off (define is_terminal (Python helper) or report terminal in visit to turn it on)
initial state: {"accepted":[],"lim":{"hits":[],"limit":3,"window":4},"now":0}
  hash nsaSy_PRZ4dTiYx2jT8wLOxrKmE
  labels: (none: add observe(state) to name behaviour for the baseline)
  violations: none
  2 action(s):
    request  →  new state
    tick  →  new state
[exit 0]
```

```console
~/ratelimit $ reachgate explore
FAIL: 1 invariant violated · 1028 states, 1027 steps, 3 labels · state space exhausted · 363 ms
  ✗ within-limit: the invariant itself threw: NameError("name 'window' is not defined")
    witness (4 steps, shortest): request → request → request → request
    replay: reachgate replay ./reachgate_target.py .reachgate/witnesses/within-limit.json
report: .reachgate/report.md
[exit 1]
```

```console
~/ratelimit $ cat reachgate_target.py app/limiter.py
"""reachgate target for app.limiter (sliding-window rate limiter)."""
from reachgate_adapter import serve

from app.limiter import allow, new_limiter

HORIZON = 6  # bound the scenario: explore the first 6 ticks


def initial():
    # The limiter does not keep a history of what it accepted, so the target keeps a ghost list.
    return {"lim": new_limiter(limit=3, window=4), "now": 0, "accepted": []}


def affordances(s):
    acts = [{"type": "request"}]
    if s["now"] < HORIZON:
        acts.append({"type": "tick"})
    return acts


def step(s, a):
    if a["type"] == "tick":
        s["now"] += 1
    elif a["type"] == "request":
        if allow(s["lim"], s["now"]):
            s["accepted"].append(s["now"])
    return s


def within_limit(s):
    limit, window = s["lim"]["limit"], s["lim"]["window"]
    for t in s["accepted"]:
        n = sum(1 for u in s["accepted"] if t - window < u <= t)
        if n > limit:
            return f"{n} requests accepted in the {window}-tick window ending at tick {t} (limit {limit})"
    return True


serve(
    name="rate-limiter",
    initial=initial,
    affordances=affordances,
    step=step,
    invariants={"within-limit": within_limit},
    observe=lambda s: ["at-limit"] if len(s["lim"]["hits"]) >= s["lim"]["limit"] else [],
    label=lambda a: a["type"],
)
"""Sliding-window rate limiter: at most `limit` accepted requests in any `window` ticks.
State is a plain dict so it can be stored in Redis/JSON; the clock is passed in."""


def new_limiter(limit=3, window=4):
    return {"limit": limit, "window": window, "hits": []}


def allow(lim, now):
    lim["hits"] = [t for t in lim["hits"] if now - t < lim["window"]]
    if len(lim["hits"]) <= lim["limit"]:  # BUG: should be <
        lim["hits"].append(now)
        return True
    return False
[exit 0]
```

```console
~/ratelimit $ reachgate explore
FAIL: 1 invariant violated · 1028 states, 1027 steps, 3 labels · state space exhausted · 299 ms
  ✗ within-limit: 4 requests accepted in the 4-tick window ending at tick 0 (limit 3)
    witness (4 steps, shortest): request → request → request → request
    replay: reachgate replay ./reachgate_target.py .reachgate/witnesses/within-limit.json
report: .reachgate/report.md
[exit 1]
```

```console
~/ratelimit $ reachgate replay .reachgate/witnesses/within-limit.json
replaying 4 step(s) on rate-limiter (recorded violation: within-limit)
  0. initial()
  1. request
  2. request
  3. request
       + at-limit
  4. request
       ✗ within-limit: 4 requests accepted in the 4-tick window ending at tick 0 (limit 3)
REPRODUCED: within-limit at step 4
[exit 0]
```

```console
~/ratelimit $ reachgate explore
PASS: 0 invariants violated · 706 states, 1027 steps, 3 labels · state space exhausted · 264 ms
report: .reachgate/report.md
[exit 0]
```

```console
~/ratelimit $ reachgate replay .reachgate/witnesses/previous/within-limit.json
replaying 4 step(s) on rate-limiter (recorded violation: within-limit)
  0. initial()
  1. request
  2. request
  3. request
       + at-limit
  4. request
NOT REPRODUCED: the trace replays, but within-limit no longer happens (fixed?)
[exit 1]
```

```console
~/ratelimit $ reachgate baseline
PASS: 0 invariants violated · 706 states, 1027 steps, 3 labels · state space exhausted · 310 ms
baseline: reachgate.baseline.json (3 labels, 2 invariants incl. built-in no-crash)
[exit 0]
```


`explore` found the bug through the Python adapter: shortest witness `request → request → request →
request` (4 accepted at tick 0, limit 3), exit 1; replay reproduced it; after the fix the old witness is
NOT REPRODUCED and the run is exhaustive (706 states).

## Friction and suggestions

1. **Node 20 statement in the guide is out of date for current Node 20.** The guide says "Node 22
   detects ES module syntax in `.js` files on its own, but Node 20 does not." On Node v20.20.2 an ESM
   `src/vending.js` with no package.json worked fine (both `reachgate inspect` and plain `node`
   imported it). Suggest: "Node versions before 20.19 do not". Harmless, since following the guide
   (adding `"type": "module"`) also works.
2. **The `.mjs` alternative is incomplete.** "Without that, name the file `vending.mjs`" does not say the
   target's `import ... from './src/vending.js'` must change too. Tried in a scratch copy
   (`/tmp/mjs-try`, `mv src/vending.js src/vending.mjs`, nothing else changed):

   ```console
   /tmp/mjs-try $ reachgate inspect
   reachgate: could not measure: could not import /tmp/mjs-try/reachgate.target.mjs: Cannot find module '/tmp/mjs-try/src/vending.js' imported from /tmp/mjs-try/reachgate.target.mjs
   exit=3
   ```
   The error is clear, but the guide should say "...and import `./src/vending.mjs`".
3. **`inspect` gives a misleading hint when `observe` is defined.** Both the vending and rate-limiter
   targets define `observe`, but `inspect` printed `labels: (none: add observe(state) to name
   behaviour for the baseline)` because `observe` returns `[]` in the initial state. Suggest
   "(none in the initial state)" when the hook exists.
4. **The guide's `inspect` paste is cut off with `...`**, though the guide says "Every output below is
   pasted from a real run". You can't check the rest (deadlock line, initial state, the 4 actions) against
   anything. The full output is short enough to paste.
5. Minor: the guide's `explore` PASS paste omits the `report: .reachgate/report.md` line that is
   printed. `--quiet` still prints the full Markdown summary for `check`. That is documented
   ("The summary still prints"), but it surprised me in a CI context.
6. Install: only the "from a clone" form could be tested here (no GitHub). It worked and links the
   clone, as the README says.

Nothing blocked me. The error messages (invariant threw, NOT REPRODUCED / NOT REACHED with reasons)
were clear enough that I never needed src/ or tests.

## Verdict

**PASS.** I did all five tasks using only the README and docs it links to, with no outside help.
The Quickstart and every pasted output in the 15-minute guide matched mine exactly (timings aside).
The problems above are documentation inaccuracies and one misleading `inspect` hint. None of them
blocked anything.
