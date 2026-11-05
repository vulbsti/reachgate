// reachgate target for the todo reducer. The reducer itself (todos.mjs) knows nothing about reachgate;
// this file says what a user can click in each state and what must always be true.
//
//   default    v1.2, with the redo bug         node bin/reachgate.mjs explore examples/todo-reducer/target.mjs
//   fixed      the current reducer             ...explore examples/todo-reducer/target.mjs#fixed
//   regressed  fixed + the history refactor    ...check examples/todo-reducer/target.mjs#regressed
import { createTodoReducer, initialState, visibleItems, canUndo, canRedo, FILTERS, MAX_ITEMS } from './todos.mjs';

// One level of undo is enough to reach every history bug class here (undo, redo, redo-after-change);
// each extra level multiplies the state space, so the target keeps it at 1.
const HISTORY_LIMIT = 1;

/** What the UI offers. While the inline editor is open only the editor and the undo/redo shortcuts work. */
function affordances(s) {
  const out = [];
  if (s.editing) {
    out.push({ type: 'commitEdit', title: 'Renamed' }, { type: 'cancelEdit' });
  } else {
    if (s.items.length < MAX_ITEMS) out.push({ type: 'add' });
    for (const item of visibleItems(s)) {
      out.push({ type: 'toggle', id: item.id }, { type: 'delete', id: item.id });
      if (item.id !== s.selectedId) out.push({ type: 'select', id: item.id });
    }
    if (s.selectedId !== null) out.push({ type: 'deselect' }, { type: 'startEdit' });
    for (const filter of FILTERS) if (filter !== s.filter) out.push({ type: 'setFilter', filter });
    if (s.items.some((i) => i.done)) out.push({ type: 'clearCompleted' });
  }
  if (canUndo(s)) out.push({ type: 'undo' });
  if (canRedo(s)) out.push({ type: 'redo' });
  return out;
}

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const invariants = {
  'selection-exists': (s) => s.selectedId === null || s.items.some((i) => i.id === s.selectedId) || `selectedId ${s.selectedId} is not in the list (ids: ${s.items.map((i) => i.id).join(', ') || 'none'})`,
  'editing-implies-selection': (s) => s.editing === null || s.editing.id === s.selectedId || `editing item ${s.editing.id} but selectedId is ${s.selectedId}`,
  'visible-subset': (s) => {
    const visible = visibleItems(s);
    if (!visible.every((v) => s.items.includes(v))) return 'a visible item is not in the list';
    const wrong = visible.find((v) => (s.filter === 'active' && v.done) || (s.filter === 'done' && !v.done));
    return !wrong || `item ${wrong.id} is visible under filter "${s.filter}"`;
  },
  'history-consistent': (s) => {
    if (s.past.length > HISTORY_LIMIT || s.future.length > HISTORY_LIMIT) return `history longer than ${HISTORY_LIMIT}`;
    if (s.past.length && sameList(s.past[s.past.length - 1], s.items)) return 'undo would not change anything';
    if (s.future.length && sameList(s.future[0], s.items)) return 'redo would not change anything';
    return true;
  },
};

const describe = {
  'selection-exists': 'the selected item exists',
  'editing-implies-selection': 'the item being edited is the selected one',
  'visible-subset': 'the list shows only existing items that match the filter',
  'history-consistent': 'history is bounded and every undo/redo step changes something',
};

function observe(s) {
  return [
    s.editing ? 'screen:editing' : 'screen:list',
    `filter:${s.filter}`,
    ...(canUndo(s) ? ['can:undo'] : []),
    ...(canRedo(s) ? ['can:redo'] : []),
    ...(s.items.length === 0 ? ['empty'] : []),
    ...(s.items.length === MAX_ITEMS ? ['full'] : []),
    ...(s.selectedId !== null ? ['selected'] : []),
    ...(visibleItems(s).length === 0 && s.items.length > 0 ? ['all-hidden-by-filter'] : []),
  ];
}

function label(a) {
  if (a.id !== undefined) return `${a.type} ${a.id}`;
  if (a.filter) return `${a.type} ${a.filter}`;
  if (a.title) return `${a.type} "${a.title}"`;
  return a.type;
}

function todoTarget(name, options) {
  const reducer = createTodoReducer({ historyLimit: HISTORY_LIMIT, ...options });
  return {
    name,
    initial: initialState,
    affordances,
    step: (s, a) => reducer(s, a),
    clone: (s) => s, // the reducer never mutates its input, so reachgate can skip the defensive copy
    invariants,
    describe,
    observe,
    label,
  };
}

export default todoTarget('todo-reducer (v1.2, redo bug)', { revalidateOnRedo: false });
export const fixed = todoTarget('todo-reducer (fixed)', {});
export const regressed = todoTarget('todo-reducer (history refactor)', { undoViaCommit: true });
