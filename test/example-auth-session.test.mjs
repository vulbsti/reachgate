// The auth-session example (examples/auth-session): the remembered-device lockout bypass and its fix.
// The numbers asserted here are the ones quoted in examples/auth-session/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, replayTrace } from '../src/index.mjs';
import buggy, { fixed } from '../examples/auth-session/target.mjs';

test('BFS finds the lockout bypass with a 7-step shortest witness that replays', async () => {
  const r = await run(buggy);
  assert.equal(r.stats.exhaustive, true);
  assert.deepEqual(r.violations.map((v) => v.id), ['locked-has-no-new-session']);
  const [v] = r.violations;
  assert.equal(v.length, 7);
  assert.equal(v.shortest, true);
  assert.equal(v.replayed, true);
  // Remember a device, lock the account with three bad passwords, sign in on the remembered device.
  const steps = v.trace.map(buggy.label);
  assert.deepEqual(steps, [
    'login laptop hunter2',
    'verify laptop good-code +remember',
    'logout laptop',
    'login laptop correct-horse',
    'login laptop correct-horse',
    'login laptop correct-horse',
    'login laptop hunter2',
  ]);
  const again = await replayTrace(buggy, v.trace);
  assert.equal(again.ok, true);
  assert.deepEqual(again.violations.map((x) => [x.id, x.at]), [['locked-has-no-new-session', 7]]);
});

test('the fixed service has no violations and BFS exhausts its state space', async () => {
  const r = await run(fixed);
  assert.deepEqual(r.violations, []);
  assert.equal(r.stats.exhaustive, true);
  assert.equal(r.stats.states, 2457);
  for (const l of ['state:locked', 'session:remembered-device', 'reset:used', 'reset:revoked', 'reset:expired', 'password:changed']) {
    assert.ok(l in r.labels, `${l} is reachable`);
  }
});
