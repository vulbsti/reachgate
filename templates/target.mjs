// reachgate target: describe your real code so reachgate can explore it.
// Replace the toy door below with imports of your own reducer / engine / state machine.
// Docs: https://github.com/vulbsti/reachgate/blob/main/docs/wire-in-15-minutes.md
// No import of reachgate is needed: a target is a plain object, so this file works with a global install.

// --- your code (normally imported, e.g. `import { reducer, initialState } from './src/store.js'`) ---
const initialState = { door: 'closed', locked: false };
function reducer(s, a) {
  switch (a.type) {
    case 'open': return { ...s, door: 'open' };
    case 'close': return { ...s, door: 'closed' };
    case 'lock': return { ...s, locked: true };
    case 'unlock': return { ...s, locked: false };
    default: return s;
  }
}

/** @type {import('reachgate').Target} */
export default {
  name: 'door',
  // The start state. Must be the same every call.
  initial: () => initialState,
  // Every action that can happen in state s: user input, timers, network replies...
  affordances: (s) => [
    ...(s.door === 'closed' && !s.locked ? [{ type: 'open' }] : []),
    ...(s.door === 'open' ? [{ type: 'close' }] : []),
    ...(s.locked ? [{ type: 'unlock' }] : [{ type: 'lock' }]),
  ],
  // Apply one action with your real code. reachgate passes a copy, so mutating s is fine.
  step: (s, a) => reducer(s, a),
  // Must hold in every reachable state: return true, false, or a string explaining the failure.
  invariants: {
    'open-door-is-unlocked': (s) => s.door === 'closed' || !s.locked || 'the door is open and locked',
  },
  // Names for behaviour you care about; the baseline records which of these are reachable.
  observe: (s) => [`door:${s.door}`, ...(s.locked ? ['locked'] : [])],
  // How actions print in witnesses.
  label: (a) => a.type,
};
