/**
 * auto-animate.ts — Reveal.js auto-animate authoring operations (P6-9 / spec motion-and-transitions).
 *
 * WHY AUTO-ANIMATE IS A SIGNATURE FEATURE HERE:
 * Reveal's auto-animate matches elements between two consecutive `data-auto-animate`
 * slides by their `data-id` attribute and automatically tweens position/size/style
 * deltas.  Our stable `data-eid` architecture makes this nearly free:
 *
 *   • `data-id` values are derived directly from `data-eid` — no new identifiers
 *     are invented.
 *   • Pairs of slides (previous + current) get `data-auto-animate` stamped on
 *     their `<section>` elements.
 *   • Candidate elements in both slides that share the same tag name at the same
 *     ordinal position are assigned matching `data-id` values so reveal can tween
 *     them.
 *
 * "ANIMATE FROM PREVIOUS SLIDE" WORKFLOW:
 *   1. User selects a slide and clicks "Animate from previous slide".
 *   2. `enableAutoAnimate(model, slideEid)` locates the previous slide sibling.
 *   3. Both sections receive `data-auto-animate` (boolean attribute = null value).
 *   4. Elements in the CURRENT slide that have a `data-eid` get `data-id = data-eid`.
 *   5. Elements in the PREVIOUS slide with the SAME tag + ordinal position get
 *      the SAME `data-id` so reveal matches them as a tween pair.
 *   6. The user then moves/resizes/restyles elements on one of the two slides;
 *      reveal animates the delta at presentation time.
 *
 * Disabling (`disableAutoAnimate`) removes `data-auto-animate` from ONE slide
 * and leaves `data-id` in place — they are harmless on non-auto-animate slides
 * and may be useful if the user re-enables the effect later.
 *
 * BYTE STABILITY:
 * Only modified elements are marked dirty (setAttribute/removeAttribute via
 * edit.ts).  All untouched nodes continue to serialize verbatim (spec principles-and-invariants #4).
 */

import { getAttribute, setAttribute, removeAttribute, walk } from '$lib/model/edit';
import type { DeckModel, ElementNode } from '$lib/model/types';
import { classify } from '$lib/model/classify';

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find the previous sibling `<section>` element within the same parent as the
 * section with `slideEid`.
 *
 * WHY SIBLING-BASED INSTEAD OF FLAT LIST:
 * Reveal slides can be nested (vertical stacks).  We look for the previous
 * sibling of the target section in its immediate parent, which handles both
 * top-level horizontal slides and vertical-stack slides uniformly.
 *
 * Returns `null` when:
 *   • `slideEid` is not found in the model
 *   • the slide has no parent (top-level node, unlikely in practice)
 *   • the slide is the first child of its parent (no previous sibling)
 *   • the previous sibling is not a `<section>` (unusual but possible)
 */
function findPreviousSlide(model: DeckModel, slideEid: string): ElementNode | null {
  // Build a child→parent map in one walk so we can traverse upward.
  const parentMap = new Map<ElementNode, ElementNode | null>();
  walk(model, (node, parent) => {
    if (node.type === 'element') parentMap.set(node, parent);
  });

  // Find the target section.
  let target: ElementNode | null = null;
  walk(model, (node) => {
    if (target) return;
    if (node.type === 'element' && getAttribute(node, 'data-eid') === slideEid) {
      target = node;
    }
  });
  if (!target) return null;

  // Find the parent.
  const parent = parentMap.get(target) ?? null;
  if (!parent) return null;

  // Walk the parent's children looking for the element immediately before target.
  let prevSection: ElementNode | null = null;
  for (const child of parent.children) {
    if (child.type !== 'element') continue;
    if (child === target) break; // reached target — stop, prevSection is our answer
    if (child.tagName.toLowerCase() === 'section') {
      prevSection = child;
    }
  }
  return prevSection;
}

/**
 * Collect all "candidate" elements within a slide for auto-animate matching.
 *
 * A candidate element is one that:
 *   • is a LEAF or CONTAINER (not passthrough) — i.e. the editor manages it
 *   • is NOT the slide's `<section>` root itself
 *   • has a `data-eid` (stamped by stampEids)
 *
 * Elements are returned in depth-first document order.
 *
 * WHY ONLY MANAGED ELEMENTS:
 * Passthrough elements (script, style, aside.notes, unknown custom elements) are
 * opaque to the editor; assigning them data-id could confuse reveal if the same
 * custom element appears in both slides but with different semantics.
 */
function collectCandidates(slideEl: ElementNode): ElementNode[] {
  const results: ElementNode[] = [];
  const recurse = (el: ElementNode) => {
    if (el !== slideEl) {
      const cls = classify(el);
      if ((cls === 'leaf' || cls === 'container' || cls === 'free') &&
          getAttribute(el, 'data-eid') !== null) {
        results.push(el);
      }
    }
    for (const child of el.children) {
      if (child.type === 'element') recurse(child);
    }
  };
  recurse(slideEl);
  return results;
}

/**
 * Build a map from (tagName, ordinal-within-tag) → ElementNode for the
 * candidates in a slide.  Used for matching elements across the two slides.
 *
 * Key format: `"${tagName}:${n}"` where n is 0-based ordinal among same-tag candidates.
 */
function buildTagOrdinalMap(candidates: ElementNode[]): Map<string, ElementNode> {
  const tagCounts = new Map<string, number>();
  const map = new Map<string, ElementNode>();
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    const n = tagCounts.get(tag) ?? 0;
    tagCounts.set(tag, n + 1);
    map.set(`${tag}:${n}`, el);
  }
  return map;
}

// ── Auto-animate query ops ───────────────────────────────────────────────────

/**
 * True when `slideEl` carries the `data-auto-animate` attribute (boolean).
 */
export function hasAutoAnimate(slideEl: ElementNode): boolean {
  return getAttribute(slideEl, 'data-auto-animate') !== null;
}

// ── Auto-animate mutation ops ────────────────────────────────────────────────

/**
 * Enable "animate from previous slide" for the slide with `slideEid`.
 *
 * What this does:
 *   1. Locates the slide element and its previous sibling section.
 *   2. Stamps `data-auto-animate` (boolean) on BOTH sections.
 *   3. Collects managed elements (leaf/container/free) in each slide.
 *   4. Matches elements by tag name + ordinal position (tag:n key).
 *   5. For each matched pair: assigns `data-id = data-eid` from the CURRENT
 *      slide's element to BOTH elements (same data-id = reveal tweens them).
 *
 * WHY data-id = data-eid (not a new identifier):
 * We already have a stable, unique, editor-managed identifier on every element:
 * `data-eid`.  Reusing it for `data-id` avoids a second namespace and keeps
 * the two concepts visually linked in the HTML source.  Reveal only cares that
 * the data-id value is the same in both slides — the value itself is arbitrary.
 *
 * Returns `true` on success, `false` when the slide or its predecessor are not
 * found (safe no-op for stale selections after external edits).
 */
export function enableAutoAnimate(model: DeckModel, slideEid: string): boolean {
  const slide = (() => {
    let found: ElementNode | null = null;
    walk(model, (node) => {
      if (found) return;
      if (node.type === 'element' && getAttribute(node, 'data-eid') === slideEid) {
        found = node;
      }
    });
    return found;
  })();
  if (!slide) return false;

  const prev = findPreviousSlide(model, slideEid);
  if (!prev) return false;

  // Mark both sections as auto-animate partners (boolean attr → null value).
  setAttribute(slide, 'data-auto-animate', null);
  setAttribute(prev, 'data-auto-animate', null);

  // Collect and match candidates by tag + ordinal.
  const currentCandidates = collectCandidates(slide);
  const prevCandidates = collectCandidates(prev);

  const currentMap = buildTagOrdinalMap(currentCandidates);
  const prevMap = buildTagOrdinalMap(prevCandidates);

  // For each element in the CURRENT slide, derive data-id from its data-eid
  // and propagate the same data-id to the matching element in the PREVIOUS slide.
  for (const [key, currEl] of currentMap) {
    const eid = getAttribute(currEl, 'data-eid');
    if (!eid) continue; // unstamped element — skip

    // Current slide element gets data-id = its own data-eid.
    setAttribute(currEl, 'data-id', eid);

    // Previous slide's matching element (same tag:ordinal) gets the SAME data-id
    // so reveal knows to tween between the two.
    const prevEl = prevMap.get(key);
    if (prevEl) {
      setAttribute(prevEl, 'data-id', eid);
    }
  }

  return true;
}

/**
 * Disable auto-animate for the slide with `slideEid`.
 *
 * Removes `data-auto-animate` from the slide.  `data-id` attributes are
 * intentionally left in place — they are harmless on non-auto-animate slides
 * and allow the user to quickly re-enable the effect later without losing
 * the established element pairings.
 *
 * Returns `true` on success, `false` when the slide is not found.
 */
export function disableAutoAnimate(model: DeckModel, slideEid: string): boolean {
  let target: ElementNode | null = null;
  walk(model, (node) => {
    if (target) return;
    if (node.type === 'element' && getAttribute(node, 'data-eid') === slideEid) {
      target = node;
    }
  });
  if (!target) return false;
  removeAttribute(target, 'data-auto-animate');
  return true;
}
