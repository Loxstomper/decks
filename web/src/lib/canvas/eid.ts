/**
 * eid.ts — Map a clicked DOM element back to a selectable model node (P2-3).
 *
 * WHY THIS EXISTS (spec canvas-interaction "Selection"):
 * ======================================
 * Selection/editing run in the PARENT window but operate on elements that live
 * inside the reveal.js iframe. The only stable bridge between a rendered DOM
 * element and its model node is the `data-eid` attribute that Lane A stamps onto
 * the model (and that is written into deck.html on save). So when the user clicks
 * a node inside the iframe we must resolve that DOM `Element` to a single eid.
 *
 * Two rules, both from spec canvas-interaction:
 *   1. "Click to select a leaf" — we select the NEAREST classifiable *leaf*, not
 *      whatever exact text-run / inline span happened to receive the click. A
 *      click anywhere inside `<h1 data-eid="t1">Hello</h1>` selects `t1`.
 *   2. Clicking empty space (the slide background, `.slides`, `<section>` chrome)
 *      selects nothing → the caller deselects.
 *
 * Containers (sections, layout boxes) are handled in later phases via the outline
 * panel; for now we walk UP from the click target and return the first element
 * that is both (a) a recognised leaf tag and (b) carries a `data-eid`.
 *
 * This module is intentionally DOM-free in its core (`resolveSelectable` takes a
 * minimal {@link ElementLike}) so it is unit-testable headlessly — real
 * `HTMLElement`s satisfy the interface, and tests can pass plain fakes.
 */

/**
 * The minimal shape we need from a DOM element. Real `Element`s satisfy this,
 * and tests can supply lightweight fakes (no jsdom required).
 */
export interface ElementLike {
  /** Tag name. DOM returns this UPPER-CASE for HTML elements; we normalise. */
  tagName: string;
  getAttribute(name: string): string | null;
  /** Parent in the tree, or null at the root. */
  parentElement: ElementLike | null;
}

/** Result of resolving a click to a selectable model node. */
export interface Selectable {
  /** The `data-eid` of the resolved leaf. */
  eid: string;
  /** True when the leaf holds editable text (P2-5 contenteditable applies). */
  editable: boolean;
  /** Normalised (lower-case) tag name of the resolved leaf. */
  tag: string;
}

/**
 * Tags that carry editable TEXT content. A click on any of these (with a
 * data-eid) yields an `editable` selectable, so double-click can start an
 * in-place contenteditable session (P2-5).
 *
 * Deliberately conservative: structural/layout tags (`div`, `section`) are NOT
 * here — selecting/editing a whole layout box is a later-phase concern. We want
 * the *content* leaf, which is almost always one of these in a reveal slide.
 */
const TEXT_LEAF_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'a', 'span', 'code', 'pre', 'blockquote',
  'figcaption', 'caption', 'td', 'th', 'dt', 'dd',
  'em', 'strong', 'b', 'i', 'small', 'mark', 'sub', 'sup', 'label',
]);

/**
 * Tags that are selectable LEAVES but hold no editable text (geometry-only —
 * select to move/resize, never to type into).
 */
const NON_TEXT_LEAF_TAGS = new Set([
  'img', 'svg', 'video', 'audio', 'canvas', 'iframe', 'picture', 'object',
]);

/** True when `tag` (any case) is a recognised selectable leaf. */
export function isLeafTag(tag: string): boolean {
  const t = tag.toLowerCase();
  return TEXT_LEAF_TAGS.has(t) || NON_TEXT_LEAF_TAGS.has(t);
}

/** True when `tag` (any case) is an editable TEXT leaf. */
export function isTextLeafTag(tag: string): boolean {
  return TEXT_LEAF_TAGS.has(tag.toLowerCase());
}

/**
 * Walk up from a click target to the nearest classifiable leaf that carries a
 * `data-eid`, returning the selectable descriptor or `null` (→ deselect).
 *
 * We require BOTH the leaf classification and a present data-eid: an eid without
 * a leaf tag is a container (skip, keep climbing); a leaf tag without an eid
 * cannot be mapped back to the model (skip). The first element satisfying both
 * wins. A bounded climb (no eid anywhere up the chain) returns null.
 */
export function resolveSelectable(target: ElementLike | null): Selectable | null {
  let el: ElementLike | null = target;
  while (el) {
    const tag = el.tagName.toLowerCase();
    const eid = el.getAttribute('data-eid');
    if (eid && isLeafTag(tag)) {
      return { eid, editable: isTextLeafTag(tag), tag };
    }
    el = el.parentElement;
  }
  return null;
}
