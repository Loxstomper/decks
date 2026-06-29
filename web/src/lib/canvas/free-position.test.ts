import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, findByEid } from '$lib/model';
import { getFreePosition, setFreePosition, translateFreePosition } from './free-position.ts';

const FREE_DECK = `<div data-free data-x="100" data-y="200" data-eid="f1">box</div>`;

describe('getFreePosition', () => {
  it('reads data-x / data-y as logical coordinates', () => {
    const model = parseDeck(FREE_DECK);
    const el = findByEid(model, 'f1')!;
    expect(getFreePosition(el)).toEqual({ x: 100, y: 200 });
  });

  it('defaults missing coordinates to the origin', () => {
    const model = parseDeck(`<div data-free data-eid="f2">x</div>`);
    const el = findByEid(model, 'f2')!;
    expect(getFreePosition(el)).toEqual({ x: 0, y: 0 });
  });
});

describe('setFreePosition / translateFreePosition', () => {
  it('writes the new position back to the attributes', () => {
    const model = parseDeck(FREE_DECK);
    const el = findByEid(model, 'f1')!;
    setFreePosition(el, { x: 120, y: 208 });
    const out = serializeDeck(model);
    expect(out).toContain('data-x="120"');
    expect(out).toContain('data-y="208"');
  });

  it('translates relative to the current position (nudge)', () => {
    const model = parseDeck(FREE_DECK);
    const el = findByEid(model, 'f1')!;
    const next = translateFreePosition(el, 10, -10);
    expect(next).toEqual({ x: 110, y: 190 });
    expect(getFreePosition(el)).toEqual({ x: 110, y: 190 });
  });
});
