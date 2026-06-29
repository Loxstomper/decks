/**
 * blocks/target.ts — Resolve WHERE the insert seam drops a new block (P5-1).
 *
 * Pure helper shared by the palette: given the current model, the selected eid,
 * and the block's {@link Placement}, decide which seam call to make:
 *
 *   { mode: 'into',  parentEid }  → deckStore.insertBlock(parentEid, node)
 *   { mode: 'after', eid }        → deckStore.insertAfter(eid, node)
 *
 * Rules (spec 03 / P5-1 "insert into the current container or after the selection"):
 *
 *   FLOW blocks (text/table/…):
 *     • selection is a CONTAINER → insert INTO it (appended last).
 *     • selection is a LEAF/FREE → insert AFTER it (as a sibling).
 *     • nothing / passthrough     → insert INTO the current slide <section>.
 *
 *   FREE blocks (shape/embed):
 *     Free elements are absolutely positioned relative to their slide, so they
 *     always go INTO the slide <section> (the section ancestor of the selection,
 *     else the first slide). This keeps their logical data-x/y meaningful.
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
): InsertTarget | null {
  const selected = selectedEid ? findByEid(model, selectedEid) : null;

  // FREE blocks always land in the slide section.
  if (placement === 'free') {
    const section = currentSection(model, selected);
    const eid = section ? eidOf(section) : null;
    return eid ? { mode: 'into', parentEid: eid } : null;
  }

  // FLOW blocks: relative to the selection.
  if (selected) {
    const cls = classify(selected);
    if (cls === 'container') {
      const eid = eidOf(selected);
      if (eid) return { mode: 'into', parentEid: eid };
    } else if (cls === 'leaf' || cls === 'free') {
      const eid = eidOf(selected);
      if (eid) return { mode: 'after', eid };
    }
    // passthrough → fall through to the slide section.
  }

  const section = currentSection(model, selected);
  const eid = section ? eidOf(section) : null;
  return eid ? { mode: 'into', parentEid: eid } : null;
}
