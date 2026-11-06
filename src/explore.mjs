// The explorer. Two strategies over the same driver interface:
//
//   bfs         breadth-first over exact states (hash). Every first discovery is by a shortest path, so
//               each witness is a shortest trace. If the queue empties, the reachable space is exhausted.
//   go-explore  Go-Explore-style: keep an archive of cells (abstract(state)), return to a rarely visited
//               cell by restoring its saved state (no replay from the start), then explore from it with a
//               short seeded random rollout. Witnesses are then shrunk to 1-minimal.
//
// Budgets: maxSteps (step() calls), maxStates (distinct exact states), maxSeconds (wall-clock safety cap),
// maxDepth (trace length). Steps are the primary budget so the same seed explores the same way every run.
import { rng, weightedIndex } from './rng.mjs';
import { replay, shrink } from './replay.mjs';

export const DEFAULTS = {
  strategy: 'bfs',
  maxSteps: 200000,
  maxStates: 100000,
  maxSeconds: 120,
  maxDepth: Infinity,
  seed: 1,
  rollout: 12,
  actionLabels: true,
  expandViolations: false,
  shrink: true,
  verify: true,
};

/** Reconstruct the actions from the root to a search node. */
export function traceOf(node) {
  const out = [];
  for (let n = node; n && n.parent; n = n.parent) out.push(n.action);
  return out.reverse();
}

class Recorder {
  constructor(driver, opts, clock) {
    this.driver = driver;
    this.opts = opts;
    this.clock = clock;
    this.violations = new Map(); // id -> { id, message, count, node, first }
    this.labels = new Map(); // label -> node (shortest seen)
  }
  see(info, node, stats) {
    for (const v of info.violations) this.violation(v, node, stats);
    for (const l of info.labels) this.label(l, node);
    if (this.opts.actionLabels) for (const a of info.actions) this.label('action:' + this.driver.label(a), node);
  }
  label(l, node) {
    const prev = this.labels.get(l);
    if (!prev || node.depth < prev.depth) this.labels.set(l, node);
  }
  violation(v, node, stats) {
    const prev = this.violations.get(v.id);
    if (!prev) {
      this.violations.set(v.id, { id: v.id, message: v.message ?? '', count: 1, node, first: { steps: stats.steps, states: stats.states, ms: this.clock() } });
      stats.firstViolation ??= { id: v.id, steps: stats.steps, states: stats.states, ms: this.clock() };
    } else {
      prev.count++;
      if (node.depth < prev.node.depth) Object.assign(prev, { node, message: v.message ?? prev.message });
    }
  }
}

/**
 * Explore a driver's state space.
 * @param {object} driver   from inProcessDriver() or adapterDriver()
 * @param {object} options  see DEFAULTS
 */
export async function explore(driver, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (!['bfs', 'go-explore'].includes(opts.strategy)) throw new Error(`unknown strategy "${opts.strategy}" (use bfs or go-explore)`);
  const t0 = performance.now();
  const clock = () => Math.round(performance.now() - t0);
  const stats = { steps: 0, states: 0, cells: 0, depth: 0, unexpanded: 0, stoppedBy: null, exhaustive: false, ms: 0, firstViolation: null };
  const rec = new Recorder(driver, opts, clock);
  const progress = opts.onProgress ?? (() => {});
  let lastProgress = 0;
  const outOfBudget = () => {
    if (stats.steps >= opts.maxSteps) return 'steps';
    if (stats.states >= opts.maxStates) return 'states';
    if ((stats.steps & 63) === 0 && performance.now() - t0 > opts.maxSeconds * 1000) return 'time';
    if (performance.now() - lastProgress > 1000) {
      lastProgress = performance.now();
      progress({ ...stats, ms: clock(), violations: rec.violations.size, labels: rec.labels.size });
    }
    return null;
  };

  const s0 = await driver.initial();
  const root = { parent: null, action: null, depth: 0 };
  const info0 = await driver.visit(s0);
  stats.states = 1;
  rec.see(info0, root, stats);

  if (opts.strategy === 'bfs') await bfs(driver, opts, stats, rec, outOfBudget, { s0, root, info0 });
  else await goExplore(driver, opts, stats, rec, outOfBudget, { s0, root, info0 });
  stats.ms = clock();

  // Turn search nodes into traces, shrink (Go-Explore) and replay every witness to prove it reproduces.
  const warnings = [];
  if (stats.stoppedBy === 'time') warnings.push(`stopped on the time cap (${opts.maxSeconds}s), not the step budget: this run is not reproducible. Raise --max-seconds or lower --max-steps.`);
  if (stats.unexpanded && rec.violations.size && [...driver.invariantIds, ...driver.transitionIds].some((id) => !rec.violations.has(id))) {
    warnings.push(`${stats.unexpanded} state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.`);
  }
  const violations = [];
  for (const v of rec.violations.values()) {
    let trace = traceOf(v.node), shrunk = null;
    if (opts.strategy === 'go-explore' && opts.shrink) {
      const r = await shrink(driver, trace, v.id);
      shrunk = { from: trace.length, to: r.trace.length, replays: r.replays };
      trace = r.trace;
    }
    const out = { id: v.id, message: v.message, count: v.count, length: trace.length, shortest: opts.strategy === 'bfs', minimal: opts.strategy === 'bfs' ? 'shortest' : opts.shrink ? '1-minimal' : 'none', first: v.first, shrunk, trace };
    if (opts.verify) {
      const [a, b] = [await replay(driver, trace, { actionLabels: false }), await replay(driver, trace, { actionLabels: false })];
      const hit = (r) => r.violations.find((x) => x.id === v.id && x.at === trace.length);
      out.replayed = !!hit(a) && !!hit(b) && a.finalHash === b.finalHash;
      if (!out.replayed) {
        // A witness that doesn't reproduce proves nothing about length either.
        Object.assign(out, { message: v.message, shortest: false, minimal: 'none' });
        warnings.push(`witness for "${v.id}" did not replay to the same violation: the target is not deterministic (hidden state, time, randomness or I/O in step/affordances?)`);
      }
      if (hit(a)) out.message = hit(a).message;
    }
    violations.push(out);
  }
  violations.sort((x, y) => x.id.localeCompare(y.id));
  const labels = {};
  for (const [l, node] of [...rec.labels].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) labels[l] = traceOf(node);
  const invariants = [...new Set([...driver.invariantIds, ...driver.transitionIds, 'no-crash', ...(driver.deadlock ? ['deadlock'] : []), ...violations.map((v) => v.id)])].sort().map((id) => {
    const v = violations.find((x) => x.id === id);
    return { id, description: driver.describe?.[id] ?? builtinDescription(id), status: v ? 'violated' : 'holds' };
  });
  return {
    target: driver.name,
    options: { strategy: opts.strategy, seed: opts.seed, maxSteps: opts.maxSteps, maxStates: opts.maxStates, maxSeconds: opts.maxSeconds, maxDepth: Number.isFinite(opts.maxDepth) ? opts.maxDepth : null, rollout: opts.strategy === 'go-explore' ? opts.rollout : undefined },
    stats,
    invariants,
    violations,
    labels,
    warnings,
  };
}

function builtinDescription(id) {
  return { 'no-crash': 'step(), affordances() and observe() never throw', deadlock: 'every non-terminal state offers at least one action' }[id] ?? '';
}

async function bfs(driver, opts, stats, rec, outOfBudget, { s0, root, info0 }) {
  const seen = new Set([info0.hash]);
  // The queue holds states only for the frontier; search nodes keep a parent pointer and the action,
  // so memory is one small node per visited state plus the frontier's states.
  const queue = [{ node: root, state: s0, actions: info0.actions, bad: info0.violations.length > 0 }];
  let head = 0;
  while (head < queue.length) {
    const item = queue[head];
    queue[head++] = undefined;
    if (item.bad && !opts.expandViolations) {
      stats.unexpanded++;
      continue;
    }
    if (item.node.depth >= opts.maxDepth) continue;
    for (const a of item.actions) {
      const stop = outOfBudget();
      if (stop) {
        stats.stoppedBy = stop;
        return;
      }
      stats.steps++;
      const child = { parent: item.node, action: a, depth: item.node.depth + 1 };
      const r = await driver.step(item.state, a);
      if (r.crash) {
        rec.violation({ id: 'no-crash', message: r.crash }, child, stats);
        continue;
      }
      for (const v of r.violations) rec.violation(v, child, stats);
      const info = await driver.visit(r.state);
      if (seen.has(info.hash)) continue;
      seen.add(info.hash);
      stats.states++;
      if (child.depth > stats.depth) stats.depth = child.depth;
      rec.see(info, child, stats);
      queue.push({ node: child, state: r.state, actions: info.actions, bad: info.violations.length > 0 || r.violations.length > 0 });
    }
  }
  stats.stoppedBy = 'exhausted';
  stats.exhaustive = !Number.isFinite(opts.maxDepth);
}

async function goExplore(driver, opts, stats, rec, outOfBudget, { s0, root, info0 }) {
  const rand = rng(opts.seed);
  const seen = new Set([info0.hash]);
  const archive = new Map(); // cell -> { node, state, actions, visits }
  const cells = []; // insertion order, for deterministic sampling
  const tried = new Map(); // action label -> times chosen anywhere in the search
  const addCell = (key, node, state, actions) => {
    const c = archive.get(key);
    if (!c) {
      const cell = { node, state: driver.clone(state), actions, visits: 0 };
      archive.set(key, cell);
      cells.push(cell);
    } else if (node.depth < c.node.depth) Object.assign(c, { node, state: driver.clone(state), actions });
  };
  if (!info0.violations.length) addCell(info0.cell ?? info0.hash, root, s0, info0.actions);
  stats.cells = archive.size;
  // Count-based selection (Go-Explore): weight 1/sqrt(1+visits), sampled by rejection so a pick is O(1).
  const pickCell = () => {
    for (let i = 0; i < 64; i++) {
      const c = cells[Math.floor(rand() * cells.length)];
      if (rand() < 1 / Math.sqrt(1 + c.visits)) return c;
    }
    return cells[Math.floor(rand() * cells.length)];
  };
  while (cells.length) {
    const cell = pickCell();
    cell.visits++;
    let state = driver.clone(cell.state), node = cell.node, actions = cell.actions;
    const n = 1 + Math.floor(rand() * opts.rollout);
    for (let i = 0; i < n; i++) {
      if (!actions.length || node.depth >= opts.maxDepth) break;
      const stop = outOfBudget();
      if (stop) {
        stats.stoppedBy = stop;
        stats.cells = archive.size;
        return;
      }
      // Prefer actions tried least anywhere in the search, so one common move doesn't drown rare ones.
      const w = actions.map((a) => 1 / (1 + (tried.get(driver.label(a)) || 0)));
      const a = actions[weightedIndex(rand, w)];
      const la = driver.label(a);
      tried.set(la, (tried.get(la) || 0) + 1);
      stats.steps++;
      const child = { parent: node, action: a, depth: node.depth + 1 };
      const r = await driver.step(state, a);
      if (r.crash) {
        rec.violation({ id: 'no-crash', message: r.crash }, child, stats);
        break;
      }
      for (const v of r.violations) rec.violation(v, child, stats);
      const info = await driver.visit(r.state);
      if (!seen.has(info.hash)) {
        seen.add(info.hash);
        stats.states++;
      }
      if (child.depth > stats.depth) stats.depth = child.depth;
      rec.see(info, child, stats);
      if ((info.violations.length || r.violations.length) && !opts.expandViolations) {
        stats.unexpanded++;
        break;
      }
      addCell(info.cell ?? info.hash, child, r.state, info.actions);
      state = r.state;
      node = child;
      actions = info.actions;
    }
    stats.cells = archive.size;
  }
  stats.stoppedBy = 'exhausted';
}
