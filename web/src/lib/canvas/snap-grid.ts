/**
 * snap-grid.ts — Snap-to-grid math (P3-8 / spec 04 "Snap-to-grid").
 *
 * WHY THIS EXISTS (spec 04 "Alignment tools", spec 05 logical units):
 * ===================================================================
 * Spec 04 offers an OPTIONAL grid (default 8 logical units) that drags snap to
 * when enabled. All snapping math operates in LOGICAL coordinates (spec 04
 * "Coordinate/scale system" + spec 05) so the behaviour is identical at any
 * editor zoom or output resolution — we never snap in screen pixels, only in the
 * authoritative 1920×1080 logical space.
 *
 * This module is intentionally pure and DOM-free so it is unit-testable headless
 * and reusable by both the free-element drag (move) and keyboard-nudge paths.
 */

import type { Point } from '$lib/coords.ts';

/**
 * Default grid spacing in LOGICAL units (spec 04: "optional grid, default 8
 * logical px"). Chosen as the single source of truth so the overlay renderer and
 * the snapping math never disagree.
 */
export const DEFAULT_GRID_SIZE = 8;

/**
 * Snap a single logical value to the nearest multiple of `gridSize`.
 *
 * Pure: `round(value / gridSize) * gridSize`. Negative values snap correctly
 * because Math.round rounds toward +∞ at .5 consistently and the symmetry of the
 * grid means the nearest multiple is still chosen.
 *
 * GUARD: a non-positive or non-finite `gridSize` means "no grid / snapping
 * disabled" — we return the value unchanged rather than dividing by zero or
 * producing NaN. This lets callers pass `gridSize` straight through from a toggle
 * (e.g. `enabled ? size : 0`) without branching.
 */
export function snapToGrid(valueLogical: number, gridSize: number = DEFAULT_GRID_SIZE): number {
  if (!(gridSize > 0) || !Number.isFinite(gridSize)) return valueLogical;
  const snapped = Math.round(valueLogical / gridSize) * gridSize;
  // Normalise -0 → 0 so coordinates never serialize as "-0".
  return snapped === 0 ? 0 : snapped;
}

/**
 * Snap a logical point to the grid on both axes. Convenience wrapper used by the
 * free-element drag/move path where both x and y must land on the grid.
 */
export function snapPointToGrid(point: Point, gridSize: number = DEFAULT_GRID_SIZE): Point {
  return {
    x: snapToGrid(point.x, gridSize),
    y: snapToGrid(point.y, gridSize),
  };
}
