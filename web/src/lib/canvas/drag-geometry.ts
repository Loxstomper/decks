/**
 * drag-geometry.ts — Pure drop-target resolution for structural drags
 * (P3-6 reorder, P3-7 reparent / spec 04 "Two drag semantics").
 *
 * WHY THIS EXISTS (spec 04 "Coordinate/scale system" — all hit-testing in
 * LOGICAL space):
 * ====================================================================
 * Dragging a structured child means "drop it into a position among its siblings,
 * or into a different container/cell". Resolving WHERE the pointer wants to drop
 * is pure geometry: given the pointer (already converted to logical coordinates
 * via coords.ts `screenToLogical`) and the logical rects of candidate containers
 * and their children, compute:
 *
 *   • the target CONTAINER (innermost one under the pointer) — P3-7 reparent.
 *   • the target INDEX among that container's element children — P3-6 reorder.
 *
 * Keeping this DOM-free makes it unit-testable headless and keeps the drag
 * controller (which owns the messy DOM/iframe measuring) thin. The controller
 * measures rects with `getBoundingClientRect()` INSIDE the iframe — already
 * logical (see overlay-geometry.ts) — and feeds them here.
 */

import type { Point } from '$lib/coords.ts';
import type { Rect } from './overlay-geometry.ts';

/** Layout main-axis of a container, deciding whether reorder compares X or Y. */
export type Orientation = 'horizontal' | 'vertical';

/** A child element's logical rect, tagged by its stable eid. */
export interface ChildRect {
  eid: string;
  rect: Rect;
}

/** A candidate drop container with its logical rect, axis, and child rects. */
export interface ContainerCandidate {
  eid: string;
  /** Logical bounding rect of the container's content box. */
  rect: Rect;
  /** Main-axis: row/grid → horizontal, stack/section → vertical. */
  orientation: Orientation;
  /** Direct element children, in document order, with their logical rects. */
  children: ChildRect[];
}

/** Where a drop would land: a parent container and an insertion index. */
export interface DropTarget {
  parentEid: string;
  /** Insertion index among the parent's element children (0..n, exclusive end). */
  index: number;
}

/** True when `point` lies within `rect` (inclusive of edges). */
export function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

/** Area of a rect — used to pick the INNERMOST (smallest) container under a point. */
function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/**
 * Compute the insertion index for a reorder/reparent drop.
 *
 * The dragged element (if `excludeEid` is given) is removed from the comparison
 * set first, so the returned index is expressed in the POST-REMOVAL element list
 * — exactly the contract `moveChild`/`reparentChild` expect (they splice the
 * dragged node out before reinserting at this index).
 *
 * Decision rule: count how many remaining siblings have their main-axis MIDPOINT
 * before the pointer. That count is where the element should be inserted:
 *   - pointer above/left of every sibling → 0 (insert first).
 *   - pointer below/right of every sibling → n (append).
 * Using midpoints (not edges) gives the natural "crosses the halfway line to
 * swap places" feel.
 */
export function resolveDropIndex(
  pointer: Point,
  siblings: ChildRect[],
  orientation: Orientation,
  excludeEid?: string,
): number {
  const others = excludeEid ? siblings.filter((s) => s.eid !== excludeEid) : siblings;
  const coord = orientation === 'horizontal' ? pointer.x : pointer.y;
  let index = 0;
  for (const sib of others) {
    const mid =
      orientation === 'horizontal'
        ? sib.rect.left + sib.rect.width / 2
        : sib.rect.top + sib.rect.height / 2;
    if (mid < coord) index += 1;
  }
  return index;
}

/**
 * Resolve a full drop target (container + index) for a structural drag.
 *
 * 1. Find every candidate container whose rect contains the pointer.
 * 2. Pick the INNERMOST (smallest-area) one — nested layouts mean several
 *    contain the point; the user means the deepest cell under the cursor.
 * 3. Within it, compute the insertion index among its children, excluding the
 *    dragged element itself so a no-op drop maps back to its current slot.
 *
 * Returns `null` when the pointer is over no candidate container (drop is a
 * no-op / cancelled).
 */
export function resolveDrop(
  pointer: Point,
  containers: ContainerCandidate[],
  draggedEid?: string,
): DropTarget | null {
  let best: ContainerCandidate | null = null;
  for (const c of containers) {
    // A container can never be dropped into itself or its own descendant; the
    // caller filters self/descendant containers out of `containers`, but we also
    // skip the dragged eid here as a guard.
    if (c.eid === draggedEid) continue;
    if (!rectContains(c.rect, pointer)) continue;
    if (best === null || area(c.rect) < area(best.rect)) best = c;
  }
  if (!best) return null;
  const index = resolveDropIndex(pointer, best.children, best.orientation, draggedEid);
  return { parentEid: best.eid, index };
}

/**
 * Compute the LOGICAL rect of the drop INDICATOR line for a resolved drop: a thin
 * bar drawn between siblings at the insertion point. Orientation decides whether
 * it is a horizontal bar (vertical stacks — sits on the boundary between rows) or
 * a vertical bar (horizontal rows — sits between columns).
 *
 * The dragged element is excluded so the indicator reflects the post-removal
 * layout the resolver indexed against. An empty container yields a bar across its
 * leading edge. The caller maps this logical rect to screen via
 * overlay-geometry.logicalRectToScreen for rendering.
 */
export function dropIndicatorRect(
  container: ContainerCandidate,
  index: number,
  excludeEid?: string,
  thickness = 3,
): Rect {
  const children = excludeEid
    ? container.children.filter((c) => c.eid !== excludeEid)
    : container.children;
  const horizontal = container.orientation === 'horizontal';

  if (children.length === 0) {
    // Empty target → show the bar along the container's leading edge.
    return horizontal
      ? { left: container.rect.left, top: container.rect.top, width: thickness, height: container.rect.height }
      : { left: container.rect.left, top: container.rect.top, width: container.rect.width, height: thickness };
  }

  const clamped = Math.max(0, Math.min(index, children.length));
  const last = children[children.length - 1];

  if (horizontal) {
    const x =
      clamped < children.length
        ? children[clamped].rect.left
        : last.rect.left + last.rect.width;
    const top = Math.min(...children.map((c) => c.rect.top));
    const bottom = Math.max(...children.map((c) => c.rect.top + c.rect.height));
    return { left: x - thickness / 2, top, width: thickness, height: bottom - top };
  }

  const y =
    clamped < children.length ? children[clamped].rect.top : last.rect.top + last.rect.height;
  const left = Math.min(...children.map((c) => c.rect.left));
  const right = Math.max(...children.map((c) => c.rect.left + c.rect.width));
  return { left, top: y - thickness / 2, width: right - left, height: thickness };
}
