import { describe, it, expect } from 'vitest';
import {
  ASPECT_PRESETS,
  DEFAULT_ASPECT,
  aspectToLogicalSize,
  logicalDimensions,
  logicalSizeToAspect,
  repositionFreeRect,
  computeRepositionOffers,
  type LogicalSize,
} from './aspect.ts';

describe('logicalSizeToAspect — reverse map for load-time seeding', () => {
  it('returns the preset id for an exact preset size', () => {
    expect(logicalSizeToAspect({ width: 1920, height: 1080 })).toBe('16:9');
    expect(logicalSizeToAspect({ width: 1440, height: 1080 })).toBe('4:3');
    expect(logicalSizeToAspect({ width: 1080, height: 1920 })).toBe('9:16');
  });
  it('returns an explicit WxH custom descriptor for a non-preset size', () => {
    expect(logicalSizeToAspect({ width: 1600, height: 900 })).toBe('1600x900');
  });
  it('round-trips a custom size through aspectToLogicalSize', () => {
    const size = { width: 1600, height: 900 };
    expect(aspectToLogicalSize(logicalSizeToAspect(size))).toEqual(size);
  });
});

describe('aspectToLogicalSize — preset table (spec 05)', () => {
  it('16:9 → 1920×1080', () => {
    expect(aspectToLogicalSize('16:9')).toEqual({ width: 1920, height: 1080 });
  });
  it('4:3 → 1440×1080', () => {
    expect(aspectToLogicalSize('4:3')).toEqual({ width: 1440, height: 1080 });
  });
  it('16:10 → 1920×1200 (explicit table value, NOT ratio-derived)', () => {
    expect(aspectToLogicalSize('16:10')).toEqual({ width: 1920, height: 1200 });
  });
  it('9:16 portrait → 1080×1920', () => {
    expect(aspectToLogicalSize('9:16')).toEqual({ width: 1080, height: 1920 });
  });

  it('the default aspect resolves to the 16:9 size', () => {
    expect(aspectToLogicalSize(DEFAULT_ASPECT)).toEqual(ASPECT_PRESETS['16:9']);
  });

  it('trims surrounding whitespace', () => {
    expect(aspectToLogicalSize('  4:3 ')).toEqual({ width: 1440, height: 1080 });
  });
});

describe('aspectToLogicalSize — custom forms', () => {
  it('parses explicit WxH dimensions', () => {
    expect(aspectToLogicalSize('1600x900')).toEqual({ width: 1600, height: 900 });
  });
  it('parses the unicode × separator', () => {
    expect(aspectToLogicalSize('1280×720')).toEqual({ width: 1280, height: 720 });
  });
  it('derives a non-preset landscape ratio anchored to height 1080', () => {
    // 21:9 → height 1080, width = 1080*21/9 = 2520.
    expect(aspectToLogicalSize('21:9')).toEqual({ width: 2520, height: 1080 });
  });
  it('derives a non-preset portrait ratio anchored to width 1080', () => {
    // 3:4 → width 1080, height = 1080*4/3 = 1440.
    expect(aspectToLogicalSize('3:4')).toEqual({ width: 1080, height: 1440 });
  });
  it('falls back to the default for unparseable input', () => {
    expect(aspectToLogicalSize('garbage')).toEqual(ASPECT_PRESETS[DEFAULT_ASPECT]);
    expect(aspectToLogicalSize('0:0')).toEqual(ASPECT_PRESETS[DEFAULT_ASPECT]);
  });
});

const SIZE_16_9: LogicalSize = { width: 1920, height: 1080 };
const SIZE_4_3: LogicalSize = { width: 1440, height: 1080 };

describe('repositionFreeRect — proportional (default)', () => {
  it('scales x and width by the width factor; y and height by the height factor', () => {
    // 16:9 → 4:3: sx = 1440/1920 = 0.75, sy = 1080/1080 = 1.
    const out = repositionFreeRect(
      { x: 960, y: 540, w: 400, h: 200 },
      SIZE_16_9,
      SIZE_4_3,
      'proportional',
    );
    expect(out).toEqual({ x: 720, y: 540, w: 300, h: 200 });
  });

  it('keeps an element pinned at the origin at the origin', () => {
    const out = repositionFreeRect({ x: 0, y: 0, w: 100, h: 100 }, SIZE_16_9, SIZE_4_3);
    expect(out).toEqual({ x: 0, y: 0, w: 75, h: 100 });
  });

  it('omits size keys that were not supplied (content-sized element)', () => {
    const out = repositionFreeRect({ x: 800, y: 200 }, SIZE_16_9, SIZE_4_3, 'proportional');
    expect(out).toEqual({ x: 600, y: 200 });
    expect(out.w).toBeUndefined();
    expect(out.h).toBeUndefined();
  });

  it('is identity when old and new sizes are equal', () => {
    const r = { x: 123, y: 456, w: 78, h: 90 };
    expect(repositionFreeRect(r, SIZE_16_9, SIZE_16_9, 'proportional')).toEqual(r);
  });
});

describe('repositionFreeRect — uniform (preserve element aspect)', () => {
  it('scales size by the smaller factor and recenters proportionally', () => {
    // sx=0.75, sy=1 → s=0.75. Element centre (1160,640) → (870,640).
    // new size 300×150, so top-left = (870-150, 640-75) = (720, 565).
    const out = repositionFreeRect(
      { x: 960, y: 540, w: 400, h: 200 },
      SIZE_16_9,
      SIZE_4_3,
      'uniform',
    );
    expect(out).toEqual({ x: 720, y: 565, w: 300, h: 150 });
  });

  it('preserves a square element as a square', () => {
    const out = repositionFreeRect({ x: 0, y: 0, w: 200, h: 200 }, SIZE_16_9, SIZE_4_3, 'uniform');
    // s = 0.75 → 150×150 (still square), unlike proportional which would give 150×200.
    expect(out.w).toBe(150);
    expect(out.h).toBe(150);
  });
});

describe('aspectToLogicalSize — 1:1 preset (P4-7)', () => {
  it('1:1 → 1080×1080', () => {
    expect(aspectToLogicalSize('1:1')).toEqual({ width: 1080, height: 1080 });
  });
});

describe('logicalDimensions() — safe no-throw wrapper (P4-7)', () => {
  it('no argument → default 1920×1080', () => {
    expect(logicalDimensions()).toEqual({ width: 1920, height: 1080 });
  });

  it('undefined → default 1920×1080', () => {
    expect(logicalDimensions(undefined)).toEqual({ width: 1920, height: 1080 });
  });

  it('16:9 → 1920×1080 (matches ASPECT_PRESETS)', () => {
    expect(logicalDimensions('16:9')).toEqual(ASPECT_PRESETS['16:9']);
  });

  it('4:3 → 1440×1080', () => {
    expect(logicalDimensions('4:3')).toEqual({ width: 1440, height: 1080 });
  });

  it('1:1 → 1080×1080', () => {
    expect(logicalDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
  });

  it('9:16 portrait → 1080×1920', () => {
    expect(logicalDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
  });

  it('custom ratio 3:2 → derived from H=1080 base', () => {
    // 3/2 * 1080 = 1620
    expect(logicalDimensions('3:2')).toEqual({ width: 1620, height: 1080 });
  });

  it('explicit WxH format passes through', () => {
    expect(logicalDimensions('1600x900')).toEqual({ width: 1600, height: 900 });
  });

  it('invalid string → falls back to default 1920×1080 (no throw)', () => {
    expect(logicalDimensions('garbage')).toEqual({ width: 1920, height: 1080 });
  });

  it('empty string → falls back to default 1920×1080 (no throw)', () => {
    expect(logicalDimensions('')).toEqual({ width: 1920, height: 1080 });
  });

  it('DEFAULT_ASPECT resolves to the 16:9 size', () => {
    expect(logicalDimensions(DEFAULT_ASPECT)).toEqual(ASPECT_PRESETS['16:9']);
  });
});

describe('computeRepositionOffers', () => {
  it('builds current+suggested for every free element, preserving order', () => {
    const offers = computeRepositionOffers(
      [
        { eid: 'f1', rect: { x: 960, y: 0, w: 400, h: 100 } },
        { eid: 'f2', rect: { x: 0, y: 540 } },
      ],
      SIZE_16_9,
      SIZE_4_3,
      'proportional',
    );
    expect(offers).toEqual([
      { eid: 'f1', current: { x: 960, y: 0, w: 400, h: 100 }, suggested: { x: 720, y: 0, w: 300, h: 100 } },
      { eid: 'f2', current: { x: 0, y: 540 }, suggested: { x: 0, y: 540 } },
    ]);
  });
});
