# Wire your project in 15 minutes

This guide wires reachgate into an existing project: a small vending-machine controller that has never
heard of reachgate. Every output below is pasted from a real run. Python projects follow the same
steps with `reachgate init --lang python` (see the end).

**You need:** Node.js 20 or newer, and `npm install -g reachgate` (or prefix every command with
`npx reachgate`).

## 0. The code you already have (`src/vending.js`)

```js
export const PRICES = { cola: 150, chips: 100 };

export function createMachine() {
  return { credit: 0, stock: { cola: 1, chips: 2 }, cashbox: 0, dispensed: [], returned: 0 };
}
export function insert(m, coin) {
  if (![50, 100].includes(coin)) throw new Error(`bad coin ${coin}`);
  m.credit += coin;
}
export function select(m, item) {
  const price = PRICES[item];
  if (m.stock[item] === 0) return 'sold out';
  if (m.credit < price) return 'insert more';
  m.stock[item] -= 1;
  m.cashbox += price;
  m.dispensed.push(item);
  m.returned += m.credit - price; // give change
  return 'enjoy';
}
export function refund(m) {
  m.returned += m.credit;
  m.credit = 0;
}
```

## 1. Scaffold (1 minute)

```
$ reachgate init
wrote reachgate.target.mjs, reachgate.config.json
```

`reachgate.target.mjs` contains a working toy target (a door with a lock) that shows each hook. Replace
it with a target that drives your code.

## 2. Describe the code as a target (10 minutes)

A target is a plain object. Keep the hooks thin: they call your real code, and reimplement nothing.

```js
import { createMachine, insert, select, refund } from './src/vending.js';

export default {
  name: 'vending',
  // The machine doesn't count what was inserted, so the target keeps that as a ghost variable.
  initial: () => ({ m: createMachine(), inserted: 0 }),
  affordances: ({ m, inserted }) => [
    // Bound the scenario: at most 400 in coins per session, so the state space is finite.
    ...(inserted < 400 ? [{ type: 'insert', coin: 50 }, { type: 'insert', coin: 100 }] : []),
    { type: 'select', item: 'cola' },
    { type: 'select', item: 'chips' },
    ...(m.credit > 0 ? [{ type: 'refund' }] : []),
  ],
  step: (s, a) => {
    if (a.type === 'insert') { insert(s.m, a.coin); s.inserted += a.coin; }
    if (a.type === 'select') select(s.m, a.item);
    if (a.type === 'refund') refund(s.m);
    return s;
  },
  invariants: {
    'money-conserved': ({ m, inserted }) =>
      m.cashbox + m.credit + m.returned === inserted ||
      `inserted ${inserted}, but cashbox ${m.cashbox} + credit ${m.credit} + returned ${m.returned} = ${m.cashbox + m.credit + m.returned}`,
    'stock-non-negative': ({ m }) => Object.values(m.stock).every((n) => n >= 0),
  },
  observe: ({ m }) => [...new Set(m.dispensed)].map((d) => `dispensed:${d}`).concat(m.stock.cola === 0 ? ['sold-out:cola'] : []),
  label: (a) => (a.type === 'insert' ? `insert ${a.coin}` : a.type === 'select' ? `select ${a.item}` : a.type),
};
```

What each hook is for:

| Hook | Rule of thumb |
| --- | --- |
| `initial()` | Must return the same state every call. Inject clocks, random seeds and generated IDs. |
| `affordances(s)` | Everything that can happen next, **including the environment** (a payment provider's reply, a timeout, a second user). Keep value domains small: two or three IDs, coin values, quantity caps. |
| `step(s, a)` | Calls your code. reachgate passes a copy of `s`, so mutating it is fine. |
| `invariants` | Must be true in every reachable state. Return `true`, or a string saying what's wrong. Use ghost variables (like `inserted`) for facts your code doesn't keep. |
| `observe(s)` | Names for behaviour you want to keep reachable. The baseline gate tracks these, plus `action:<label>` for every action that is ever offered. |
| `label(a)` | How an action prints in witnesses. |
| `isTerminal(s)` | Optional. Defining it turns on deadlock detection. |
| `hash(s)` / `abstract(s)` | Optional. Exact identity, and a coarse cell for `--strategy go-explore`. |

Two things to get right:

- **Bound the scenario.** If a counter can grow forever, the state space is infinite and the report will
  say `stopped by steps budget` instead of `state space exhausted`. Cap it in `affordances` (here, 400 in
  coins), or leave it out of `hash(s)`.
- **No hidden state.** Everything that affects behaviour must be in the state reachgate passes around:
  no module-level counters, `Date.now()` or `Math.random()` inside `step`. reachgate replays every
  witness twice and reports exit code 3 if they differ.

## 3. Check the wiring (1 minute)

```
$ reachgate inspect
target: vending (in-process: ./reachgate.target.mjs)
invariants: money-conserved, stock-non-negative
...
```

It shows the initial state, its actions, and whether each action leads somewhere new. An empty action
list or a crash here means the hooks need fixing.

## 4. Explore (1 minute)

```
$ reachgate explore
FAIL: 1 invariant violated · 118 states, 224 steps, 8 labels · state space exhausted · 5 ms
  ✗ money-conserved: inserted 100, but cashbox 100 + credit 100 + returned 0 = 200
    witness (2 steps, shortest): insert 100 → select chips
    replay: reachgate replay ./reachgate.target.mjs .reachgate/witnesses/money-conserved.json
report: .reachgate/report.md
```

A real bug: `select` gives change but never zeroes the credit, so you can buy again with the same
money. BFS found it at depth 2, and no shorter witness exists. Replay it step by step:

```
$ reachgate replay .reachgate/witnesses/money-conserved.json
replaying 2 step(s) on vending (recorded violation: money-conserved)
  0. initial()
  1. insert 100
  2. select chips
       + dispensed:chips
       ✗ money-conserved: inserted 100, but cashbox 100 + credit 100 + returned 0 = 200
REPRODUCED: money-conserved at step 2
```

Fix it (`m.credit = 0;` after giving change) and explore again:

```
$ reachgate explore
PASS: 0 invariants violated · 179 states, 681 steps, 8 labels · state space exhausted · 11 ms
```

"State space exhausted" means every reachable state of this bounded scenario was checked, not a sample.

## 5. Record the baseline (1 minute)

```
$ reachgate baseline
PASS: 0 invariants violated · 179 states, 681 steps, 8 labels · state space exhausted · 10 ms
baseline: reachgate.baseline.json (8 labels, 3 invariants)
```

Commit `reachgate.baseline.json` and `reachgate.config.json`. Add `.reachgate/` to `.gitignore`.

## 6. The gate, after every change

Say someone later "keeps one cola for the display":

```js
if (m.stock[item] <= 1) return 'sold out'; // keep one for display
```

No invariant breaks: no money is lost and stock never goes negative. But behaviour that used to be
reachable no longer is:

```
$ reachgate check
# reachgate check: vending

**FAIL: 2 label(s) no longer reachable.**

Before: 179 states (exhaustive). After: 89 states (exhaustive). Failing on: lost, violation.

## No longer reachable (2)

- `dispensed:cola`: the baseline witness still replays all 3 step(s), but "dispensed:cola" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: insert 50 → insert 100 → select cola (`.reachgate/witnesses/lost_dispensed_cola.json`)
- `sold-out:cola`: ...
```

Exit code 1 fails CI. If you meant to change the behaviour, say why in the PR and run `reachgate
baseline` to accept it. If not, you've just caught a regression that no invariant would have caught.

`reachgate check` never fails just because the search was unlucky. A label the new search misses is
first checked by replaying its old witness, and only reported lost if that replay no longer reaches it.

## 7. Tell your coding agent, and CI

Add to `CLAUDE.md` / `AGENTS.md`:

```markdown
## Before calling a change done
`reachgate check` must pass. Quote its verdict line in the PR. If behaviour was removed on purpose,
say why and run `reachgate baseline` to accept it. Never edit reachgate.baseline.json by hand.
```

Claude Code users can install the bundled skill instead (see the README). In CI:

```yaml
- run: npx reachgate check --quiet
```

## Python projects

```
$ reachgate init --lang python
wrote reachgate_target.py, reachgate_adapter.py, reachgate.config.json
```

`reachgate_adapter.py` is a zero-dependency helper. Your target calls `serve(initial=..., affordances=...,
step=..., invariants={...}, observe=..., label=...)` with the same hooks as above (snake_case:
`is_terminal`). States and actions must be JSON values. Then use `reachgate explore`, `baseline` and
`check` exactly as above. Other languages speak the [adapter protocol](protocol.md) directly.

## When BFS isn't enough

If `explore` keeps saying `stopped by steps budget` and you can't bound the scenario further, try
`reachgate explore --strategy go-explore` with an `abstract(s)` that keeps progress (stage, what's held,
which screen) and drops detail (counters, positions). It reaches deeper in the same budget, but its
witnesses are 1-minimal rather than guaranteed shortest. The [dungeon example](../examples/dungeon/)
compares both.
