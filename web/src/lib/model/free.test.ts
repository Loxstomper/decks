/**
 * free.test.ts — P4-1: data-free toggle (model operation).
 *
 * Coverage:
 *  1. setFree(el, true, rect) writes data-free + data-x/y/w/h.
 *  2. setFree(el, true) without rect writes only data-free.
 *  3. setFree(el, false) removes data-free and all positional attributes.
 *  4. classify() returns 'free' after setFree(el, true).
 *  5. classify() returns original class after setFree(el, false).
 *  6. toggleFree() toggles on then off correctly.
 *  7. toggleFree() returns null for unknown eid.
 *  8. Only the target element goes dirty (spec 12 #4 — siblings stay clean).
 *  9. Round-trip: setFree + serializeDeck preserves geometry in output bytes.
 * 10. setFree(el, true) on an already-free element is idempotent.
 * 11. setFree(el, false) on a non-free element is a no-op (no extra dirty).
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, findByEid, getAttribute, hasAttribute } from './index';
import { classify } from './classify';
import { setFree, toggleFree } from './free';
import type { LogicalRect } from './free';

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** A deck with a structured leaf (h2), a data-lay container, and a sibling. */
const STRUCTURED_HTML = `<section data-eid="s1">
  <div data-lay="stack" data-eid="c1">
    <h2 data-eid="h1">Title</h2>
    <p data-eid="p1">Body</p>
  </div>
</section>`;

/** A deck with an already-free element. */
const FREE_HTML = `<div data-free data-x="100" data-y="200" data-w="400" data-h="80" data-eid="f1">free</div>`;

const RECT: LogicalRect = { x: 50, y: 100, w: 300, h: 60 };

// ─── 1-2: setFree(el, true) ──────────────────────────────────────────────────

describe('setFree(el, true)', () => {
  it('writes data-free as a boolean attribute (no value)', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'h1')!;
    setFree(el, true);
    // data-free is present
    expect(hasAttribute(el, 'data-free')).toBe(true);
    // getAttribute returns '' for a boolean attribute (null value in source)
    expect(getAttribute(el, 'data-free')).toBe('');
  });

  it('writes data-x/y/w/h when rect is provided', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'h1')!;
    setFree(el, true, RECT);
    expect(getAttribute(el, 'data-x')).toBe('50');
    expect(getAttribute(el, 'data-y')).toBe('100');
    expect(getAttribute(el, 'data-w')).toBe('300');
    expect(getAttribute(el, 'data-h')).toBe('60');
  });

  it('does NOT write positional attributes when rect is omitted', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'p1')!;
    setFree(el, true); // no rect
    expect(getAttribute(el, 'data-x')).toBeNull();
    expect(getAttribute(el, 'data-y')).toBeNull();
    expect(getAttribute(el, 'data-w')).toBeNull();
    expect(getAttribute(el, 'data-h')).toBeNull();
  });

  it('marks the element dirty', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'h1')!;
    expect(el.dirty).toBe(false);
    setFree(el, true);
    expect(el.dirty).toBe(true);
  });
});

// ─── 3: setFree(el, false) ───────────────────────────────────────────────────

describe('setFree(el, false)', () => {
  it('removes data-free', () => {
    const model = parseDeck(FREE_HTML);
    const el = findByEid(model, 'f1')!;
    setFree(el, false);
    expect(hasAttribute(el, 'data-free')).toBe(false);
  });

  it('removes all four positional attributes', () => {
    const model = parseDeck(FREE_HTML);
    const el = findByEid(model, 'f1')!;
    setFree(el, false);
    expect(getAttribute(el, 'data-x')).toBeNull();
    expect(getAttribute(el, 'data-y')).toBeNull();
    expect(getAttribute(el, 'data-w')).toBeNull();
    expect(getAttribute(el, 'data-h')).toBeNull();
  });

  it('marks the element dirty', () => {
    const model = parseDeck(FREE_HTML);
    const el = findByEid(model, 'f1')!;
    setFree(el, false);
    expect(el.dirty).toBe(true);
  });
});

// ─── 4-5: classify() after toggle ────────────────────────────────────────────

describe('classify() after setFree', () => {
  it('classify returns "free" after setFree(el, true)', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'h1')!;
    expect(classify(el)).toBe('leaf'); // before
    setFree(el, true);
    expect(classify(el)).toBe('free'); // after
  });

  it('classify returns "leaf" after setFree(el, false) on a formerly-free leaf', () => {
    // An h2 that was free; toggling off should return it to leaf.
    const html = `<h2 data-free data-x="10" data-y="20" data-w="200" data-h="50" data-eid="h2">Hi</h2>`;
    const model = parseDeck(html);
    const el = findByEid(model, 'h2')!;
    expect(classify(el)).toBe('free'); // before
    setFree(el, false);
    expect(classify(el)).toBe('leaf'); // after (h2 is a LEAF_TAG)
  });
});

// ─── 6: toggleFree ───────────────────────────────────────────────────────────

describe('toggleFree()', () => {
  it('enables free on a structured element and returns true', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const result = toggleFree(model, 'h1', RECT);
    expect(result).toBe(true);
    const el = findByEid(model, 'h1')!;
    expect(hasAttribute(el, 'data-free')).toBe(true);
    expect(getAttribute(el, 'data-x')).toBe('50');
  });

  it('disables free on a free element and returns false', () => {
    const model = parseDeck(FREE_HTML);
    const result = toggleFree(model, 'f1');
    expect(result).toBe(false);
    const el = findByEid(model, 'f1')!;
    expect(hasAttribute(el, 'data-free')).toBe(false);
  });

  it('toggle on then off is a round-trip: no data-free at the end', () => {
    const model = parseDeck(STRUCTURED_HTML);
    toggleFree(model, 'h1', RECT);
    toggleFree(model, 'h1');
    const el = findByEid(model, 'h1')!;
    expect(hasAttribute(el, 'data-free')).toBe(false);
    expect(classify(el)).toBe('leaf');
  });
});

// ─── 7: unknown eid ──────────────────────────────────────────────────────────

describe('toggleFree() unknown eid', () => {
  it('returns null for an eid that does not exist', () => {
    const model = parseDeck(STRUCTURED_HTML);
    expect(toggleFree(model, 'zzz-does-not-exist')).toBeNull();
  });
});

// ─── 8: scoped dirty — siblings stay clean (spec 12 #4) ─────────────────────

describe('setFree() scoped dirty', () => {
  it('only the toggled element is dirty; its siblings remain clean', () => {
    const model = parseDeck(STRUCTURED_HTML);
    // After parsing, all nodes are clean.
    const s1 = findByEid(model, 's1')!;
    const c1 = findByEid(model, 'c1')!;
    const h1 = findByEid(model, 'h1')!;
    const p1 = findByEid(model, 'p1')!;
    expect([s1.dirty, c1.dirty, h1.dirty, p1.dirty]).toEqual([false, false, false, false]);

    setFree(h1, true, RECT);

    // Only h1 is dirty; section, container, and sibling p remain clean.
    expect(h1.dirty).toBe(true);
    expect(s1.dirty).toBe(false);
    expect(c1.dirty).toBe(false);
    expect(p1.dirty).toBe(false);
  });
});

// ─── 9: round-trip — geometry appears in serialized output ──────────────────

describe('setFree() round-trip serialization', () => {
  it('data-free and positional attributes appear in serialized output', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'h1')!;
    setFree(el, true, { x: 123, y: 456, w: 789, h: 42 });
    const out = serializeDeck(model);
    expect(out).toContain('data-free');
    expect(out).toContain('data-x="123"');
    expect(out).toContain('data-y="456"');
    expect(out).toContain('data-w="789"');
    expect(out).toContain('data-h="42"');
  });

  it('setFree(el, false): removes data-free from serialized output', () => {
    const model = parseDeck(FREE_HTML);
    const el = findByEid(model, 'f1')!;
    setFree(el, false);
    const out = serializeDeck(model);
    expect(out).not.toContain('data-free');
    expect(out).not.toContain('data-x');
    expect(out).not.toContain('data-y');
  });
});

// ─── 10: idempotency ─────────────────────────────────────────────────────────

describe('setFree() idempotency', () => {
  it('enabling free twice does not duplicate attributes', () => {
    const model = parseDeck(FREE_HTML);
    const el = findByEid(model, 'f1')!;
    setFree(el, true, { x: 10, y: 20, w: 30, h: 40 });
    setFree(el, true, { x: 10, y: 20, w: 30, h: 40 });
    // Attributes are just overwritten, no duplicates.
    const out = serializeDeck(model);
    const matches = out.match(/data-free/g);
    expect(matches?.length).toBe(1);
  });
});

// ─── 11: setFree(el, false) on non-free element ─────────────────────────────

describe('setFree(el, false) on non-free element', () => {
  it('is a no-op and does not mark the element dirty if it had no free attrs', () => {
    const model = parseDeck(STRUCTURED_HTML);
    const el = findByEid(model, 'h1')!;
    expect(el.dirty).toBe(false);
    // Calling setFree(false) on an element that has no data-free / positional attrs.
    // removeAttribute is a no-op (per edit.ts) if attribute is absent.
    setFree(el, false);
    // dirty stays false because removeAttribute only marks dirty if it actually removes.
    expect(el.dirty).toBe(false);
  });
});
