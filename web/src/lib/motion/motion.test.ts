/**
 * motion.test.ts — Pure model operation tests for Lane B (P6-7, P6-8, P6-9 / spec 07).
 *
 * All tests use the source-preserving parser + serializer; NO DOM / jsdom required.
 *
 * Coverage:
 *   Fragment ops   — toggle adds/removes class+index; style rotation; list ordering.
 *   Transition ops — per-slide set/read; deck-level set/read via .reveal div.
 *   Auto-animate   — sets data-auto-animate on pair; derives matching data-id.
 *   Byte stability — untouched nodes serialize verbatim after any of the above ops.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, getAttribute, findByEid, getSlides, stampEids } from '$lib/model';

import {
  toggleFragment,
  setFragmentIndex,
  setFragmentStyle,
  getFragmentIndex,
  getFragmentStyle,
  getFragmentsInSlide,
  isFragment,
  FRAGMENT_STYLES,
} from './fragments';

import {
  getSlideTransition,
  setSlideTransition,
  getDeckTransition,
  setDeckTransition,
} from './transitions';

import {
  enableAutoAnimate,
  disableAutoAnimate,
  hasAutoAnimate,
} from './auto-animate';

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** Minimal two-slide deck for transition and auto-animate tests. */
const TWO_SLIDES_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>T</title></head>
<body>
  <div class="reveal">
    <div class="slides">
      <section data-eid="s1">
        <h1 data-eid="h1">Title</h1>
        <p data-eid="p1">Paragraph one.</p>
      </section>
      <section data-eid="s2">
        <h1 data-eid="h2">Title copy</h1>
        <p data-eid="p2">Paragraph two.</p>
      </section>
    </div>
  </div>
</body>
</html>`;

/** Three-slide deck for previous-slide navigation tests. */
const THREE_SLIDES_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>T</title></head>
<body>
  <div class="reveal">
    <div class="slides">
      <section data-eid="s1"><h1 data-eid="h1">A</h1></section>
      <section data-eid="s2"><h1 data-eid="h2">B</h1><p data-eid="p1">B-p</p></section>
      <section data-eid="s3"><h1 data-eid="h3">C</h1><p data-eid="p2">C-p</p></section>
    </div>
  </div>
</body>
</html>`;

/** Deck with elements that have class attributes already. */
const CLASSED_HTML = `<!doctype html>
<html><head><meta charset="utf-8" /><title>T</title></head>
<body>
  <div class="reveal"><div class="slides">
    <section data-eid="s1">
      <p data-eid="p1" class="intro">Para with existing class.</p>
      <p data-eid="p2">Bare para.</p>
      <p data-eid="p3" class="fragment fade-up" data-fragment-index="0">Already fragment.</p>
    </section>
  </div></div>
</body></html>`;

// ─────────────────────────────────────────────────────────────────────────────
// FRAGMENT TESTS (P6-7)
// ─────────────────────────────────────────────────────────────────────────────

describe('fragments — toggleFragment', () => {
  it('adds "fragment" class to a bare element', () => {
    const model = parseDeck(CLASSED_HTML);
    const p2 = findByEid(model, 'p2')!;
    expect(isFragment(p2)).toBe(false);
    const result = toggleFragment(p2);
    expect(result).toBe(true);
    expect(isFragment(p2)).toBe(true);
    expect(getAttribute(p2, 'class')).toBe('fragment');
  });

  it('preserves existing classes when adding fragment', () => {
    const model = parseDeck(CLASSED_HTML);
    const p1 = findByEid(model, 'p1')!;
    toggleFragment(p1);
    const cls = getAttribute(p1, 'class')!;
    // Both 'intro' and 'fragment' should be present.
    expect(cls.split(' ')).toContain('intro');
    expect(cls.split(' ')).toContain('fragment');
  });

  it('removes "fragment" class and data-fragment-index when toggling off', () => {
    const model = parseDeck(CLASSED_HTML);
    const p3 = findByEid(model, 'p3')!;
    expect(isFragment(p3)).toBe(true);
    expect(getFragmentIndex(p3)).toBe(0);
    const result = toggleFragment(p3);
    expect(result).toBe(false);
    expect(isFragment(p3)).toBe(false);
    expect(getAttribute(p3, 'data-fragment-index')).toBeNull();
  });

  it('retains fade-up style class after removing fragment marker', () => {
    // The fragment style is left intact so re-enabling restores the style.
    const model = parseDeck(CLASSED_HTML);
    const p3 = findByEid(model, 'p3')!;
    toggleFragment(p3); // remove fragment
    const cls = getAttribute(p3, 'class') ?? '';
    // 'fragment' is gone, but 'fade-up' remains.
    expect(cls.split(' ')).not.toContain('fragment');
    expect(cls.split(' ')).toContain('fade-up');
  });

  it('stamps a data-fragment-index when an index is provided', () => {
    const model = parseDeck(CLASSED_HTML);
    const p2 = findByEid(model, 'p2')!;
    toggleFragment(p2, 3);
    expect(getAttribute(p2, 'data-fragment-index')).toBe('3');
  });

  it('does not stamp data-fragment-index when no index provided', () => {
    const model = parseDeck(CLASSED_HTML);
    const p2 = findByEid(model, 'p2')!;
    toggleFragment(p2); // no index argument
    expect(getAttribute(p2, 'data-fragment-index')).toBeNull();
  });
});

describe('fragments — setFragmentIndex', () => {
  it('writes data-fragment-index as a string', () => {
    const model = parseDeck(CLASSED_HTML);
    const p3 = findByEid(model, 'p3')!;
    setFragmentIndex(p3, 7);
    expect(getAttribute(p3, 'data-fragment-index')).toBe('7');
  });

  it('overwrites an existing index', () => {
    const model = parseDeck(CLASSED_HTML);
    const p3 = findByEid(model, 'p3')!;
    expect(getFragmentIndex(p3)).toBe(0);
    setFragmentIndex(p3, 2);
    expect(getFragmentIndex(p3)).toBe(2);
  });
});

describe('fragments — setFragmentStyle', () => {
  it('adds a style class to an existing fragment', () => {
    const model = parseDeck(CLASSED_HTML);
    const p2 = findByEid(model, 'p2')!;
    toggleFragment(p2);
    setFragmentStyle(p2, 'fade-up');
    const cls = getAttribute(p2, 'class')!;
    expect(cls.split(' ')).toContain('fragment');
    expect(cls.split(' ')).toContain('fade-up');
  });

  it('replaces an existing style class', () => {
    const model = parseDeck(CLASSED_HTML);
    const p3 = findByEid(model, 'p3')!;
    // p3 already has fade-up; replace with highlight-red.
    setFragmentStyle(p3, 'highlight-red');
    const cls = getAttribute(p3, 'class')!;
    expect(cls.split(' ')).not.toContain('fade-up');
    expect(cls.split(' ')).toContain('highlight-red');
  });

  it('removes the style class when null is passed', () => {
    const model = parseDeck(CLASSED_HTML);
    const p3 = findByEid(model, 'p3')!;
    setFragmentStyle(p3, null);
    const cls = getAttribute(p3, 'class') ?? '';
    // fragment class stays; style class is gone.
    expect(cls.split(' ')).toContain('fragment');
    for (const s of FRAGMENT_STYLES) {
      expect(cls.split(' ')).not.toContain(s);
    }
  });
});

describe('fragments — getFragmentsInSlide', () => {
  const ORDERED_HTML = `<!doctype html>
<html><head><meta charset="utf-8"/><title>T</title></head>
<body>
  <div class="reveal"><div class="slides">
    <section data-eid="s1">
      <h1 data-eid="h1">Not a fragment.</h1>
      <p data-eid="p1" class="fragment" data-fragment-index="1">Step 2</p>
      <p data-eid="p2" class="fragment" data-fragment-index="0">Step 1</p>
      <p data-eid="p3" class="fragment">Auto-index (no explicit)</p>
    </section>
  </div></div>
</body></html>`;

  it('returns only fragment elements, not the slide root or non-fragments', () => {
    const model = parseDeck(ORDERED_HTML);
    const slide = findByEid(model, 's1')!;
    const frags = getFragmentsInSlide(slide);
    const eids = frags.map((f) => f.eid);
    expect(eids).not.toContain('s1');
    expect(eids).not.toContain('h1'); // h1 has no fragment class
    expect(eids).toContain('p1');
    expect(eids).toContain('p2');
    expect(eids).toContain('p3');
  });

  it('sorts by explicit data-fragment-index ascending, nulls last', () => {
    const model = parseDeck(ORDERED_HTML);
    const slide = findByEid(model, 's1')!;
    const frags = getFragmentsInSlide(slide);
    const eids = frags.map((f) => f.eid);
    // p2 has index=0, p1 has index=1, p3 has no index → p2, p1, p3
    expect(eids).toEqual(['p2', 'p1', 'p3']);
  });

  it('returns FragmentInfo with correct index and style fields', () => {
    const model = parseDeck(ORDERED_HTML);
    const slide = findByEid(model, 's1')!;
    const frags = getFragmentsInSlide(slide);
    const p2Info = frags.find((f) => f.eid === 'p2')!;
    expect(p2Info.index).toBe(0);
    expect(p2Info.style).toBeNull(); // no style class
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION TESTS (P6-8)
// ─────────────────────────────────────────────────────────────────────────────

describe('transitions — per-slide setSlideTransition / getSlideTransition', () => {
  it('sets data-transition on a section', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    setSlideTransition(s1, 'zoom');
    expect(getAttribute(s1, 'data-transition')).toBe('zoom');
  });

  it('sets data-transition-speed when provided', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    setSlideTransition(s1, 'fade', 'fast');
    expect(getAttribute(s1, 'data-transition-speed')).toBe('fast');
  });

  it('reads back transition and speed via getSlideTransition', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    setSlideTransition(s1, 'convex', 'slow');
    const result = getSlideTransition(s1);
    expect(result.transition).toBe('convex');
    expect(result.speed).toBe('slow');
  });

  it('removes data-transition when null is passed', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    setSlideTransition(s1, 'zoom');
    setSlideTransition(s1, null);
    expect(getAttribute(s1, 'data-transition')).toBeNull();
  });

  it('removes data-transition-speed when null speed is passed', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    setSlideTransition(s1, 'slide', 'fast');
    setSlideTransition(s1, 'slide', null);
    expect(getAttribute(s1, 'data-transition-speed')).toBeNull();
  });

  it('leaves speed unchanged when speed argument is omitted', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    setSlideTransition(s1, 'slide', 'slow');
    setSlideTransition(s1, 'fade'); // omit speed
    // speed should remain 'slow' — not touched
    expect(getAttribute(s1, 'data-transition-speed')).toBe('slow');
  });

  it('returns null for absent transition/speed', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    const result = getSlideTransition(s1);
    expect(result.transition).toBeNull();
    expect(result.speed).toBeNull();
  });

  it('does not dirty the untouched sibling slide', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s1 = findByEid(model, 's1')!;
    const s2 = findByEid(model, 's2')!;
    setSlideTransition(s1, 'zoom');
    // s2 is not dirty — its original source bytes should appear verbatim.
    const out = serializeDeck(model);
    // s2 should still have its raw markup unchanged.
    expect(out).toContain('data-eid="s2"');
    // s1 was edited — confirm the new attribute appears.
    expect(out).toContain('data-transition="zoom"');
    // Idempotency check.
    expect(serializeDeck(parseDeck(out))).toBe(out);
  });
});

describe('transitions — deck-level setDeckTransition / getDeckTransition', () => {
  it('sets data-transition on the .reveal div', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const result = setDeckTransition(model, 'none');
    expect(result).toBe(true);
    // The .reveal div should carry the attribute.
    const out = serializeDeck(model);
    expect(out).toContain('data-transition="none"');
    // It should be on the div.reveal — verify by re-parsing and reading.
    const model2 = parseDeck(out);
    const { transition } = getDeckTransition(model2);
    expect(transition).toBe('none');
  });

  it('sets deck-level speed on the .reveal div', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    setDeckTransition(model, 'slide', 'fast');
    const { transition, speed } = getDeckTransition(model);
    expect(transition).toBe('slide');
    expect(speed).toBe('fast');
  });

  it('removes deck-level transition when null is passed', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    setDeckTransition(model, 'zoom');
    setDeckTransition(model, null);
    expect(getDeckTransition(model).transition).toBeNull();
  });

  it('returns null for both when not set', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const { transition, speed } = getDeckTransition(model);
    expect(transition).toBeNull();
    expect(speed).toBeNull();
  });

  it('returns false when the .reveal div is absent (safe no-op)', () => {
    const model = parseDeck('<html><body><p>No reveal div.</p></body></html>');
    const result = setDeckTransition(model, 'fade');
    expect(result).toBe(false);
  });

  it('does not affect slide data-transition attributes', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    setDeckTransition(model, 'convex');
    // Per-slide transition attributes on s1 and s2 should still be absent.
    const s1 = findByEid(model, 's1')!;
    expect(getAttribute(s1, 'data-transition')).toBeNull();
  });

  it('byte-stable: untouched slides round-trip verbatim after deck-level edit', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    setDeckTransition(model, 'slide');
    const out = serializeDeck(model);
    // The full document still parses and re-serializes identically.
    expect(serializeDeck(parseDeck(out))).toBe(out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-ANIMATE TESTS (P6-9)
// ─────────────────────────────────────────────────────────────────────────────

describe('auto-animate — enableAutoAnimate', () => {
  it('stamps data-auto-animate on BOTH the current and previous slide', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const ok = enableAutoAnimate(model, 's2');
    expect(ok).toBe(true);
    const s1 = findByEid(model, 's1')!;
    const s2 = findByEid(model, 's2')!;
    expect(hasAutoAnimate(s1)).toBe(true);
    expect(hasAutoAnimate(s2)).toBe(true);
  });

  it('data-auto-animate is a boolean attribute (no value)', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    const out = serializeDeck(model);
    // Boolean attribute should appear without ="..." — or with="" at most.
    // Our serializer emits boolean as `data-auto-animate` (no value).
    expect(out).toMatch(/data-auto-animate(?!=")/);
  });

  it('derives data-id from data-eid for matched elements', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    // h1 in s2 (h2) should get data-id equal to its own data-eid.
    const h2 = findByEid(model, 'h2')!;
    expect(getAttribute(h2, 'data-id')).toBe('h2');
    // p in s2 (p2) should get data-id equal to its own data-eid.
    const p2 = findByEid(model, 'p2')!;
    expect(getAttribute(p2, 'data-id')).toBe('p2');
  });

  it('propagates matching data-id to the corresponding elements in the previous slide', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    const h1 = findByEid(model, 'h1')!;
    const h2 = findByEid(model, 'h2')!;
    // h1 (prev slide's h1) and h2 (current slide's h1) must share the same data-id.
    const id1 = getAttribute(h1, 'data-id');
    const id2 = getAttribute(h2, 'data-id');
    expect(id1).not.toBeNull();
    expect(id1).toBe(id2); // same data-id → reveal tweens them
  });

  it('returns false when slideEid is not found', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    expect(enableAutoAnimate(model, 'nonexistent')).toBe(false);
  });

  it('returns false when there is no previous slide (first slide)', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    expect(enableAutoAnimate(model, 's1')).toBe(false);
  });

  it('handles three-slide decks: s3 pairs with s2, not s1', () => {
    const model = parseDeck(THREE_SLIDES_HTML);
    enableAutoAnimate(model, 's3');
    const s1 = findByEid(model, 's1')!;
    const s2 = findByEid(model, 's2')!;
    const s3 = findByEid(model, 's3')!;
    // Only s2 and s3 should be marked, not s1.
    expect(hasAutoAnimate(s2)).toBe(true);
    expect(hasAutoAnimate(s3)).toBe(true);
    expect(hasAutoAnimate(s1)).toBe(false);
  });

  it('pairs p elements correctly across s2 and s3', () => {
    const model = parseDeck(THREE_SLIDES_HTML);
    enableAutoAnimate(model, 's3');
    const p1 = findByEid(model, 'p1')!; // in s2
    const p2 = findByEid(model, 'p2')!; // in s3
    const id_prev = getAttribute(p1, 'data-id');
    const id_curr = getAttribute(p2, 'data-id');
    expect(id_curr).toBe('p2'); // current slide element gets own eid as data-id
    expect(id_prev).toBe('p2'); // previous slide element gets same data-id
  });
});

describe('auto-animate — disableAutoAnimate', () => {
  it('removes data-auto-animate from the target slide', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    expect(hasAutoAnimate(findByEid(model, 's2')!)).toBe(true);
    const ok = disableAutoAnimate(model, 's2');
    expect(ok).toBe(true);
    expect(hasAutoAnimate(findByEid(model, 's2')!)).toBe(false);
  });

  it('leaves data-auto-animate on the previous slide', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    disableAutoAnimate(model, 's2');
    // s1 still has data-auto-animate — it was not the target of disable.
    expect(hasAutoAnimate(findByEid(model, 's1')!)).toBe(true);
  });

  it('leaves data-id attributes intact (facilitates quick re-enable)', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    disableAutoAnimate(model, 's2');
    const h2 = findByEid(model, 'h2')!;
    expect(getAttribute(h2, 'data-id')).not.toBeNull();
  });

  it('returns false when slide is not found', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    expect(disableAutoAnimate(model, 'missing')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BYTE STABILITY TESTS (spec 12 #4)
// ─────────────────────────────────────────────────────────────────────────────

describe('byte stability — only modified elements are re-serialized', () => {
  it('toggleFragment only dirties the modified element', () => {
    const model = parseDeck(CLASSED_HTML);
    const p2 = findByEid(model, 'p2')!;
    toggleFragment(p2); // only p2 is changed
    const out = serializeDeck(model);
    // p1's original bytes are verbatim.
    expect(out).toContain('class="intro"');
    // p3's original bytes are verbatim (it was not touched).
    expect(out).toContain('class="fragment fade-up" data-fragment-index="0"');
    // p2 now has the fragment class.
    expect(out).toContain('class="fragment"');
  });

  it('setSlideTransition on s1 does not affect s2 bytes', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    const s2 = findByEid(model, 's2')!;
    const s2RawBefore = s2.rawOpen; // original open tag bytes
    setSlideTransition(findByEid(model, 's1')!, 'zoom');
    // s2 is untouched, its rawOpen should be the same.
    expect(s2.rawOpen).toBe(s2RawBefore);
    expect(s2.dirty).toBeFalsy();
  });

  it('enableAutoAnimate round-trips correctly after editing', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    enableAutoAnimate(model, 's2');
    const out = serializeDeck(model);
    // The edited document must re-serialize identically from its own bytes.
    expect(serializeDeck(parseDeck(out))).toBe(out);
  });

  it('fragment operations produce byte-stable output on round-trip', () => {
    const model = parseDeck(CLASSED_HTML);
    const p2 = findByEid(model, 'p2')!;
    toggleFragment(p2, 1);
    setFragmentStyle(p2, 'fade-up');
    const out = serializeDeck(model);
    expect(serializeDeck(parseDeck(out))).toBe(out);
  });

  it('deck transition on .reveal div is byte-stable on round-trip', () => {
    const model = parseDeck(TWO_SLIDES_HTML);
    setDeckTransition(model, 'concave', 'slow');
    const out = serializeDeck(model);
    expect(serializeDeck(parseDeck(out))).toBe(out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STAMP-EID INTERACTION (auto-animate must work on freshly-stamped decks)
// ─────────────────────────────────────────────────────────────────────────────

describe('auto-animate — works with freshly stampEids models', () => {
  const UNSTAMPED = `<!doctype html>
<html><head><meta charset="utf-8"/><title>T</title></head>
<body>
  <div class="reveal"><div class="slides">
    <section>
      <h1>Title A</h1>
      <p>Para A</p>
    </section>
    <section>
      <h1>Title B</h1>
      <p>Para B</p>
    </section>
  </div></div>
</body></html>`;

  it('enables auto-animate after stampEids', () => {
    const model = parseDeck(UNSTAMPED);
    stampEids(model);
    // All sections should now have eids; find the second slide.
    const slides = getSlides(model);
    expect(slides).toHaveLength(2);
    const secondEid = getAttribute(slides[1], 'data-eid');
    expect(secondEid).not.toBeNull();
    const ok = enableAutoAnimate(model, secondEid!);
    expect(ok).toBe(true);
    expect(hasAutoAnimate(slides[0])).toBe(true);
    expect(hasAutoAnimate(slides[1])).toBe(true);
  });
});
