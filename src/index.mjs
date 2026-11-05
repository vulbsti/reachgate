// reachgate: explore your real code's reachable states, check invariants, return shortest replayable
// witnesses, and gate changes against a recorded behavioural baseline.
//
//   import { defineTarget, run } from 'reachgate';
//   const result = await run(target, { strategy: 'bfs', maxSteps: 50000 });
export { defineTarget, inProcessDriver, TargetError, judge } from './target.mjs';
export { adapterDriver, splitCommand, PROTOCOL_VERSION } from './adapter.mjs';
export { explore, traceOf, DEFAULTS } from './explore.mjs';
export { replay, shrink } from './replay.mjs';
export { signature, compare, exploreOptionsOf, BASELINE_FORMAT } from './baseline.mjs';
export { EXIT, exitCodeOf, summaryLine, exploreMarkdown, diffMarkdown } from './report.mjs';
export { loadDriver } from './load.mjs';
export { canonical, digest } from './canonical.mjs';
import { inProcessDriver } from './target.mjs';
import { explore } from './explore.mjs';
import { replay } from './replay.mjs';
import { signature, compare, exploreOptionsOf } from './baseline.mjs';

const asDriver = (t) => (typeof t?.visit === 'function' ? t : inProcessDriver(t));

/** Explore an in-process target (or a driver) and return the result. */
export async function run(target, options = {}) {
  return explore(asDriver(target), options);
}

/** Replay a list of actions on a target. */
export async function replayTrace(target, trace) {
  return replay(asDriver(target), trace);
}

/** Record a baseline signature for a target. */
export async function recordBaseline(target, options = {}) {
  return signature(await explore(asDriver(target), options));
}

/** Explore a target with the baseline's options and diff the result against the baseline. */
export async function checkBaseline(target, baseline, { failOn, ...options } = {}) {
  const d = asDriver(target);
  const result = await explore(d, { ...exploreOptionsOf(baseline), ...options });
  return { result, diff: await compare(d, baseline, result, failOn ? { failOn } : undefined) };
}
