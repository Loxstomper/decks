/**
 * free.ts — Model-layer toggle for the free-positioning escape hatch (P4-1).
 *
 * WHY THIS EXISTS (spec 03 / spec 04 "Two drag semantics"):
 * =========================================================
 * A `data-free` element is absolutely positioned in LOGICAL coordinates via
 * `data-x`/`data-y`/`data-w`/`data-h`. This module provides the model
 * operation that converts an element into or out of free mode.
 *
 * WHY THE CALLER PASSES THE RECT (not computed here):
 *   The model layer has no access to the DOM or rendered layout. Only the
 *   canvas layer knows the current visual geometry of the element (measured
 *   via getBoundingClientRect → screenToLogical). The caller measures the
 *   element's current logical rect and passes it here so the element does not
 *   visually jump on the canvas when the mode is toggled.
 *
 * WHY USE edit.ts HELPERS (setAttribute/removeAttribute):
 *   These are the canonical mutation path: each call marks the element dirty
 *   (triggering canonical re-render on next serializeDeck) while untouched
 *   siblings stay clean (byte-stable passthrough, spec 12 #4).
 *
 * classify(el) then returns 'free' for elements with data-free — no extra
 * coordination needed; classify() already has that rule at highest priority.
 */

import { setAttribute, removeAttribute, hasAttribute, findByEid } from './edit';
import type { ElementNode, DeckModel } from './types';

/**
 * A logical-coordinate rectangle, matching the coordinate space used by
 * data-x / data-y / data-w / data-h (spec 03).
 */
export interface LogicalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Enable or disable free positioning on a model element.
 *
 * setFree(el, true, rect)
 *   Writes `data-free` (boolean attribute, no value) and captures the
 *   element's current logical geometry into data-x/y/w/h so it does not
 *   visually jump. If `rect` is omitted the positional attributes are left
 *   as-is (caller may set them separately, or they default to 0 in the
 *   free-position helpers).
 *
 * setFree(el, false)
 *   Removes data-free and all four positional attributes, returning the
 *   element to structured (flex/grid) flow. The element's children and
 *   styling are untouched.
 *
 * After this call: setAttribute/removeAttribute have marked only this element
 * dirty — siblings round-trip byte-identically (spec 12 #4).
 */
export function setFree(el: ElementNode, on: boolean, rect?: LogicalRect): void {
  if (on) {
    // Boolean attribute — present without a value (null = no ="..." in output).
    setAttribute(el, 'data-free', null);
    if (rect !== undefined) {
      // Write logical coordinates as simple numbers; integers stay integer-formatted.
      setAttribute(el, 'data-x', formatCoord(rect.x));
      setAttribute(el, 'data-y', formatCoord(rect.y));
      setAttribute(el, 'data-w', formatCoord(rect.w));
      setAttribute(el, 'data-h', formatCoord(rect.h));
    }
  } else {
    // Return element to structured layout flow — strip all free-mode attributes.
    removeAttribute(el, 'data-free');
    removeAttribute(el, 'data-x');
    removeAttribute(el, 'data-y');
    removeAttribute(el, 'data-w');
    removeAttribute(el, 'data-h');
  }
}

/**
 * Toggle the free-positioning state of the element identified by `eid`.
 *
 * Returns the new free state (true = now free, false = now structured flow),
 * or null if the eid is not found in the model.
 *
 * When toggling ON, pass `rect` so the element's visual position is preserved.
 * When toggling OFF, `rect` is ignored.
 */
export function toggleFree(model: DeckModel, eid: string, rect?: LogicalRect): boolean | null {
  const el = findByEid(model, eid);
  if (!el) return null;
  const enabling = !hasAttribute(el, 'data-free');
  setFree(el, enabling, enabling ? rect : undefined);
  return enabling;
}

// ─── private helpers ──────────────────────────────────────────────────────────

/** Format a logical coordinate for attribute storage: integers without .0. */
function formatCoord(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v);
}
