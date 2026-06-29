/**
 * resize-geometry.ts — Pure geometry for free-element move + resize (P4-2 / P4-3).
 *
 * WHY THIS EXISTS (spec 04 "Resize handles: 8 handles; Shift = preserve aspect;
 * Alt = resize from center", "Free → Move"; spec 05 logical coordinates):
 * =====================================================================
 * Dragging or resizing a `data-free` element changes its logical geometry
 * (`data-x`/`data-y`/`data-w`/`data-h` — spec 03). ALL of that math happens in
 * the authoritative LOGICAL 1920×1080 space (spec 04 "all snapping, guides, and
 * handle math operate in logical coordinates"), so behaviour is identical at any
 * editor zoom or output resolution — the overlay only re-projects the result to
 * screen pixels for drawing.
 *
 * This module is intentionally PURE and DOM-free: no iframe, no store, no
 * `transform`. The controller (FreeTransformOverlay.svelte) feeds it logical
 * deltas (already converted from pointer pixels via coords.screenToLogical) and
 * renders whatever rect comes back. That keeps every handle × modifier × snap
 * combination unit-testable headless.
 *
 * COORDINATE CONVENTION: a {@link Rect} here is `{ left, top, width, height }` in
 * LOGICAL units, where `left`/`top` are the free element's `data-x`/`data-y` and
 * `width`/`height` are `data-w`/`data-h`. (Same shape as overlay-geometry.Rect so
 * the two interoperate without conversion.)
 */

import type { Rect } from './overlay-geometry.ts';
import type { Point } from '$lib/coords.ts';
import { snapToGrid } from './snap-grid.ts';

export type { Rect } from './overlay-geometry.ts';

/**
 * The eight resize handles, named by compass direction:
 *   nw  n  ne
 *   w      e
 *   sw  s  se
 * Corners drive both axes; edges drive one. Order is stable so the overlay can
 * render them deterministically.
 */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** All eight handles in a stable render order (corners + edges interleaved). */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Which edges a handle controls.
 *   x: 'left' | 'right' | null   — the horizontal edge that moves (null = none)
 *   y: 'top'  | 'bottom' | null  — the vertical edge that moves (null = none)
 * The OPPOSITE edge is the anchor that stays put (unless `fromCenter`).
 */
const HANDLE_EDGES: Record<Handle, { x: 'left' | 'right' | null; y: 'top' | 'bottom' | null }> = {
  nw: { x: 'left', y: 'top' },
  n: { x: null, y: 'top' },
  ne: { x: 'right', y: 'top' },
  e: { x: 'right', y: null },
  se: { x: 'right', y: 'bottom' },
  s: { x: null, y: 'bottom' },
  sw: { x: 'left', y: 'bottom' },
  w: { x: 'left', y: null },
};

/** Default minimum logical size so a resize can never collapse/flip the box. */
export const MIN_FREE_SIZE = 1;

/** Options for {@link resizeRect}. */
export interface ResizeOptions {
  /** Shift: preserve the original aspect ratio. */
  aspect?: boolean;
  /** Alt: resize symmetrically about the element's center. */
  fromCenter?: boolean;
  /** Grid size in logical units to snap the resized dimensions to (0 = no snap). */
  snap?: number;
  /** Minimum logical width/height. Defaults to {@link MIN_FREE_SIZE}. */
  minSize?: number;
}

/**
 * The logical-space center point of a handle for a given rect — used by the
 * overlay to place the handle dots (projected to screen with the transform) and
 * by {@link hitTestHandle}. Corners sit on the rect corners; edge handles at the
 * midpoint of their edge.
 */
export function handlePoint(rect: Rect, handle: Handle): Point {
  const edges = HANDLE_EDGES[handle];
  // x: left edge → left, right edge → right, neither (n/s) → horizontal midpoint.
  const x =
    edges.x === 'left' ? rect.left : edges.x === 'right' ? rect.left + rect.width : rect.left + rect.width / 2;
  const y =
    edges.y === 'top' ? rect.top : edges.y === 'bottom' ? rect.top + rect.height : rect.top + rect.height / 2;
  return { x, y };
}

/**
 * Hit-test a query point against a rect's eight handles, returning the nearest
 * handle whose center is within `radius` of the point (in the SAME coordinate
 * space as `point`/`rect`), or null. The overlay normally renders one div per
 * handle and relies on native pointer hit-testing, but exposing this keeps the
 * decision pure + testable and supports headless/keyboard paths.
 *
 * `radius` is the half-size of a handle's clickable square; a point inside any
 * handle's box (Chebyshev distance ≤ radius) hits it. Ties resolve to the
 * earliest handle in {@link HANDLES} order.
 */
export function hitTestHandle(point: Point, rect: Rect, radius: number): Handle | null {
  for (const handle of HANDLES) {
    const hp = handlePoint(rect, handle);
    if (Math.abs(point.x - hp.x) <= radius && Math.abs(point.y - hp.y) <= radius) {
      return handle;
    }
  }
  return null;
}

/**
 * Translate a rect by a logical delta (free MOVE — spec 04 "Free → Move"). Size
 * is preserved; only the origin (data-x/data-y) changes. When `snap > 0` the new
 * origin snaps to the grid (same rule as the nudge/drag path), so a moved element
 * lands on grid lines just like snapToGrid does for a point.
 */
export function dragRect(orig: Rect, dxLogical: number, dyLogical: number, snap = 0): Rect {
  let left = orig.left + dxLogical;
  let top = orig.top + dyLogical;
  if (snap > 0) {
    left = snapToGrid(left, snap);
    top = snapToGrid(top, snap);
  }
  return { left, top, width: orig.width, height: orig.height };
}

/**
 * Resize a rect by dragging `handle` a logical delta `(dx, dy)` (P4-3).
 *
 * Modifiers (spec 04):
 *   • `aspect` (Shift)     — keep the original width/height ratio. For a corner
 *     the axis with the larger proportional change drives; for an edge handle the
 *     dragged axis drives and the other axis grows symmetrically about center.
 *   • `fromCenter` (Alt)   — the element's center stays fixed; both opposite
 *     edges move, so a single edge drag changes the dimension by 2·delta.
 *
 * The anchor (the edge opposite the handle, or the center when `fromCenter`) is
 * held fixed; the dragged edge(s) follow the pointer. Dimensions are clamped to
 * `minSize` so the box can never collapse or flip inside-out. When `snap > 0` the
 * resized dimensions snap to the grid (for aspect, only the driving dimension
 * snaps and the other is re-derived from the ratio, so the ratio is preserved).
 *
 * Returns a fresh rect; never mutates `orig`.
 */
export function resizeRect(
  orig: Rect,
  handle: Handle,
  dxLogical: number,
  dyLogical: number,
  opts: ResizeOptions = {},
): Rect {
  const { aspect = false, fromCenter = false, snap = 0, minSize = MIN_FREE_SIZE } = opts;
  const edges = HANDLE_EDGES[handle];

  // Original anchor edges + center, captured before mutation.
  const origRight = orig.left + orig.width;
  const origBottom = orig.top + orig.height;
  const cx = orig.left + orig.width / 2;
  const cy = orig.top + orig.height / 2;

  // 1. Raw new dimensions from the deltas. Moving an edge changes that dimension
  //    by ±delta; fromCenter moves the opposite edge too, hence the ×2 factor.
  const factor = fromCenter ? 2 : 1;
  let width = orig.width;
  let height = orig.height;
  if (edges.x === 'left') width = orig.width - dxLogical * factor;
  else if (edges.x === 'right') width = orig.width + dxLogical * factor;
  if (edges.y === 'top') height = orig.height - dyLogical * factor;
  else if (edges.y === 'bottom') height = orig.height + dyLogical * factor;

  // 2. Aspect-ratio lock (Shift). Decide a driver dimension, then derive the
  //    other from the original ratio so the rect keeps its proportions.
  const ar = orig.height !== 0 ? orig.width / orig.height : 1;
  if (aspect && orig.width > 0 && orig.height > 0) {
    const cornerHandle = edges.x !== null && edges.y !== null;
    let widthDrives: boolean;
    if (cornerHandle) {
      // The axis whose new size deviates more (proportionally) wins — feels like
      // the box follows whichever way the pointer pulled hardest.
      widthDrives = Math.abs(width / orig.width) >= Math.abs(height / orig.height);
    } else {
      // Edge handle: the dragged axis is the driver.
      widthDrives = edges.x !== null;
    }
    if (widthDrives) {
      if (snap > 0) width = clampMin(snapToGrid(width, snap), minSize);
      height = width / ar;
    } else {
      if (snap > 0) height = clampMin(snapToGrid(height, snap), minSize);
      width = height * ar;
    }
  } else if (snap > 0) {
    // No aspect lock: snap each dragged dimension independently to the grid.
    if (edges.x !== null) width = snapToGrid(width, snap);
    if (edges.y !== null) height = snapToGrid(height, snap);
  }

  // 3. Clamp to the minimum size (prevents collapse / inside-out flip).
  width = clampMin(width, minSize);
  height = clampMin(height, minSize);

  // 4. Placement: re-derive left/top from the final size while holding the anchor
  //    fixed. For the non-active axis (and fromCenter) we center on the original
  //    center — which is a no-op when that dimension didn't change, and the
  //    natural choice when aspect grew it.
  let left: number;
  if (fromCenter || edges.x === null) left = cx - width / 2;
  else if (edges.x === 'left') left = origRight - width; // right edge anchored
  else left = orig.left; // edges.x === 'right' → left edge anchored

  let top: number;
  if (fromCenter || edges.y === null) top = cy - height / 2;
  else if (edges.y === 'top') top = origBottom - height; // bottom edge anchored
  else top = orig.top; // edges.y === 'bottom' → top edge anchored

  return { left, top, width, height };
}

/** Clamp a value to a minimum, also normalising -0 → 0. */
function clampMin(value: number, min: number): number {
  const v = value < min ? min : value;
  return v === 0 ? 0 : v;
}
