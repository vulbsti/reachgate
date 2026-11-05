// Replaying a trace, and shrinking one. A trace is a list of actions from initial(). Replay checks that
// every action is actually offered by affordances() at that point, so a witness can never smuggle in a
// move the real code would not allow.
import { canonical } from './canonical.mjs';

/**
 * Replay a trace on a driver.
 * @returns {Promise<{ok:boolean, divergence?:object, violations:{id,message,at}[], labels:Set<string>,
 *   labelAt:Map<string,number>, hashes:string[], finalHash:string|null, crashed:boolean}>}
 *   `at` is the number of steps taken when the violation was seen (0 = in the initial state).
 */
export async function replay(driver, trace, { actionLabels = true } = {}) {
  const violations = [], labelAt = new Map(), hashes = [];
  const see = (info, at) => {
    for (const v of info.violations) violations.push({ ...v, at });
    for (const l of info.labels) if (!labelAt.has(l)) labelAt.set(l, at);
    if (actionLabels) for (const a of info.actions) { const l = 'action:' + driver.label(a); if (!labelAt.has(l)) labelAt.set(l, at); }
    hashes.push(info.hash);
    offered = info.actions;
  };
  let offered = [];
  let s = await driver.initial();
  let info = await driver.visit(s);
  see(info, 0);
  const done = (extra) => ({ ok: true, violations, labels: new Set(labelAt.keys()), labelAt, hashes, finalHash: hashes[hashes.length - 1] ?? null, offered: offered.map((x) => driver.label(x)), crashed: false, ...extra });
  for (let i = 0; i < trace.length; i++) {
    const a = trace[i], ca = canonical(a);
    if (!info.actions.some((x) => canonical(x) === ca)) {
      return {
        ...done(),
        ok: false,
        divergence: { at: i, reason: 'not-offered', action: driver.label(a), offered: info.actions.map((x) => driver.label(x)) },
      };
    }
    const r = await driver.step(s, a);
    if (r.crash) {
      violations.push({ id: 'no-crash', message: r.crash, at: i + 1 });
      // A crash ends the trace. If it is not the last step, the trace no longer replays as recorded.
      if (i < trace.length - 1) return { ...done({ crashed: true }), ok: false, divergence: { at: i, reason: 'crashed', action: driver.label(a), message: r.crash } };
      return done({ crashed: true });
    }
    for (const v of r.violations) violations.push({ ...v, at: i + 1 });
    s = r.state;
    info = await driver.visit(s);
    see(info, i + 1);
  }
  return done();
}

/** The trace cut right after violation `id` first shows, or null if the trace doesn't replay to it. */
async function reproduces(driver, trace, id) {
  const r = await replay(driver, trace, { actionLabels: false });
  const v = r.violations.find((x) => x.id === id);
  if (!v) return null;
  // A trace that diverges later still counts if the violation showed on the part that did replay.
  if (!r.ok) {
    const validUpTo = r.divergence.at + (r.divergence.reason === 'crashed' ? 1 : 0);
    if (v.at > validUpTo) return null;
  }
  return { trace: trace.slice(0, v.at), hashes: r.hashes.slice(0, v.at + 1) };
}

/**
 * Shrink a witness for violation `id`: first cut loops (the trace passes the same state twice), then
 * delta debugging (ddmin) until no single step can be removed. The result is 1-minimal, not
 * necessarily shortest. Every candidate is replayed, so the result always replays.
 */
export async function shrink(driver, trace, id, { maxReplays = 2000 } = {}) {
  let replays = 1;
  let cur = await reproduces(driver, trace, id);
  if (!cur) return { trace, replays, shrunk: false };
  // 1. loops: if state k equals state j (k < j), the steps between them are a detour.
  for (let guard = 0; guard < 50; guard++) {
    const first = new Map();
    let cut = null;
    cur.hashes.forEach((h, j) => {
      if (cut) return;
      if (first.has(h)) cut = [first.get(h), j];
      else first.set(h, j);
    });
    if (!cut) break;
    const cand = [...cur.trace.slice(0, cut[0]), ...cur.trace.slice(cut[1])];
    replays++;
    const r = await reproduces(driver, cand, id);
    if (!r) break;
    cur = r;
  }
  // 2. ddmin over the remaining steps.
  let t = cur.trace, n = 2;
  while (t.length >= 1 && replays < maxReplays) {
    const size = Math.max(1, Math.ceil(t.length / n));
    let reduced = false;
    for (let start = 0; start < t.length && replays < maxReplays; start += size) {
      const cand = [...t.slice(0, start), ...t.slice(start + size)];
      replays++;
      const r = await reproduces(driver, cand, id);
      if (r) {
        t = r.trace;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (size === 1) break;
      n = Math.min(t.length, n * 2);
    }
  }
  return { trace: t, replays, shrunk: t.length < trace.length, budgetHit: replays >= maxReplays };
}
