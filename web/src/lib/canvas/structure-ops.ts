/**
 * structure-ops.ts — Model reorder/reparent operations (P3-6 / P3-7).
 *
 * WHY THIS EXISTS (spec canvas-interaction "Two drag semantics" + spec document-model byte-stability):
 * ========================================================================
 * Dragging a STRUCTURED child reorders it among its siblings (P3-6) or moves it
 * into a different container/cell (P3-7). Both are MODEL operations on the
 * source-preserving tree: we splice the child node to its new array position and
 * mark the minimum set of nodes dirty so the byte-stable round-trip invariant
 * (spec principles-and-invariants #4) is preserved — every untouched subtree still serializes verbatim.
 *
 * DIRTY MINIMISATION (the load-bearing detail, see serialize.ts):
 *   • Reorder within one parent: marking ONLY the moved element dirty is enough.
 *     `subtreeDirty(parent)` becomes true (a descendant changed), so the parent
 *     re-iterates its children in the NEW array order — but the parent keeps its
 *     own `rawOpen`/`rawClose` tag bytes, and every sibling is emitted verbatim.
 *     Only the moved element re-renders canonically.
 *   • Reparent across parents: the OLD parent must additionally be marked dirty —
 *     after the child leaves it has no dirty descendant, so without this it would
 *     emit its stale `raw` (still containing the child!). Marking it dirty forces
 *     a re-render that omits the moved child while keeping its remaining children
 *     verbatim. The NEW parent needs no flag: the inserted child is already dirty.
 *
 * WHITESPACE: the text node of indentation immediately preceding the child is
 * carried with it, so moved elements keep clean indentation instead of leaving an
 * orphaned blank line behind and landing flush against their new neighbour.
 *
 * These are pure functions over the model (no DOM, no store) → unit-testable.
 * The store command layer (structure-commands.ts) wraps them with
 * updateFromModel() + commitCommand() so each drop is one undo entry + one save.
 *
 * NOTE FOR THE INTEGRATOR: these mirror Lane A's intended `moveChild` /
 * `reparentChild` model ops. If Lane A lands canonical versions in
 * model/edit.ts, consolidate to a single implementation and re-point
 * structure-commands.ts at them — the signatures here are index-based and
 * eid-addressable to match that contract.
 */

import { walk, type DeckModel, type ElementNode, type SlideNode } from '$lib/model';

/** True for an element node (narrowing helper). */
function isElement(n: SlideNode): n is ElementNode {
  return n.type === 'element';
}

/** True for a whitespace-only text node (indentation/newlines between tags). */
function isWhitespaceText(n: SlideNode): boolean {
  return n.type === 'text' && /^\s*$/.test(n.value);
}

/** Direct element children of a parent, in document order. */
export function elementChildren(parent: ElementNode): ElementNode[] {
  return parent.children.filter(isElement);
}

/**
 * Find the parent element of a node (the element whose `children` array holds it)
 * plus the node itself, addressed by eid. Returns null if the eid is unknown or
 * the node is a top-level node with no element parent (not movable).
 */
export function findChildAndParent(
  model: DeckModel,
  eid: string,
): { child: ElementNode; parent: ElementNode } | null {
  let result: { child: ElementNode; parent: ElementNode } | null = null;
  walk(model, (node, parent) => {
    if (result || node.type !== 'element' || !parent) return;
    // data-eid lives in source form but eids are ASCII, so a direct attr lookup
    // (no entity decoding) is sufficient and avoids importing getAttribute.
    const attr = node.attributes.find((a) => a.name.toLowerCase() === 'data-eid');
    if (attr && attr.value === eid) result = { child: node, parent };
  });
  return result;
}

/** Find an element by eid anywhere in the model (used to resolve a new parent). */
export function findElementByEid(model: DeckModel, eid: string): ElementNode | null {
  let found: ElementNode | null = null;
  walk(model, (node) => {
    if (found || node.type !== 'element') return;
    const attr = node.attributes.find((a) => a.name.toLowerCase() === 'data-eid');
    if (attr && attr.value === eid) found = node;
  });
  return found;
}

/**
 * Remove `child` (and a single immediately-preceding whitespace text node, if
 * any) from `parent.children`, returning the removed block in document order so
 * the caller can reinsert it elsewhere with its indentation intact.
 */
function detach(parent: ElementNode, child: ElementNode): SlideNode[] | null {
  const arr = parent.children;
  const ci = arr.indexOf(child);
  if (ci < 0) return null;
  let start = ci;
  const block: SlideNode[] = [child];
  if (ci > 0 && isWhitespaceText(arr[ci - 1])) {
    start = ci - 1;
    block.unshift(arr[ci - 1]);
  }
  arr.splice(start, block.length);
  return block;
}

/**
 * Insert `block` (a leading-whitespace + element pair, or just the element) into
 * `parent.children` so the element lands at element-index `targetIndex` among the
 * parent's element children. `targetIndex` is clamped to [0, elementCount].
 */
function insertAt(parent: ElementNode, block: SlideNode[], targetIndex: number): void {
  const els = elementChildren(parent);
  const t = Math.max(0, Math.min(targetIndex, els.length));
  let pos: number;
  if (t < els.length) {
    pos = parent.children.indexOf(els[t]);
  } else {
    // Append after the last existing element (before any trailing whitespace) so
    // the new element nests cleanly; fall back to end when there are no elements.
    pos = els.length > 0 ? parent.children.indexOf(els[els.length - 1]) + 1 : parent.children.length;
  }
  parent.children.splice(pos, 0, ...block);
}

/**
 * P3-6: Reorder `child` to element-index `targetIndex` within its current parent.
 *
 * `targetIndex` is the desired final position among the parent's element children
 * EXCLUDING the dragged child (i.e. the index returned by
 * drag-geometry.resolveDropIndex). A no-op move (same resulting position) still
 * marks the child dirty harmlessly; callers can pre-check if churn matters.
 *
 * Returns true on success, false if `child` is not actually a child of `parent`.
 */
export function moveChild(parent: ElementNode, child: ElementNode, targetIndex: number): boolean {
  const block = detach(parent, child);
  if (!block) return false;
  insertAt(parent, block, targetIndex);
  child.dirty = true; // re-render moved element; parent keeps its tag bytes
  return true;
}

/**
 * P3-7: Move `child` out of `oldParent` and into `newParent` at element-index
 * `targetIndex`. When `oldParent === newParent` this delegates to {@link moveChild}.
 *
 * Marks `oldParent` dirty (so it re-renders WITHOUT the departed child) and the
 * child dirty (so `newParent` re-renders WITH it). `newParent` itself is left
 * untouched so it keeps its own original tag bytes.
 *
 * Returns true on success, false if `child` is not a child of `oldParent`.
 */
export function reparentChild(
  oldParent: ElementNode,
  newParent: ElementNode,
  child: ElementNode,
  targetIndex: number,
): boolean {
  if (oldParent === newParent) return moveChild(oldParent, child, targetIndex);
  const block = detach(oldParent, child);
  if (!block) return false;
  insertAt(newParent, block, targetIndex);
  oldParent.dirty = true; // old parent's contents changed → must re-serialize
  child.dirty = true; // moved element re-renders inside its new parent
  return true;
}

/**
 * P9-7: Delete the element carrying `eid` from its parent (spec canvas-interaction "Deleting
 * elements").
 *
 * Removing a node removes its entire subtree by construction, so this one op
 * covers every class:
 *   • LEAF        → the node is removed.
 *   • CONTAINER   → the node and all its descendants are removed.
 *   • PASSTHROUGH → removed whole-or-nothing (never partially mangled, spec canvas-interaction).
 *
 * The single immediately-preceding whitespace text node (indentation) goes with
 * it via {@link detach}, so no orphaned blank line is left behind. The parent is
 * marked dirty so it re-serializes WITHOUT the removed child, while every
 * remaining sibling round-trips byte-for-byte (spec principles-and-invariants #4).
 *
 * SLIDE GUARD: whole-slide deletion lives in the navigator (spec canvas-interaction), not here.
 * A `<section>` is a slide root, so deleting one through the element-level path
 * is refused (returns false) — the navigator's deleteSlide owns that.
 *
 * Returns true on success, false when the eid is unknown, is not removable (a
 * top-level node with no element parent), or is a slide section.
 */
export function deleteElement(model: DeckModel, eid: string): boolean {
  const found = findChildAndParent(model, eid);
  if (!found) return false;
  if (found.child.tagName.toLowerCase() === 'section') return false;
  const block = detach(found.parent, found.child);
  if (!block) return false;
  found.parent.dirty = true; // parent re-renders without the removed child
  return true;
}

// ── eid-addressable convenience wrappers (used by the store command layer) ─────

/** Resolve eids then {@link moveChild}. Returns false if the child/parent is unknown. */
export function moveChildByEid(model: DeckModel, eid: string, targetIndex: number): boolean {
  const found = findChildAndParent(model, eid);
  if (!found) return false;
  return moveChild(found.parent, found.child, targetIndex);
}

/**
 * Resolve eids then {@link reparentChild}. Returns false if either the child or
 * the new parent is unknown.
 */
export function reparentChildByEid(
  model: DeckModel,
  eid: string,
  newParentEid: string,
  targetIndex: number,
): boolean {
  const found = findChildAndParent(model, eid);
  if (!found) return false;
  const newParent = findElementByEid(model, newParentEid);
  if (!newParent) return false;
  return reparentChild(found.parent, newParent, found.child, targetIndex);
}
