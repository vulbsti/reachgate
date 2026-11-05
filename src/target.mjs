// A target is the user's real code, described by a few functions. A driver is the uniform async
// interface the explorer talks to, whether the target runs in this process or behind an adapter.
//
// Target (in-process):
//   name?            string
//   initial()        -> state                       the start state (must be deterministic)
//   affordances(s)   -> action[]                    everything that can be done in s
//   step(s, a)       -> state                       apply a; may mutate s (reachgate passes a clone)
//   invariants?      { id: (s) => true | false | string | {ok, message} }   must hold in every state
//   transitions?     { id: (prev, a, next) => ... } must hold on every step
//   observe?(s)      -> string[]                    labels: facts about s worth tracking in the baseline
//   hash?(s)         -> any                         exact identity (default: canonical JSON of s)
//   abstract?(s)     -> any                         coarse cell for Go-Explore (default: hash)
//   isTerminal?(s)   -> boolean                     defining this turns on deadlock detection
//   label?(a)        -> string                      how an action is printed (default: canonical JSON)
//   clone?(s)        -> state                       default structuredClone
//   describe?        { id: 'what the invariant means' }
import { canonical, keyOf, digest } from './canonical.mjs';

export class TargetError extends Error {
  constructor(message, { cause, fatal = false, usage = false } = {}) {
    super(message, { cause });
    this.name = 'TargetError';
    this.fatal = fatal;
    this.usage = usage; // the user's command or config is wrong (exit 2), not the target (exit 3)
  }
}

/** Identity helper so a target file gets editor completion from index.d.ts. */
export function defineTarget(target) {
  return target;
}

export function defaultLabel(action) {
  if (typeof action === 'string') return action;
  return canonical(action);
}

/** Evaluate one invariant result: true/undefined/null = holds; false = violated; string = violated with message. */
export function judge(result) {
  if (result === true || result === undefined || result === null) return null;
  if (result === false) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && 'ok' in result) return result.ok ? null : String(result.message ?? '');
  return null;
}

function check(table, args, out) {
  for (const [id, fn] of Object.entries(table || {})) {
    let msg;
    try {
      msg = judge(fn(...args));
    } catch (e) {
      msg = `the invariant itself threw: ${e?.message ?? e}`;
    }
    if (msg !== null) out.push({ id, message: msg });
  }
  return out;
}

/** Wrap an in-process target object as a driver. */
export function inProcessDriver(target, { source = null } = {}) {
  for (const fn of ['initial', 'affordances', 'step']) {
    if (typeof target?.[fn] !== 'function') throw new TargetError(`target is missing ${fn}()`, { fatal: true });
  }
  const clone = target.clone ?? structuredClone;
  const label = target.label ?? defaultLabel;
  const hasHash = typeof target.hash === 'function';
  const hasCell = typeof target.abstract === 'function';
  const deadlock = typeof target.isTerminal === 'function';
  return {
    name: target.name ?? 'target',
    source,
    kind: 'in-process',
    invariantIds: Object.keys(target.invariants || {}),
    transitionIds: Object.keys(target.transitions || {}),
    deadlock,
    describe: target.describe ?? {},
    label,
    clone,
    async initial() {
      try {
        return target.initial();
      } catch (e) {
        throw new TargetError(`initial() threw: ${e?.message ?? e}`, { cause: e, fatal: true });
      }
    },
    /** Everything the explorer needs to know about one state, in one call. */
    async visit(s) {
      let actions;
      try {
        actions = target.affordances(s) ?? [];
      } catch (e) {
        return { actions: [], violations: [{ id: 'no-crash', message: `affordances() threw: ${e?.message ?? e}` }], labels: [], hash: digest(canonical(s)), cell: null, terminal: true };
      }
      const violations = check(target.invariants, [s], []);
      let terminal = false;
      if (deadlock) {
        try {
          terminal = !!target.isTerminal(s);
        } catch (e) {
          violations.push({ id: 'no-crash', message: `isTerminal() threw: ${e?.message ?? e}` });
        }
        if (!terminal && actions.length === 0) violations.push({ id: 'deadlock', message: 'no action is possible and the state is not terminal' });
      }
      let labels = [];
      if (target.observe) {
        try {
          labels = (target.observe(s) ?? []).map(String);
        } catch (e) {
          violations.push({ id: 'no-crash', message: `observe() threw: ${e?.message ?? e}` });
        }
      }
      const hash = hasHash ? keyOf(target.hash(s)) : digest(canonical(s));
      const cell = hasCell ? keyOf(target.abstract(s)) : null;
      return { actions, violations, labels, hash, cell, terminal };
    },
    /** Apply one action. A throw from the user's code is a finding (no-crash), not a tool error. */
    async step(s, a) {
      let next;
      try {
        next = target.step(clone(s), a);
      } catch (e) {
        return { crash: `step(${label(a)}) threw: ${e?.message ?? e}` };
      }
      if (next === undefined) return { crash: `step(${label(a)}) returned undefined (return the new state)` };
      const violations = target.transitions ? check(target.transitions, [s, a, next], []) : [];
      return { state: next, violations };
    },
    async close() {},
  };
}
