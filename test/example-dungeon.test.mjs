// The dungeon example (examples/dungeon): the seeded softlock, its fix, and Go-Explore vs BFS on the
// deep level. The numbers asserted here are the ones quoted in examples/dungeon/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, replayTrace } from '../src/index.mjs';
import cellar, { fixed, deep } from '../examples/dungeon/target.mjs';

const softlockAt = (r) => r.violations.find((v) => v.id === 'no-softlock')?.at;

test('BFS finds the seeded softlock with a 13-step shortest witness that replays', async () => {
  const r = await run(cellar);
  assert.equal(r.stats.exhaustive, true);
  assert.deepEqual(r.violations.map((v) => v.id), ['no-softlock']);
  const [v] = r.violations;
  assert.equal(v.length, 13);
  assert.equal(v.shortest, true);
  assert.equal(v.replayed, true);
  assert.match(v.message, /stuck in the locked door/);
  const again = await replayTrace(cellar, v.trace);
  assert.equal(again.ok, true);
  assert.equal(softlockAt(again), 13);
});

test('the fixed game has no violations and BFS exhausts its state space', async () => {
  const r = await run(fixed);
  assert.deepEqual(r.violations, []);
  assert.equal(r.stats.exhaustive, true);
  assert.ok(r.labels.won && r.labels.lost && r.labels['key:knocked-loose'], 'winning, losing and dropping the key are all reachable');
});

test('deep level: Go-Explore finds the softlock in a 200k-step budget, BFS does not', async () => {
  const budget = { maxSteps: 200000 };
  const ge = await run(deep, { ...budget, strategy: 'go-explore', seed: 1 });
  const v = ge.violations.find((x) => x.id === 'no-softlock');
  assert.ok(v, 'go-explore should find no-softlock');
  assert.equal(v.minimal, '1-minimal');
  assert.equal(v.replayed, true);
  // 1-minimal: dropping any single step no longer reproduces the softlock.
  for (let i = 0; i < v.trace.length; i++) {
    const r = await replayTrace(deep, v.trace.toSpliced(i, 1));
    assert.equal(softlockAt(r), undefined, `the witness still reproduces without step ${i + 1}`);
  }

  const bfs = await run(deep, budget);
  assert.equal(bfs.stats.stoppedBy, 'steps');
  assert.deepEqual(bfs.violations, []);
  assert.equal(bfs.labels['room:well'], undefined, 'BFS should not even reach the well room');
  assert.ok(bfs.stats.depth < v.length, `BFS got to depth ${bfs.stats.depth}, the witness is ${v.length} steps`);
});
