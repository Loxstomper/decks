/**
 * align-distribute.ts — Align and distribute operations for free multi-selection (P4-6).
 *
 * WHY THIS EXISTS (spec canvas-interaction "Align / distribute"):
 * ================================================
 * When the user selects 2+ `data-free` elements and clicks an alignment button,
 * we compute new logical positions for every element and apply them as ONE undo
 * entry (via `deckStore.applyFreeGeometryBatch`).
 *
 * All functions here are PURE (no DOM, no store) → unit-testable headlessly.
 * All coordinates are in LOGICAL space (spec canvas-interaction, spec scaling-and-resolution).
 *
 * Alignment strategy (matches Figma / Adobe XD convention):
 *   • Align ops use the BOUNDING BOX of the entire selection as the reference frame.
 *     "Align left" means: all elements move so their left edges match the leftmost
 *     left edge in the selection.
 *   • Distribute ops keep the first and last elements in place (by their primary
 *     axis position), then space the intermediate elements so the GAP between each
 *     adjacent pair is equal.
 *
 * Return value: every function returns a Map<eid, Rect> containing the NEW rect
 * for EVERY input element (even those that didn't move, for simplicity). Callers
 * extract `.left` / `.top` as the new `data-x` / `data-y`.
 */

import type { Rect } from './overlay-geometry.ts';

/** An eid-tagged logical rect — the input/output unit for all ops here. */
export interface FreeRect {
  eid: string;
  /** Logical bounding box in the slide coordinate system. */
  rect: Rect;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Produce a new Map with the same keys but each rect replaced by the patcher. */
function mapRects(
  input: FreeRect[],
  patch: (fr: FreeRect) => Rect,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const fr of input) out.set(fr.eid, patch(fr));
  return out;
}

/** Bounding box that contains all input rects. */
function boundingBox(rects: FreeRect[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { rect: r } of rects) {
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.left + r.width > right) right = r.left + r.width;
    if (r.top + r.height > bottom) bottom = r.top + r.height;
  }
  return { left, top, right, bottom };
}

// ── Align operations ──────────────────────────────────────────────────────────

/**
 * Align all elements' LEFT edges to the leftmost left edge in the selection.
 * Tops and sizes are unchanged.
 */
export function alignLeft(rects: FreeRect[]): Map<string, Rect> {
  const { left: target } = boundingBox(rects);
  return mapRects(rects, ({ rect: r }) => ({ ...r, left: target }));
}

/**
 * Align all elements' RIGHT edges to the rightmost right edge in the selection.
 * Each element's left is shifted so its right lands on `maxRight`.
 * Tops and sizes are unchanged.
 */
export function alignRight(rects: FreeRect[]): Map<string, Rect> {
  const { right: target } = boundingBox(rects);
  return mapRects(rects, ({ rect: r }) => ({ ...r, left: target - r.width }));
}

/**
 * Align all elements' TOP edges to the topmost top edge in the selection.
 * Lefts and sizes are unchanged.
 */
export function alignTop(rects: FreeRect[]): Map<string, Rect> {
  const { top: target } = boundingBox(rects);
  return mapRects(rects, ({ rect: r }) => ({ ...r, top: target }));
}

/**
 * Align all elements' BOTTOM edges to the bottommost bottom edge in the selection.
 * Each element's top is shifted so its bottom lands on `maxBottom`.
 * Lefts and sizes are unchanged.
 */
export function alignBottom(rects: FreeRect[]): Map<string, Rect> {
  const { bottom: target } = boundingBox(rects);
  return mapRects(rects, ({ rect: r }) => ({ ...r, top: target - r.height }));
}

/**
 * Align all elements' HORIZONTAL centers to the center of the selection bounding box.
 * Each element's left is set so its cx = (bbox.left + bbox.right) / 2.
 * Tops and sizes are unchanged.
 */
export function alignCenterH(rects: FreeRect[]): Map<string, Rect> {
  const { left, right } = boundingBox(rects);
  const targetCx = (left + right) / 2;
  return mapRects(rects, ({ rect: r }) => ({ ...r, left: targetCx - r.width / 2 }));
}

/**
 * Align all elements' VERTICAL centers to the center of the selection bounding box.
 * Each element's top is set so its cy = (bbox.top + bbox.bottom) / 2.
 * Lefts and sizes are unchanged.
 */
export function alignCenterV(rects: FreeRect[]): Map<string, Rect> {
  const { top, bottom } = boundingBox(rects);
  const targetCy = (top + bottom) / 2;
  return mapRects(rects, ({ rect: r }) => ({ ...r, top: targetCy - r.height / 2 }));
}

// ── Distribute operations ─────────────────────────────────────────────────────

/**
 * Distribute elements with equal horizontal gaps between them.
 *
 * The LEFTMOST and RIGHTMOST elements (by left edge) are kept in place.
 * Intermediate elements are positioned so that the gap between each adjacent
 * pair of elements is equal.
 *
 * Formula:
 *   totalSpan   = rightmost.right - leftmost.left
 *   sumWidths   = Σ element.width
 *   gap         = (totalSpan - sumWidths) / (n - 1)
 *   elem[i].left = elem[i-1].right + gap  (sorted by left edge)
 *
 * Tops and sizes are unchanged. No-op for fewer than 3 elements (returned
 * rects equal the inputs — the first/last elements already define the span).
 */
export function distributeHorizontally(rects: FreeRect[]): Map<string, Rect> {
  if (rects.length < 3) {
    // With 1 or 2 elements there is nothing to distribute — return unchanged.
    return mapRects(rects, ({ rect: r }) => ({ ...r }));
  }

  // Sort a copy by left edge (ascending) to establish ordering.
  const sorted = [...rects].sort((a, b) => a.rect.left - b.rect.left);

  const first = sorted[0].rect;
  const last = sorted[sorted.length - 1].rect;
  const totalSpan = last.left + last.width - first.left;
  const sumWidths = sorted.reduce((s, { rect: r }) => s + r.width, 0);
  // Guard: if all elements are wider than the span, gap would be negative —
  // clamp to 0 so elements are stacked left-to-right touching each other.
  const gap = Math.max(0, (totalSpan - sumWidths) / (sorted.length - 1));

  const out = new Map<string, Rect>();
  let cursor = first.left;
  for (const fr of sorted) {
    out.set(fr.eid, { ...fr.rect, left: cursor });
    cursor += fr.rect.width + gap;
  }
  return out;
}

/**
 * Distribute elements with equal vertical gaps between them.
 *
 * The TOPMOST and BOTTOMMOST elements (by top edge) are kept in place.
 * Intermediate elements are positioned so that the gap between each adjacent
 * pair is equal.
 *
 * Lefts and sizes are unchanged. No-op for fewer than 3 elements.
 */
export function distributeVertically(rects: FreeRect[]): Map<string, Rect> {
  if (rects.length < 3) {
    return mapRects(rects, ({ rect: r }) => ({ ...r }));
  }

  const sorted = [...rects].sort((a, b) => a.rect.top - b.rect.top);

  const first = sorted[0].rect;
  const last = sorted[sorted.length - 1].rect;
  const totalSpan = last.top + last.height - first.top;
  const sumHeights = sorted.reduce((s, { rect: r }) => s + r.height, 0);
  const gap = Math.max(0, (totalSpan - sumHeights) / (sorted.length - 1));

  const out = new Map<string, Rect>();
  let cursor = first.top;
  for (const fr of sorted) {
    out.set(fr.eid, { ...fr.rect, top: cursor });
    cursor += fr.rect.height + gap;
  }
  return out;
}
