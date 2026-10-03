import { describe, expect, it } from 'vitest';
import { initialListNav, listNavReducer, type ListNavAction, type ListNavState } from '@/lib/list-nav';

function run(state: ListNavState, ...actions: ListNavAction[]): ListNavState {
  return actions.reduce(listNavReducer, state);
}

const loaded = run(initialListNav, { type: 'sync', ids: ['a', 'b', 'c', 'd'] });

describe('cursor movement (j/k)', () => {
  it('starts at the first row on j and the last on k', () => {
    expect(run(loaded, { type: 'move', delta: 1 }).cursor).toBe('a');
    expect(run(loaded, { type: 'move', delta: -1 }).cursor).toBe('d');
  });

  it('moves and clamps at both ends', () => {
    const s = run(loaded, { type: 'set', id: 'c' }, { type: 'move', delta: 1 }, { type: 'move', delta: 1 });
    expect(s.cursor).toBe('d');
    expect(run(s, { type: 'first' }, { type: 'move', delta: -1 }).cursor).toBe('a');
  });

  it('returns the same state object when nothing changes', () => {
    const s = run(loaded, { type: 'set', id: 'd' });
    expect(listNavReducer(s, { type: 'move', delta: 1 })).toBe(s);
    expect(listNavReducer(s, { type: 'sync', ids: ['a', 'b', 'c', 'd'] })).toBe(s);
  });

  it('ignores unknown ids and empty lists', () => {
    expect(run(loaded, { type: 'set', id: 'zzz' }).cursor).toBeNull();
    expect(run(initialListNav, { type: 'move', delta: 1 })).toBe(initialListNav);
  });
});

describe('selection (x)', () => {
  it('toggles the cursor row and keeps display order', () => {
    const s = run(loaded, { type: 'set', id: 'c' }, { type: 'toggle' }, { type: 'toggle', id: 'a' });
    expect(s.selected).toEqual(['a', 'c']);
    expect(run(s, { type: 'toggle', id: 'c' }).selected).toEqual(['a']);
  });

  it('selects all, then clears on a second toggleAll', () => {
    const all = run(loaded, { type: 'toggleAll' });
    expect(all.selected).toEqual(['a', 'b', 'c', 'd']);
    expect(run(all, { type: 'toggleAll' }).selected).toEqual([]);
    expect(run(all, { type: 'clear' }).selected).toEqual([]);
  });
});

describe('optimistic removal and resync', () => {
  it('moves the cursor to the next row when its row is resolved', () => {
    const s = run(loaded, { type: 'set', id: 'b' }, { type: 'remove', ids: ['b'] });
    expect(s.ids).toEqual(['a', 'c', 'd']);
    expect(s.cursor).toBe('c');
  });

  it('falls back to the previous row at the end of the list', () => {
    const s = run(loaded, { type: 'set', id: 'd' }, { type: 'remove', ids: ['c', 'd'] });
    expect(s.cursor).toBe('b');
  });

  it('drops removed rows from the selection', () => {
    const s = run(loaded, { type: 'toggleAll' }, { type: 'remove', ids: ['a', 'c'] });
    expect(s.selected).toEqual(['b', 'd']);
  });

  it('keeps the cursor across a refetch that reorders rows', () => {
    const s = run(loaded, { type: 'set', id: 'c' }, { type: 'sync', ids: ['c', 'a', 'b'] });
    expect(s.cursor).toBe('c');
  });

  it('restores rows on rollback without losing the cursor', () => {
    const removed = run(loaded, { type: 'set', id: 'b' }, { type: 'remove', ids: ['b'] });
    const restored = run(removed, { type: 'sync', ids: ['a', 'b', 'c', 'd'] });
    expect(restored.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(restored.cursor).toBe('c');
  });

  it('clears the cursor when the list empties', () => {
    expect(run(loaded, { type: 'set', id: 'a' }, { type: 'sync', ids: [] }).cursor).toBeNull();
  });
});
