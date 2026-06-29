/**
 * drag-dom.ts — Measure drop-target candidates from the iframe DOM (P3-6/P3-7).
 *
 * WHY THIS EXISTS:
 * ================
 * The pure resolver (drag-geometry.ts) needs the LOGICAL rects of every candidate
 * container and its children. This module is the thin DOM adapter that walks the
 * same-origin reveal iframe document and produces that data. It is the ONLY
 * drag-side module that touches the DOM, so all the decision logic stays pure and
 * testable.
 *
 * KEY INVARIANT (overlay-geometry.ts): an element's getBoundingClientRect()
 * measured INSIDE the iframe is already in LOGICAL coordinates (the iframe is
 * sized at 1920×1080 and reveal renders at scale 1), so we use those rects
 * directly — no transform needed here.
 *
 * "Container" classification mirrors model/classify.ts but on the rendered DOM:
 * an element is a drop container if it carries `data-lay` or is a `<section>`,
 * and is NOT itself `data-free`. Orientation comes from computed flex/grid layout
 * so reorder compares the correct axis.
 */

import { domRectToLogical, type Rect } from './overlay-geometry.ts';
import type { ContainerCandidate, ChildRect, Orientation } from './drag-geometry.ts';

/** True when a rendered element is a structural drop container. */
export function isContainerEl(el: Element): boolean {
  if (el.hasAttribute('data-free')) return false;
  return el.hasAttribute('data-lay') || el.tagName.toLowerCase() === 'section';
}

/** Logical rect of an element measured inside the iframe. */
export function logicalRectOf(el: Element): Rect {
  return domRectToLogical(el.getBoundingClientRect());
}

/**
 * Determine a container's main-axis from its computed layout so reorder compares
 * the right coordinate: flex-row / grid → horizontal, flex-column / block stack →
 * vertical. Defaults to vertical (the common stack / section case).
 */
export function orientationOf(el: Element, win: Window): Orientation {
  const style = win.getComputedStyle(el);
  const display = style.display;
  if (display.includes('flex')) {
    return style.flexDirection.startsWith('row') ? 'horizontal' : 'vertical';
  }
  if (display.includes('grid')) {
    // Grid items usually flow left-to-right across columns; approximate as
    // horizontal (DOM order still drives the actual reflow on drop).
    return 'horizontal';
  }
  return 'vertical';
}

/** Direct element children carrying a data-eid, with their logical rects. */
function childRectsOf(container: Element): ChildRect[] {
  const out: ChildRect[] = [];
  for (const child of Array.from(container.children)) {
    const eid = child.getAttribute('data-eid');
    if (eid) out.push({ eid, rect: logicalRectOf(child) });
  }
  return out;
}

/**
 * Build the full set of container candidates from the iframe document, ready to
 * feed to drag-geometry.resolveDrop(). Every element with a data-eid that
 * classifies as a container contributes one candidate.
 */
export function buildContainerCandidates(doc: Document, win: Window): ContainerCandidate[] {
  const candidates: ContainerCandidate[] = [];
  for (const el of Array.from(doc.querySelectorAll('[data-eid]'))) {
    if (!isContainerEl(el)) continue;
    const eid = el.getAttribute('data-eid');
    if (!eid) continue;
    candidates.push({
      eid,
      rect: logicalRectOf(el),
      orientation: orientationOf(el, win),
      children: childRectsOf(el),
    });
  }
  return candidates;
}

/** True when an element (or an ancestor) is a free element (`data-free`). */
export function isFreeEl(el: Element): boolean {
  return el.closest('[data-free]') !== null;
}
