import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck } from '$lib/model';
import {
  moveChildByEid,
  reparentChildByEid,
  findChildAndParent,
  elementChildren,
  deleteElement,
} from './structure-ops.ts';

/** Order of element eids inside the first container, by source position. */
function eidOrder(html: string, eids: string[]): string[] {
  return [...eids]
    .map((eid) => ({ eid, at: html.indexOf(`data-eid="${eid}"`) }))
    .filter((e) => e.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((e) => e.eid);
}

const REORDER_DECK = `<div data-lay="stack" data-eid="c1">
  <h1 data-eid="a">A</h1>
  <h2 data-eid="b">B</h2>
  <p data-eid="c">C</p>
</div>`;

describe('moveChild (P3-6 reorder)', () => {
  it('moves a child to the front', () => {
    const model = parseDeck(REORDER_DECK);
    expect(moveChildByEid(model, 'c', 0)).toBe(true);
    const out = serializeDeck(model);
    expect(eidOrder(out, ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('moves a child to the middle', () => {
    const model = parseDeck(REORDER_DECK);
    // Move 'a' to index 1 (post-removal list is [b,c]) → between b and c.
    expect(moveChildByEid(model, 'a', 1)).toBe(true);
    const out = serializeDeck(model);
    expect(eidOrder(out, ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('keeps untouched siblings byte-identical (spec 12 #4)', () => {
    const model = parseDeck(REORDER_DECK);
    moveChildByEid(model, 'c', 0);
    const out = serializeDeck(model);
    // 'a' and 'b' were not edited → their exact source bytes survive.
    expect(out).toContain('<h1 data-eid="a">A</h1>');
    expect(out).toContain('<h2 data-eid="b">B</h2>');
    // The container keeps its own tag bytes (only a child moved).
    expect(out).toContain('<div data-lay="stack" data-eid="c1">');
  });

  it('returns false for an unknown eid', () => {
    const model = parseDeck(REORDER_DECK);
    expect(moveChildByEid(model, 'nope', 0)).toBe(false);
  });
});

const REPARENT_DECK = `<section data-eid="s1">
  <div data-lay="stack" data-eid="left">
    <p data-eid="p1">one</p>
    <p data-eid="p2">two</p>
  </div>
  <div data-lay="stack" data-eid="right">
    <p data-eid="p3">three</p>
  </div>
</section>`;

describe('reparentChild (P3-7)', () => {
  it('moves a child into a different container', () => {
    const model = parseDeck(REPARENT_DECK);
    expect(reparentChildByEid(model, 'p1', 'right', 1)).toBe(true);

    // p1 now lives inside 'right', after p3.
    const left = findChildAndParent(model, 'p2')!.parent;
    const right = findChildAndParent(model, 'p3')!.parent;
    expect(elementChildren(left).map((e) => attrEid(e))).toEqual(['p2']);
    expect(elementChildren(right).map((e) => attrEid(e))).toEqual(['p3', 'p1']);
  });

  it('persists the new parent in serialized source', () => {
    const model = parseDeck(REPARENT_DECK);
    reparentChildByEid(model, 'p1', 'right', 0);
    const out = serializeDeck(model);
    // p1 should now appear AFTER the 'right' container opens and BEFORE p3.
    const rightAt = out.indexOf('data-eid="right"');
    const p1At = out.indexOf('data-eid="p1"');
    const p3At = out.indexOf('data-eid="p3"');
    expect(p1At).toBeGreaterThan(rightAt);
    expect(p1At).toBeLessThan(p3At);
  });

  it('same-parent reparent behaves as a reorder', () => {
    const model = parseDeck(REPARENT_DECK);
    expect(reparentChildByEid(model, 'p1', 'left', 1)).toBe(true);
    const left = findChildAndParent(model, 'p2')!.parent;
    expect(elementChildren(left).map((e) => attrEid(e))).toEqual(['p2', 'p1']);
  });

  it('returns false when the new parent is unknown', () => {
    const model = parseDeck(REPARENT_DECK);
    expect(reparentChildByEid(model, 'p1', 'ghost', 0)).toBe(false);
  });
});

/** Read a node's data-eid (source form) for assertions. */
function attrEid(el: { attributes: { name: string; value: string | null }[] }): string | null {
  const a = el.attributes.find((x) => x.name.toLowerCase() === 'data-eid');
  return a ? a.value : null;
}

// ── P9-7: deleteElement ──────────────────────────────────────────────────────

const NESTED_DECK = `<section data-eid="s1">
  <div data-lay="stack" data-eid="box">
    <h1 data-eid="a">A</h1>
    <p data-eid="b">B</p>
  </div>
  <ul data-eid="list">
    <li data-eid="li1">one</li>
    <li data-eid="li2">two</li>
  </ul>
  <!-- raw comment, passthrough -->
  <footer data-eid="ft">notes</footer>
</section>`;

describe('deleteElement (P9-7)', () => {
  it('removes a LEAF node and leaves siblings byte-identical', () => {
    const model = parseDeck(NESTED_DECK);
    expect(deleteElement(model, 'a')).toBe(true);
    const out = serializeDeck(model);
    expect(out).not.toContain('data-eid="a"');
    // Sibling 'b' round-trips verbatim (only the parent re-renders to drop 'a').
    expect(out).toContain('<p data-eid="b">B</p>');
    // The parent re-serializes WITHOUT the removed child but still exists.
    expect(out).toContain('data-eid="box"');
    expect(out).toContain('data-lay="stack"');
  });

  it('removes a CONTAINER and its entire subtree', () => {
    const model = parseDeck(NESTED_DECK);
    expect(deleteElement(model, 'box')).toBe(true);
    const out = serializeDeck(model);
    expect(out).not.toContain('data-eid="box"');
    expect(out).not.toContain('data-eid="a"'); // descendant gone too
    expect(out).not.toContain('data-eid="b"');
    // Untouched later siblings survive verbatim.
    expect(out).toContain('<ul data-eid="list">');
  });

  it('deletes a PASSTHROUGH element whole', () => {
    const model = parseDeck(NESTED_DECK);
    // <footer> is not a leaf/container → passthrough, but still removable whole.
    expect(deleteElement(model, 'ft')).toBe(true);
    const out = serializeDeck(model);
    expect(out).not.toContain('data-eid="ft"');
    expect(out).not.toContain('notes');
  });

  it('refuses to delete a slide <section> (navigator owns slide deletion)', () => {
    const model = parseDeck(NESTED_DECK);
    expect(deleteElement(model, 's1')).toBe(false);
    expect(serializeDeck(model)).toContain('data-eid="s1"');
  });

  it('returns false for an unknown eid', () => {
    const model = parseDeck(NESTED_DECK);
    expect(deleteElement(model, 'nope')).toBe(false);
  });

  it('leaves the rest of the deck byte-stable (spec 12 #4)', () => {
    const model = parseDeck(NESTED_DECK);
    deleteElement(model, 'li1');
    const out = serializeDeck(model);
    expect(out).not.toContain('data-eid="li1"');
    // Remaining list item and its bytes are preserved exactly.
    expect(out).toContain('<li data-eid="li2">two</li>');
    expect(out).toContain('<ul data-eid="list">');
  });
});
