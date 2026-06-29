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
