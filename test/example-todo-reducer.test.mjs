// The todo-reducer example (examples/todo-reducer): the seeded redo bug, its fix, and the baseline gate
// catching a refactor that keeps every invariant but makes redo unreachable. The numbers asserted here
// are the ones quoted in examples/todo-reducer/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, replayTrace, recordBaseline, checkBaseline } from '../src/index.mjs';
import buggy, { fixed, regressed } from '../examples/todo-reducer/target.mjs';

const baseline = recordBaseline(fixed); // shared: one exhaustive run of the fixed reducer

test('BFS finds the redo bug with a 5-step shortest witness that replays', async () => {
  const r = await run(buggy, { maxDepth: 5 });
  assert.deepEqual(r.violations.map((v) => v.id), ['selection-exists']);
  const [v] = r.violations;
  assert.equal(v.length, 5);
  assert.equal(v.shortest, true);
  assert.equal(v.replayed, true);
  assert.deepEqual(v.trace.map(buggy.label), ['add', 'delete 1', 'undo', 'select 1', 'redo']);
  const again = await replayTrace(buggy, v.trace);
  assert.equal(again.ok, true);
  assert.deepEqual(again.violations.map((x) => [x.id, x.at]), [['selection-exists', 5]]);
});

test('the fixed reducer has no violations and BFS exhausts its state space', async () => {
  const b = await baseline;
  assert.equal(b.stats.exhaustive, true);
  assert.equal(b.stats.states, 25465);
  assert.ok(Object.values(b.invariants).every((s) => s === 'holds'), JSON.stringify(b.invariants));
  for (const l of ['can:redo', 'screen:editing', 'filter:done', 'full', 'action:redo']) assert.ok(l in b.labels, `${l} is reachable`);
});

test('baseline gate: the history refactor keeps every invariant but loses redo', async () => {
  const { result, diff } = await checkBaseline(regressed, await baseline);
  assert.equal(result.violations.length, 0, 'invariants alone cannot catch this');
  assert.equal(diff.verdict, 'fail');
  assert.deepEqual(diff.regressed, []);
  const lost = Object.fromEntries(diff.lost.map((x) => [x.label, x]));
  assert.deepEqual(Object.keys(lost).sort(), ['action:redo', 'can:redo']);
  assert.equal(lost['action:redo'].diagnosis.reason, 'action-no-longer-offered');
  assert.equal(lost['action:redo'].diagnosis.action, 'redo');
  assert.deepEqual(lost['action:redo'].baselineWitness.map(fixed.label), ['add', 'undo']);
  assert.equal(lost['can:redo'].diagnosis.reason, 'label-not-observed');
});

test('baseline gate: the fixed reducer passes against its own baseline', async () => {
  const { diff } = await checkBaseline(fixed, await baseline);
  assert.equal(diff.verdict, 'pass');
  assert.deepEqual(diff.lost, []);
  assert.deepEqual(diff.regressed, []);
});
