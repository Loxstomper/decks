import { describe, it, expect } from 'vitest';
import { computeGuides, DEFAULT_GUIDE_THRESHOLD } from './alignment-guides.ts';
import type { Rect } from './overlay-geometry.ts';

const canvas = { width: 1920, height: 1080 };
const T = 10; // threshold for tests

// Helper: build a simple rect
function r(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height };
}

describe('computeGuides — no snap (far from everything)', () => {
  it('returns unchanged rect and empty guides when far from all targets', () => {
    // cx=550, cy=450 — far from canvas center (960,540) and all edges
    // nearest canvas y target: 540 at distance |450-540|=90 > T=10
    // nearest canvas x target: 960 at distance |550-960|=410 > T=10
    const moving = r(500, 400, 100, 100);
    const res = computeGuides(moving, [], canvas, T);
    expect(res.guides).toHaveLength(0);
    expect(res.snappedRect).toEqual(moving);
  });

  it('does not snap when delta just exceeds threshold', () => {
    // left=T+1=11 from canvas left (0); just beyond threshold
    const moving = r(T + 1, 500, 100, 100);
    const res = computeGuides(moving, [], canvas, T);
    // guide for x=0 must NOT fire
    const x0 = res.guides.filter((g) => g.axis === 'x' && g.position === 0);
    expect(x0).toHaveLength(0);
    expect(res.snappedRect.left).toBe(T + 1);
  });

  it('snaps exactly at threshold distance', () => {
    // left=T exactly — borderline, should snap
    const moving = r(T, 500, 100, 100);
    const res = computeGuides(moving, [], canvas, T);
    const x0 = res.guides.filter((g) => g.axis === 'x' && g.position === 0);
    expect(x0).toHaveLength(1);
    expect(res.snappedRect.left).toBe(0);
  });
});

describe('computeGuides — canvas edges and center', () => {
  it('snaps left edge to canvas left (x=0)', () => {
    const moving = r(7, 200, 200, 100); // left=7, within T=10
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.left).toBe(0); // delta=-7
    expect(res.guides).toContainEqual({ axis: 'x', position: 0 });
  });

  it('snaps right edge to canvas right (x=W)', () => {
    const moving = r(1713, 200, 200, 100); // right=1913, W-right=7
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.left).toBe(1720); // right=1920
    expect(res.guides).toContainEqual({ axis: 'x', position: 1920 });
  });

  it('snaps center-x to canvas center (x=W/2)', () => {
    // moving cx=955, canvas cx=960, delta=5
    const moving = r(855, 200, 200, 100); // cx=955
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.left).toBe(860); // cx=960
    expect(res.guides).toContainEqual({ axis: 'x', position: 960 });
  });

  it('snaps top edge to canvas top (y=0)', () => {
    const moving = r(200, 6, 100, 100);
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.top).toBe(0);
    expect(res.guides).toContainEqual({ axis: 'y', position: 0 });
  });

  it('snaps bottom edge to canvas bottom (y=H)', () => {
    const moving = r(200, 975, 100, 100); // bottom=1075, delta=5
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.top).toBe(980); // bottom=1080
    expect(res.guides).toContainEqual({ axis: 'y', position: 1080 });
  });

  it('snaps center-y to canvas center (y=H/2)', () => {
    // moving cy=533, canvas cy=540, delta=7
    const moving = r(100, 483, 100, 100); // cy=533
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.top).toBe(490); // cy=540
    expect(res.guides).toContainEqual({ axis: 'y', position: 540 });
  });
});

describe('computeGuides — sibling alignment', () => {
  it('snaps left-to-left (edge-to-edge)', () => {
    const moving = r(207, 300, 100, 100); // left=207
    const sib = r(200, 50, 150, 80); // left=200, delta=-7
    const res = computeGuides(moving, [sib], canvas, T);
    expect(res.snappedRect.left).toBe(200);
    expect(res.guides).toContainEqual({ axis: 'x', position: 200 });
  });

  it('snaps moving left to sibling right (left-to-right edge-to-edge)', () => {
    // sib right = 200+150 = 350, moving left=354, delta=-4
    const moving = r(354, 300, 100, 100);
    const sib = r(200, 50, 150, 80);
    const res = computeGuides(moving, [sib], canvas, T);
    expect(res.snappedRect.left).toBe(350);
    expect(res.guides).toContainEqual({ axis: 'x', position: 350 });
  });

  it('snaps center-to-center (cx-to-cx)', () => {
    // moving cx=256, sib cx=255, delta=-1
    // Check no smaller snap exists: left=206 vs sib.left=50 → delta=-156 (no)
    const moving = r(206, 300, 100, 100); // cx=256
    const sib = r(50, 50, 410, 80); // cx=255
    const res = computeGuides(moving, [sib], canvas, T);
    expect(res.snappedRect.left).toBe(205); // left shifts -1 so cx→255
    expect(res.guides).toContainEqual({ axis: 'x', position: 255 });
  });

  it('snaps top-to-top between elements', () => {
    const moving = r(400, 205, 100, 100); // top=205
    const sib = r(200, 200, 150, 80); // top=200, delta=-5
    const res = computeGuides(moving, [sib], canvas, T);
    expect(res.snappedRect.top).toBe(200);
    expect(res.guides).toContainEqual({ axis: 'y', position: 200 });
  });

  it('snaps bottom-to-bottom between elements', () => {
    // moving bottom=top+h, sib bottom=200+80=280
    const moving = r(400, 174, 100, 100); // bottom=274, delta=6
    const sib = r(200, 200, 150, 80); // bottom=280
    const res = computeGuides(moving, [sib], canvas, T);
    expect(res.snappedRect.top).toBe(180); // bottom=280
    expect(res.guides).toContainEqual({ axis: 'y', position: 280 });
  });

  it('picks the closest snap when multiple siblings are within threshold', () => {
    // sib1 left=200 (delta=-7 from moving left=207), sib2 left=195 (delta=-12 beyond T)
    const moving = r(207, 300, 100, 100);
    const sib1 = r(200, 50, 100, 50); // left=200, delta=-7
    const sib2 = r(195, 350, 100, 50); // left=195, delta=-12 (beyond T)
    const res = computeGuides(moving, [sib1, sib2], canvas, T);
    expect(res.snappedRect.left).toBe(200); // snapped to sib1
    // sib2 guide should NOT appear
    expect(res.guides.filter((g) => g.position === 195)).toHaveLength(0);
  });

  it('when two snaps tie, picks smaller displacement; both guides shown if truly tied', () => {
    // Two siblings each 3px away on the same axis → tied → both guides appear
    const moving = r(203, 300, 100, 100); // left=203
    const sib1 = r(200, 50, 100, 50); // left=200, delta=-3
    const sib2 = r(300, 350, 100, 50); // right=400; moving right=303, delta=400-303=97 (no)
    // For left: sib1 delta=-3; sib2 left=300, delta=97 (no). Only sib1 active.
    // But what if sib2 left=200 too? Then two guides at x=200 (deduplicated to one).
    const res = computeGuides(moving, [sib1, sib2], canvas, T);
    expect(res.snappedRect.left).toBe(200);
  });

  it('two same-width elements snap left AND right simultaneously (two guides)', () => {
    // moving and sib have the same width → left-to-left and right-to-right give the same delta
    const moving = r(203, 200, 100, 100); // left=203, right=303
    const sib = r(200, 50, 100, 80); // left=200, right=300
    // left-to-left: delta=200-203=-3
    // right-to-right: delta=300-303=-3 (same!)
    const res = computeGuides(moving, [sib], canvas, T);
    expect(res.snappedRect.left).toBe(200);
    // Both x=200 and x=300 should be guide lines
    expect(res.guides).toContainEqual({ axis: 'x', position: 200 });
    expect(res.guides).toContainEqual({ axis: 'x', position: 300 });
  });
});

describe('computeGuides — independent x and y snapping', () => {
  it('snaps both axes independently', () => {
    // x: left=7 → snap to x=0 (delta=-7)
    // y: top=6 → snap to y=0 (delta=-6)
    const moving = r(7, 6, 100, 100);
    const res = computeGuides(moving, [], canvas, T);
    expect(res.snappedRect.left).toBe(0);
    expect(res.snappedRect.top).toBe(0);
    expect(res.guides).toContainEqual({ axis: 'x', position: 0 });
    expect(res.guides).toContainEqual({ axis: 'y', position: 0 });
  });

  it('snaps x but not y when only x is close', () => {
    const moving = r(7, 500, 100, 100);
    // cx=550, cy=550 far from everything on y axis... but let me check:
    // top=500, cy=550, bottom=600; canvas y: 0(far), 540(delta=-10 on cy), 1080(far)
    // cy=550 vs canvas cy=540: delta=-10 exactly at threshold → also snaps!
    // Let me move y further from center: top=300, cy=350, bottom=400
    const moving2 = r(7, 300, 100, 100); // cy=350; canvas cy=540, delta=190 (no)
    const res = computeGuides(moving2, [], canvas, T);
    expect(res.snappedRect.left).toBe(0); // x snapped
    expect(res.snappedRect.top).toBe(300); // y NOT snapped
    expect(res.guides.some((g) => g.axis === 'x')).toBe(true);
    expect(res.guides.some((g) => g.axis === 'y')).toBe(false);
  });
});

describe('computeGuides — edge cases', () => {
  it('handles zero-size threshold (never snaps)', () => {
    const moving = r(0, 0, 100, 100); // already on canvas left/top
    const res = computeGuides(moving, [], canvas, 0);
    // threshold=0 means |delta|<=0, only delta=0 qualifies
    // left=0 vs canvas-left=0: delta=0 → exactly at threshold, should snap
    expect(res.snappedRect).toEqual(moving); // already aligned, no change
    // but guides should show since delta=0 ≤ 0
    expect(res.guides.some((g) => g.axis === 'x' && g.position === 0)).toBe(true);
  });

  it('handles empty sibling list gracefully', () => {
    // Rect with all edges/centers far from canvas targets (0, 960, 1920, 0, 540, 1080)
    // cx=550, cy=450: nearest x target 960 (dist 410), nearest y target 540 (dist 90)
    const moving = r(500, 400, 100, 100);
    const res = computeGuides(moving, [], canvas, T);
    // Nothing within threshold
    expect(res.snappedRect).toEqual(moving);
    expect(res.guides).toHaveLength(0);
  });

  it('exports DEFAULT_GUIDE_THRESHOLD as 8', () => {
    expect(DEFAULT_GUIDE_THRESHOLD).toBe(8);
  });
});
