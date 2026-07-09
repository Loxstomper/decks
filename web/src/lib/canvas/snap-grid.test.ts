import { describe, it, expect } from 'vitest';
import { snapToGrid, snapPointToGrid, DEFAULT_GRID_SIZE } from './snap-grid.ts';

describe('snapToGrid', () => {
  it('defaults to an 8 logical-unit grid (spec canvas-interaction)', () => {
    expect(DEFAULT_GRID_SIZE).toBe(8);
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(0); // nearest multiple of 8 below the halfway
    expect(snapToGrid(4)).toBe(8); // exactly halfway rounds up
    expect(snapToGrid(11)).toBe(8);
    expect(snapToGrid(12)).toBe(16); // 1.5 rounds up
    expect(snapToGrid(13)).toBe(16);
  });

  it('snaps to an arbitrary grid size', () => {
    expect(snapToGrid(23, 10)).toBe(20);
    expect(snapToGrid(25, 10)).toBe(30);
    expect(snapToGrid(100, 25)).toBe(100);
  });

  it('handles negative values symmetrically', () => {
    expect(snapToGrid(-3, 8)).toBe(0);
    expect(snapToGrid(-5, 8)).toBe(-8);
    expect(snapToGrid(-12, 8)).toBe(-8);
  });

  it('returns the value unchanged when the grid is disabled / invalid', () => {
    expect(snapToGrid(13, 0)).toBe(13);
    expect(snapToGrid(13, -8)).toBe(13);
    expect(snapToGrid(13, NaN)).toBe(13);
    expect(snapToGrid(13, Infinity)).toBe(13);
  });
});

describe('snapPointToGrid', () => {
  it('snaps both axes independently', () => {
    expect(snapPointToGrid({ x: 13, y: 4 }, 8)).toEqual({ x: 16, y: 8 });
  });

  it('passes through when disabled', () => {
    expect(snapPointToGrid({ x: 13, y: 5 }, 0)).toEqual({ x: 13, y: 5 });
  });
});
