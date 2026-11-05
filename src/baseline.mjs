// The baseline gate. A baseline is a reachable-behaviour signature: every label the search reached
// (each with a witness trace that reaches it) and the status of every invariant. After a change,
// compare() explores again and explains what newly became reachable or unreachable.
//
// From the original game verifier: a label the new search did not find is only "lost" if its baseline witness no longer
// reaches it either. Search luck can't fail the gate; only a real change in reachable behaviour can.
import { replay } from './replay.mjs';

export const BASELINE_FORMAT = 1;

export function signature(result, { version } = {}) {
  return {
    reachgate: BASELINE_FORMAT,
    tool: version,
    target: result.target,
    options: result.options,
    stats: { states: result.stats.states, steps: result.stats.steps, exhaustive: result.stats.exhaustive, stoppedBy: result.stats.stoppedBy },
    invariants: Object.fromEntries(result.invariants.map((i) => [i.id, i.status])),
    labels: result.labels,
  };
}

/** Options the check should reuse so before and after are explored the same way. */
export function exploreOptionsOf(baseline) {
  const o = { ...baseline.options };
  if (o.maxDepth == null) delete o.maxDepth;
  if (o.rollout == null) delete o.rollout;
  return o;
}

/**
 * Compare a fresh exploration against a baseline.
 * @returns {Promise<object>} a diff: lost, added, regressed, fixed, stillViolated, removedInvariants
 */
export async function compare(driver, baseline, result, { failOn = ['lost', 'violation'] } = {}) {
  const now = result.labels;
  const lost = [], recovered = [], added = [];
  for (const [label, trace] of Object.entries(baseline.labels)) {
    if (label in now) continue;
    // The search didn't reach it this time. Does the old witness still get there?
    const r = await replay(driver, trace);
    if (r.labels.has(label)) {
      recovered.push({ label, via: 'baseline witness', length: trace.length });
      continue;
    }
    lost.push({ label, baselineWitness: trace, diagnosis: diagnose(r, trace, label) });
  }
  for (const [label, trace] of Object.entries(now)) if (!(label in baseline.labels)) added.push({ label, witness: trace });

  const regressed = [], fixed = [], stillViolated = [], removedInvariants = [];
  const byId = Object.fromEntries(result.violations.map((v) => [v.id, v]));
  for (const inv of result.invariants) {
    const before = baseline.invariants[inv.id];
    const v = byId[inv.id];
    if (inv.status === 'violated' && before !== 'violated') regressed.push({ id: inv.id, before: before ?? 'new invariant', message: v.message, witness: v.trace, length: v.length, shortest: v.shortest });
    else if (inv.status === 'violated') stillViolated.push({ id: inv.id, message: v.message, witness: v.trace, length: v.length });
    else if (before === 'violated') fixed.push({ id: inv.id });
  }
  for (const id of Object.keys(baseline.invariants)) if (!result.invariants.some((i) => i.id === id)) removedInvariants.push(id);

  const failing = [];
  if (failOn.includes('lost') && lost.length) failing.push(`${lost.length} label(s) no longer reachable`);
  if (failOn.includes('violation') && regressed.length) failing.push(`${regressed.length} invariant(s) newly violated`);
  if (failOn.includes('new') && added.length) failing.push(`${added.length} label(s) newly reachable`);
  if (failOn.includes('removed') && removedInvariants.length) failing.push(`${removedInvariants.length} invariant(s) removed`);
  return {
    verdict: failing.length ? 'fail' : 'pass',
    reasons: failing,
    failOn,
    lost,
    added,
    recovered,
    regressed,
    fixed,
    stillViolated,
    removedInvariants,
    stats: { before: baseline.stats, after: { states: result.stats.states, steps: result.stats.steps, exhaustive: result.stats.exhaustive, stoppedBy: result.stats.stoppedBy } },
  };
}

/** Explain why an old witness no longer reaches its label, in terms an agent can act on. */
function diagnose(r, trace, label) {
  if (!r.ok && r.divergence.reason === 'not-offered') {
    return {
      reason: 'action-not-offered',
      step: r.divergence.at + 1,
      action: r.divergence.action,
      offered: r.divergence.offered,
      text: `step ${r.divergence.at + 1} of the baseline witness (${r.divergence.action}) is no longer offered by affordances(); offered there now: ${r.divergence.offered.slice(0, 8).join(', ') || '(nothing)'}`,
    };
  }
  if (!r.ok && r.divergence.reason === 'crashed') {
    return { reason: 'crashed', step: r.divergence.at + 1, action: r.divergence.action, text: `step ${r.divergence.at + 1} (${r.divergence.action}) now throws: ${r.divergence.message}` };
  }
  if (label.startsWith('action:')) {
    return {
      reason: 'action-no-longer-offered',
      step: trace.length,
      action: label.slice(7),
      offered: r.offered,
      text: `the baseline witness still replays (${trace.length} step(s)), but at its end "${label.slice(7)}" is no longer offered; offered there now: ${r.offered.slice(0, 8).join(', ') || '(nothing)'}`,
    };
  }
  return {
    reason: 'label-not-observed',
    step: trace.length,
    text: `the baseline witness still replays all ${trace.length} step(s), but "${label}" no longer shows up anywhere along it: the code behaves differently on the same steps`,
  };
}
