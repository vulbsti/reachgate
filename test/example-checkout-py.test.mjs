// The checkout-py example (examples/checkout-py): a Python target behind the stdio adapter. The retry
// double charge, its fix, and the CLI end to end. The numbers asserted here are the ones quoted in
// examples/checkout-py/README.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, replayTrace, adapterDriver } from '../src/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'examples/checkout-py/target.py');
const drivers = [];
const driver = async (...args) => {
  const d = await adapterDriver(['python3', TARGET, ...args]);
  drivers.push(d);
  return d;
};
after(() => Promise.all(drivers.map((d) => d.close())));

test('BFS finds the retry double charge with a 6-step shortest witness that replays', async () => {
  const d = await driver();
  const r = await run(d, { maxDepth: 6 });
  assert.deepEqual(r.violations.map((v) => v.id), ['charged-equals-total', 'single-capture']);
  for (const v of r.violations) {
    assert.equal(v.length, 6);
    assert.equal(v.shortest, true);
    assert.equal(v.replayed, true);
    assert.deepEqual(v.trace.map(d.label), ['add_item mug', 'set_address domestic', 'pay timeout', 'retry_payment approve', 'reconcile', 'capture']);
  }
  assert.match(r.violations[0].message, /charged 3400 for an order total of 1700/);
  const again = await replayTrace(d, r.violations[0].trace);
  assert.equal(again.ok, true);
  assert.deepEqual(again.violations.map((x) => [x.id, x.at]), [['charged-equals-total', 6], ['single-capture', 6]]);
});

test('the fixed checkout (--fixed) has no violations and BFS exhausts its state space', async () => {
  const r = await run(await driver('--fixed'));
  assert.deepEqual(r.violations, []);
  assert.equal(r.stats.exhaustive, true);
  assert.equal(r.stats.states, 1170);
  for (const l of ['status:refunded', 'payment:timed_out', 'payment:declined', 'coupon:SAVE10', 'status:cancelled']) assert.ok(l in r.labels, `${l} is reachable`);
});

test('CLI: explore on the .py file exits 1 and writes the report and witnesses to --out', () => {
  const out = mkdtempSync(join(tmpdir(), 'reachgate-checkout-'));
  const p = spawnSync(process.execPath, ['bin/reachgate.mjs', 'explore', 'examples/checkout-py/target.py', '--quiet', '--out', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(p.status, 1, p.stderr);
  assert.match(p.stdout, /FAIL: 2 invariants violated/);
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.violations.map((v) => v.length), [6, 6]);
  assert.ok(existsSync(join(out, 'report.md')));
  const w = JSON.parse(readFileSync(join(out, 'witnesses', 'charged-equals-total.json'), 'utf8'));
  assert.equal(w.trace.length, 6);
});
