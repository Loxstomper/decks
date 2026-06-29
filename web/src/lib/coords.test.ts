/**
 * coords.test.ts — Unit tests for the coordinate/scale transform (P0-14).
 *
 * These tests are LOAD-BEARING: the transform underlies every overlay
 * element (selection boxes, resize handles, alignment guides).  They must
 * pass before any canvas overlay work begins (per IMPLEMENTATION_PLAN P0-14).
 *
 * Coverage:
 *  1. screenToLogical / logicalToScreen basic correctness
 *  2. fit-scale computation (present-scale mode, spec 05)
 *  3. custom editor zoom (spec 05 — distinct from present-scale)
 *  4. pan offset (additive, spec 04)
 *  5. round-trip identity in both directions (floating-point tolerance)
 *  6. Edge cases: zoom=1 (fit), extreme zoom, non-default logical size
 */

import { describe, it, expect } from 'vitest';
import {
  type Point,
  type Transform,
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
  screenToLogical,
  logicalToScreen,
  computeFitTransform,
  computeZoomTransform,
  applyPan,
} from './coords.js';

// Floating-point equality tolerance (sub-pixel precision is sufficient).
const EPS = 1e-9;

function expectNearPoint(actual: Point, expected: Point, eps = EPS) {
  expect(actual.x).toBeCloseTo(expected.x, -Math.log10(eps));
  expect(actual.y).toBeCloseTo(expected.y, -Math.log10(eps));
}

// ---------------------------------------------------------------------------
// 1. Basic transform primitives
// ---------------------------------------------------------------------------

describe('logicalToScreen', () => {
  it('converts the logical origin to the transform offset', () => {
    const t: Transform = { scale: 2, offsetX: 100, offsetY: 50 };
    const result = logicalToScreen({ x: 0, y: 0 }, t);
    expect(result.x).toBeCloseTo(100, 10);
    expect(result.y).toBeCloseTo(50, 10);
  });

  it('applies scale and offset correctly', () => {
    const t: Transform = { scale: 0.5, offsetX: 20, offsetY: 10 };
    // screen = logical * scale + offset
    const result = logicalToScreen({ x: 100, y: 200 }, t);
    expect(result.x).toBeCloseTo(70, 10);  // 100*0.5 + 20
    expect(result.y).toBeCloseTo(110, 10); // 200*0.5 + 10
  });

  it('maps the center of 1920x1080 canvas correctly', () => {
    // Centered canvas in a 1920x1080 screen at scale=1 has no offset.
    const t: Transform = { scale: 1, offsetX: 0, offsetY: 0 };
    const center = logicalToScreen({ x: 960, y: 540 }, t);
    expect(center.x).toBeCloseTo(960, 10);
    expect(center.y).toBeCloseTo(540, 10);
  });
});

describe('screenToLogical', () => {
  it('converts screen origin to logical position given only offset', () => {
    const t: Transform = { scale: 1, offsetX: 100, offsetY: 50 };
    const result = screenToLogical({ x: 100, y: 50 }, t);
    // logical origin maps to screen (offsetX, offsetY)
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('inverts scale correctly', () => {
    const t: Transform = { scale: 2, offsetX: 0, offsetY: 0 };
    const result = screenToLogical({ x: 200, y: 400 }, t);
    expect(result.x).toBeCloseTo(100, 10);
    expect(result.y).toBeCloseTo(200, 10);
  });

  it('inverts both scale and offset', () => {
    const t: Transform = { scale: 0.5, offsetX: 20, offsetY: 10 };
    // screen (70, 110) -> logical (100, 200)  [inverse of logicalToScreen test above]
    const result = screenToLogical({ x: 70, y: 110 }, t);
    expect(result.x).toBeCloseTo(100, 10);
    expect(result.y).toBeCloseTo(200, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. Round-trip identity: logicalToScreen(screenToLogical(p)) ≈ p
//                   and  screenToLogical(logicalToScreen(p)) ≈ p
// ---------------------------------------------------------------------------

describe('round-trip identity', () => {
  const transforms: Array<[string, Transform]> = [
    ['identity',           { scale: 1,    offsetX: 0,   offsetY: 0 }],
    ['scale=2 no offset',  { scale: 2,    offsetX: 0,   offsetY: 0 }],
    ['scale=0.5625 +offset', { scale: 0.5625, offsetX: 120, offsetY: 67.5 }],
    ['fractional zoom',    { scale: 1.3333, offsetX: -213.3, offsetY: 0 }],
    ['large offset',       { scale: 0.25, offsetX: 800, offsetY: 450 }],
  ];

  const testPoints: Point[] = [
    { x: 0,    y: 0    },
    { x: 960,  y: 540  }, // canvas center
    { x: 1920, y: 1080 }, // canvas corner
    { x: 123.456, y: 789.012 }, // arbitrary
    { x: -50,  y: -30  }, // outside canvas (allowed for pan)
  ];

  for (const [label, t] of transforms) {
    describe(`transform: ${label}`, () => {
      for (const p of testPoints) {
        it(`screen→logical→screen round-trip for (${p.x}, ${p.y})`, () => {
          const intermediate = screenToLogical(p, t);
          const result = logicalToScreen(intermediate, t);
          expectNearPoint(result, p);
        });

        it(`logical→screen→logical round-trip for (${p.x}, ${p.y})`, () => {
          const intermediate = logicalToScreen(p, t);
          const result = screenToLogical(intermediate, t);
          expectNearPoint(result, p);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. computeFitTransform — present-scale (spec 05)
// ---------------------------------------------------------------------------

describe('computeFitTransform', () => {
  it('uses default 1920x1080 logical size', () => {
    // Viewport exactly matches logical canvas → scale=1, no offset.
    const t = computeFitTransform(1920, 1080);
    expect(t.scale).toBeCloseTo(1, 10);
    expect(t.offsetX).toBeCloseTo(0, 10);
    expect(t.offsetY).toBeCloseTo(0, 10);
  });

  it('scales uniformly to fit a narrower viewport (letterbox vertical bars)', () => {
    // 1280x1080 viewport, 1920x1080 logical → limited by width.
    const t = computeFitTransform(1280, 1080);
    const expectedScale = 1280 / 1920; // ≈ 0.6667
    expect(t.scale).toBeCloseTo(expectedScale, 10);
    // Vertically: scaled height = 1080 * scale = 1080 * 0.6667 ≈ 720
    // Vertical offset = (1080 - 720) / 2 = 180
    expect(t.offsetY).toBeCloseTo((1080 - 1080 * expectedScale) / 2, 10);
    expect(t.offsetX).toBeCloseTo(0, 10); // fills width exactly
  });

  it('scales uniformly to fit a shorter viewport (pillarbox horizontal bars)', () => {
    // 1920x720 viewport, 1920x1080 logical → limited by height.
    const t = computeFitTransform(1920, 720);
    const expectedScale = 720 / 1080; // ≈ 0.6667
    expect(t.scale).toBeCloseTo(expectedScale, 10);
    // Horizontal: scaled width = 1920 * scale = 1920 * 0.6667 ≈ 1280
    // Horizontal offset = (1920 - 1280) / 2 = 320
    expect(t.offsetX).toBeCloseTo((1920 - 1920 * expectedScale) / 2, 10);
    expect(t.offsetY).toBeCloseTo(0, 10); // fills height exactly
  });

  it('handles a common laptop resolution (1440x900)', () => {
    const t = computeFitTransform(1440, 900);
    // scale limited by height: 900/1080 = 0.8333...; width: 1440/1920 = 0.75 → height wins
    const expectedScale = Math.min(1440 / 1920, 900 / 1080);
    expect(t.scale).toBeCloseTo(expectedScale, 10);
    expect(t.scale).toBeCloseTo(0.75, 10);
    // Centered: offsetX = (1440 - 1920*0.75) / 2 = (1440-1440)/2 = 0
    expect(t.offsetX).toBeCloseTo(0, 10);
    expect(t.offsetY).toBeCloseTo((900 - 1080 * expectedScale) / 2, 10);
  });

  it('accepts a custom logical size (4:3 preset 1440x1080)', () => {
    const t = computeFitTransform(1920, 1080, 1440, 1080);
    // scale limited by height: 1080/1080 = 1; width: 1920/1440 = 1.333 → height wins
    expect(t.scale).toBeCloseTo(1, 10);
    // Pillarbox: offsetX = (1920 - 1440*1) / 2 = 240
    expect(t.offsetX).toBeCloseTo(240, 10);
    expect(t.offsetY).toBeCloseTo(0, 10);
  });

  it('maps logical corners to screen edges after fit (no offset)', () => {
    // 1920x1080 viewport, exact match — corners should map to screen corners.
    const t = computeFitTransform(1920, 1080);
    expectNearPoint(logicalToScreen({ x: 0, y: 0 }, t), { x: 0, y: 0 });
    expectNearPoint(logicalToScreen({ x: 1920, y: 1080 }, t), { x: 1920, y: 1080 });
  });

  it('maps logical corners to letterboxed screen positions', () => {
    // 960x540 viewport → scale=0.5, no offset (perfect 16:9 fit).
    const t = computeFitTransform(960, 540);
    expect(t.scale).toBeCloseTo(0.5, 10);
    expect(t.offsetX).toBeCloseTo(0, 10);
    expect(t.offsetY).toBeCloseTo(0, 10);
    // Top-right logical corner (1920,0) → screen (960,0)
    expectNearPoint(logicalToScreen({ x: 1920, y: 0 }, t), { x: 960, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// 4. computeZoomTransform — editor zoom (spec 05)
// ---------------------------------------------------------------------------

describe('computeZoomTransform', () => {
  it('with userZoom=1 equals computeFitTransform', () => {
    const paneW = 800;
    const paneH = 500;
    const fit  = computeFitTransform(paneW, paneH);
    const zoom = computeZoomTransform(paneW, paneH, 1.0);
    expect(zoom.scale).toBeCloseTo(fit.scale, 10);
    expect(zoom.offsetX).toBeCloseTo(fit.offsetX, 10);
    expect(zoom.offsetY).toBeCloseTo(fit.offsetY, 10);
  });

  it('with userZoom=2 doubles the scale relative to fit', () => {
    const paneW = 800;
    const paneH = 450;
    const fit  = computeFitTransform(paneW, paneH);
    const zoom = computeZoomTransform(paneW, paneH, 2.0);
    expect(zoom.scale).toBeCloseTo(fit.scale * 2, 10);
  });

  it('centers the zoomed canvas in the pane', () => {
    // At zoom=2, the canvas is larger than the pane — offset goes negative.
    const paneW = 800;
    const paneH = 450;
    const t = computeZoomTransform(paneW, paneH, 2.0);
    // scale = fitScale * 2
    const fitScale = Math.min(paneW / LOGICAL_WIDTH, paneH / LOGICAL_HEIGHT);
    const scale    = fitScale * 2;
    const scaledW  = LOGICAL_WIDTH  * scale;
    const scaledH  = LOGICAL_HEIGHT * scale;
    expect(t.offsetX).toBeCloseTo((paneW - scaledW) / 2, 10);
    expect(t.offsetY).toBeCloseTo((paneH - scaledH) / 2, 10);
  });

  it('handles fractional zoom (0.5 = half of fit size)', () => {
    const t = computeZoomTransform(1920, 1080, 0.5);
    // fit scale = 1 (exact match), zoom 0.5 → scale=0.5
    expect(t.scale).toBeCloseTo(0.5, 10);
    // Canvas is 960x540 centered in 1920x1080
    expect(t.offsetX).toBeCloseTo(480, 10);
    expect(t.offsetY).toBeCloseTo(270, 10);
  });

  it('round-trips through screen and logical space at custom zoom', () => {
    const t = computeZoomTransform(1024, 768, 1.5);
    const logical: Point = { x: 500, y: 300 };
    const screen    = logicalToScreen(logical, t);
    const backToLog = screenToLogical(screen, t);
    expectNearPoint(backToLog, logical);
  });
});

// ---------------------------------------------------------------------------
// 5. applyPan — additive pan offset (spec 04)
// ---------------------------------------------------------------------------

describe('applyPan', () => {
  it('adds pan to the transform offset without changing scale', () => {
    const t: Transform = { scale: 0.5, offsetX: 100, offsetY: 80 };
    const panned = applyPan(t, 50, -20);
    expect(panned.scale).toBeCloseTo(0.5, 10);
    expect(panned.offsetX).toBeCloseTo(150, 10);
    expect(panned.offsetY).toBeCloseTo(60, 10);
  });

  it('zero pan leaves the transform unchanged', () => {
    const t: Transform = { scale: 1.2, offsetX: 33, offsetY: 44 };
    const panned = applyPan(t, 0, 0);
    expect(panned.scale).toBeCloseTo(t.scale, 10);
    expect(panned.offsetX).toBeCloseTo(t.offsetX, 10);
    expect(panned.offsetY).toBeCloseTo(t.offsetY, 10);
  });

  it('pan correctly shifts where a logical point lands in screen space', () => {
    const base = computeFitTransform(960, 540);
    // Canvas is exactly half size, no offset originally.
    expect(base.offsetX).toBeCloseTo(0, 10);

    const panned = applyPan(base, 100, 50);
    const screenPos = logicalToScreen({ x: 0, y: 0 }, panned);
    // Logical origin should now be at (100, 50) in screen space.
    expect(screenPos.x).toBeCloseTo(100, 10);
    expect(screenPos.y).toBeCloseTo(50, 10);
  });

  it('round-trips through panned transform', () => {
    const base   = computeFitTransform(800, 600);
    const panned = applyPan(base, 123, -456);
    const p: Point = { x: 700, y: 200 };
    const screen = logicalToScreen(p, panned);
    const back   = screenToLogical(screen, panned);
    expectNearPoint(back, p);
  });
});

// ---------------------------------------------------------------------------
// 6. Integration: composing fit + zoom + pan
// ---------------------------------------------------------------------------

describe('composed transforms', () => {
  it('fit → pan → round-trip', () => {
    const t = applyPan(computeFitTransform(1280, 720), 30, -15);
    const p: Point = { x: 960, y: 540 };
    expectNearPoint(screenToLogical(logicalToScreen(p, t), t), p);
  });

  it('zoom → pan → round-trip', () => {
    const t = applyPan(computeZoomTransform(1024, 768, 1.75), -80, 40);
    const p: Point = { x: 1500, y: 800 };
    expectNearPoint(screenToLogical(logicalToScreen(p, t), t), p);
  });

  it('known good values: fit 1280x720 logical center maps to screen center', () => {
    // 1280x720 viewport, 1920x1080 logical → scale = 1280/1920 = 2/3.
    // No letterbox (both ratios are exactly 16:9), offset=(0,0).
    const t = computeFitTransform(1280, 720);
    expect(t.scale).toBeCloseTo(2 / 3, 10);
    expect(t.offsetX).toBeCloseTo(0, 10);
    expect(t.offsetY).toBeCloseTo(0, 10);
    // Canvas center (960, 540) → screen center (640, 360).
    expectNearPoint(logicalToScreen({ x: 960, y: 540 }, t), { x: 640, y: 360 });
    // Back again.
    expectNearPoint(screenToLogical({ x: 640, y: 360 }, t), { x: 960, y: 540 });
  });
});

// ---------------------------------------------------------------------------
// 7. Constants sanity check
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('LOGICAL_WIDTH is 1920 (spec 05)', () => {
    expect(LOGICAL_WIDTH).toBe(1920);
  });

  it('LOGICAL_HEIGHT is 1080 (spec 05)', () => {
    expect(LOGICAL_HEIGHT).toBe(1080);
  });

  it('default aspect ratio is 16:9', () => {
    expect(LOGICAL_WIDTH / LOGICAL_HEIGHT).toBeCloseTo(16 / 9, 10);
  });
});
