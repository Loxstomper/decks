import { describe, it, expect } from 'vitest';
import {
  resizeRect,
  dragRect,
  handlePoint,
  hitTestHandle,
  HANDLES,
  type Handle,
  type Rect,
} from './resize-geometry.ts';

// Base rect: 2:1 aspect, off-origin so anchoring bugs surface.
const BASE: Rect = { left: 100, top: 100, width: 200, height: 100 };

describe('dragRect (P4-2 absolute move)', () => {
  it('translates by a logical delta, preserving size', () => {
    expect(dragRect(BASE, 10, 20)).toEqual({ left: 110, top: 120, width: 200, height: 100 });
  });

  it('preserves size for negative deltas', () => {
    expect(dragRect(BASE, -40, -30)).toEqual({ left: 60, top: 70, width: 200, height: 100 });
  });

  it('snaps the origin to the grid when snap > 0', () => {
    // 110 → 112 (nearest multiple of 8); 120 already on grid.
    expect(dragRect(BASE, 10, 20, 8)).toEqual({ left: 112, top: 120, width: 200, height: 100 });
  });

  it('does not snap when snap is 0 (grid off)', () => {
    expect(dragRect(BASE, 11, 13, 0)).toEqual({ left: 111, top: 113, width: 200, height: 100 });
  });

  it('does not mutate the input rect', () => {
    const copy = { ...BASE };
    dragRect(BASE, 5, 5);
    expect(BASE).toEqual(copy);
  });
});

describe('resizeRect — corner handles, no modifiers', () => {
  it('se: grows from the top-left anchor', () => {
    expect(resizeRect(BASE, 'se', 20, 10)).toEqual({
      left: 100,
      top: 100,
      width: 220,
      height: 110,
    });
  });

  it('nw: moves top-left, anchors bottom-right', () => {
    expect(resizeRect(BASE, 'nw', 20, 10)).toEqual({
      left: 120,
      top: 110,
      width: 180,
      height: 90,
    });
  });

  it('ne: right + top edges move, bottom-left anchored', () => {
    expect(resizeRect(BASE, 'ne', 20, 10)).toEqual({
      left: 100,
      top: 110,
      width: 220,
      height: 90,
    });
  });

  it('sw: left + bottom edges move, top-right anchored', () => {
    expect(resizeRect(BASE, 'sw', 20, 10)).toEqual({
      left: 120,
      top: 100,
      width: 180,
      height: 110,
    });
  });
});

describe('resizeRect — edge handles ignore the off-axis delta', () => {
  it('e: only width changes; dy ignored', () => {
    expect(resizeRect(BASE, 'e', 20, 999)).toEqual({
      left: 100,
      top: 100,
      width: 220,
      height: 100,
    });
  });

  it('w: width grows leftward, right anchored', () => {
    expect(resizeRect(BASE, 'w', -10, 0)).toEqual({
      left: 90,
      top: 100,
      width: 210,
      height: 100,
    });
  });

  it('n: height grows upward, bottom anchored', () => {
    expect(resizeRect(BASE, 'n', 999, -10)).toEqual({
      left: 100,
      top: 90,
      width: 200,
      height: 110,
    });
  });

  it('s: only height changes', () => {
    expect(resizeRect(BASE, 's', 0, 25)).toEqual({
      left: 100,
      top: 100,
      width: 200,
      height: 125,
    });
  });
});

describe('resizeRect — fromCenter (Alt)', () => {
  it('e: both edges move, center fixed (delta doubles width)', () => {
    expect(resizeRect(BASE, 'e', 20, 0, { fromCenter: true })).toEqual({
      left: 80,
      top: 100,
      width: 240,
      height: 100,
    });
  });

  it('se corner: symmetric on both axes about the center', () => {
    expect(resizeRect(BASE, 'se', 20, 10, { fromCenter: true })).toEqual({
      left: 80,
      top: 90,
      width: 240,
      height: 120,
    });
  });

  it('n: grows symmetrically in height', () => {
    expect(resizeRect(BASE, 'n', 0, -10, { fromCenter: true })).toEqual({
      left: 100,
      top: 90,
      width: 200,
      height: 120,
    });
  });
});

describe('resizeRect — aspect lock (Shift)', () => {
  it('se with width-dominant drag: height follows the 2:1 ratio', () => {
    expect(resizeRect(BASE, 'se', 20, 0, { aspect: true })).toEqual({
      left: 100,
      top: 100,
      width: 220,
      height: 110,
    });
  });

  it('se with height-dominant drag: width follows the ratio', () => {
    expect(resizeRect(BASE, 'se', 0, 20, { aspect: true })).toEqual({
      left: 100,
      top: 100,
      width: 240,
      height: 120,
    });
  });

  it('e edge: dragged axis drives, other axis centers about the original center', () => {
    expect(resizeRect(BASE, 'e', 20, 0, { aspect: true })).toEqual({
      left: 100,
      top: 95,
      width: 220,
      height: 110,
    });
  });

  it('keeps the original aspect ratio for the corner case', () => {
    const r = resizeRect(BASE, 'se', 37, 4, { aspect: true });
    expect(r.width / r.height).toBeCloseTo(BASE.width / BASE.height, 10);
  });
});

describe('resizeRect — aspect + fromCenter combined', () => {
  it('se: ratio preserved and centered', () => {
    expect(resizeRect(BASE, 'se', 20, 0, { aspect: true, fromCenter: true })).toEqual({
      left: 80,
      top: 90,
      width: 240,
      height: 120,
    });
  });
});

describe('resizeRect — snap to grid', () => {
  it('se: snaps both dimensions to grid multiples', () => {
    // width 221 → 224, height 109 → 112; top-left anchored.
    expect(resizeRect(BASE, 'se', 21, 9, { snap: 8 })).toEqual({
      left: 100,
      top: 100,
      width: 224,
      height: 112,
    });
  });

  it('n: snaps only the dragged (height) axis and re-anchors the bottom', () => {
    // height 109 → 112; top = origBottom(200) - 112 = 88.
    expect(resizeRect(BASE, 'n', 0, -9, { snap: 8 })).toEqual({
      left: 100,
      top: 88,
      width: 200,
      height: 112,
    });
  });

  it('aspect + snap: snaps the driver, derives the other from the ratio', () => {
    // width 221 → 224 (driver), height = 224/2 = 112 — ratio still exactly 2:1.
    const r = resizeRect(BASE, 'se', 21, 0, { aspect: true, snap: 8 });
    expect(r).toEqual({ left: 100, top: 100, width: 224, height: 112 });
    expect(r.width / r.height).toBeCloseTo(2, 10);
  });
});

describe('resizeRect — minimum-size clamp (no collapse / flip)', () => {
  it('clamps width and height to the minimum on an over-drag', () => {
    expect(resizeRect(BASE, 'se', -500, -500)).toEqual({
      left: 100,
      top: 100,
      width: 1,
      height: 1,
    });
  });

  it('honours a custom minSize', () => {
    const r = resizeRect(BASE, 'se', -500, -500, { minSize: 8 });
    expect(r.width).toBe(8);
    expect(r.height).toBe(8);
  });

  it('never mutates the input rect', () => {
    const copy = { ...BASE };
    resizeRect(BASE, 'nw', 13, 7, { aspect: true, fromCenter: true, snap: 8 });
    expect(BASE).toEqual(copy);
  });
});

describe('every handle × modifier combination produces a finite, positive rect', () => {
  const deltas = [
    [25, 15],
    [-25, -15],
    [40, -10],
    [-5, 30],
  ];
  for (const handle of HANDLES) {
    for (const aspect of [false, true]) {
      for (const fromCenter of [false, true]) {
        for (const snap of [0, 8]) {
          for (const [dx, dy] of deltas) {
            it(`${handle} a=${aspect} c=${fromCenter} snap=${snap} d=(${dx},${dy})`, () => {
              const r = resizeRect(BASE, handle as Handle, dx, dy, { aspect, fromCenter, snap });
              expect(Number.isFinite(r.left)).toBe(true);
              expect(Number.isFinite(r.top)).toBe(true);
              expect(r.width).toBeGreaterThanOrEqual(1);
              expect(r.height).toBeGreaterThanOrEqual(1);
            });
          }
        }
      }
    }
  }
});

describe('handlePoint', () => {
  it('places corners on the rect corners', () => {
    expect(handlePoint(BASE, 'nw')).toEqual({ x: 100, y: 100 });
    expect(handlePoint(BASE, 'se')).toEqual({ x: 300, y: 200 });
  });

  it('places edge handles at edge midpoints', () => {
    expect(handlePoint(BASE, 'n')).toEqual({ x: 200, y: 100 });
    expect(handlePoint(BASE, 'w')).toEqual({ x: 100, y: 150 });
    expect(handlePoint(BASE, 'e')).toEqual({ x: 300, y: 150 });
  });
});

describe('hitTestHandle', () => {
  const r: Rect = { left: 0, top: 0, width: 100, height: 100 };

  it('hits the corner within the radius', () => {
    expect(hitTestHandle({ x: 0, y: 0 }, r, 5)).toBe('nw');
    expect(hitTestHandle({ x: 100, y: 100 }, r, 5)).toBe('se');
  });

  it('hits an edge midpoint', () => {
    expect(hitTestHandle({ x: 50, y: 0 }, r, 5)).toBe('n');
  });

  it('tolerates the radius around the handle', () => {
    expect(hitTestHandle({ x: 3, y: 4 }, r, 5)).toBe('nw');
  });

  it('returns null in the interior (no handle near)', () => {
    expect(hitTestHandle({ x: 50, y: 50 }, r, 5)).toBeNull();
  });
});
