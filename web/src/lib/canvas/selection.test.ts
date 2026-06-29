/**
 * selection.test.ts — Multi-select extension of the canvas selection store (P4-5/6).
 *
 * Coverage:
 *  Backward compat:
 *    1. select(eid) sets .eid (getter) to that eid.
 *    2. select(eid) replaces any previous selection.
 *    3. clear() resets .eid to null.
 *    4. select(same eid) twice is a no-op (editing stays unchanged).
 *    5. setEditing() marks editing flag.
 *
 *  Multi-select:
 *    6. .eids is an array of all selected eids.
 *    7. add() extends the set; primary stays first-added.
 *    8. add() is idempotent for a eid already in the set.
 *    9. remove() shrinks the set; primary shifts to next if primary removed.
 *   10. remove() on non-member is a no-op.
 *   11. toggle() adds when absent, removes when present.
 *   12. set([...]) replaces the entire selection; first eid → primary.
 *   13. set([]) is equivalent to clear().
 *   14. clear() on an empty selection stays empty.
 *
 *  Semantics:
 *   15. .primary === .eid (the two getters return the same value).
 *   16. select() exits editing; add/remove/toggle do NOT auto-exit editing.
 *   17. remove() of last eid exits editing (empty selection).
 *   18. set([]) exits editing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { selectionStore } from './selection.svelte';

// Re-acquire a fresh reference before each test — the singleton persists across
// imports, so we just call clear() to reset it to a known state.
beforeEach(() => {
  selectionStore.clear();
});

// ─── 1-5: backward-compat single-select ──────────────────────────────────────

describe('backward-compat single-select', () => {
  it('select(eid) sets .eid to that eid', () => {
    selectionStore.select('h1');
    expect(selectionStore.eid).toBe('h1');
  });

  it('select(eid) replaces any previous selection', () => {
    selectionStore.select('h1');
    selectionStore.select('p1');
    expect(selectionStore.eid).toBe('p1');
    expect(selectionStore.eids).toEqual(['p1']);
  });

  it('clear() resets .eid to null', () => {
    selectionStore.select('h1');
    selectionStore.clear();
    expect(selectionStore.eid).toBeNull();
    expect(selectionStore.eids).toEqual([]);
  });

  it('select(same eid) twice is a no-op (editing flag unchanged)', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    selectionStore.select('h1'); // same eid — should not exit editing
    expect(selectionStore.editing).toBe(true);
  });

  it('select(different eid) exits editing', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    selectionStore.select('p1'); // different eid — exits editing
    expect(selectionStore.editing).toBe(false);
  });

  it('setEditing(true) marks editing; setEditing(false) clears it', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    expect(selectionStore.editing).toBe(true);
    selectionStore.setEditing(false);
    expect(selectionStore.editing).toBe(false);
  });
});

// ─── 6-14: multi-select operations ───────────────────────────────────────────

describe('.eids array', () => {
  it('is empty initially', () => {
    expect(selectionStore.eids).toEqual([]);
  });

  it('contains the single eid after select()', () => {
    selectionStore.select('h1');
    expect(selectionStore.eids).toEqual(['h1']);
  });
});

describe('add()', () => {
  it('extends the selection set', () => {
    selectionStore.select('h1');
    selectionStore.add('p1');
    expect(selectionStore.eids).toEqual(['h1', 'p1']);
  });

  it('primary stays the first-added eid when add() is called', () => {
    selectionStore.select('h1');
    selectionStore.add('p1');
    expect(selectionStore.primary).toBe('h1');
    expect(selectionStore.eid).toBe('h1'); // backward compat
  });

  it('add() when set is empty sets primary', () => {
    selectionStore.add('c1');
    expect(selectionStore.primary).toBe('c1');
  });

  it('add() is idempotent for an eid already in the set', () => {
    selectionStore.select('h1');
    selectionStore.add('h1');
    expect(selectionStore.eids).toEqual(['h1']); // no duplicate
    expect(selectionStore.eids.length).toBe(1);
  });
});

describe('remove()', () => {
  it('shrinks the selection set', () => {
    selectionStore.set(['h1', 'p1', 'c1']);
    selectionStore.remove('p1');
    expect(selectionStore.eids).toEqual(['h1', 'c1']);
  });

  it('primary is unchanged when a non-primary is removed', () => {
    selectionStore.set(['h1', 'p1']);
    selectionStore.remove('p1');
    expect(selectionStore.primary).toBe('h1');
  });

  it('primary shifts to next eid when primary is removed', () => {
    selectionStore.set(['h1', 'p1', 'c1']);
    selectionStore.remove('h1'); // removing the primary
    expect(selectionStore.primary).toBe('p1');
    expect(selectionStore.eids).toEqual(['p1', 'c1']);
  });

  it('primary becomes null when last eid is removed', () => {
    selectionStore.select('h1');
    selectionStore.remove('h1');
    expect(selectionStore.primary).toBeNull();
    expect(selectionStore.eid).toBeNull();
    expect(selectionStore.eids).toEqual([]);
  });

  it('remove() on non-member is a no-op', () => {
    selectionStore.set(['h1', 'p1']);
    selectionStore.remove('zzz-not-in-set');
    expect(selectionStore.eids).toEqual(['h1', 'p1']);
    expect(selectionStore.primary).toBe('h1');
  });
});

describe('toggle()', () => {
  it('adds eid when absent', () => {
    selectionStore.select('h1');
    selectionStore.toggle('p1');
    expect(selectionStore.eids).toContain('p1');
  });

  it('removes eid when present', () => {
    selectionStore.set(['h1', 'p1']);
    selectionStore.toggle('p1');
    expect(selectionStore.eids).not.toContain('p1');
    expect(selectionStore.eids).toEqual(['h1']);
  });

  it('toggle same eid twice is a no-op', () => {
    selectionStore.select('h1');
    selectionStore.toggle('p1');
    selectionStore.toggle('p1');
    expect(selectionStore.eids).toEqual(['h1']);
  });
});

describe('set(eids[])', () => {
  it('replaces the entire selection; first eid becomes primary', () => {
    selectionStore.select('old1');
    selectionStore.set(['a', 'b', 'c']);
    expect(selectionStore.eids).toEqual(['a', 'b', 'c']);
    expect(selectionStore.primary).toBe('a');
  });

  it('set([]) clears the selection (equivalent to clear())', () => {
    selectionStore.set(['h1', 'p1']);
    selectionStore.set([]);
    expect(selectionStore.eids).toEqual([]);
    expect(selectionStore.primary).toBeNull();
    expect(selectionStore.eid).toBeNull();
  });
});

describe('clear()', () => {
  it('empties the set and nulls primary', () => {
    selectionStore.set(['a', 'b']);
    selectionStore.clear();
    expect(selectionStore.eids).toEqual([]);
    expect(selectionStore.primary).toBeNull();
  });

  it('is idempotent on an already-empty selection', () => {
    selectionStore.clear();
    selectionStore.clear();
    expect(selectionStore.eids).toEqual([]);
    expect(selectionStore.primary).toBeNull();
  });
});

// ─── 15-18: semantics ────────────────────────────────────────────────────────

describe('API semantics', () => {
  it('.primary === .eid (both getters return the same value)', () => {
    selectionStore.select('h1');
    expect(selectionStore.primary).toBe(selectionStore.eid);
    selectionStore.add('p1');
    expect(selectionStore.primary).toBe(selectionStore.eid);
    selectionStore.clear();
    expect(selectionStore.primary).toBe(selectionStore.eid);
  });

  it('add/remove/toggle do NOT auto-exit editing', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    selectionStore.add('p1');
    expect(selectionStore.editing).toBe(true); // add does not exit editing
    selectionStore.remove('p1');
    expect(selectionStore.editing).toBe(true); // remove of non-primary doesn't exit
    selectionStore.toggle('c1');
    expect(selectionStore.editing).toBe(true); // toggle add doesn't exit
  });

  it('remove() of last eid exits editing (empty selection)', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    selectionStore.remove('h1'); // last element removed
    expect(selectionStore.editing).toBe(false);
  });

  it('set([]) exits editing', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    selectionStore.set([]);
    expect(selectionStore.editing).toBe(false);
  });

  it('select() on a different eid always exits editing', () => {
    selectionStore.select('h1');
    selectionStore.setEditing(true);
    selectionStore.select('p1');
    expect(selectionStore.editing).toBe(false);
  });
});
