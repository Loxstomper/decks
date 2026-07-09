/**
 * writeback.test.ts — Canvas rich-text edit → model → source (P2-6 / P17-3).
 *
 * The load-bearing assertions:
 *   • the edited leaf's NEW content appears in the serialized output;
 *   • the edited leaf keeps its original TAG bytes (only its children re-render);
 *   • literal text is entity-encoded on the way into source form;
 *   • INLINE MARKS now SURVIVE the edit — they are no longer flattened to text
 *     (this is the P17 behaviour change: a committed `<strong>` is preserved,
 *     and `<b>` is canonicalised to `<strong>`), and hostile markup is stripped;
 *   • sibling / unrelated subtrees are byte-IDENTICAL (spec principles-and-invariants #4 passthrough);
 *   • an unknown eid is a no-op returning false.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck } from '$lib/model';
import { applyRichTextEditToModel } from './writeback';

const DECK = [
  '<section data-eid="s1">',
  '<h1 data-eid="t1">Hello</h1>',
  '<p data-eid="p1">Untouched &amp; original</p>',
  '<p data-eid="m1">a <b>bold</b> c</p>',
  '</section>',
].join('');

describe('applyRichTextEditToModel', () => {
  it('rewrites a plain-text edit, preserving the leaf tag bytes', () => {
    const model = parseDeck(DECK);
    expect(applyRichTextEditToModel(model, 't1', 'Goodbye')).toBe(true);
    const out = serializeDeck(model);
    expect(out).toContain('<h1 data-eid="t1">Goodbye</h1>');
  });

  it('leaves sibling subtrees byte-identical (passthrough)', () => {
    const model = parseDeck(DECK);
    applyRichTextEditToModel(model, 't1', 'Goodbye');
    const out = serializeDeck(model);
    // p1 was never touched → its exact source bytes (entity intact) survive.
    expect(out).toContain('<p data-eid="p1">Untouched &amp; original</p>');
  });

  it('entity-encodes literal text into source form', () => {
    const model = parseDeck(DECK);
    // innerHTML from contenteditable already encodes `<` and `&`.
    applyRichTextEditToModel(model, 't1', 'x &lt; y &amp; z');
    const out = serializeDeck(model);
    expect(out).toContain('<h1 data-eid="t1">x &lt; y &amp; z</h1>');
  });

  it('PRESERVES inline marks (P17 — no longer flattened) and canonicalises <b>→<strong>', () => {
    // WHY THIS CHANGED: pre-P17 the writeback flattened mixed inline content to
    // plain text (the old test asserted the <b> vanished). P17 makes the leaf
    // rich: the committed innerHTML's marks are sanitised + canonicalised and
    // kept, so formatting survives a round-trip through the model.
    const model = parseDeck(DECK);
    expect(applyRichTextEditToModel(model, 'm1', 'a <b>bold</b> c')).toBe(true);
    const out = serializeDeck(model);
    // <b> is canonicalised to <strong>; the <p> tag bytes are preserved.
    expect(out).toContain('<p data-eid="m1">a <strong>bold</strong> c</p>');
  });

  it('strips hostile markup (script / on* / javascript: href) on commit', () => {
    const model = parseDeck(DECK);
    applyRichTextEditToModel(
      model,
      'm1',
      'safe<script>alert(1)</script> ' +
        '<a href="javascript:alert(1)" onclick="x()">x</a> ' +
        '<a href="https://ok.com">ok</a>',
    );
    const out = serializeDeck(model);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('onclick');
    // The safe external link survives (external <a> navigation is allowed).
    expect(out).toContain('<a href="https://ok.com">ok</a>');
  });

  it('clearing all content leaves an empty leaf (keeps tag bytes)', () => {
    const model = parseDeck(DECK);
    expect(applyRichTextEditToModel(model, 'm1', '')).toBe(true);
    const out = serializeDeck(model);
    expect(out).toContain('<p data-eid="m1"></p>');
  });

  it('round-trips byte-identically when nothing is edited', () => {
    const model = parseDeck(DECK);
    expect(serializeDeck(model)).toBe(DECK);
  });

  it('returns false for an unknown eid (stale selection)', () => {
    const model = parseDeck(DECK);
    expect(applyRichTextEditToModel(model, 'nope', 'x')).toBe(false);
    expect(serializeDeck(model)).toBe(DECK); // untouched
  });
});
