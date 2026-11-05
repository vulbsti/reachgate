// Todo list UI state: a Redux-style reducer plus the selectors the view uses.
//
// The document (the list of items) has undo/redo history. UI state (selection, which row is in edit
// mode, the filter) is not part of history: undo restores items, then the UI state is re-validated so
// it never points at an item that no longer exists. The edit box keeps its own text (component state)
// and dispatches commitEdit with the final title, so keystrokes never reach the store.
//
// createTodoReducer() takes two flags that reproduce earlier revisions of this file:
//   revalidateOnRedo: false   v1.2 as shipped: redo restored items without re-validating the UI state
//                             (undo got the fix in v1.1 after a bug report; redo was missed)
//   undoViaCommit: true       the v1.4 "one history path" refactor: undo was rewritten on top of
//                             commit(), which also clears the redo stack

export const MAX_ITEMS = 3;
export const FILTERS = ['all', 'active', 'done'];

export function initialState() {
  return { items: [], selectedId: null, editing: null, filter: 'all', past: [], future: [] };
}

/** Items the list shows under the current filter. */
export function visibleItems(state) {
  if (state.filter === 'active') return state.items.filter((i) => !i.done);
  if (state.filter === 'done') return state.items.filter((i) => i.done);
  return state.items;
}

export const canUndo = (state) => state.past.length > 0;
export const canRedo = (state) => state.future.length > 0;

function nextId(items) {
  for (let id = 1; id <= MAX_ITEMS; id++) if (!items.some((i) => i.id === id)) return id;
  return null;
}

/** Rows keep a stable order by id. */
function insertById(items, item) {
  const at = items.findIndex((i) => i.id > item.id);
  return at === -1 ? [...items, item] : [...items.slice(0, at), item, ...items.slice(at)];
}

function sameItems(a, b) {
  return a.length === b.length && a.every((x, k) => x.id === b[k].id && x.title === b[k].title && x.done === b[k].done);
}

/** Drop selection and the editor if they refer to an item that is gone. */
function revalidate(state) {
  const exists = (id) => state.items.some((i) => i.id === id);
  const selectedId = state.selectedId !== null && exists(state.selectedId) ? state.selectedId : null;
  const editing = state.editing && state.editing.id === selectedId ? state.editing : null;
  return selectedId === state.selectedId && editing === state.editing ? state : { ...state, selectedId, editing };
}

export function createTodoReducer({ historyLimit = 50, revalidateOnRedo = true, undoViaCommit = false } = {}) {
  /** Replace the items as one undoable change. A change that changes nothing is not recorded. */
  function commit(state, items) {
    if (sameItems(items, state.items)) return state;
    const past = [...state.past, state.items].slice(-historyLimit);
    return revalidate({ ...state, items, past, future: [] });
  }

  function undo(state) {
    if (!canUndo(state)) return state;
    const previous = state.past[state.past.length - 1];
    if (undoViaCommit) return commit({ ...state, past: state.past.slice(0, -1) }, previous);
    const future = [state.items, ...state.future].slice(0, historyLimit);
    return revalidate({ ...state, items: previous, past: state.past.slice(0, -1), future });
  }

  function redo(state) {
    if (!canRedo(state)) return state;
    const [next, ...future] = state.future;
    const past = [...state.past, state.items].slice(-historyLimit);
    const restored = { ...state, items: next, past, future };
    return revalidateOnRedo ? revalidate(restored) : restored;
  }

  return function todoReducer(state = initialState(), action) {
    switch (action.type) {
      case 'add': {
        const id = nextId(state.items);
        if (id === null) return state;
        return commit(state, insertById(state.items, { id, title: `Task ${id}`, done: false }));
      }
      case 'toggle':
        return commit(state, state.items.map((i) => (i.id === action.id ? { ...i, done: !i.done } : i)));
      case 'delete':
        return commit(state, state.items.filter((i) => i.id !== action.id));
      case 'clearCompleted':
        return commit(state, state.items.filter((i) => !i.done));
      case 'select':
        return state.items.some((i) => i.id === action.id) ? { ...state, selectedId: action.id } : state;
      case 'deselect':
        return { ...state, selectedId: null, editing: null };
      case 'startEdit': {
        const item = state.items.find((i) => i.id === state.selectedId);
        return item ? { ...state, editing: { id: item.id } } : state;
      }
      case 'commitEdit': {
        if (!state.editing) return state;
        const { id } = state.editing;
        const closed = { ...state, editing: null };
        return commit(closed, closed.items.map((i) => (i.id === id ? { ...i, title: action.title } : i)));
      }
      case 'cancelEdit':
        return { ...state, editing: null };
      case 'setFilter': // switching tabs clears the selection
        return { ...state, filter: action.filter, selectedId: null, editing: null };
      case 'undo':
        return undo(state);
      case 'redo':
        return redo(state);
      default:
        return state;
    }
  };
}

export const todoReducer = createTodoReducer();
