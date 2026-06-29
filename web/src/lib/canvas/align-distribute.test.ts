import { describe, it, expect } from 'vitest';
import {
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignCenterH,
  alignCenterV,
  distributeHorizontally,
  distributeVertically,
  type FreeRect,
} from './align-distribute.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Three non-overlapping rects with distinct positions on both axes:
 *   r1: left=100 top=50  w=200 h=100  → right=300, bottom=150, cx=200, cy=100
 *   r2: left=300 top=200 w=150 h=120  → right=450, bottom=320, cx=375, cy=260
 *   r3: left=500 top=100 w=100 h=80   → right=600, bottom=180, cx=550, cy=140
 *
 * Bounding box: left=100, right=600, top=50, bottom=320
 *   bbox center: cx=(100+600)/2=350, cy=(50+320)/2=185
 */
const r1: FreeRect = { eid: 'a', rect: { left: 100, top: 50,  width: 200, height: 100 } };
const r2: FreeRect = { eid: 'b', rect: { left: 300, top: 200, width: 150, height: 120 } };
const r3: FreeRect = { eid: 'c', rect: { left: 500, top: 100, width: 100, height: 80  } };

// ── alignLeft ─────────────────────────────────────────────────────────────────

describe('alignLeft', () => {
  it('sets all left edges to the minimum left (bbox.left)', () => {
    const res = alignLeft([r1, r2, r3]);
    expect(res.get('a')?.left).toBe(100); // already there
    expect(res.get('b')?.left).toBe(100);
    expect(res.get('c')?.left).toBe(100);
  });

  it('does not change top, width, or height', () => {
    const res = alignLeft([r1, r2]);
    expect(res.get('b')?.top).toBe(200);
    expect(res.get('b')?.width).toBe(150);
    expect(res.get('b')?.height).toBe(120);
  });

  it('works with two elements', () => {
    const res = alignLeft([r2, r3]);
    // min left = 300
    expect(res.get('b')?.left).toBe(300);
    expect(res.get('c')?.left).toBe(300);
  });
});

// ── alignRight ────────────────────────────────────────────────────────────────

describe('alignRight', () => {
  it('sets all right edges to the maximum right (bbox.right)', () => {
    // maxRight = 600 (r3)
    const res = alignRight([r1, r2, r3]);
    expect(res.get('a')?.left).toBe(400); // 600-200
    expect(res.get('b')?.left).toBe(450); // 600-150
    expect(res.get('c')?.left).toBe(500); // 600-100, already there
  });

  it('does not change top, width, or height', () => {
    const res = alignRight([r1, r2, r3]);
    expect(res.get('a')?.top).toBe(50);
    expect(res.get('a')?.width).toBe(200);
    expect(res.get('a')?.height).toBe(100);
  });
});

// ── alignTop ──────────────────────────────────────────────────────────────────

describe('alignTop', () => {
  it('sets all top edges to the minimum top (bbox.top)', () => {
    // minTop = 50 (r1)
    const res = alignTop([r1, r2, r3]);
    expect(res.get('a')?.top).toBe(50); // already there
    expect(res.get('b')?.top).toBe(50);
    expect(res.get('c')?.top).toBe(50);
  });

  it('does not change left, width, or height', () => {
    const res = alignTop([r1, r2]);
    expect(res.get('b')?.left).toBe(300);
    expect(res.get('b')?.width).toBe(150);
  });
});

// ── alignBottom ───────────────────────────────────────────────────────────────

describe('alignBottom', () => {
  it('sets all bottom edges to the maximum bottom (bbox.bottom)', () => {
    // maxBottom = 320 (r2)
    const res = alignBottom([r1, r2, r3]);
    expect(res.get('a')?.top).toBe(220); // 320-100
    expect(res.get('b')?.top).toBe(200); // 320-120 (already there)
    expect(res.get('c')?.top).toBe(240); // 320-80
  });

  it('does not change left, width, or height', () => {
    const res = alignBottom([r1, r2, r3]);
    expect(res.get('a')?.left).toBe(100);
    expect(res.get('a')?.width).toBe(200);
    expect(res.get('a')?.height).toBe(100);
  });
});

// ── alignCenterH ──────────────────────────────────────────────────────────────

describe('alignCenterH', () => {
  it('centers all elements on the bounding-box horizontal center', () => {
    // bbox.left=100, bbox.right=600, targetCx=350
    const res = alignCenterH([r1, r2, r3]);
    expect(res.get('a')?.left).toBe(250); // cx=350, left=350-100
    expect(res.get('b')?.left).toBe(275); // cx=350, left=350-75
    expect(res.get('c')?.left).toBe(300); // cx=350, left=350-50
    // Verify centers
    expect((res.get('a')!.left) + res.get('a')!.width / 2).toBe(350);
    expect((res.get('b')!.left) + res.get('b')!.width / 2).toBe(350);
    expect((res.get('c')!.left) + res.get('c')!.width / 2).toBe(350);
  });

  it('does not change tops or sizes', () => {
    const res = alignCenterH([r1, r2]);
    expect(res.get('a')?.top).toBe(50);
    expect(res.get('a')?.height).toBe(100);
  });
});

// ── alignCenterV ──────────────────────────────────────────────────────────────

describe('alignCenterV', () => {
  it('centers all elements on the bounding-box vertical center', () => {
    // bbox.top=50, bbox.bottom=320, targetCy=185
    const res = alignCenterV([r1, r2, r3]);
    expect(res.get('a')?.top).toBe(135); // cy=185, top=185-50
    expect(res.get('b')?.top).toBe(125); // cy=185, top=185-60
    expect(res.get('c')?.top).toBe(145); // cy=185, top=185-40
    // Verify centers
    expect((res.get('a')!.top) + res.get('a')!.height / 2).toBe(185);
    expect((res.get('b')!.top) + res.get('b')!.height / 2).toBe(185);
    expect((res.get('c')!.top) + res.get('c')!.height / 2).toBe(185);
  });

  it('does not change lefts or widths', () => {
    const res = alignCenterV([r1, r3]);
    expect(res.get('a')?.left).toBe(100);
    expect(res.get('a')?.width).toBe(200);
  });
});

// ── distributeHorizontally ────────────────────────────────────────────────────

describe('distributeHorizontally', () => {
  it('places 3 elements with equal horizontal gaps', () => {
    const rects: FreeRect[] = [
      { eid: 'a', rect: { left: 0,   top: 50, width: 100, height: 100 } },
      { eid: 'b', rect: { left: 200, top: 50, width: 100, height: 100 } },
      { eid: 'c', rect: { left: 500, top: 50, width: 100, height: 100 } },
    ];
    // totalSpan=600, sumWidths=300, gap=150
    // a: left=0 (first, stays)
    // b: 0+100+150=250
    // c: 250+100+150=500 (last, stays)
    const res = distributeHorizontally(rects);
    expect(res.get('a')?.left).toBe(0);
    expect(res.get('b')?.left).toBe(250);
    expect(res.get('c')?.left).toBe(500);
  });

  it('places 4 elements with equal gaps', () => {
    const rects: FreeRect[] = [
      { eid: 'a', rect: { left: 0,   top: 0, width: 50, height: 50 } },
      { eid: 'b', rect: { left: 100, top: 0, width: 50, height: 50 } },
      { eid: 'c', rect: { left: 200, top: 0, width: 50, height: 50 } },
      { eid: 'd', rect: { left: 450, top: 0, width: 50, height: 50 } },
    ];
    // totalSpan=500, sumWidths=200, gap=300/3=100
    // a: 0, b: 50+100=150, c: 200+100=300, d: 350+100=450 (last stays)
    const res = distributeHorizontally(rects);
    expect(res.get('a')?.left).toBe(0);
    expect(res.get('b')?.left).toBe(150);
    expect(res.get('c')?.left).toBe(300);
    expect(res.get('d')?.left).toBe(450);
  });

  it('is order-independent (sorts by left edge)', () => {
    // Same three rects as above but provided in reverse order
    const rects: FreeRect[] = [
      { eid: 'c', rect: { left: 500, top: 50, width: 100, height: 100 } },
      { eid: 'a', rect: { left: 0,   top: 50, width: 100, height: 100 } },
      { eid: 'b', rect: { left: 200, top: 50, width: 100, height: 100 } },
    ];
    const res = distributeHorizontally(rects);
    expect(res.get('a')?.left).toBe(0);
    expect(res.get('b')?.left).toBe(250);
    expect(res.get('c')?.left).toBe(500);
  });

  it('does not change top, width, or height', () => {
    const rects: FreeRect[] = [
      { eid: 'a', rect: { left: 0,   top: 50,  width: 100, height: 80  } },
      { eid: 'b', rect: { left: 300, top: 200, width: 120, height: 60  } },
      { eid: 'c', rect: { left: 600, top: 100, width: 80,  height: 90  } },
    ];
    const res = distributeHorizontally(rects);
    expect(res.get('a')?.top).toBe(50);
    expect(res.get('b')?.top).toBe(200);
    expect(res.get('b')?.width).toBe(120);
    expect(res.get('c')?.height).toBe(90);
  });

  it('returns unchanged rects for fewer than 3 elements', () => {
    const two: FreeRect[] = [
      { eid: 'a', rect: { left: 100, top: 0, width: 100, height: 100 } },
      { eid: 'b', rect: { left: 500, top: 0, width: 100, height: 100 } },
    ];
    const res = distributeHorizontally(two);
    expect(res.get('a')?.left).toBe(100);
    expect(res.get('b')?.left).toBe(500);
  });

  it('clamps gap to 0 when elements overflow the span', () => {
    // Elements wider than the span: overlap scenario
    const rects: FreeRect[] = [
      { eid: 'a', rect: { left: 0,   top: 0, width: 400, height: 100 } },
      { eid: 'b', rect: { left: 100, top: 0, width: 400, height: 100 } },
      { eid: 'c', rect: { left: 200, top: 0, width: 400, height: 100 } },
    ];
    // totalSpan=600, sumWidths=1200, gap would be negative → clamp to 0
    const res = distributeHorizontally(rects);
    // All stack starting at leftmost.left=0, gap=0
    expect(res.get('a')?.left).toBe(0);
    expect(res.get('b')?.left).toBe(400);
    expect(res.get('c')?.left).toBe(800);
  });
});

// ── distributeVertically ──────────────────────────────────────────────────────

describe('distributeVertically', () => {
  it('places 3 elements with equal vertical gaps', () => {
    const rects: FreeRect[] = [
      { eid: 'a', rect: { left: 50, top: 0,   width: 100, height: 100 } },
      { eid: 'b', rect: { left: 50, top: 200, width: 100, height: 100 } },
      { eid: 'c', rect: { left: 50, top: 500, width: 100, height: 100 } },
    ];
    // totalSpan=600, sumHeights=300, gap=150
    // a: top=0, b: 0+100+150=250, c: 250+100+150=500
    const res = distributeVertically(rects);
    expect(res.get('a')?.top).toBe(0);
    expect(res.get('b')?.top).toBe(250);
    expect(res.get('c')?.top).toBe(500);
  });

  it('is order-independent (sorts by top edge)', () => {
    const rects: FreeRect[] = [
      { eid: 'c', rect: { left: 50, top: 500, width: 100, height: 100 } },
      { eid: 'a', rect: { left: 50, top: 0,   width: 100, height: 100 } },
      { eid: 'b', rect: { left: 50, top: 200, width: 100, height: 100 } },
    ];
    const res = distributeVertically(rects);
    expect(res.get('a')?.top).toBe(0);
    expect(res.get('b')?.top).toBe(250);
    expect(res.get('c')?.top).toBe(500);
  });

  it('does not change left, width, or height', () => {
    const rects: FreeRect[] = [
      { eid: 'a', rect: { left: 10,  top: 0,   width: 200, height: 100 } },
      { eid: 'b', rect: { left: 100, top: 300, width: 150, height: 80  } },
      { eid: 'c', rect: { left: 50,  top: 500, width: 120, height: 90  } },
    ];
    const res = distributeVertically(rects);
    expect(res.get('a')?.left).toBe(10);
    expect(res.get('b')?.left).toBe(100);
    expect(res.get('b')?.width).toBe(150);
  });

  it('returns unchanged rects for fewer than 3 elements', () => {
    const two: FreeRect[] = [
      { eid: 'a', rect: { left: 0, top: 100, width: 100, height: 100 } },
      { eid: 'b', rect: { left: 0, top: 500, width: 100, height: 100 } },
    ];
    const res = distributeVertically(two);
    expect(res.get('a')?.top).toBe(100);
    expect(res.get('b')?.top).toBe(500);
  });
});

// ── Single-element edge cases ─────────────────────────────────────────────────

describe('single element (no-op)', () => {
  it('alignLeft with one element returns it unchanged', () => {
    const res = alignLeft([r1]);
    expect(res.get('a')).toEqual(r1.rect);
  });

  it('alignRight with one element returns it unchanged', () => {
    const res = alignRight([r1]);
    expect(res.get('a')).toEqual(r1.rect);
  });

  it('alignCenterH with one element returns it unchanged', () => {
    const res = alignCenterH([r1]);
    expect(res.get('a')).toEqual(r1.rect);
  });

  it('distributeHorizontally with one element returns it unchanged', () => {
    const res = distributeHorizontally([r1]);
    expect(res.get('a')).toEqual(r1.rect);
  });
});
