/**
 * writeback.test.ts — Canvas text edit → model → source (P2-6).
 *
 * The load-bearing assertions:
 *   • the edited leaf's NEW text appears in the serialized output;
 *   • the edited leaf keeps its original TAG bytes (only the text re-renders);
 *   • literal text is entity-encoded on the way into source form;
 *   • sibling / unrelated subtrees are byte-IDENTICAL (spec 12 #4 passthrough);
 *   • an unknown eid is a no-op returning false.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck } from '$lib/model';
import { applyTextEditToModel } from './writeback';

const DECK = [
  '<section data-eid="s1">',
  '<h1 data-eid="t1">Hello</h1>',
  '<p data-eid="p1">Untouched &amp; original</p>',
  '<p data-eid="m1">a <b>bold</b> c</p>',
  '</section>',
].join('');

describe('applyTextEditToModel', () => {
  it('rewrites a single-text-child leaf, preserving its tag bytes', () => {
    const model = parseDeck(DECK);
    expect(applyTextEditToModel(model, 't1', 'Goodbye')).toBe(true);
    const out = serializeDeck(model);
    // New text present; original open/close tag bytes (incl. attribute) intact.
    expect(out).toContain('<h1 data-eid="t1">Goodbye</h1>');
  });

  it('leaves sibling subtrees byte-identical (passthrough)', () => {
    const model = parseDeck(DECK);
    applyTextEditToModel(model, 't1', 'Goodbye');
    const out = serializeDeck(model);
    // p1 was never touched → its exact source bytes (entity intact) survive.
    expect(out).toContain('<p data-eid="p1">Untouched &amp; original</p>');
  });

  it('entity-encodes literal text into source form', () => {
    const model = parseDeck(DECK);
    applyTextEditToModel(model, 't1', 'x < y & z');
    const out = serializeDeck(model);
    expect(out).toContain('<h1 data-eid="t1">x &lt; y &amp; z</h1>');
  });

  it('flattens mixed inline content to a single text node, keeping tag bytes', () => {
    const model = parseDeck(DECK);
    expect(applyTextEditToModel(model, 'm1', 'plain now')).toBe(true);
    const out = serializeDeck(model);
    expect(out).toContain('<p data-eid="m1">plain now</p>');
    // The inline <b> is gone (text-edit semantics) but the <p> tag survives.
    expect(out).not.toContain('<b>bold</b>');
  });

  it('round-trips byte-identically when nothing is edited', () => {
    const model = parseDeck(DECK);
    expect(serializeDeck(model)).toBe(DECK);
  });

  it('returns false for an unknown eid (stale selection)', () => {
    const model = parseDeck(DECK);
    expect(applyTextEditToModel(model, 'nope', 'x')).toBe(false);
    expect(serializeDeck(model)).toBe(DECK); // untouched
  });
});
