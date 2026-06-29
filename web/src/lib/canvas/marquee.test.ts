import { describe, it, expect } from 'vitest';
import {
  marqueeRectFromPoints,
  rectsIntersect,
  rectContains,
  elementsInMarquee,
  type MarqueeCandidate,
} from './marquee.ts';
import type { Rect } from './overlay-geometry.ts';

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
});

describe('marqueeRectFromPoints', () => {
  it('normalises a down-right drag', () => {
    expect(marqueeRectFromPoints({ x: 10, y: 20 }, { x: 110, y: 220 })).toEqual(
      rect(10, 20, 100, 200),
    );
  });

  it('normalises an up-left drag to the same rect', () => {
    // Dragging from bottom-right to top-left must yield identical geometry.
    expect(marqueeRectFromPoints({ x: 110, y: 220 }, { x: 10, y: 20 })).toEqual(
      rect(10, 20, 100, 200),
    );
  });

  it('produces a zero-area rect when the points coincide', () => {
    expect(marqueeRectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(rect(5, 5, 0, 0));
  });
});

describe('rectsIntersect', () => {
  it('detects overlap', () => {
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true);
  });

  it('rejects disjoint rects', () => {
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(200, 200, 50, 50))).toBe(false);
  });

  it('treats edge-touching as NOT intersecting (strict overlap)', () => {
    // Right edge of A (x=100) exactly meets left edge of B (x=100): no sliver.
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
  });

  it('detects a one-unit sliver of overlap', () => {
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(99, 0, 100, 100))).toBe(true);
  });
});

describe('rectContains', () => {
  it('accepts a fully-enclosed rect', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(10, 10, 50, 50))).toBe(true);
  });

  it('accepts a flush-edge rect (inclusive bounds)', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(0, 0, 100, 100))).toBe(true);
  });

  it('rejects a partially-outside rect', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(80, 80, 50, 50))).toBe(false);
  });
});

describe('elementsInMarquee', () => {
  const candidates: MarqueeCandidate[] = [
    { eid: 'a', rect: rect(0, 0, 100, 100) }, // top-left
    { eid: 'b', rect: rect(200, 0, 100, 100) }, // top-right
    { eid: 'c', rect: rect(0, 200, 100, 100) }, // bottom-left
    { eid: 'd', rect: rect(150, 150, 50, 50) }, // centre-ish, small
  ];

  it("intersect mode grabs every touched element, in candidate order", () => {
    // A band over the whole top row touches a and b (and clips d at x=150..200).
    const band = rect(-10, -10, 360, 120);
    expect(elementsInMarquee(band, candidates, 'intersect')).toEqual(['a', 'b']);
  });

  it('contain mode requires full enclosure', () => {
    // Band encloses a fully but only clips b → only a in contain mode.
    const band = rect(-10, -10, 160, 120);
    expect(elementsInMarquee(band, candidates, 'contain')).toEqual(['a']);
  });

  it('intersect catches a partially-covered element that contain rejects', () => {
    const band = rect(120, 120, 40, 40); // overlaps d (150,150) by a sliver
    expect(elementsInMarquee(band, candidates, 'intersect')).toEqual(['d']);
    expect(elementsInMarquee(band, candidates, 'contain')).toEqual([]);
  });

  it('defaults to intersect mode', () => {
    const band = rect(-10, -10, 360, 120);
    expect(elementsInMarquee(band, candidates)).toEqual(['a', 'b']);
  });

  it('a zero-area marquee selects nothing', () => {
    expect(elementsInMarquee(rect(50, 50, 0, 0), candidates, 'intersect')).toEqual([]);
    expect(elementsInMarquee(rect(50, 50, 0, 0), candidates, 'contain')).toEqual([]);
  });

  it('selects all when the band covers the whole canvas', () => {
    const band = rect(-100, -100, 2000, 2000);
    expect(elementsInMarquee(band, candidates, 'intersect')).toEqual(['a', 'b', 'c', 'd']);
    expect(elementsInMarquee(band, candidates, 'contain')).toEqual(['a', 'b', 'c', 'd']);
  });
});
