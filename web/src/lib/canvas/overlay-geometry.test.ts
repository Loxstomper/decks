/**
 * overlay-geometry.test.ts — Overlay coordinate mapping (P2-4).
 *
 * Verifies the load-bearing property: an element's logical rect maps to the
 * correct overlay-local screen rect under the active transform, and tracks
 * correctly when the transform (zoom/pan) changes while the logical rect stays
 * fixed — the whole reason the overlay can follow at any zoom without re-reading
 * the DOM.
 */

import { describe, it, expect } from 'vitest';
import { domRectToLogical, logicalRectToScreen, type Rect } from './overlay-geometry';
import type { Transform } from '$lib/coords.ts';

describe('domRectToLogical', () => {
  it('normalises a DOMRect-like to a plain Rect (in-iframe rect IS logical)', () => {
    const dom = { left: 12, top: 34, width: 56, height: 78, right: 68, bottom: 112 };
    expect(domRectToLogical(dom)).toEqual({ left: 12, top: 34, width: 56, height: 78 });
  });
});

describe('logicalRectToScreen', () => {
  const rect: Rect = { left: 200, top: 100, width: 400, height: 80 };

  it('applies scale + offset to the top-left and scales the size', () => {
    const t: Transform = { scale: 0.5, offsetX: 100, offsetY: 50 };
    expect(logicalRectToScreen(rect, t)).toEqual({
      left: 200 * 0.5 + 100, // 200
      top: 100 * 0.5 + 50, //  100
      width: 400 * 0.5, //     200
      height: 80 * 0.5, //      40
    });
  });

  it('is identity at scale 1 with zero offset', () => {
    const t: Transform = { scale: 1, offsetX: 0, offsetY: 0 };
    expect(logicalRectToScreen(rect, t)).toEqual(rect);
  });

  it('tracks the element when only the transform changes (zoom + pan)', () => {
    // Same logical rect, two different transforms → two consistent screen boxes,
    // both derivable WITHOUT re-measuring the DOM (the cached-rect invariant).
    const zoomedIn: Transform = { scale: 2, offsetX: -300, offsetY: -150 };
    const out = logicalRectToScreen(rect, zoomedIn);
    expect(out).toEqual({
      left: 200 * 2 - 300, // 100
      top: 100 * 2 - 150, //   50
      width: 800,
      height: 160,
    });
  });
});
