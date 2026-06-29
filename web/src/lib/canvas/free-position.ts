/**
 * free-position.ts — Read/write a free element's logical position (P3-9 nudge,
 * P3-8 snap for free drags / spec 03 `data-free`, spec 04 "Free → Move").
 *
 * WHY THIS EXISTS:
 * ================
 * A `data-free` element is positioned in LOGICAL coordinates via `data-x` /
 * `data-y` (spec 03 layout vocabulary). Nudging or dragging a free element edits
 * those attributes — and only those — so the byte-stable round-trip (spec 12 #4)
 * holds: setAttribute marks just that element dirty.
 *
 * Pure model helpers (no DOM, no store) → unit-testable. The store command layer
 * applies grid snapping (snap-grid.ts) on top before writing.
 */

import { getAttribute, setAttribute, type ElementNode } from '$lib/model';
import type { Point } from '$lib/coords.ts';
import type { Rect } from './overlay-geometry.ts';

/**
 * Parse a free element's logical position from `data-x`/`data-y`. Missing or
 * non-numeric coordinates default to 0 (top-left of the logical canvas), so a
 * freshly-freed element with no coordinates yet nudges from the origin.
 */
export function getFreePosition(el: ElementNode): Point {
  const parse = (raw: string | null): number => {
    if (raw === null) return 0;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  };
  return { x: parse(getAttribute(el, 'data-x')), y: parse(getAttribute(el, 'data-y')) };
}

/**
 * Write a free element's logical position to `data-x`/`data-y`.
 *
 * Integer-valued coordinates are written without a trailing `.0` (cleaner source
 * and matches how authors hand-write them); fractional values are written as-is.
 * Only this element goes dirty.
 */
export function setFreePosition(el: ElementNode, pos: Point): void {
  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(v));
  setAttribute(el, 'data-x', fmt(pos.x));
  setAttribute(el, 'data-y', fmt(pos.y));
}

/**
 * Apply a logical translation to a free element's position and write it back.
 * Returns the new position (post-translation) for callers that want to echo it.
 */
export function translateFreePosition(el: ElementNode, dx: number, dy: number): Point {
  const cur = getFreePosition(el);
  const next = { x: cur.x + dx, y: cur.y + dy };
  setFreePosition(el, next);
  return next;
}

/**
 * Parse a free element's logical SIZE from `data-w`/`data-h` (P4-3 resize / spec
 * 03 `data-w`/`data-h`). Returns null for a dimension that is absent or
 * non-positive: such an element is sized by its content, so the caller must fall
 * back to a measured rect (getBoundingClientRect inside the iframe is logical)
 * rather than inventing a size here in the pure layer.
 */
export function getFreeSize(el: ElementNode): { width: number | null; height: number | null } {
  const parse = (raw: string | null): number | null => {
    if (raw === null) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { width: parse(getAttribute(el, 'data-w')), height: parse(getAttribute(el, 'data-h')) };
}

/**
 * Write a free element's logical SIZE to `data-w`/`data-h`. Mirrors
 * {@link setFreePosition}: integer-valued sizes serialize without a trailing
 * `.0`. Only this element goes dirty (spec 12 #4 round-trip).
 */
export function setFreeSize(el: ElementNode, width: number, height: number): void {
  setAttribute(el, 'data-w', String(width));
  setAttribute(el, 'data-h', String(height));
}

/**
 * Write a free element's full logical geometry (`data-x`/`data-y`/`data-w`/
 * `data-h`) in one go — the resize/move commit path. Rounding stays out of here:
 * the command layer decides whether to snap before calling, so this writes
 * exactly the rect it is given.
 */
export function setFreeRect(el: ElementNode, rect: Rect): void {
  setFreePosition(el, { x: rect.left, y: rect.top });
  setFreeSize(el, rect.width, rect.height);
}

/**
 * Read a free element's logical geometry as a {@link Rect}. Position falls back
 * to the origin and size to `fallback` (a measured rect) when the corresponding
 * attributes are absent — so an as-yet-unsized free element still yields a
 * concrete rect for the resize handles to act on.
 */
export function getFreeRect(el: ElementNode, fallback?: Partial<Rect>): Rect {
  const pos = getFreePosition(el);
  const size = getFreeSize(el);
  return {
    left: pos.x,
    top: pos.y,
    width: size.width ?? fallback?.width ?? 0,
    height: size.height ?? fallback?.height ?? 0,
  };
}
