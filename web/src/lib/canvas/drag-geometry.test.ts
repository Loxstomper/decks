import { describe, it, expect } from 'vitest';
import {
  rectContains,
  resolveDropIndex,
  resolveDrop,
  dropIndicatorRect,
  type ChildRect,
  type ContainerCandidate,
} from './drag-geometry.ts';

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

describe('rectContains', () => {
  it('is inclusive of edges and excludes outside points', () => {
    const r = rect(10, 10, 100, 50);
    expect(rectContains(r, { x: 10, y: 10 })).toBe(true);
    expect(rectContains(r, { x: 110, y: 60 })).toBe(true);
    expect(rectContains(r, { x: 60, y: 35 })).toBe(true);
    expect(rectContains(r, { x: 9, y: 35 })).toBe(false);
    expect(rectContains(r, { x: 60, y: 61 })).toBe(false);
  });
});

describe('resolveDropIndex (vertical stack)', () => {
  // Three stacked children, each 100 tall starting at y=0,100,200.
  const siblings: ChildRect[] = [
    { eid: 'a', rect: rect(0, 0, 200, 100) },
    { eid: 'b', rect: rect(0, 100, 200, 100) },
    { eid: 'c', rect: rect(0, 200, 200, 100) },
  ];

  it('returns 0 above the first midpoint', () => {
    expect(resolveDropIndex({ x: 10, y: 10 }, siblings, 'vertical')).toBe(0);
  });

  it('returns the count of midpoints passed', () => {
    // y=150 is past a's midpoint (50) and b's midpoint (150 not < 150) → index 1
    expect(resolveDropIndex({ x: 10, y: 140 }, siblings, 'vertical')).toBe(1);
    // y=260 is past a(50), b(150), c(250) → index 3 (append)
    expect(resolveDropIndex({ x: 10, y: 260 }, siblings, 'vertical')).toBe(3);
  });

  it('excludes the dragged element from the comparison set', () => {
    // Dragging 'a'; pointer near top. Remaining [b,c] midpoints 150,250.
    // y=10 < both → index 0.
    expect(resolveDropIndex({ x: 10, y: 10 }, siblings, 'vertical', 'a')).toBe(0);
    // y=160 past b's midpoint(150) only → index 1 in the post-removal list.
    expect(resolveDropIndex({ x: 10, y: 160 }, siblings, 'vertical', 'a')).toBe(1);
  });
});

describe('resolveDropIndex (horizontal row)', () => {
  const siblings: ChildRect[] = [
    { eid: 'a', rect: rect(0, 0, 100, 80) },
    { eid: 'b', rect: rect(100, 0, 100, 80) },
  ];
  it('compares the X axis', () => {
    expect(resolveDropIndex({ x: 10, y: 40 }, siblings, 'horizontal')).toBe(0);
    expect(resolveDropIndex({ x: 120, y: 40 }, siblings, 'horizontal')).toBe(1);
    expect(resolveDropIndex({ x: 199, y: 40 }, siblings, 'horizontal')).toBe(2);
  });
});

describe('resolveDrop', () => {
  const outer: ContainerCandidate = {
    eid: 'outer',
    rect: rect(0, 0, 400, 400),
    orientation: 'vertical',
    children: [
      { eid: 'inner', rect: rect(50, 50, 200, 200) },
      { eid: 'leaf', rect: rect(50, 300, 200, 50) },
    ],
  };
  const inner: ContainerCandidate = {
    eid: 'inner',
    rect: rect(50, 50, 200, 200),
    orientation: 'horizontal',
    children: [
      { eid: 'x', rect: rect(60, 60, 80, 180) },
      { eid: 'y', rect: rect(150, 60, 80, 180) },
    ],
  };

  it('picks the innermost (smallest-area) container under the pointer', () => {
    const res = resolveDrop({ x: 200, y: 150 }, [outer, inner]);
    expect(res?.parentEid).toBe('inner');
    // pointer x=200 past x-mid(100) and y-mid(190 not<200 → yes 190<200) → index 2
    expect(res?.index).toBe(2);
  });

  it('falls back to the outer container outside the inner one', () => {
    const res = resolveDrop({ x: 100, y: 320 }, [outer, inner]);
    expect(res?.parentEid).toBe('outer');
  });

  it('returns null when the pointer is over no container', () => {
    expect(resolveDrop({ x: 999, y: 999 }, [outer, inner])).toBeNull();
  });

  it('never drops into the dragged element itself', () => {
    // Pointer inside inner, but inner IS the dragged element → fall back to outer.
    const res = resolveDrop({ x: 200, y: 150 }, [outer, inner], 'inner');
    expect(res?.parentEid).toBe('outer');
  });
});

describe('dropIndicatorRect', () => {
  const vstack: ContainerCandidate = {
    eid: 'v',
    rect: rect(0, 0, 200, 300),
    orientation: 'vertical',
    children: [
      { eid: 'a', rect: rect(0, 0, 200, 100) },
      { eid: 'b', rect: rect(0, 100, 200, 100) },
      { eid: 'c', rect: rect(0, 200, 200, 100) },
    ],
  };

  it('draws a horizontal bar at the top of the target row (vertical stack)', () => {
    const r = dropIndicatorRect(vstack, 1);
    // boundary above child[1] → y≈100, full width, thin height.
    expect(r.top).toBeCloseTo(100 - 1.5);
    expect(r.left).toBe(0);
    expect(r.width).toBe(200);
    expect(r.height).toBe(3);
  });

  it('draws the bar at the bottom edge when appending', () => {
    const r = dropIndicatorRect(vstack, 3);
    expect(r.top).toBeCloseTo(300 - 1.5);
  });

  it('excludes the dragged element from the layout', () => {
    // Drag 'a' out; remaining [b,c]. Index 0 → boundary above b at y=100.
    const r = dropIndicatorRect(vstack, 0, 'a');
    expect(r.top).toBeCloseTo(100 - 1.5);
  });

  it('handles an empty container', () => {
    const empty: ContainerCandidate = {
      eid: 'e',
      rect: rect(10, 20, 200, 50),
      orientation: 'vertical',
      children: [],
    };
    const r = dropIndicatorRect(empty, 0);
    expect(r).toEqual({ left: 10, top: 20, width: 200, height: 3 });
  });

  it('draws a vertical bar for horizontal rows', () => {
    const row: ContainerCandidate = {
      eid: 'r',
      rect: rect(0, 0, 200, 80),
      orientation: 'horizontal',
      children: [
        { eid: 'a', rect: rect(0, 0, 100, 80) },
        { eid: 'b', rect: rect(100, 0, 100, 80) },
      ],
    };
    const r = dropIndicatorRect(row, 1);
    expect(r.left).toBeCloseTo(100 - 1.5);
    expect(r.width).toBe(3);
    expect(r.height).toBe(80);
  });
});
