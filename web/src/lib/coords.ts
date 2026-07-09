/**
 * coords.ts — Coordinate / scale transform for the slide canvas.
 *
 * WHY THIS EXISTS (per spec canvas-interaction + 05):
 * ====================================
 * reveal.js renders the logical canvas (default 1920×1080) at a fixed logical
 * size, then applies a single uniform CSS `transform: scale()` to fit any
 * physical viewport. The editor overlays (selection boxes, resize handles,
 * alignment guides) live in the *parent* document — outside that scaled space.
 * Therefore every overlay calculation must convert between two coordinate
 * systems:
 *
 *   • Logical space  — 1920×1080 units; the authoritative space for all
 *                      geometry (positions, sizes, snap grid, nudge amounts).
 *   • Screen space   — physical CSS pixels of the browser viewport / pane.
 *
 * The single shared transform is:
 *
 *   screen = logical × scale + offset
 *
 * where `offset` handles both letterboxing/pillarboxing *and* pan.
 *
 * Two zoom concepts (spec scaling-and-resolution) — never conflated:
 *   1. present-scale: auto fit-to-screen (uniform, no user control).
 *   2. editor-zoom:   pane-fit × userZoom (user can zoom in for detail work).
 *
 * All snapping, guide math, handle positions, and nudge ops work in LOGICAL
 * coordinates and are converted to screen only for rendering.  This means
 * behaviour is identical at any zoom level or output resolution.
 *
 * Transform shape: { scale, offsetX, offsetY }
 *   - scale   : uniform scale factor (screen_px / logical_px)
 *   - offsetX : x translation in screen pixels (logical origin in screen space)
 *   - offsetY : y translation in screen pixels
 */

/** A 2-D point in either coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Represents the active coordinate transform between logical and screen space.
 *
 * screen_x = logical_x * scale + offsetX
 * screen_y = logical_y * scale + offsetY
 */
export interface Transform {
  /** Uniform scale factor: screen pixels per logical pixel. */
  scale: number;
  /** X translation from logical origin to screen origin (CSS pixels). */
  offsetX: number;
  /** Y translation from logical origin to screen origin (CSS pixels). */
  offsetY: number;
}

/** Default logical canvas size (spec scaling-and-resolution). */
export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;

/**
 * Convert a point from screen space (CSS pixels) to logical canvas space.
 *
 * Inverse of logicalToScreen.  Used when the user clicks/drags on the overlay
 * to find the corresponding position inside the slide.
 */
export function screenToLogical(point: Point, transform: Transform): Point {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

/**
 * Convert a point from logical canvas space to screen space (CSS pixels).
 *
 * Inverse of screenToLogical.  Used when rendering overlay elements (handles,
 * guides) at positions derived from logical geometry.
 */
export function logicalToScreen(point: Point, transform: Transform): Point {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  };
}

/**
 * Compute the fit-to-viewport transform.
 *
 * Scales the logical canvas uniformly so it fills the given viewport as
 * large as possible while preserving the aspect ratio (letterboxing /
 * pillarboxing).  Centers the result.
 *
 * This mirrors exactly what reveal.js does at present time (spec scaling-and-resolution), giving
 * true WYSIWYG alignment between the iframe content and the overlay layer.
 *
 * @param viewportWidth  Available CSS width in screen pixels.
 * @param viewportHeight Available CSS height in screen pixels.
 * @param logicalWidth   Logical canvas width (default 1920).
 * @param logicalHeight  Logical canvas height (default 1080).
 */
export function computeFitTransform(
  viewportWidth: number,
  viewportHeight: number,
  logicalWidth: number = LOGICAL_WIDTH,
  logicalHeight: number = LOGICAL_HEIGHT,
): Transform {
  // Uniform scale: fit inside viewport without cropping.
  const scale = Math.min(viewportWidth / logicalWidth, viewportHeight / logicalHeight);

  // Center the scaled canvas within the viewport (letterbox/pillarbox).
  const scaledW = logicalWidth * scale;
  const scaledH = logicalHeight * scale;
  const offsetX = (viewportWidth - scaledW) / 2;
  const offsetY = (viewportHeight - scaledH) / 2;

  return { scale, offsetX, offsetY };
}

/**
 * Compute the editor-zoom transform.
 *
 * The editor canvas is first fit to the pane (same as fit-to-viewport), then
 * an additional `userZoom` multiplier is applied (1.0 = fit, 2.0 = 200%, etc.)
 * and the result is kept centered in the pane.
 *
 * Editor zoom ≠ present-scale (spec scaling-and-resolution): the user can zoom in/out for detail
 * work without affecting how the deck will look when presented.
 *
 * @param paneWidth   Width of the canvas pane in CSS pixels.
 * @param paneHeight  Height of the canvas pane in CSS pixels.
 * @param userZoom    Zoom multiplier (1.0 = fit to pane, 2.0 = 200%).
 * @param logicalWidth  Logical canvas width (default 1920).
 * @param logicalHeight Logical canvas height (default 1080).
 */
export function computeZoomTransform(
  paneWidth: number,
  paneHeight: number,
  userZoom: number,
  logicalWidth: number = LOGICAL_WIDTH,
  logicalHeight: number = LOGICAL_HEIGHT,
): Transform {
  // Base fit scale (same calculation as computeFitTransform).
  const fitScale = Math.min(paneWidth / logicalWidth, paneHeight / logicalHeight);
  const scale = fitScale * userZoom;

  // Re-center after applying user zoom.
  const scaledW = logicalWidth * scale;
  const scaledH = logicalHeight * scale;
  const offsetX = (paneWidth - scaledW) / 2;
  const offsetY = (paneHeight - scaledH) / 2;

  return { scale, offsetX, offsetY };
}

/**
 * Apply an additional pan offset to an existing transform.
 *
 * Pan is additive: the user shifts the canvas within the pane without changing
 * the zoom level.  All geometry math remains in logical coordinates; this only
 * moves where the logical origin lands in screen space.
 *
 * @param transform  Base transform (from computeFitTransform or computeZoomTransform).
 * @param panX       Additional X pan in screen pixels.
 * @param panY       Additional Y pan in screen pixels.
 */
export function applyPan(transform: Transform, panX: number, panY: number): Transform {
  return {
    scale: transform.scale,
    offsetX: transform.offsetX + panX,
    offsetY: transform.offsetY + panY,
  };
}
