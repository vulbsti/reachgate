# Example: a todo list UI reducer

[`todos.mjs`](todos.mjs) is an ordinary Redux-style reducer for a todo list UI: add (up to 3 items),
toggle, delete, select, inline edit (start / commit / cancel), a filter (all / active / done),
clear-completed, and undo/redo over the list. It has no reachgate code in it.
[`target.mjs`](target.mjs) wraps it: what a user can click in each state (`affordances`), the
invariants, and the labels the baseline records.

| Invariant | Meaning |
| --- | --- |
| `selection-exists` | the selected item exists |
| `editing-implies-selection` | the item being edited is the selected one |
| `visible-subset` | the list shows only existing items that match the filter |
| `history-consistent` | history is bounded and every undo/redo step changes something |

Labels: `screen:list` / `screen:editing`, `filter:all|active|done`, `can:undo`, `can:redo`, `empty`,
`full`, `selected`, `all-hidden-by-filter`, plus `action:<label>` for every action offered.

The target exports three variants of the same reducer:

| Export | What it is |
| --- | --- |
| `default` | v1.2 as shipped, with the redo bug |
| `fixed` | the current reducer |
| `regressed` | `fixed` after a refactor that keeps every invariant but silently breaks redo |

## The seeded bug

Undo, redo, delete and clear-completed can all remove the selected item, so each one must re-validate
the UI state afterwards. Undo got that fix in an earlier release; redo was missed
([`todos.mjs` line 75](todos.mjs#L75)):

```js
return revalidateOnRedo ? revalidate(restored) : restored;   // v1.2: revalidateOnRedo = false
```

## Run it

```console
$ node bin/reachgate.mjs explore examples/todo-reducer/target.mjs
FAIL: 1 invariant violated · 27049 states, 189625 steps, 31 labels · state space exhausted · 1787 ms
  ✗ selection-exists: selectedId 1 is not in the list (ids: none)
    witness (5 steps, shortest): add → delete 1 → undo → select 1 → redo
    replay: reachgate replay examples/todo-reducer/target.mjs .reachgate/witnesses/selection-exists.json
warning: 1584 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
```

```console
$ node bin/reachgate.mjs replay examples/todo-reducer/target.mjs .reachgate/witnesses/selection-exists.json
replaying 5 step(s) on todo-reducer (v1.2, redo bug) (recorded violation: selection-exists)
  0. initial()
       + screen:list
       + filter:all
       + empty
  1. add
       + can:undo
  2. delete 1
  3. undo
       + can:redo
  4. select 1
       + selected
  5. redo
       ✗ selection-exists: selectedId 1 is not in the list (ids: none)
REPRODUCED: selection-exists at step 5
```

### Why 5 steps is the minimum

BFS visits states in order of distance from the start, so the first witness it finds is a shortest one.
By hand: the bad state needs a redo that removes the selected item. Redo replays a change that was
undone, so that change must have removed an item (`delete` or `clearCompleted`), and the item must
exist first (`add`). Then `undo` brings it back, and it has to be selected *after* the undo, because
selecting it before the delete doesn't survive the delete. That's `add, delete, undo, select, redo`:
5 steps, and `clearCompleted` would need an extra `toggle`.

## The fixed version

```console
$ node bin/reachgate.mjs explore examples/todo-reducer/target.mjs#fixed
PASS: 0 invariants violated · 25465 states, 189625 steps, 31 labels · state space exhausted · 1807 ms
report: .reachgate/report.md
```

All 25465 reachable states were visited (`state space exhausted`), so the four invariants hold in every
state the UI can reach, not just the ones a test happened to hit. (The target uses one level of undo
history and keeps rows in id order. That keeps the space small enough to exhaust in about 2 s, and
one level is enough to reach both the redo bug and the regression below. Each extra level multiplies
the state space.)

## The baseline gate: a regression no invariant catches

The `regressed` variant is the fixed reducer after a "one history path" refactor: undo was rewritten
on top of `commit()` ([line 65](todos.mjs#L65)), and `commit()` clears the redo stack
([line 59](todos.mjs#L59)). Every invariant still holds, and `explore` passes. But redo can never be
used again.

Record a baseline on the good code, then check the change against it:

```console
$ node bin/reachgate.mjs baseline examples/todo-reducer/target.mjs#fixed --baseline .reachgate/todo-baseline.json
PASS: 0 invariants violated · 25465 states, 189625 steps, 31 labels · state space exhausted · 5366 ms
baseline: .reachgate/todo-baseline.json (31 labels, 5 invariants)

$ node bin/reachgate.mjs check examples/todo-reducer/target.mjs#regressed --baseline .reachgate/todo-baseline.json
# reachgate check: todo-reducer (history refactor)

**FAIL: 2 label(s) no longer reachable.**

Before: 25465 states (exhaustive). After: 19155 states (exhaustive). Failing on: lost, violation.

## No longer reachable (2)

- `action:redo`: the baseline witness still replays (2 step(s)), but at its end "redo" is no longer offered; offered there now: add, setFilter active, setFilter done, undo.
  Baseline witness: add → undo (`.reachgate/witnesses/lost_action_redo.json`)
- `can:redo`: the baseline witness still replays all 2 step(s), but "can:redo" no longer shows up anywhere along it: the code behaves differently on the same steps.
  Baseline witness: add → undo (`.reachgate/witnesses/lost_can_redo.json`)
...
```

The check exits 1. Both explorations were exhaustive, so "no longer reachable" is a fact about the
code, not search luck, and the diagnosis says exactly where it changed: after `add → undo`, redo used to
be offered and isn't any more. Checking `fixed` against the same baseline passes (exit 0).

## Tests

[`test/example-todo-reducer.test.mjs`](../../test/example-todo-reducer.test.mjs) checks the 5-step
witness and its replay, that the fixed reducer exhausts 25465 states with no violation, and both gate
results (regressed fails with `action:redo` lost as `action-no-longer-offered` and `can:redo` as
`label-not-observed`, with no invariant regressions; fixed passes).
