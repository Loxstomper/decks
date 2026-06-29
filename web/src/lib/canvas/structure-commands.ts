/**
 * structure-commands.ts — Undoable store commands for structural drags + nudge
 * (P3-6 reorder, P3-7 reparent, P3-9 nudge).
 *
 * WHY THIS EXISTS (spec 04 + the deck store command contract):
 * ============================================================
 * The pure model ops (structure-ops.ts, free-position.ts) mutate the tree; this
 * layer wraps each one in the deck store's COMMAND protocol so a drop or a nudge
 * is exactly one undo entry and one autosaved on-disk state:
 *
 *   mutate model → deckStore.updateFromModel() → deckStore.commitCommand()
 *
 * (the same pattern Lane B uses for property edits — see deck.svelte.ts header.)
 * commitCommand() pushes the post-edit source onto the undo stack and persists
 * immediately, bypassing the keystroke debounce, so the canvas reloads showing
 * the moved/reordered element.
 *
 * INTEGRATION (see integration_notes): the DragController and the keyboard-nudge
 * handler call these. They are deliberately store-aware (not pure) so the caller
 * only needs an eid + a target; all geometry/threshold decisions happen earlier
 * in the pure modules.
 *
 * Each command is a no-op (returns false, no undo entry) when the eid is unknown
 * or the move would not change anything, so spurious clicks never flood history.
 */

import { deckStore } from '$lib/store/deck.svelte.ts';
import { classify, type ElementNode } from '$lib/model';
import {
  findChildAndParent,
  elementChildren,
  moveChild,
  reparentChild,
  findElementByEid,
} from './structure-ops.ts';
import { translateFreePosition, getFreePosition, setFreePosition } from './free-position.ts';
import { snapPointToGrid } from './snap-grid.ts';
import { freeNudgeDelta, reorderNudgeDirection } from './nudge.ts';
import { gridStore } from './grid.svelte.ts';
import type { Point } from '$lib/coords.ts';

/** Reserialize + commit a successful mutation as one undo entry. Returns true. */
function commit(): boolean {
  deckStore.updateFromModel();
  void deckStore.commitCommand();
  return true;
}

/**
 * P3-6: reorder `eid` to element-index `targetIndex` among its siblings.
 * `targetIndex` is the post-removal insertion index (drag-geometry.resolveDrop).
 */
export function moveChildCommand(eid: string, targetIndex: number): boolean {
  const model = deckStore.model;
  if (!model) return false;
  const found = findChildAndParent(model, eid);
  if (!found) return false;

  // No-op guard: dropping back into the same slot should not create history.
  // `targetIndex` is the insertion index in the post-removal sibling list; the
  // element's current full-list index reproduces its own slot once spliced out,
  // so target === current means "no move".
  const siblings = elementChildren(found.parent);
  const current = siblings.indexOf(found.child);
  if (current === targetIndex) return false;
  if (!moveChild(found.parent, found.child, targetIndex)) return false;
  return commit();
}

/**
 * P3-7: move `eid` into container `newParentEid` at element-index `targetIndex`.
 * Falls back to a reorder when the new parent is the current parent.
 */
export function reparentChildCommand(
  eid: string,
  newParentEid: string,
  targetIndex: number,
): boolean {
  const model = deckStore.model;
  if (!model) return false;
  const found = findChildAndParent(model, eid);
  if (!found) return false;
  const newParent = findElementByEid(model, newParentEid);
  if (!newParent) return false;

  // Guard: never drop an element into itself or one of its own descendants
  // (that would detach a subtree from the tree). Walk the new parent up.
  if (isSelfOrDescendant(found.child, newParent)) return false;

  if (newParent === found.parent) {
    return moveChildCommand(eid, targetIndex);
  }
  if (!reparentChild(found.parent, newParent, found.child, targetIndex)) return false;
  return commit();
}

/** True when `candidate` is `node` or nested anywhere inside it. */
function isSelfOrDescendant(node: ElementNode, candidate: ElementNode): boolean {
  if (node === candidate) return true;
  for (const child of node.children) {
    if (child.type === 'element' && isSelfOrDescendant(child, candidate)) return true;
  }
  return false;
}

/**
 * P3-8 (free drag): set a FREE element's logical position, snapping to the grid
 * when enabled. Used by the drag controller on drop for `data-free` elements.
 */
export function moveFreeCommand(eid: string, logical: Point): boolean {
  const model = deckStore.model;
  if (!model) return false;
  const found = findChildAndParent(model, eid) ?? { child: findElementByEid(model, eid), parent: null };
  const el = found.child;
  if (!el) return false;
  const snapped = snapPointToGrid(logical, gridStore.effectiveSize);
  const before = getFreePosition(el);
  if (before.x === snapped.x && before.y === snapped.y) return false;
  setFreePosition(el, snapped);
  return commit();
}

/**
 * P3-9: keyboard nudge for the selected `eid`. Free elements translate their
 * data-x/data-y by 1 (or 10 with Shift) logical units, snapped to the grid when
 * enabled; structured elements reorder ±1 among their siblings. Returns false
 * (and records no history) when the key is not an arrow or nothing changes.
 *
 * The caller is responsible for the editing-context guard (nudge.isEditingContext)
 * and for calling preventDefault on a handled event.
 */
export function nudgeCommand(eid: string, key: string, shift: boolean): boolean {
  const model = deckStore.model;
  if (!model) return false;
  const found = findChildAndParent(model, eid);
  // The slide-root section has no element parent; only its free/structured
  // descendants are nudgeable. An eid with no parent → look it up standalone for
  // the free case (a top-level free element is unusual but handled).
  const el = found?.child ?? findElementByEid(model, eid);
  if (!el) return false;

  if (classify(el) === 'free') {
    const delta = freeNudgeDelta(key, shift);
    if (!delta) return false;
    const next = translateFreePosition(el, delta.dx, delta.dy);
    // Re-snap the resulting position to the grid when enabled so nudging keeps
    // a free element aligned rather than drifting off-grid by 1s.
    const snapped = snapPointToGrid(next, gridStore.effectiveSize);
    if (snapped.x !== next.x || snapped.y !== next.y) setFreePosition(el, snapped);
    return commit();
  }

  // Structured element → reorder ±1 among siblings.
  if (!found) return false;
  const dir = reorderNudgeDirection(key);
  if (dir === 0) return false;
  const siblings = elementChildren(found.parent);
  const current = siblings.indexOf(found.child);
  const target = Math.max(0, Math.min(current + dir, siblings.length - 1));
  if (target === current) return false; // already at an edge
  if (!moveChild(found.parent, found.child, target)) return false;
  return commit();
}
