/**
 * layout.test.ts — Unit tests for the layout-props model (P3-4 / spec 03).
 *
 * Test goals:
 *   1. getLayoutProps() returns typed props from data-* attrs — correct values,
 *      correct null for absent attrs, unknown attr values coerce to null.
 *   2. setLayoutProps() writes attrs, removes on null, and marks the element dirty.
 *   3. findParentOf() returns the immediate element parent of the target eid.
 *   4. findNearestContainerAncestor() finds the closest container up the chain.
 *   5. resolveContainerForEid() returns the container itself for containers, the
 *      nearest ancestor container for leaves, and null for passhtrough/missing.
 *   6. "Button → prop change" mapping: a simulated toolbar click produces exactly
 *      the expected data-* attribute write on the element (no side-effects on
 *      siblings or other attrs).
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, getAttribute, createElement } from './index';
import {
  getLayoutProps,
  setLayoutProps,
  findParentOf,
  findNearestContainerAncestor,
  resolveContainerForEid,
  getLayoutMarker,
  setLayoutMarker,
  getSlot,
  setSlot,
  getAutoslide,
  setAutoslide,
  type LayoutProps,
  type AlignValue,
  type JustifyValue,
} from './layout';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/**
 * Small deck with:
 *   section[data-eid=s1]
 *     div[data-lay=row, data-gap=32, data-align=center, data-eid=c1]
 *       h2[data-eid=h1]
 *       p[data-eid=p1]
 *     div[data-lay=grid, data-cols=3, data-rows=2, data-pad=16, data-justify=between, data-eid=c2]
 *       p[data-eid=p2]
 */
const DECK_HTML = `<!DOCTYPE html>
<html><body>
<div class="reveal"><div class="slides">
  <section data-eid="s1">
    <div data-lay="row" data-gap="32" data-align="center" data-eid="c1">
      <h2 data-eid="h1">Heading</h2>
      <p data-eid="p1">Paragraph</p>
    </div>
    <div data-lay="grid" data-cols="3" data-rows="2" data-pad="16" data-justify="between" data-eid="c2">
      <p data-eid="p2">Grid child</p>
    </div>
  </section>
</div></div>
</body></html>`;

/** Parse once per suite (pure reads — no mutations in these tests). */
function parseSample() {
  return parseDeck(DECK_HTML);
}

// ─── 1. getLayoutProps ─────────────────────────────────────────────────────

describe('getLayoutProps()', () => {
  it('returns all set attributes for a row container', () => {
    const model = parseSample();
    // Walk to find c1
    const el = findElByEid(model, 'c1');
    expect(el).not.toBeNull();
    const props = getLayoutProps(el!);
    expect(props.lay).toBe('row');
    expect(props.gap).toBe(32);
    expect(props.align).toBe('center');
    expect(props.justify).toBeNull(); // not set on c1
    expect(props.pad).toBeNull();     // not set on c1
    expect(props.cols).toBeNull();
    expect(props.rows).toBeNull();
  });

  it('returns grid-specific props (cols, rows, justify) for a grid container', () => {
    const model = parseSample();
    const el = findElByEid(model, 'c2');
    expect(el).not.toBeNull();
    const props = getLayoutProps(el!);
    expect(props.lay).toBe('grid');
    expect(props.cols).toBe('3');
    expect(props.rows).toBe('2');
    expect(props.pad).toBe(16);
    expect(props.justify).toBe('between');
    expect(props.align).toBeNull();
    expect(props.gap).toBeNull();
  });

  it('returns null for every prop on an element with no layout attrs', () => {
    const el = createElement('h2', {});
    const lp = getLayoutProps(el);
    // Core container props — all null when no data-* attrs are present.
    expect(lp.lay).toBeNull();
    expect(lp.gap).toBeNull();
    expect(lp.align).toBeNull();
    expect(lp.justify).toBeNull();
    expect(lp.pad).toBeNull();
    expect(lp.cols).toBeNull();
    expect(lp.rows).toBeNull();
    // Child layout props (grow/basis/span) also null on an empty element.
    // Lane A extended LayoutProps with these spec-03 child-attribute fields.
    expect(lp.grow).toBeNull();
    expect(lp.basis).toBeNull();
    expect(lp.span).toBeNull();
  });

  it('coerces unknown lay value to null (unknown primitives are unrecognised)', () => {
    const el = createElement('div', { 'data-lay': 'unknown-primitive' });
    expect(getLayoutProps(el).lay).toBeNull();
  });

  it('coerces unknown align value to null', () => {
    const el = createElement('div', { 'data-lay': 'row', 'data-align': 'bogus' });
    expect(getLayoutProps(el).align).toBeNull();
  });

  it('coerces unknown justify value to null', () => {
    const el = createElement('div', { 'data-lay': 'stack', 'data-justify': 'distributed' });
    expect(getLayoutProps(el).justify).toBeNull();
  });

  it('returns null for non-numeric gap / pad', () => {
    const el = createElement('div', { 'data-gap': 'auto', 'data-pad': 'foo' });
    expect(getLayoutProps(el).gap).toBeNull();
    expect(getLayoutProps(el).pad).toBeNull();
  });

  it('parses section (slide root container) — lay is null because sections use no data-lay', () => {
    const model = parseSample();
    const el = findElByEid(model, 's1');
    expect(el).not.toBeNull();
    const props = getLayoutProps(el!);
    // sections don't carry data-lay
    expect(props.lay).toBeNull();
  });

  it('recognises all valid LayValues', () => {
    for (const lay of ['stack', 'row', 'grid', 'layers'] as const) {
      const el = createElement('div', { 'data-lay': lay });
      expect(getLayoutProps(el).lay).toBe(lay);
    }
  });

  it('recognises all valid AlignValues', () => {
    for (const align of ['start', 'center', 'end', 'stretch'] as const) {
      const el = createElement('div', { 'data-align': align });
      expect(getLayoutProps(el).align).toBe(align);
    }
  });

  it('recognises all valid JustifyValues', () => {
    for (const justify of ['start', 'center', 'end', 'between', 'around'] as const) {
      const el = createElement('div', { 'data-justify': justify });
      expect(getLayoutProps(el).justify).toBe(justify);
    }
  });
});

// ─── 2. setLayoutProps ─────────────────────────────────────────────────────

describe('setLayoutProps()', () => {
  it('sets gap on a clean element and marks it dirty', () => {
    const el = createElement('div', { 'data-lay': 'stack' });
    // createElement starts dirty; reset to test the mutation.
    el.dirty = false;
    setLayoutProps(el, { gap: 24 });
    expect(getAttribute(el, 'data-gap')).toBe('24');
    expect(el.dirty).toBe(true);
  });

  it('removes an attribute when the value is null', () => {
    const el = createElement('div', { 'data-lay': 'row', 'data-align': 'center' });
    setLayoutProps(el, { align: null });
    expect(getAttribute(el, 'data-align')).toBeNull();
  });

  it('does NOT touch attributes whose key is absent from the delta', () => {
    const el = createElement('div', {
      'data-lay': 'row',
      'data-gap': '16',
      'data-align': 'center',
    });
    setLayoutProps(el, { gap: 32 }); // only touch gap
    expect(getAttribute(el, 'data-align')).toBe('center'); // untouched
    expect(getAttribute(el, 'data-lay')).toBe('row');       // untouched
    expect(getAttribute(el, 'data-gap')).toBe('32');        // changed
  });

  it('sets the lay attribute from a delta', () => {
    const el = createElement('div', {});
    setLayoutProps(el, { lay: 'grid' });
    expect(getAttribute(el, 'data-lay')).toBe('grid');
  });

  it('sets cols and rows for grid', () => {
    const el = createElement('div', { 'data-lay': 'grid' });
    setLayoutProps(el, { cols: '3', rows: '2' });
    expect(getAttribute(el, 'data-cols')).toBe('3');
    expect(getAttribute(el, 'data-rows')).toBe('2');
  });

  it('removes cols and rows when null (reverting to auto)', () => {
    const el = createElement('div', { 'data-lay': 'grid', 'data-cols': '3' });
    setLayoutProps(el, { cols: null });
    expect(getAttribute(el, 'data-cols')).toBeNull();
  });

  it('encodes pad as a string integer', () => {
    const el = createElement('div', {});
    setLayoutProps(el, { pad: 48 });
    expect(getAttribute(el, 'data-pad')).toBe('48');
  });
});

// ─── 3. findParentOf ───────────────────────────────────────────────────────

describe('findParentOf()', () => {
  it('returns the immediate parent element of the target eid', () => {
    const model = parseSample();
    // h1 is inside c1
    const parent = findParentOf(model, 'h1');
    expect(parent).not.toBeNull();
    expect(getAttribute(parent!, 'data-eid')).toBe('c1');
  });

  it('returns null for an eid that does not exist', () => {
    const model = parseSample();
    expect(findParentOf(model, 'zzz-nonexistent')).toBeNull();
  });

  it('returns the section for a direct child of the section', () => {
    const model = parseSample();
    // c1 and c2 are direct children of s1
    const parent = findParentOf(model, 'c1');
    expect(parent).not.toBeNull();
    expect(getAttribute(parent!, 'data-eid')).toBe('s1');
  });
});

// ─── 4. findNearestContainerAncestor ───────────────────────────────────────

describe('findNearestContainerAncestor()', () => {
  it('finds the nearest container up the tree for a leaf', () => {
    const model = parseSample();
    // h1 is a leaf inside c1 (a row container)
    const ancestor = findNearestContainerAncestor(model, 'h1');
    expect(ancestor).not.toBeNull();
    expect(getAttribute(ancestor!, 'data-eid')).toBe('c1');
  });

  it('skips intermediate non-container ancestors', () => {
    // Leaf nested inside a passthrough div which is inside a stack container
    const html = `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">
      <section data-eid="s1">
        <div data-lay="stack" data-eid="stk1">
          <div data-eid="pt1">
            <p data-eid="para1">text</p>
          </div>
        </div>
      </section>
    </div></div></body></html>`;
    const model = parseDeck(html);
    const ancestor = findNearestContainerAncestor(model, 'para1');
    expect(ancestor).not.toBeNull();
    // The passthrough div has no data-lay, so the nearest container is stk1
    expect(getAttribute(ancestor!, 'data-eid')).toBe('stk1');
  });

  it('returns null when the eid does not exist', () => {
    const model = parseSample();
    expect(findNearestContainerAncestor(model, 'missing')).toBeNull();
  });
});

// ─── 5. resolveContainerForEid ─────────────────────────────────────────────

describe('resolveContainerForEid()', () => {
  it('returns the container itself when a container eid is given', () => {
    const model = parseSample();
    const result = resolveContainerForEid(model, 'c1');
    expect(result).not.toBeNull();
    expect(getAttribute(result!.el, 'data-eid')).toBe('c1');
    expect(result!.isOwnContainer).toBe(true);
  });

  it('returns the section itself when the section eid is given', () => {
    const model = parseSample();
    const result = resolveContainerForEid(model, 's1');
    expect(result).not.toBeNull();
    expect(getAttribute(result!.el, 'data-eid')).toBe('s1');
    expect(result!.isOwnContainer).toBe(true);
  });

  it('returns the parent container when a leaf eid is given', () => {
    const model = parseSample();
    // h1 is a leaf inside c1
    const result = resolveContainerForEid(model, 'h1');
    expect(result).not.toBeNull();
    expect(getAttribute(result!.el, 'data-eid')).toBe('c1');
    expect(result!.isOwnContainer).toBe(false);
  });

  it('returns null for a missing eid', () => {
    const model = parseSample();
    expect(resolveContainerForEid(model, 'nope')).toBeNull();
  });
});

// ─── 6. Button → prop change mapping ───────────────────────────────────────
//
// These tests simulate what happens when the user clicks an alignment/justify
// button in the toolbar.  The toolbar calls setLayoutProps with a single-key
// delta; we verify that EXACTLY one attribute changes and nothing else.

describe('Toolbar button → prop change (alignment-as-intent)', () => {
  it('"align center" button sets data-align=center (only)', () => {
    const el = createElement('div', { 'data-lay': 'row', 'data-gap': '32' });
    el.dirty = false;

    // Simulate the "align center" button click.
    const clickedAlign: AlignValue = 'center';
    setLayoutProps(el, { align: clickedAlign });

    expect(getAttribute(el, 'data-align')).toBe('center');
    expect(getAttribute(el, 'data-lay')).toBe('row');   // unchanged
    expect(getAttribute(el, 'data-gap')).toBe('32');     // unchanged
    expect(el.dirty).toBe(true);
  });

  it('"align start" button sets data-align=start', () => {
    const el = createElement('div', { 'data-lay': 'stack', 'data-align': 'center' });
    setLayoutProps(el, { align: 'start' });
    expect(getAttribute(el, 'data-align')).toBe('start');
  });

  it('"align end" button sets data-align=end', () => {
    const el = createElement('div', { 'data-lay': 'stack' });
    setLayoutProps(el, { align: 'end' });
    expect(getAttribute(el, 'data-align')).toBe('end');
  });

  it('"justify center" button sets data-justify=center (only)', () => {
    const el = createElement('div', { 'data-lay': 'stack', 'data-gap': '16' });
    el.dirty = false;

    const clickedJustify: JustifyValue = 'center';
    setLayoutProps(el, { justify: clickedJustify });

    expect(getAttribute(el, 'data-justify')).toBe('center');
    expect(getAttribute(el, 'data-gap')).toBe('16');   // unchanged
    expect(el.dirty).toBe(true);
  });

  it('"justify between" button sets data-justify=between', () => {
    const el = createElement('div', { 'data-lay': 'row' });
    setLayoutProps(el, { justify: 'between' });
    expect(getAttribute(el, 'data-justify')).toBe('between');
  });

  it('"justify around" button sets data-justify=around', () => {
    const el = createElement('div', { 'data-lay': 'row' });
    setLayoutProps(el, { justify: 'around' });
    expect(getAttribute(el, 'data-justify')).toBe('around');
  });

  it('"justify end" button sets data-justify=end', () => {
    const el = createElement('div', { 'data-lay': 'row' });
    setLayoutProps(el, { justify: 'end' });
    expect(getAttribute(el, 'data-justify')).toBe('end');
  });

  it('pressing the active align button again (same value) is idempotent', () => {
    const el = createElement('div', { 'data-lay': 'row', 'data-align': 'center' });
    setLayoutProps(el, { align: 'center' });
    expect(getAttribute(el, 'data-align')).toBe('center');
  });

  it('"remove align" (null) clears data-align (reset to default stretch)', () => {
    const el = createElement('div', { 'data-lay': 'row', 'data-align': 'end' });
    setLayoutProps(el, { align: null });
    expect(getAttribute(el, 'data-align')).toBeNull();
  });

  it('setting gap to 0 writes "0", setting to null removes it', () => {
    const el = createElement('div', { 'data-lay': 'stack', 'data-gap': '24' });
    setLayoutProps(el, { gap: 0 });
    expect(getAttribute(el, 'data-gap')).toBe('0');
    setLayoutProps(el, { gap: null });
    expect(getAttribute(el, 'data-gap')).toBeNull();
  });
});

// ─── 7. P3-2: getContainerKind ────────────────────────────────────────────────
//
// Verifies the new ContainerKind API added in P3-2.

import { readFileSync } from 'node:fs';
import {
  getContainerKind,
  type ContainerKind,
} from './layout';
import { getElementsByTagName, serializeDeck, findByEid } from './index';

function loadFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
}

describe('getContainerKind() — P3-2', () => {
  it('returns correct kind for each data-lay primitive', () => {
    for (const lay of ['stack', 'row', 'grid', 'layers'] as const) {
      const el = createElement('div', { 'data-lay': lay });
      expect(getContainerKind(el)).toBe(lay as ContainerKind);
    }
  });

  it('returns "section" for section elements', () => {
    const model = parseDeck(`<root><section data-eid="s1"></section></root>`);
    const el = getElementsByTagName(model, 'section')[0];
    expect(getContainerKind(el)).toBe('section');
  });

  it('returns null for data-free elements (escape hatch, not a container)', () => {
    const el = createElement('div', { 'data-free': null, 'data-x': '0', 'data-y': '0' });
    expect(getContainerKind(el)).toBeNull();
  });

  it('returns null even when both data-free and data-lay are present (free wins)', () => {
    const el = createElement('div', { 'data-free': null, 'data-lay': 'row' });
    expect(getContainerKind(el)).toBeNull();
  });

  it('returns null for leaf elements (p, h2, img)', () => {
    for (const tag of ['p', 'h2', 'img']) {
      const el = createElement(tag, {});
      expect(getContainerKind(el)).toBeNull();
    }
  });

  it('returns null for a div without data-lay (passthrough)', () => {
    const el = createElement('div', { class: 'reveal' });
    expect(getContainerKind(el)).toBeNull();
  });

  it('reads kinds from the data-lay fixture (all four primitives present)', () => {
    const model = parseDeck(loadFixture('data-lay.html'));
    const divs = getElementsByTagName(model, 'div').filter(
      (d) => getAttribute(d, 'data-lay') !== null,
    );
    const kinds = divs.map((d) => getContainerKind(d));
    expect(kinds).toContain('stack');
    expect(kinds).toContain('row');
    expect(kinds).toContain('grid');
    expect(kinds).toContain('layers');
  });
});

// ─── 8. P3-2: child attributes (grow, basis, span) ──────────────────────────

describe('getLayoutProps() + setLayoutProps() — child attributes (P3-2)', () => {
  it('reads data-grow as a number', () => {
    const el = createElement('div', { 'data-grow': '2' });
    expect(getLayoutProps(el).grow).toBe(2);
  });

  it('reads data-basis as a string', () => {
    const el = createElement('div', { 'data-basis': '50%' });
    expect(getLayoutProps(el).basis).toBe('50%');
  });

  it('reads data-span as a number', () => {
    const el = createElement('div', { 'data-span': '3' });
    expect(getLayoutProps(el).span).toBe(3);
  });

  it('sets grow and round-trips via getLayoutProps', () => {
    const el = createElement('div', {});
    setLayoutProps(el, { grow: 1 });
    expect(getLayoutProps(el).grow).toBe(1);
    expect(getAttribute(el, 'data-grow')).toBe('1');
  });

  it('sets basis and round-trips via getLayoutProps', () => {
    const el = createElement('div', {});
    setLayoutProps(el, { basis: '40%' });
    expect(getLayoutProps(el).basis).toBe('40%');
  });

  it('sets span and round-trips via getLayoutProps', () => {
    const el = createElement('div', {});
    setLayoutProps(el, { span: 2 });
    expect(getLayoutProps(el).span).toBe(2);
  });

  it('removes grow by passing null', () => {
    const el = createElement('div', { 'data-grow': '1' });
    setLayoutProps(el, { grow: null });
    expect(getAttribute(el, 'data-grow')).toBeNull();
  });

  it('throws TypeError for negative grow', () => {
    const el = createElement('div', {});
    expect(() => setLayoutProps(el, { grow: -1 })).toThrow(TypeError);
  });

  it('throws TypeError for fractional span', () => {
    const el = createElement('div', {});
    expect(() => setLayoutProps(el, { span: 1.5 })).toThrow(TypeError);
  });

  it('throws TypeError for span === 0 (must be ≥1)', () => {
    const el = createElement('div', {});
    expect(() => setLayoutProps(el, { span: 0 })).toThrow(TypeError);
  });
});

// ─── 9. P3-2: moveChild ──────────────────────────────────────────────────────

import { walk } from './edit';
import type { DeckModel, ElementNode } from './types';

function findElByEid(model: DeckModel, eid: string): ElementNode | null {
  let found: ElementNode | null = null;
  walk(model, (node) => {
    if (found || node.type !== 'element') return;
    if (getAttribute(node, 'data-eid') === eid) found = node;
  });
  return found;
}

// ─── 10. P14: getLayoutMarker / setLayoutMarker ──────────────────────────────
//
// data-layout is a non-authoritative MARKER on <section> elements that records
// the applied preset name. Any non-empty string is valid; the attribute has no
// reflow semantics (layout is driven by data-lay subtree).
//
// Dual-encoded: Go validator (internal/validate/validate.go) must stay in sync
// on attribute name and the non-empty contract.

describe('getLayoutMarker() + setLayoutMarker() — P14', () => {
  it('returns null when data-layout is absent', () => {
    const el = createElement('section', {});
    expect(getLayoutMarker(el)).toBeNull();
  });

  it('returns the marker string when data-layout is set', () => {
    const el = createElement('section', { 'data-layout': 'two-column' });
    expect(getLayoutMarker(el)).toBe('two-column');
  });

  it('returns null when data-layout is an empty string', () => {
    const el = createElement('section', { 'data-layout': '' });
    expect(getLayoutMarker(el)).toBeNull();
  });

  it('sets data-layout and marks the element dirty', () => {
    const el = createElement('section', {});
    el.dirty = false;
    setLayoutMarker(el, 'title-body');
    expect(getAttribute(el, 'data-layout')).toBe('title-body');
    expect(el.dirty).toBe(true);
  });

  it('removes data-layout when null is passed', () => {
    const el = createElement('section', { 'data-layout': 'two-column' });
    setLayoutMarker(el, null);
    expect(getAttribute(el, 'data-layout')).toBeNull();
  });

  it('round-trips via get after set', () => {
    const el = createElement('section', {});
    setLayoutMarker(el, 'blank');
    expect(getLayoutMarker(el)).toBe('blank');
  });

  it('is byte-stable: setting the same value is idempotent', () => {
    const el = createElement('section', { 'data-layout': 'two-column' });
    el.dirty = false;
    setLayoutMarker(el, 'two-column');
    // value is still present after a redundant set
    expect(getAttribute(el, 'data-layout')).toBe('two-column');
  });

  it('throws TypeError when an empty string is passed (use null to clear)', () => {
    const el = createElement('section', {});
    expect(() => setLayoutMarker(el, '')).toThrow(TypeError);
  });

  it('does not disturb other attributes on the section', () => {
    const el = createElement('section', { 'data-eid': 's1', 'data-theme': 'moon' });
    setLayoutMarker(el, 'two-column');
    expect(getAttribute(el, 'data-eid')).toBe('s1');
    expect(getAttribute(el, 'data-theme')).toBe('moon');
  });
});

// ─── 11. P14: getSlot / setSlot ──────────────────────────────────────────────
//
// data-slot is a non-authoritative MARKER on any element that names its
// semantic role within a preset layout (e.g. "content", "sidebar"). Any
// non-empty string is valid; the attribute has no reflow semantics.
//
// Dual-encoded: Go validator (internal/validate/validate.go) must stay in sync
// on attribute name and the non-empty contract.

describe('getSlot() + setSlot() — P14', () => {
  it('returns null when data-slot is absent', () => {
    const el = createElement('div', {});
    expect(getSlot(el)).toBeNull();
  });

  it('returns the slot name when data-slot is set', () => {
    const el = createElement('div', { 'data-slot': 'content' });
    expect(getSlot(el)).toBe('content');
  });

  it('returns null when data-slot is an empty string', () => {
    const el = createElement('div', { 'data-slot': '' });
    expect(getSlot(el)).toBeNull();
  });

  it('sets data-slot and marks the element dirty', () => {
    const el = createElement('div', {});
    el.dirty = false;
    setSlot(el, 'sidebar');
    expect(getAttribute(el, 'data-slot')).toBe('sidebar');
    expect(el.dirty).toBe(true);
  });

  it('removes data-slot when null is passed', () => {
    const el = createElement('div', { 'data-slot': 'content' });
    setSlot(el, null);
    expect(getAttribute(el, 'data-slot')).toBeNull();
  });

  it('round-trips via get after set', () => {
    const el = createElement('div', {});
    setSlot(el, 'header');
    expect(getSlot(el)).toBe('header');
  });

  it('works on any element tag (section, div, p, h2)', () => {
    for (const tag of ['section', 'div', 'p', 'h2']) {
      const el = createElement(tag, {});
      setSlot(el, 'content');
      expect(getSlot(el)).toBe('content');
    }
  });

  it('throws TypeError when an empty string is passed (use null to clear)', () => {
    const el = createElement('div', {});
    expect(() => setSlot(el, '')).toThrow(TypeError);
  });

  it('does not disturb other layout attributes', () => {
    const el = createElement('div', { 'data-lay': 'stack', 'data-gap': '32' });
    setSlot(el, 'content');
    expect(getAttribute(el, 'data-lay')).toBe('stack');
    expect(getAttribute(el, 'data-gap')).toBe('32');
  });

  it('data-layout on section + data-slot on children round-trip cleanly via model', () => {
    const html = `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">
      <section data-eid="s1" data-layout="two-column">
        <div data-lay="row" data-eid="row1">
          <div data-lay="stack" data-eid="col1" data-slot="content"><h2 data-eid="t1">Main</h2></div>
          <div data-lay="stack" data-eid="col2" data-slot="sidebar"><p data-eid="p1">Side</p></div>
        </div>
      </section>
    </div></div></body></html>`;
    const model = parseDeck(html);
    const section = findElByEid(model, 's1')!;
    const col1 = findElByEid(model, 'col1')!;
    const col2 = findElByEid(model, 'col2')!;

    expect(getLayoutMarker(section)).toBe('two-column');
    expect(getSlot(col1)).toBe('content');
    expect(getSlot(col2)).toBe('sidebar');
  });
});

// ─── 11. P17-20: getAutoslide / setAutoslide ─────────────────────────────────
//
// data-autoslide is a reveal-native per-slide auto-advance override (ms) on a
// <section>. number | null, where null means "no override" (attribute absent).
// Dual-encoded: Go validator accepts it as a non-negative integer.

describe('getAutoslide() + setAutoslide() — P17-20', () => {
  it('returns null when data-autoslide is absent', () => {
    expect(getAutoslide(createElement('section', {}))).toBeNull();
  });

  it('returns the integer ms when set', () => {
    expect(getAutoslide(createElement('section', { 'data-autoslide': '3000' }))).toBe(3000);
  });

  it('returns null for a non-integer / negative value', () => {
    expect(getAutoslide(createElement('section', { 'data-autoslide': 'fast' }))).toBeNull();
    expect(getAutoslide(createElement('section', { 'data-autoslide': '-5' }))).toBeNull();
  });

  it('sets data-autoslide and marks the element dirty', () => {
    const el = createElement('section', {});
    el.dirty = false;
    setAutoslide(el, 5000);
    expect(getAttribute(el, 'data-autoslide')).toBe('5000');
    expect(el.dirty).toBe(true);
  });

  it('removes data-autoslide when null is passed', () => {
    const el = createElement('section', { 'data-autoslide': '3000' });
    setAutoslide(el, null);
    expect(getAttribute(el, 'data-autoslide')).toBeNull();
  });

  it('round-trips via get after set', () => {
    const el = createElement('section', {});
    setAutoslide(el, 0);
    expect(getAutoslide(el)).toBe(0);
  });

  it('throws on a negative or non-integer ms', () => {
    const el = createElement('section', {});
    expect(() => setAutoslide(el, -1)).toThrow(TypeError);
    expect(() => setAutoslide(el, 1.5)).toThrow(TypeError);
  });
});
