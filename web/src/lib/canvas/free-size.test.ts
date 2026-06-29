import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, findByEid } from '$lib/model';
import { getFreeSize, setFreeSize, setFreeRect, getFreeRect } from './free-position.ts';

const SIZED = `<div data-free data-x="100" data-y="200" data-w="300" data-h="150" data-eid="f1">box</div>`;
const UNSIZED = `<div data-free data-x="10" data-y="20" data-eid="f2">x</div>`;

describe('getFreeSize', () => {
  it('reads data-w / data-h', () => {
    const el = findByEid(parseDeck(SIZED), 'f1')!;
    expect(getFreeSize(el)).toEqual({ width: 300, height: 150 });
  });

  it('returns null for absent or non-positive dimensions (content-sized)', () => {
    const el = findByEid(parseDeck(UNSIZED), 'f2')!;
    expect(getFreeSize(el)).toEqual({ width: null, height: null });
    const zero = findByEid(parseDeck(`<div data-free data-w="0" data-h="-5" data-eid="z">x</div>`), 'z')!;
    expect(getFreeSize(zero)).toEqual({ width: null, height: null });
  });
});

describe('setFreeSize', () => {
  it('writes data-w / data-h back to the element', () => {
    const model = parseDeck(SIZED);
    setFreeSize(findByEid(model, 'f1')!, 320, 160);
    const out = serializeDeck(model);
    expect(out).toContain('data-w="320"');
    expect(out).toContain('data-h="160"');
  });
});

describe('setFreeRect / getFreeRect', () => {
  it('writes the full geometry in one call', () => {
    const model = parseDeck(SIZED);
    setFreeRect(findByEid(model, 'f1')!, { left: 12, top: 34, width: 56, height: 78 });
    const out = serializeDeck(model);
    expect(out).toContain('data-x="12"');
    expect(out).toContain('data-y="34"');
    expect(out).toContain('data-w="56"');
    expect(out).toContain('data-h="78"');
  });

  it('round-trips through getFreeRect', () => {
    const el = findByEid(parseDeck(SIZED), 'f1')!;
    expect(getFreeRect(el)).toEqual({ left: 100, top: 200, width: 300, height: 150 });
  });

  it('falls back to the provided size when data-w/h are absent', () => {
    const el = findByEid(parseDeck(UNSIZED), 'f2')!;
    expect(getFreeRect(el, { width: 99, height: 88 })).toEqual({
      left: 10,
      top: 20,
      width: 99,
      height: 88,
    });
  });
});
