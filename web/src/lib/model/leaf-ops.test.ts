/**
 * leaf-ops.test.ts — Whole-leaf link + list re-nest model ops (P17-8/9/10).
 *
 * Load-bearing assertions:
 *   • linkLeaf wraps the leaf's content in one <a href>; unlinkLeaf removes it;
 *   • the edited leaf's NEW shape appears in serialized output;
 *   • untouched siblings round-trip byte-for-byte (spec 12 #4);
 *   • indent/outdent is reversible and byte-stable (re-parse is a fixed point).
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, findByEid } from './index';
import { linkLeaf, unlinkLeaf, indentList, isListLeaf } from './leaf-ops';

const DECK = [
  '<section data-eid="s1">',
  '<p data-eid="p1">hello world</p>',
  '<p data-eid="p2">Untouched &amp; original</p>',
  '<ul data-eid="l1"><li>a</li><li>b</li></ul>',
  '</section>',
].join('');

describe('linkLeaf / unlinkLeaf (P17-9/10)', () => {
  it('wraps the whole leaf content in a single <a href>', () => {
    const model = parseDeck(DECK);
    linkLeaf(findByEid(model, 'p1')!, 'https://example.com/');
    const out = serializeDeck(model);
    expect(out).toContain('<a href="https://example.com/">hello world</a>');
    // The leaf tag itself is preserved.
    expect(out).toContain('<p data-eid="p1">');
  });

  it('leaves untouched siblings byte-identical', () => {
    const model = parseDeck(DECK);
    linkLeaf(findByEid(model, 'p1')!, 'https://example.com/');
    expect(serializeDeck(model)).toContain('<p data-eid="p2">Untouched &amp; original</p>');
  });

  it('round-trips byte-stable after linking (re-parse is a fixed point)', () => {
    const model = parseDeck(DECK);
    linkLeaf(findByEid(model, 'p1')!, 'https://example.com/');
    const once = serializeDeck(model);
    expect(serializeDeck(parseDeck(once))).toBe(once);
  });

  it('unlinkLeaf removes the anchor, restoring the content', () => {
    const model = parseDeck('<p data-eid="p1">see <a href="http://x/">docs</a> here</p>');
    const changed = unlinkLeaf(findByEid(model, 'p1')!);
    expect(changed).toBe(true);
    const out = serializeDeck(model);
    expect(out).not.toContain('<a');
    expect(out).toContain('see docs here');
  });

  it('linkLeaf flattens a pre-existing anchor (links never nest)', () => {
    const model = parseDeck('<p data-eid="p1">a <a href="http://old/">b</a> c</p>');
    linkLeaf(findByEid(model, 'p1')!, 'http://new/');
    const out = serializeDeck(model);
    expect(out.match(/<a /g)?.length).toBe(1);
    expect(out).toContain('<a href="http://new/">a b c</a>');
  });

  it('unlinkLeaf is a no-op (returns false) when there is no anchor', () => {
    const model = parseDeck('<p data-eid="p1">plain</p>');
    expect(unlinkLeaf(findByEid(model, 'p1')!)).toBe(false);
  });
});

describe('indentList / outdent (P17-8)', () => {
  it('isListLeaf recognises ul/ol only', () => {
    const model = parseDeck(DECK);
    expect(isListLeaf(findByEid(model, 'l1')!)).toBe(true);
    expect(isListLeaf(findByEid(model, 'p1')!)).toBe(false);
  });

  it('indent nests the list one level deeper; outdent reverses it exactly', () => {
    const model = parseDeck(DECK);
    const before = serializeDeck(model);

    expect(indentList(findByEid(model, 'l1')!, 'in')).toBe(true);
    const indented = serializeDeck(model);
    expect(indented).toContain('<ul data-eid="l1"><li><ul><li>a</li><li>b</li></ul></li></ul>');

    expect(indentList(findByEid(model, 'l1')!, 'out')).toBe(true);
    const outdented = serializeDeck(model);
    // Outdent restores the original list content (leaf tag re-rendered canonical).
    expect(outdented).toContain('<ul data-eid="l1"><li>a</li><li>b</li></ul>');
    expect(outdented).toBe(before);
  });

  it('outdent on a flat list is a no-op (returns false)', () => {
    const model = parseDeck(DECK);
    expect(indentList(findByEid(model, 'l1')!, 'out')).toBe(false);
  });

  it('indent result round-trips byte-stable', () => {
    const model = parseDeck(DECK);
    indentList(findByEid(model, 'l1')!, 'in');
    const once = serializeDeck(model);
    expect(serializeDeck(parseDeck(once))).toBe(once);
  });

  it('indent on a non-list leaf is a no-op (returns false)', () => {
    const model = parseDeck(DECK);
    expect(indentList(findByEid(model, 'p1')!, 'in')).toBe(false);
  });
});
