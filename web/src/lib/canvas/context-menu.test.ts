/**
 * context-menu.test.ts — Unit tests for the pure helpers in context-menu.ts.
 *
 * Tests cover:
 *   • clampMenuPosition — edge-flip math for all four quadrant cases.
 *   • moveFocusIndex    — keyboard focus traversal with wrap-around and skipping.
 */

import { describe, it, expect } from 'vitest';
import {
  clampMenuPosition,
  moveFocusIndex,
  menuItemsFor,
  type MenuElementKind,
  type KindLookup,
} from './context-menu.ts';

// ── clampMenuPosition ─────────────────────────────────────────────────────────

describe('clampMenuPosition', () => {
  // Pane: 800 × 600. Menu: 160 × 240.

  it('returns (x, y) unchanged when the menu fits without overflow', () => {
    expect(clampMenuPosition(100, 100, 160, 240, 800, 600)).toEqual({
      left: 100,
      top: 100,
    });
  });

  it('flips left when the right edge would overflow', () => {
    // x=700, menuW=160 → right edge at 860 > 800 → flip to 700−160=540
    expect(clampMenuPosition(700, 100, 160, 240, 800, 600)).toEqual({
      left: 540,
      top: 100,
    });
  });

  it('flips up when the bottom edge would overflow', () => {
    // y=450, menuH=240 → bottom at 690 > 600 → flip to 450−240=210
    expect(clampMenuPosition(100, 450, 160, 240, 800, 600)).toEqual({
      left: 100,
      top: 210,
    });
  });

  it('flips both left and up when both edges overflow', () => {
    expect(clampMenuPosition(700, 450, 160, 240, 800, 600)).toEqual({
      left: 540,
      top: 210,
    });
  });

  it('clamps to 0 when a flip would produce a negative offset', () => {
    // x=10, menuW=160 → 10 + 160 > 800? No. But what if x=10, pane=50, menuW=80?
    // right edge: 10+80=90 > 50 → flip: 10−80 = −70 → clamp to 0
    expect(clampMenuPosition(10, 10, 80, 40, 50, 200)).toEqual({
      left: 0,
      top: 10,
    });
  });

  it('clamps top to 0 when flipping up would produce a negative offset', () => {
    expect(clampMenuPosition(10, 5, 80, 80, 800, 50)).toEqual({
      left: 10,
      top: 0,
    });
  });

  it('fits exactly on the edge (no flip)', () => {
    // x + menuW === paneW → no overflow, no flip
    expect(clampMenuPosition(640, 360, 160, 240, 800, 600)).toEqual({
      left: 640,
      top: 360,
    });
  });

  it('overflows by 1 pixel and flips', () => {
    // x=641, 641+160=801 > 800 → flip to 641−160=481
    expect(clampMenuPosition(641, 50, 160, 240, 800, 600)).toEqual({
      left: 481,
      top: 50,
    });
  });
});

// ── moveFocusIndex ────────────────────────────────────────────────────────────

describe('moveFocusIndex', () => {
  // moveFocusIndex only inspects `separator` / `disabled`; the typed shape keeps
  // these fixtures assignable to its weak (all-optional) parameter type.
  type NavItem = { label?: string; separator?: boolean; disabled?: boolean };
  const A: NavItem = { label: 'A' };
  const B: NavItem = { label: 'B' };
  const C: NavItem = { label: 'C' };
  const SEP: NavItem = { separator: true };
  const DIS: NavItem = { label: 'D', disabled: true };

  describe('basic movement in a plain list', () => {
    const items = [A, B, C];

    it('moves down from -1 to first item', () => {
      expect(moveFocusIndex(items, -1, 1)).toBe(0);
    });

    it('moves up from -1 to last item', () => {
      expect(moveFocusIndex(items, -1, -1)).toBe(2);
    });

    it('moves down through the list', () => {
      expect(moveFocusIndex(items, 0, 1)).toBe(1);
      expect(moveFocusIndex(items, 1, 1)).toBe(2);
    });

    it('wraps around going down past the last item', () => {
      expect(moveFocusIndex(items, 2, 1)).toBe(0);
    });

    it('moves up through the list', () => {
      expect(moveFocusIndex(items, 2, -1)).toBe(1);
      expect(moveFocusIndex(items, 1, -1)).toBe(0);
    });

    it('wraps around going up past the first item', () => {
      expect(moveFocusIndex(items, 0, -1)).toBe(2);
    });
  });

  describe('skipping separators', () => {
    const items = [A, SEP, B];

    it('skips a separator when moving down', () => {
      expect(moveFocusIndex(items, 0, 1)).toBe(2); // skip index 1 (SEP)
    });

    it('skips a separator when moving up', () => {
      expect(moveFocusIndex(items, 2, -1)).toBe(0);
    });

    it('skips a separator when wrapping from end', () => {
      // From B (idx 2) going down wraps to A (idx 0), skipping SEP (idx 1)
      expect(moveFocusIndex(items, 2, 1)).toBe(0);
    });
  });

  describe('skipping disabled items', () => {
    const items = [A, DIS, B];

    it('skips disabled item going down', () => {
      expect(moveFocusIndex(items, 0, 1)).toBe(2);
    });

    it('skips disabled item going up', () => {
      expect(moveFocusIndex(items, 2, -1)).toBe(0);
    });
  });

  describe('skipping multiple non-navigable items in a row', () => {
    const items = [A, SEP, DIS, B];

    it('jumps over separator then disabled item going down', () => {
      expect(moveFocusIndex(items, 0, 1)).toBe(3);
    });

    it('jumps over disabled then separator going up', () => {
      expect(moveFocusIndex(items, 3, -1)).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('returns current if list is empty', () => {
      expect(moveFocusIndex([], -1, 1)).toBe(-1);
      expect(moveFocusIndex([], 0, 1)).toBe(0);
    });

    it('returns current if all items are non-navigable', () => {
      const allSep = [SEP, SEP, SEP];
      expect(moveFocusIndex(allSep, -1, 1)).toBe(-1);
      expect(moveFocusIndex(allSep, 1, -1)).toBe(1);
    });

    it('handles a single navigable item (wraps to itself)', () => {
      expect(moveFocusIndex([A], 0, 1)).toBe(0);
      expect(moveFocusIndex([A], 0, -1)).toBe(0);
    });

    it('handles a single navigable item from unfocused state', () => {
      expect(moveFocusIndex([A], -1, 1)).toBe(0);
      expect(moveFocusIndex([A], -1, -1)).toBe(0);
    });
  });
});

// ── menuItemsFor (action registry, P13-3) ───────────────────────────────────────

describe('menuItemsFor', () => {
  // The MenuItem descriptor shape, derived from the registry's own return type
  // so the helpers see `danger` / `disabled` / `submenu` / `separator`.
  type MI = ReturnType<typeof menuItemsFor>[number];

  /** Build a function lookup that classifies any eid as `kind`. */
  const constLookup =
    (kind: MenuElementKind | null): KindLookup =>
    () =>
      kind;

  /** Non-separator action labels, in order. */
  const labelsOf = (items: MI[]): string[] =>
    items.filter((i) => !i.separator).map((i) => i.label);

  /** The (first) item with a given label, or undefined. */
  const byLabel = (items: MI[], label: string): MI | undefined =>
    items.find((i) => i.label === label);

  const single = (eid: string) => ({ primary: eid, eids: [eid] });

  // ── Common "any" set (present for every non-passthrough single element) ──
  describe('the "any" base set', () => {
    it('a plain leaf shows Delete · Duplicate · Copy · Cut · Paste (+ Make free)', () => {
      const items = menuItemsFor(single('t1'), constLookup('leaf'));
      expect(labelsOf(items)).toEqual([
        'Delete',
        'Duplicate',
        'Copy',
        'Cut',
        'Paste',
        'Make free',
      ]);
    });

    it('Delete is flagged danger and Duplicate/Copy/Cut are not', () => {
      const items = menuItemsFor(single('t1'), constLookup('leaf'));
      expect(byLabel(items, 'Delete')?.danger).toBe(true);
      expect(byLabel(items, 'Duplicate')?.danger).toBeUndefined();
    });

    it('Paste is disabled when the clipboard is empty', () => {
      const items = menuItemsFor(single('t1'), constLookup('leaf'), { hasClipboard: false });
      expect(byLabel(items, 'Paste')?.disabled).toBe(true);
    });

    it('Paste is enabled when the clipboard is non-empty', () => {
      const items = menuItemsFor(single('t1'), constLookup('leaf'), { hasClipboard: true });
      expect(byLabel(items, 'Paste')?.disabled).toBe(false);
    });
  });

  // ── text-leaf ──
  describe('text-leaf', () => {
    it('adds Text color (with a colour submenu) on top of the base set + Make free', () => {
      const items = menuItemsFor(single('t1'), constLookup('text-leaf'));
      expect(labelsOf(items)).toEqual([
        'Delete',
        'Duplicate',
        'Copy',
        'Cut',
        'Paste',
        'Text color',
        'Make free',
      ]);
      expect(byLabel(items, 'Text color')?.submenu?.length).toBeGreaterThan(0);
    });
  });

  // ── container ──
  describe('container', () => {
    it('adds Equal columns + Align and Make free (a container is structured)', () => {
      const items = menuItemsFor(single('c1'), constLookup('container'));
      expect(labelsOf(items)).toEqual([
        'Delete',
        'Duplicate',
        'Copy',
        'Cut',
        'Paste',
        'Equal columns',
        'Align',
        'Make free',
      ]);
      expect(byLabel(items, 'Align')?.submenu?.length).toBe(3);
    });
  });

  // ── free ──
  describe('free', () => {
    it('adds Make structured + z-order, and NEVER Make free', () => {
      const items = menuItemsFor(single('f1'), constLookup('free'));
      expect(labelsOf(items)).toEqual([
        'Delete',
        'Duplicate',
        'Copy',
        'Cut',
        'Paste',
        'Make structured',
        'Bring to front',
        'Send to back',
      ]);
      expect(byLabel(items, 'Make free')).toBeUndefined();
    });
  });

  // ── leaf (structured) ──
  describe('structured leaf', () => {
    it('adds Make free but no z-order / container actions', () => {
      const items = menuItemsFor(single('l1'), constLookup('leaf'));
      expect(byLabel(items, 'Make free')).toBeDefined();
      expect(byLabel(items, 'Make structured')).toBeUndefined();
      expect(byLabel(items, 'Bring to front')).toBeUndefined();
      expect(byLabel(items, 'Equal columns')).toBeUndefined();
    });
  });

  // ── passthrough (never-destroy) ──
  describe('passthrough', () => {
    it('shows ONLY Delete + Jump to source — no structural actions', () => {
      const items = menuItemsFor(single('p1'), constLookup('passthrough'));
      expect(labelsOf(items)).toEqual(['Delete', 'Jump to source']);
    });

    it('treats an unknown (unclassifiable) eid as passthrough-safe', () => {
      const items = menuItemsFor(single('gone'), constLookup(null));
      expect(labelsOf(items)).toEqual(['Delete', 'Jump to source']);
    });

    it('never offers Duplicate / Copy / Cut / Paste / Make free', () => {
      const items = menuItemsFor(single('p1'), constLookup('passthrough'));
      for (const forbidden of ['Duplicate', 'Copy', 'Cut', 'Paste', 'Make free']) {
        expect(byLabel(items, forbidden)).toBeUndefined();
      }
    });

    /**
     * Passthrough guard — never-destroy (spec 12):
     * The FULL set of structural / kind-specific actions that must never appear
     * for a passthrough element, covering every branch of menuItemsFor that is
     * guarded by the passthrough early-return.
     *
     * Grouped by category to make the contract legible:
     *   • clipboard ops   : Duplicate, Copy, Cut, Paste
     *   • flow toggles    : Make free, Make structured
     *   • z-order ops     : Bring to front, Send to back
     *   • container ops   : Equal columns, Align
     *   • text appearance : Text color
     *
     * Also asserts that no items carry a `submenu` (passthrough gets no submenus).
     */
    it('passthrough guard (never-destroy, spec 12): no structural/z-order/container/text actions', () => {
      const allForbidden = [
        // clipboard
        'Duplicate',
        'Copy',
        'Cut',
        'Paste',
        // flow toggles
        'Make free',
        'Make structured',
        // z-order
        'Bring to front',
        'Send to back',
        // container
        'Equal columns',
        'Align',
        // text appearance
        'Text color',
      ];

      for (const kind of ['passthrough', null] as (MenuElementKind | null)[]) {
        const items = menuItemsFor(single('p1'), constLookup(kind));

        // Exact label set: only Delete + Jump to source (no extras, no submenus).
        expect(labelsOf(items)).toEqual(['Delete', 'Jump to source']);

        // Every forbidden label must be absent.
        for (const forbidden of allForbidden) {
          expect(byLabel(items, forbidden), `"${forbidden}" must not appear for kind=${String(kind)}`).toBeUndefined();
        }

        // No item may carry a submenu (passthrough has no submenus).
        for (const item of items) {
          expect(item.submenu, `no submenu allowed for kind=${String(kind)}`).toBeUndefined();
        }
      }
    });
  });

  // ── multi-selection ──
  describe('multi (>1 selected)', () => {
    const multi = { primary: 'a', eids: ['a', 'b', 'c'] };

    it('shows Delete all · Duplicate · Copy · Cut and hides single-only items', () => {
      const items = menuItemsFor(multi, constLookup('leaf'));
      expect(labelsOf(items)).toEqual(['Delete all', 'Duplicate', 'Copy', 'Cut']);
    });

    it('does not show Paste / Make free / z-order / container actions in multi', () => {
      const items = menuItemsFor(multi, constLookup('free'));
      for (const hidden of [
        'Paste',
        'Make free',
        'Make structured',
        'Bring to front',
        'Send to back',
        'Equal columns',
        'Align',
        'Text color',
      ]) {
        expect(byLabel(items, hidden)).toBeUndefined();
      }
    });

    it('uses the "Delete all" label (danger) for the batch delete', () => {
      const items = menuItemsFor(multi, constLookup('leaf'));
      expect(byLabel(items, 'Delete all')?.danger).toBe(true);
      expect(byLabel(items, 'Delete')).toBeUndefined();
    });
  });

  // ── run callbacks exist (smoke) without invoking store mutations ──
  describe('run wiring', () => {
    it('every actionable (non-separator, non-submenu) item carries a run callback', () => {
      const items = menuItemsFor(single('t1'), constLookup('text-leaf'), { hasClipboard: true });
      for (const item of items) {
        if (item.separator) continue;
        if (item.submenu) {
          // Submenu parent need not have run; its children must.
          for (const child of item.submenu) expect(typeof child.run).toBe('function');
          continue;
        }
        expect(typeof item.run).toBe('function');
      }
    });
  });
});
