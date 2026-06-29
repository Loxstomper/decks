/**
 * marquee.ts — Pure hit-math for marquee (rubber-band) multi-select (P4-5).
 *
 * WHY THIS EXISTS (spec 04 "Marquee (drag-select) for multi-select"):
 * ===================================================================
 * Dragging on EMPTY canvas space draws a selection rectangle; on release every
 * element whose LOGICAL rect is touched by (or contained in) that rectangle is
 * selected together. The decision of WHICH elements fall inside the band is pure
 * geometry — no DOM, no store — so it lives here and is unit-tested headlessly.
 * The controller (MarqueeController.svelte) supplies the candidate rects measured
 * from the iframe and feeds the winning eids to the (multi-select) selection store.
 *
 * COORDINATE SPACE (load-bearing): every rect here is in LOGICAL canvas units
 * (1920×1080-style). The marquee rectangle the user drew is converted from screen
 * to logical by the controller via coords.ts BEFORE calling in, so the hit test is
 * scale/zoom/pan independent — identical behaviour at any zoom (spec 04).
 *
 * Two modes (spec 04 leaves the exact rule to us; both are standard editor idioms):
 *   • 'intersect' — select anything the band TOUCHES (Photoshop/Figma default;
 *                   forgiving, the common case).
 *   • 'contain'   — select only elements FULLY enclosed by the band (PowerPoint
 *                   style; precise, avoids grabbing half-covered neighbours).
 */

import type { Rect } from './overlay-geometry.ts';
import type { Point } from '$lib/coords.ts';

/** How a candidate must relate to the marquee to be selected. */
export type MarqueeMode = 'intersect' | 'contain';

/** A selectable element paired with its LOGICAL rect (left/top/width/height). */
export interface MarqueeCandidate {
  eid: string;
  rect: Rect;
}

/**
 * Build a normalised marquee rect from the drag's anchor and current pointer.
 *
 * The user can drag in any direction (up-left, down-right, …); we normalise so
 * width/height are always non-negative and `left/top` is the top-left corner.
 * Both points are in the SAME space (logical for the hit test, or screen for the
 * overlay) — this function is space-agnostic.
 */
export function marqueeRectFromPoints(a: Point, b: Point): Rect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    left,
    top,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * True when two axis-aligned rects overlap by any positive area.
 *
 * Edge-touching (zero-area overlap) does NOT count as an intersection: a band
 * dragged exactly up to — but not over — an element's edge should not grab it,
 * which matches the visual expectation that the band must visibly cover a sliver
 * of the element. We use strict `<`/`>` comparisons to encode that.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * True when `inner` is fully enclosed by `outer` (inclusive — flush edges count,
 * since a fully-covered element on the boundary is still "contained").
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  );
}

/**
 * The core P4-5 hit test: return the eids of every candidate the marquee selects.
 *
 * `mode` chooses the relation (touch vs fully-enclose). Order is preserved from
 * the candidate list so the resulting selection set is deterministic (useful for
 * "first element is the alignment anchor" semantics in P4-6).
 *
 * A zero-area marquee (a click that never moved past the drag threshold) selects
 * nothing — that case is handled by the controller before it ever calls here, but
 * we also short-circuit defensively so a degenerate band can't lasso the whole
 * slide via the 'contain' rule on zero-size elements.
 */
export function elementsInMarquee(
  marquee: Rect,
  candidates: MarqueeCandidate[],
  mode: MarqueeMode = 'intersect',
): string[] {
  if (marquee.width <= 0 || marquee.height <= 0) return [];
  const hit = mode === 'contain' ? rectContains : rectsIntersect;
  const out: string[] = [];
  for (const c of candidates) {
    if (hit(marquee, c.rect)) out.push(c.eid);
  }
  return out;
}
