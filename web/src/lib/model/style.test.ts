import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, findByEid } from '$lib/model';
import { getInlineColor, setInlineColor } from './style.ts';

describe('inline text colour (P9-8)', () => {
  it('writes a whole-element inline style="color: …" on a bare element', () => {
    const model = parseDeck(`<p data-eid="p1">hi</p>`);
    const el = findByEid(model, 'p1')!;
    setInlineColor(el, '#ff0000');
    expect(serializeDeck(model)).toContain('style="color: #ff0000"');
    expect(getInlineColor(el)).toBe('#ff0000');
  });

  it('round-trips byte-stable after a colour is set', () => {
    const model = parseDeck(`<p data-eid="p1">hi</p>`);
    setInlineColor(findByEid(model, 'p1')!, 'red');
    const once = serializeDeck(model);
    // Re-parsing and re-serializing the result must be a fixed point.
    expect(serializeDeck(parseDeck(once))).toBe(once);
  });

  it('updates an existing colour in place, preserving other declarations', () => {
    const model = parseDeck(`<p data-eid="p1" style="font-weight: bold; color: red">hi</p>`);
    const el = findByEid(model, 'p1')!;
    setInlineColor(el, 'blue');
    const out = serializeDeck(model);
    expect(out).toContain('style="font-weight: bold; color: blue"');
    expect(getInlineColor(el)).toBe('blue');
  });

  it('clearing the colour drops the now-empty style attribute', () => {
    const model = parseDeck(`<p data-eid="p1" style="color: red">hi</p>`);
    const el = findByEid(model, 'p1')!;
    setInlineColor(el, null);
    const out = serializeDeck(model);
    expect(out).not.toContain('style=');
    expect(getInlineColor(el)).toBeNull();
  });

  it('clearing the colour keeps other declarations', () => {
    const model = parseDeck(`<p data-eid="p1" style="color: red; margin: 0">hi</p>`);
    const el = findByEid(model, 'p1')!;
    setInlineColor(el, null);
    expect(serializeDeck(model)).toContain('style="margin: 0"');
  });

  it('does not touch untouched siblings (spec principles-and-invariants #4)', () => {
    const model = parseDeck(`<section data-eid="s1"><h1 data-eid="h">T</h1><p data-eid="p1">x</p></section>`);
    setInlineColor(findByEid(model, 'p1')!, 'green');
    const out = serializeDeck(model);
    expect(out).toContain('<h1 data-eid="h">T</h1>');
    expect(out).toContain('style="color: green"');
  });

  it('returns null when there is no inline style', () => {
    const model = parseDeck(`<p data-eid="p1">hi</p>`);
    expect(getInlineColor(findByEid(model, 'p1')!)).toBeNull();
  });
});
