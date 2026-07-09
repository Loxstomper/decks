/**
 * blocks/target.ts — Resolve WHERE the insert seam drops a new block (P5-1).
 *
 * Pure helper shared by the palette: given the current model, the selected eid,
 * and the block's {@link Placement}, decide which seam call to make:
 *
 *   { mode: 'into',  parentEid }  → deckStore.insertBlock(parentEid, node)
 *   { mode: 'after', eid }        → deckStore.insertAfter(eid, node)
 *
 * WHICH SLIDE: the block ALWAYS lands on the slide the canvas is currently
 * presenting (`viewedSlideEid`, passed by the caller from reveal's indices). The
 * selection only refines WHERE WITHIN that slide — and only when the selection
 * actually lives on the viewed slide. This stops an insert made while viewing
 * slide 25 (with nothing, or something on another slide, selected) from landing
 * on slide 1. When `viewedSlideEid` is null (reveal not ready) we fall back to
 * the selection's slide, else the first slide.
 *
 * Rules (spec 03 / P5-1 "insert into the current container or after the selection"):
 *
 *   FLOW blocks (text/table/…), selection is ON the viewed slide:
 *     • selection is a CONTAINER → insert INTO it (appended last).
 *     • selection is a LEAF/FREE → insert AFTER it (as a sibling).
 *     • passthrough              → insert INTO the viewed slide <section>.
 *   FLOW blocks, no selection or selection on a DIFFERENT slide:
 *     • insert INTO the viewed slide <section>.
 *
 *   FREE blocks (shape/embed):
 *     Free elements are absolutely positioned relative to their slide, so they
 *     always go INTO the viewed slide <section>. This keeps their logical
 *     data-x/y meaningful.
 *
 * Returns null only when the model has no slide section at all to fall back to.
 */

import { walk, getAttribute, findByEid, getSlides } from '$lib/model/edit';
import { classify } from '$lib/model/classify';
import type { DeckModel, ElementNode } from '$lib/model/types';
import type { Placement } from './types';

export type InsertTarget =
  | { mode: 'into'; parentEid: string }
  | { mode: 'after'; eid: string };

/** Build a child→parent map over element nodes in one walk. */
function parentMap(model: DeckModel): Map<ElementNode, ElementNode | null> {
  const map = new Map<ElementNode, ElementNode | null>();
  walk(model, (node, parent) => {
    if (node.type === 'element') map.set(node, parent);
  });
  return map;
}

/** Nearest `<section>` ancestor of `el` (inclusive), or null. */
function sectionAncestor(
  el: ElementNode,
  parents: Map<ElementNode, ElementNode | null>,
): ElementNode | null {
  let cursor: ElementNode | null = el;
  while (cursor !== null) {
    if (cursor.tagName.toLowerCase() === 'section') return cursor;
    cursor = parents.get(cursor) ?? null;
  }
  return null;
}

/** The slide section we treat as "current": the selection's section, else the first. */
function currentSection(model: DeckModel, selectedEl: ElementNode | null): ElementNode | null {
  if (selectedEl) {
    const sec = sectionAncestor(selectedEl, parentMap(model));
    if (sec) return sec;
  }
  const slides = getSlides(model);
  return slides.length > 0 ? slides[0] : null;
}

/** Read an element's eid (every managed element has one after stamping). */
function eidOf(el: ElementNode): string | null {
  return getAttribute(el, 'data-eid');
}

/**
 * Resolve the insert target. See module doc for the rules.
 * Returns null when there is no slide section to host the block.
 */
export function resolveInsertTarget(
  model: DeckModel,
  selectedEid: string | null,
  placement: Placement = 'flow',
  viewedSlideEid: string | null = null,
): InsertTarget | null {
  const selected = selectedEid ? findByEid(model, selectedEid) : null;

  // The slide the block MUST land on: the viewed (presented) slide, else the
  // selection's slide, else the first slide.
  const viewedSection = viewedSlideEid ? findByEid(model, viewedSlideEid) : null;
  const targetSection = viewedSection ?? currentSection(model, selected);
  const targetEid = targetSection ? eidOf(targetSection) : null;
  if (!targetEid) return null;

  // FREE blocks always land in the slide section itself.
  if (placement === 'free') return { mode: 'into', parentEid: targetEid };

  // FLOW blocks place relative to the selection — but ONLY when the selection
  // lives on the target slide. Otherwise (nothing selected, or a selection on a
  // different slide) the block goes into the target slide section.
  if (selected) {
    const selSection = sectionAncestor(selected, parentMap(model));
    if (selSection && eidOf(selSection) === targetEid) {
      const cls = classify(selected);
      if (cls === 'container') {
        const eid = eidOf(selected);
        if (eid) return { mode: 'into', parentEid: eid };
      } else if (cls === 'leaf' || cls === 'free') {
        const eid = eidOf(selected);
        if (eid) return { mode: 'after', eid };
      }
      // passthrough → fall through to the target slide section.
    }
  }

  return { mode: 'into', parentEid: targetEid };
}
