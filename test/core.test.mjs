// Core behaviour: the claims the README makes about the explorer, witnesses, the baseline gate and
// exit codes. Example-specific tests live in test/example-*.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, replayTrace, recordBaseline, checkBaseline, adapterDriver, canonical, inProcessDriver, shrink } from '../src/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'reachgate.mjs');

// A number line 0..30. "+1" and "+2" move right, "-1" moves left. Reaching 13 is the bug.
// Shortest path to 13 is 7 steps (six +2, one +1); random walks find much longer ones.
const line = (extra = {}) => ({
  name: 'line',
  initial: () => ({ x: 0 }),
  affordances: (s) => [...(s.x < 30 ? ['+1'] : []), ...(s.x < 29 ? ['+2'] : []), ...(s.x > 0 ? ['-1'] : [])],
  step: (s, a) => ({ x: s.x + Number(a) }),
  invariants: { 'not-13': (s) => s.x !== 13 || `x is ${s.x}` },
  observe: (s) => (s.x % 10 === 0 ? [`ten:${s.x}`] : []),
  ...extra,
});

test('BFS: shortest witness, exhaustive space, and the witness replays', async () => {
  const r = await run(line(), { strategy: 'bfs' });
  const v = r.violations.find((x) => x.id === 'not-13');
  assert.equal(v.length, 7);
  assert.equal(v.shortest, true);
  assert.equal(v.replayed, true);
  assert.equal(r.stats.exhaustive, true);
  assert.equal(r.stats.states, 31); // 0..30, every state visited once
  const rep = await replayTrace(line(), v.trace);
  assert.equal(rep.ok, true);
  assert.deepEqual(rep.violations.map((x) => [x.id, x.at]), [['not-13', 7]]);
});

test('Go-Explore: same seed, same result; witness shrunk to 1-minimal but not claimed shortest', async () => {
  const opts = { strategy: 'go-explore', maxSteps: 3000, seed: 3 };
  const [a, b] = [await run(line(), opts), await run(line(), opts)];
  assert.equal(canonical(a.violations.map((v) => v.trace)), canonical(b.violations.map((v) => v.trace)));
  assert.equal(canonical(a.labels), canonical(b.labels));
  const v = a.violations.find((x) => x.id === 'not-13');
  assert.equal(v.shortest, false);
  assert.equal(v.minimal, '1-minimal');
  assert.ok(v.shrunk.from >= v.length);
  // 1-minimal: removing any single step breaks the witness
  for (let i = 0; i < v.trace.length; i++) {
    const cut = v.trace.filter((_, j) => j !== i);
    const rep = await replayTrace(line(), cut);
    assert.ok(!(rep.ok && rep.violations.some((x) => x.id === 'not-13' && x.at === cut.length)), `step ${i} was removable`);
  }
});

test('shrink: removes detours from a long witness', async () => {
  const d = inProcessDriver(line());
  const long = ['+1', '-1', '+2', '+2', '+1', '-1', '+2', '+2', '+2', '+2', '+1', '-1', '+1']; // reaches 13
  const r = await shrink(d, long, 'not-13');
  assert.ok(r.trace.length < long.length);
  assert.equal(r.trace.reduce((x, a) => x + Number(a), 0), 13);
});

test('replay refuses an action the code does not offer', async () => {
  const rep = await replayTrace(line(), ['-1']);
  assert.equal(rep.ok, false);
  assert.equal(rep.divergence.reason, 'not-offered');
  assert.deepEqual(rep.divergence.offered, ['+1', '+2']);
});

test('a nondeterministic target is caught: its witness is not reported as reproducible', async () => {
  let calls = 0; // hidden state outside the target's state: exactly what breaks replay
  const flaky = line({ invariants: { 'not-13': (s) => s.x !== 13 || ++calls > 1 || 'x is 13' } });
  const r = await run(flaky, { strategy: 'bfs' });
  const v = r.violations.find((x) => x.id === 'not-13');
  assert.equal(v.replayed, false);
  assert.match(r.warnings.join('\n'), /not deterministic/);
});

test('baseline gate: a label the search misses is not "lost" if its baseline witness still reaches it', async () => {
  const fixed = line({ invariants: {} });
  const base = await recordBaseline(fixed, { strategy: 'bfs' });
  assert.ok('ten:30' in base.labels);
  // Same code, but a search too small to reach x = 30: the old witness proves it is still reachable.
  const same = await checkBaseline(fixed, base, { maxSteps: 20 });
  assert.equal(same.diff.verdict, 'pass');
  assert.ok(same.diff.recovered.some((x) => x.label === 'ten:30'));
  // Now really cap the line at 25: x = 30 is gone, and the diagnosis says which step stopped working.
  const capped = line({ invariants: {}, affordances: (s) => [...(s.x < 25 ? ['+1'] : []), ...(s.x < 24 ? ['+2'] : []), ...(s.x > 0 ? ['-1'] : [])] });
  const { diff } = await checkBaseline(capped, base);
  assert.equal(diff.verdict, 'fail');
  const lost = diff.lost.find((x) => x.label === 'ten:30');
  assert.equal(lost.diagnosis.reason, 'action-not-offered');
  assert.deepEqual(diff.lost.map((x) => x.label), ['ten:30']);
  // A newly violated invariant fails the gate; newly reachable labels only do with failOn 'new'.
  const broken = line();
  const r2 = await checkBaseline(broken, base);
  assert.deepEqual(r2.diff.regressed.map((x) => [x.id, x.length]), [['not-13', 7]]);
  assert.equal(r2.diff.verdict, 'fail');
});

test('baseline gate: newly reachable labels are reported, and fail only with failOn new', async () => {
  const base = await recordBaseline(line({ invariants: {} }));
  const wider = line({ invariants: {}, affordances: (s) => [...(s.x < 40 ? ['+1'] : []), ...(s.x < 39 ? ['+2'] : []), ...(s.x > 0 ? ['-1'] : [])] });
  const { diff } = await checkBaseline(wider, base);
  assert.ok(diff.added.some((x) => x.label === 'ten:40' && x.witness.length === 20));
  assert.equal(diff.verdict, 'pass');
  assert.equal((await checkBaseline(wider, base, { failOn: ['new'] })).diff.verdict, 'fail');
});

test('state and time budgets stop the search and say so', async () => {
  const byStates = await run(line(), { maxStates: 5 });
  assert.equal(byStates.stats.states, 5);
  assert.equal(byStates.stats.stoppedBy, 'states');
  assert.equal(byStates.stats.exhaustive, false);
  const byTime = await run(line(), { maxSeconds: 0 });
  assert.equal(byTime.stats.stoppedBy, 'time');
  assert.match(byTime.warnings.join('\n'), /not reproducible/);
});

test('crashes in step() are findings with a witness, not tool errors', async () => {
  const t = line({ invariants: {}, step: (s, a) => { if (s.x === 4 && a === '+2') throw new Error('boom'); return { x: s.x + Number(a) }; } });
  const r = await run(t, { strategy: 'bfs' });
  const v = r.violations.find((x) => x.id === 'no-crash');
  assert.deepEqual(v.trace, ['+2', '+2', '+2']);
  assert.match(v.message, /boom/);
  assert.equal(v.replayed, true);
});

test('adapter: a process that writes non-JSON is a measurement error, not a pass', async () => {
  await assert.rejects(adapterDriver([process.execPath, '-e', 'process.stdin.once("data", () => console.log("hello there"))']), /not JSON/);
});

const cli = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

test('CLI exit codes: 0 pass, 1 violation, 2 usage, 3 could not measure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reachgate-'));
  const src = (inv) => `export default { name: 'c', initial: () => ({ n: 0 }), affordances: (s) => s.n < 3 ? ['inc'] : [], step: (s) => ({ n: s.n + 1 }), invariants: { small: (s) => ${inv} } };\n`;
  writeFileSync(join(dir, 'ok.mjs'), src('s.n <= 3'));
  writeFileSync(join(dir, 'bad.mjs'), src('s.n < 3'));
  writeFileSync(join(dir, 'boom.mjs'), "export default { initial() { throw new Error('no db'); }, affordances: () => [], step: (s) => s };\n");
  assert.equal(cli(['explore', 'ok.mjs', '--quiet'], dir).status, 0);
  const bad = cli(['explore', 'bad.mjs', '--quiet'], dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /witness \(3 steps, shortest\): inc → inc → inc/);
  const report = JSON.parse(readFileSync(join(dir, '.reachgate', 'report.json'), 'utf8'));
  assert.equal(report.exitCode, 1);
  assert.equal(cli(['replay', 'bad.mjs', report.violations[0].witnessFile], dir).status, 0);
  assert.equal(cli(['replay', 'ok.mjs', report.violations[0].witnessFile], dir).status, 1); // replays, but no longer violates
  assert.equal(cli(['explore', 'ok.mjs', '--quiet'], dir).status, 0);
  assert.deepEqual(readdirSync(join(dir, '.reachgate', 'witnesses')), ['previous']); // a fixed violation leaves no open witness
  assert.equal(cli(['replay', 'ok.mjs', join('.reachgate', 'witnesses', 'previous', 'small.json')], dir).status, 1); // ...but the old one confirms the fix
  assert.equal(cli(['explore', 'missing.mjs'], dir).status, 2);
  assert.equal(cli(['explore', 'ok.mjs', '--max-steps', 'lots'], dir).status, 2);
  assert.equal(cli(['check', 'ok.mjs'], dir).status, 2); // no baseline yet
  assert.equal(cli(['explore', 'boom.mjs'], dir).status, 3);
  writeFileSync(join(dir, 'flaky.mjs'), "let calls = 0; // hidden state outside the target's state\nexport default { initial: () => ({ n: 0 }), affordances: (s) => (s.n < 3 ? ['inc'] : []), step: (s) => ({ n: s.n + 1 }), invariants: { small: (s) => s.n < 3 || ++calls > 1 } };\n");
  const flaky = cli(['explore', 'flaky.mjs', '--quiet'], dir);
  assert.equal(flaky.status, 3); // a violation it can't reproduce is not reported as a FAIL or a PASS
  assert.match(flaky.stdout, /^COULD NOT MEASURE/);
  const partial = cli(['explore', 'ok.mjs', '--max-steps', '1', '--require-exhaustive', '--quiet'], dir);
  assert.equal(partial.status, 3); // partial search: not a pass
  assert.match(partial.stdout, /^INCOMPLETE/); // and the verdict line an agent quotes doesn't say PASS
  assert.equal(cli(['explore', 'ok.mjs', '--require-exhaustive', '--quiet'], dir).status, 0);
  // the gate: baseline on ok, then check bad
  assert.equal(cli(['baseline', 'ok.mjs', '--quiet'], dir).status, 0);
  assert.equal(cli(['check', 'ok.mjs', '--quiet'], dir).status, 0);
  const gate = cli(['check', 'bad.mjs', '--quiet'], dir);
  assert.equal(gate.status, 1);
  assert.match(gate.stdout, /Newly violated invariants \(1\)/);
});
