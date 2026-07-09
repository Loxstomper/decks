/**
 * overlay-geometry.ts — Map an in-iframe element rect to an overlay box (P2-4).
 *
 * WHY THIS EXISTS (spec canvas-interaction "Coordinate/scale system", P0-14 transform):
 * =====================================================================
 * The selection box is drawn in the PARENT document, over the iframe, but the
 * element it tracks lives INSIDE the iframe. Two facts make the math clean:
 *
 *   1. The iframe is sized at the LOGICAL canvas (1920×1080) and reveal renders
 *      at scale 1 inside it (see RevealFrame.svelte). Therefore an element's
 *      `getBoundingClientRect()` *measured inside the iframe* is already in
 *      LOGICAL coordinates — independent of how the parent has zoomed/panned the
 *      iframe via CSS transform. (Parent CSS transforms do not affect
 *      getBoundingClientRect inside the child document.)
 *
 *   2. The parent scales/translates the iframe with exactly the coords.ts
 *      transform: `screen = logical × scale + offset`. The overlay layer is the
 *      iframe's positioned parent, so applying that same transform to the logical
 *      rect yields overlay-local pixels that land pixel-perfectly on the element.
 *
 * Consequence (the load-bearing property): the logical rect is INVARIANT under
 * editor zoom/pan, so the overlay tracks the element at any zoom simply by
 * re-applying the (changed) transform to a cached logical rect — no re-measuring
 * the DOM on zoom. We only re-measure when the element itself reflows (P2-4
 * ResizeObserver) or selection changes.
 *
 * Pure module → unit-testable headlessly (no DOM).
 */

import { logicalToScreen, type Transform } from '$lib/coords.ts';

/** An axis-aligned rectangle (left/top/width/height) in some coordinate space. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Read the logical rect of an element measured inside the iframe.
 *
 * `getBoundingClientRect()` inside the iframe is already logical (see module
 * header), so this is a thin, named adapter that documents that invariant and
 * normalises the `DOMRect` to our plain {@link Rect}.
 */
export function domRectToLogical(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Rect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Convert a LOGICAL rect to the SCREEN (overlay-local) rect using the active
 * transform. The top-left corner maps through `logicalToScreen`; width/height
 * scale by the uniform factor (no rotation/shear, so this is exact).
 */
export function logicalRectToScreen(rect: Rect, transform: Transform): Rect {
  const topLeft = logicalToScreen({ x: rect.left, y: rect.top }, transform);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  };
}
