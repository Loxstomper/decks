/**
 * free-geometry-commands.ts — Undoable store commands for free-element move +
 * resize (P4-2 absolute drag move, P4-3 resize handles).
 *
 * WHY THIS EXISTS (spec 04 "Undo/redo: each command pushes the serialized model";
 * deck store command contract):
 * =====================================================================
 * The pure geometry (resize-geometry.ts) computes a new LOGICAL rect; the pure
 * model writer (free-position.ts → edit.ts) sets only that element's
 * data-x/y/w/h. This thin layer wraps the write in the deck store's command
 * protocol so a whole drag/resize gesture is exactly ONE undo entry and ONE
 * autosaved on-disk state — matching structure-commands.ts:
 *
 *   mutate model → deckStore.updateFromModel() → deckStore.commitCommand()
 *
 * Because only the touched elements go dirty, every other node round-trips
 * byte-for-byte (spec 12 #4).
 *
 * Each command is a no-op (returns false, NO undo entry / NO save) when nothing
 * actually changed or the eid is unknown, so a click that didn't move, or a
 * resize that snapped back to the original size, never floods history.
 *
 * INTEGRATION (see integration_notes): FreeTransformOverlay.svelte calls these
 * on pointer-up. They are deliberately store-aware (not pure) so the controller
 * only hands over an eid + a final rect; all geometry decisions happened earlier
 * in the pure modules. The committed rect is the AUTHORITATIVE one — callers must
 * pre-snap if they want grid alignment (the controller does, via gridStore).
 */

import { deckStore } from '$lib/store/deck.svelte.ts';
import { findElementByEid } from './structure-ops.ts';
import { getFreeRect, setFreeRect } from './free-position.ts';
import type { Rect } from './overlay-geometry.ts';

/** True when two rects are geometrically identical (no-op guard). */
function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Reserialize + commit the current model as one undo entry. */
function commit(): boolean {
  deckStore.updateFromModel();
  void deckStore.commitCommand();
  return true;
}

/**
 * P4-3 (and single-element P4-2): set a free element's full logical geometry
 * (data-x/y/w/h) to `rect`. No-op when the element is unknown or the rect is
 * unchanged. The caller owns snapping — `rect` is written verbatim.
 */
export function applyFreeGeometry(eid: string, rect: Rect): boolean {
  const model = deckStore.model;
  if (!model) return false;
  const el = findElementByEid(model, eid);
  if (!el) return false;

  // Compare against the element's CURRENT geometry, falling back to the incoming
  // size so an element that had no data-w/h yet (content-sized) but is being set
  // to that very same measured size is still treated as a no-op.
  const current = getFreeRect(el, { width: rect.width, height: rect.height });
  if (sameRect(current, rect)) return false;

  setFreeRect(el, rect);
  return commit();
}

/** One element's target geometry in a batched move/resize commit. */
export interface FreeGeometryEntry {
  eid: string;
  rect: Rect;
}

/**
 * P4-2 (multi): apply new geometry to several free elements as ONE undo entry —
 * the shape a multi-selection drag-move needs. Iterates the entries, writes each
 * changed element, and commits once. Returns true iff at least one element
 * actually moved (so a no-move drag of a selection records no history).
 *
 * WHY A BATCH (not N single commands): a multi-select move is one user gesture;
 * collapsing it into a single commit means one undo step reverts the whole move
 * and there is a single autosave round-trip rather than N.
 *
 * Coded for multi-select now even though the selection store is single-select
 * today (spec 04 "Marquee … for multi-select" lands later) — the controller
 * passes a one-entry array in the meantime, exercising the same path.
 */
export function applyFreeGeometryBatch(entries: FreeGeometryEntry[]): boolean {
  const model = deckStore.model;
  if (!model) return false;

  let changed = false;
  for (const { eid, rect } of entries) {
    const el = findElementByEid(model, eid);
    if (!el) continue;
    const current = getFreeRect(el, { width: rect.width, height: rect.height });
    if (sameRect(current, rect)) continue;
    setFreeRect(el, rect);
    changed = true;
  }
  if (!changed) return false;
  return commit();
}
