// ─── Keyboard list navigation ────────────────────────────────────────────────
// A pure reducer for an email-client style list: a cursor that j/k move, and a
// multi-selection that x toggles. Pure so it can be unit-tested and so the
// cursor survives refetches, optimistic removals and rollbacks predictably.

export interface ListNavState {
  /** Row ids in display order. */
  ids: string[];
  /** The row the keyboard is on (and the detail pane shows). */
  cursor: string | null;
  /** Selected ids, kept in display order. */
  selected: string[];
}

export type ListNavAction =
  | { type: 'sync'; ids: string[] }
  | { type: 'move'; delta: number }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'set'; id: string | null }
  | { type: 'toggle'; id?: string }
  | { type: 'toggleAll' }
  | { type: 'clear' }
  | { type: 'remove'; ids: string[] };

export const initialListNav: ListNavState = { ids: [], cursor: null, selected: [] };

function inOrder(ids: string[], subset: Iterable<string>): string[] {
  const keep = new Set(subset);
  return ids.filter((id) => keep.has(id));
}

/** Where the cursor lands when its row disappears: the row that took its place, else the new last row. */
function successor(oldIds: string[], newIds: string[], cursor: string | null): string | null {
  if (cursor === null || newIds.length === 0) return null;
  if (newIds.includes(cursor)) return cursor;
  const oldIndex = oldIds.indexOf(cursor);
  if (oldIndex === -1) return null;
  const present = new Set(newIds);
  for (let i = oldIndex + 1; i < oldIds.length; i++) {
    if (present.has(oldIds[i])) return oldIds[i];
  }
  for (let i = oldIndex - 1; i >= 0; i--) {
    if (present.has(oldIds[i])) return oldIds[i];
  }
  return newIds[0];
}

export function listNavReducer(state: ListNavState, action: ListNavAction): ListNavState {
  switch (action.type) {
    case 'sync': {
      const same = action.ids.length === state.ids.length && action.ids.every((id, i) => id === state.ids[i]);
      if (same) return state;
      return {
        ids: action.ids,
        cursor: successor(state.ids, action.ids, state.cursor),
        selected: inOrder(action.ids, state.selected),
      };
    }
    case 'move': {
      if (state.ids.length === 0) return state;
      const index = state.cursor === null ? -1 : state.ids.indexOf(state.cursor);
      let next: number;
      if (index === -1) next = action.delta > 0 ? 0 : state.ids.length - 1;
      else next = Math.min(state.ids.length - 1, Math.max(0, index + action.delta));
      const cursor = state.ids[next];
      return cursor === state.cursor ? state : { ...state, cursor };
    }
    case 'first':
      return state.ids.length ? { ...state, cursor: state.ids[0] } : state;
    case 'last':
      return state.ids.length ? { ...state, cursor: state.ids[state.ids.length - 1] } : state;
    case 'set':
      if (action.id !== null && !state.ids.includes(action.id)) return state;
      return action.id === state.cursor ? state : { ...state, cursor: action.id };
    case 'toggle': {
      const id = action.id ?? state.cursor;
      if (id === null || !state.ids.includes(id)) return state;
      const selected = state.selected.includes(id)
        ? state.selected.filter((s) => s !== id)
        : inOrder(state.ids, [...state.selected, id]);
      return { ...state, selected };
    }
    case 'toggleAll':
      return {
        ...state,
        selected: state.selected.length === state.ids.length && state.ids.length > 0 ? [] : [...state.ids],
      };
    case 'clear':
      return state.selected.length ? { ...state, selected: [] } : state;
    case 'remove': {
      const gone = new Set(action.ids);
      const ids = state.ids.filter((id) => !gone.has(id));
      return {
        ids,
        cursor: successor(state.ids, ids, state.cursor),
        selected: state.selected.filter((id) => !gone.has(id)),
      };
    }
  }
}
