/**
 * slides.ts — Pure model operations for slide management (P6 / spec 06).
 *
 * WHY THIS EXISTS:
 * ================
 * Every "slide" is a `<section>` element directly under `.reveal > .slides`
 * (spec 06: "All operations are DOM operations on `<section>` elements"). reveal
 * is 2D — a top-level `<section>` that itself contains `<section>` children is a
 * *vertical stack* and the wrapper's own content is NOT shown as a slide. These
 * functions add / duplicate / delete / reorder / nest / promote / hide slides by
 * splicing nodes in the source-preserving model tree.
 *
 * BYTE-STABILITY (spec 12 #4 — load-bearing, DO NOT break):
 * =========================================================
 * Mutations mark the *minimum* set of nodes dirty so untouched slides still
 * round-trip byte-for-byte:
 *   • Inserting a (dirty) section makes the parent `subtreeDirty`, so the parent
 *     re-iterates its children in the NEW order but keeps its own tag bytes and
 *     emits every untouched sibling verbatim.
 *   • Removing a section requires marking the parent dirty (after the child
 *     leaves, the parent has no dirty descendant and would otherwise emit its
 *     stale `raw` — still containing the removed child).
 * Whitespace handling mirrors structure-ops.ts: the indentation text node that
 * immediately precedes a section is carried with it on move/remove and a fresh
 * copy is emitted on insert, so output stays cleanly indented and no orphaned
 * blank lines are left behind.
 *
 * These are pure functions over the model (no DOM, no store) → unit-testable.
 * The deckStore command layer wraps them with stampEids + updateFromModel +
 * commitCommand so each operation is exactly one undo entry + one autosave.
 */

import {
  getAttribute,
  setAttribute,
  removeAttribute,
  createElement,
  createText,
  appendChild,
  walk,
  type DeckModel,
  type ElementNode,
  type SlideNode,
  type TextNode,
} from '$lib/model';
// moveChild already implements whitespace-aware, dirty-minimised reordering
// within a single parent (P3-6) — reuse it for slide + vertical reorder.
import { moveChild } from '$lib/canvas/structure-ops';

// ── Narrowing helpers ────────────────────────────────────────────────────────

function isElement(n: SlideNode): n is ElementNode {
  return n.type === 'element';
}

function isSection(n: SlideNode): n is ElementNode {
  return n.type === 'element' && n.tagName.toLowerCase() === 'section';
}

/** True for a whitespace-only text node (indentation / blank lines between tags). */
function isWhitespaceText(n: SlideNode): n is TextNode {
  return n.type === 'text' && /^\s*$/.test(n.value);
}

// ── Container / structure queries ────────────────────────────────────────────

/**
 * The reveal slides container — the `.slides` div under `.reveal`. We return the
 * FIRST one in document order (a well-formed deck has exactly one). Returns null
 * when the deck has no slides container (e.g. a fragment being parsed in tests
 * that lacks the reveal scaffold — callers treat that as "no slides").
 */
export function findSlidesContainer(model: DeckModel): ElementNode | null {
  let found: ElementNode | null = null;
  walk(model, (node) => {
    if (found || node.type !== 'element') return;
    if (
      node.tagName.toLowerCase() === 'div' &&
      (getAttribute(node, 'class') ?? '').split(/\s+/).includes('slides')
    ) {
      found = node;
    }
  });
  return found;
}

/** Top-level slides: the direct `<section>` children of `.slides`, in order. */
export function topLevelSlides(model: DeckModel): ElementNode[] {
  const container = findSlidesContainer(model);
  if (!container) return [];
  return container.children.filter(isSection);
}

/** Direct `<section>` children of a section (its vertical slides, in order). */
export function verticalChildren(section: ElementNode): ElementNode[] {
  return section.children.filter(isSection);
}

/** True when `section` is a vertical stack (contains direct `<section>` children). */
export function isVerticalStack(section: ElementNode): boolean {
  return verticalChildren(section).length > 0;
}

/** True when `section` is hidden from presenting (`data-visibility="hidden"`). */
export function isSlideHidden(section: ElementNode): boolean {
  return getAttribute(section, 'data-visibility') === 'hidden';
}

/**
 * A 2D view of the deck for the navigator: each top-level slide plus, when it is
 * a vertical stack, its nested slides. `section` references the live model nodes
 * so the caller can read attributes / serialize for thumbnails.
 */
export interface SlideTreeNode {
  section: ElementNode;
  eid: string | null;
  /** Horizontal index (position among top-level slides). */
  h: number;
  hidden: boolean;
  /** Vertical children when this is a stack; empty for a simple slide. */
  verticals: { section: ElementNode; eid: string | null; v: number; hidden: boolean }[];
}

/** Build the 2D navigator model from the deck (top-level slides + verticals). */
export function buildSlideTree(model: DeckModel | null): SlideTreeNode[] {
  if (!model) return [];
  return topLevelSlides(model).map((section, h) => ({
    section,
    eid: getAttribute(section, 'data-eid'),
    h,
    hidden: isSlideHidden(section),
    verticals: verticalChildren(section).map((child, v) => ({
      section: child,
      eid: getAttribute(child, 'data-eid'),
      v,
      hidden: isSlideHidden(child),
    })),
  }));
}

// ── Internal whitespace + splice helpers ─────────────────────────────────────

/** The whitespace text node immediately preceding `el` in `parent.children`. */
function leadingWhitespace(parent: ElementNode, el: ElementNode): TextNode | null {
  const i = parent.children.indexOf(el);
  if (i > 0 && isWhitespaceText(parent.children[i - 1])) {
    return parent.children[i - 1] as TextNode;
  }
  return null;
}

/**
 * Best-effort indentation string for a new section child of `parent`: clone the
 * indentation of an existing section child, else fall back to a sensible default
 * derived from the deepest existing whitespace. Purely cosmetic — never affects
 * correctness, only keeps serialized output tidy.
 */
function indentFor(parent: ElementNode): string {
  const firstSection = parent.children.find(isSection);
  if (firstSection) {
    const ws = leadingWhitespace(parent, firstSection);
    if (ws) return ws.value;
  }
  // No existing section to copy — derive from any whitespace node present.
  const anyWs = parent.children.find(isWhitespaceText) as TextNode | undefined;
  return anyWs ? anyWs.value : '\n  ';
}

/**
 * Insert `section` into `parent.children` so it follows `after` (or becomes the
 * last section when `after` is null), preceded by a fresh indentation text node
 * so it lands on its own cleanly-indented line. Marks the inserted section dirty;
 * the parent re-serializes its children while keeping its own tag bytes.
 */
function insertSectionAfter(
  parent: ElementNode,
  after: ElementNode | null,
  section: ElementNode,
): void {
  const ws = createText(indentFor(parent)); // dirty text node → emitted verbatim
  let pos: number;
  if (after) {
    pos = parent.children.indexOf(after) + 1;
  } else {
    // Append after the last section (before any trailing whitespace) so the new
    // slide nests cleanly rather than after the closing-tag indentation.
    const sections = parent.children.filter(isSection);
    const last = sections[sections.length - 1];
    pos = last ? parent.children.indexOf(last) + 1 : parent.children.length;
  }
  parent.children.splice(pos, 0, ws, section);
  section.dirty = true;
}

/**
 * Remove `section` (and a single immediately-preceding whitespace text node, if
 * any) from `parent.children`. Marks the parent dirty so it re-serializes WITHOUT
 * the departed section. Returns the removed section, or null if it was not a
 * child of `parent`.
 */
function detachSection(parent: ElementNode, section: ElementNode): ElementNode | null {
  const ci = parent.children.indexOf(section);
  if (ci < 0) return null;
  let start = ci;
  let count = 1;
  if (ci > 0 && isWhitespaceText(parent.children[ci - 1])) {
    start = ci - 1;
    count = 2;
  }
  parent.children.splice(start, count);
  parent.dirty = true; // parent lost a child → must re-render, not emit stale raw
  return section;
}

/** Locate a top-level slide by eid plus the `.slides` container holding it. */
function findTopLevel(
  model: DeckModel,
  eid: string,
): { container: ElementNode; section: ElementNode; index: number } | null {
  const container = findSlidesContainer(model);
  if (!container) return null;
  const slides = container.children.filter(isSection);
  const index = slides.findIndex((s) => getAttribute(s, 'data-eid') === eid);
  if (index < 0) return null;
  return { container, section: slides[index], index };
}

/**
 * Locate a section by eid anywhere directly under `.slides` (top-level) OR one
 * level down (a vertical child), returning it with its immediate parent.
 */
function findSectionAndParent(
  model: DeckModel,
  eid: string,
): { parent: ElementNode; section: ElementNode } | null {
  const container = findSlidesContainer(model);
  if (!container) return null;
  for (const top of container.children) {
    if (!isSection(top)) continue;
    if (getAttribute(top, 'data-eid') === eid) return { parent: container, section: top };
    for (const inner of top.children) {
      if (isSection(inner) && getAttribute(inner, 'data-eid') === eid) {
        return { parent: top, section: inner };
      }
    }
  }
  return null;
}

// ── Deep clone (for duplicate) ───────────────────────────────────────────────

/**
 * Deep-clone a node subtree as freshly-authored, canonical nodes (raw='' +
 * dirty), stripping every `data-eid` so stampEids re-mints unique ids for the
 * copy. `data-id` and all other attributes are PRESERVED so reveal auto-animate
 * can still pair the original and the copy by data-id (spec 07).
 */
function cloneStripEids(node: SlideNode): SlideNode {
  if (node.type === 'element') {
    return {
      type: 'element',
      tagName: node.tagName,
      // Drop data-eid only; keep data-id (+ everything else) for auto-animate.
      attributes: node.attributes
        .filter((a) => a.name.toLowerCase() !== 'data-eid')
        .map((a) => ({ name: a.name, value: a.value })),
      children: node.children.map(cloneStripEids),
      rawOpen: '',
      rawClose: '',
      selfClosing: node.selfClosing,
      isVoid: node.isVoid,
      rawText: node.rawText,
      raw: '', // force canonical render
      dirty: true,
    };
  }
  // Text / comment / cdata / doctype: copy the value, force canonical render.
  return { ...node, raw: '', dirty: true };
}

// ── Public operations ────────────────────────────────────────────────────────

/**
 * P6-3: Add a new slide. Inserts a `<section data-lay="stack">` with a starter
 * heading (spec 06) immediately after the top-level slide carrying `afterEid`,
 * or appended to the end when `afterEid` is omitted / unknown. Returns the new
 * (unstamped) section node, or null when the deck has no slides container.
 */
export function addSlide(model: DeckModel, afterEid?: string): ElementNode | null {
  const container = findSlidesContainer(model);
  if (!container) return null;

  // Starter slide: data-lay="stack" (vertical-centred column, spec 03) with a
  // placeholder heading so the slide is visible in the canvas + thumbnail.
  const section = createElement('section', { 'data-lay': 'stack' });
  const heading = createElement('h2');
  appendChild(heading, createText('New slide'));
  appendChild(section, heading);

  let after: ElementNode | null = null;
  if (afterEid) {
    const found = findTopLevel(model, afterEid);
    if (found) after = found.section;
  }
  insertSectionAfter(container, after, section);
  return section;
}

/**
 * P6-3 / spec 06: Duplicate the slide carrying `eid` (top-level or vertical),
 * inserting the copy immediately after the original. The copy's `data-eid`s are
 * stripped (re-minted by the caller's stampEids) while `data-id`s are preserved
 * so auto-animate can pair the pair (spec 07). Returns the cloned section node,
 * or null when the eid is unknown.
 */
export function duplicateSlide(model: DeckModel, eid: string): ElementNode | null {
  const found = findSectionAndParent(model, eid);
  if (!found) return null;
  const clone = cloneStripEids(found.section) as ElementNode;
  insertSectionAfter(found.parent, found.section, clone);
  return clone;
}

/**
 * P6-3: Delete the slide carrying `eid` (top-level or vertical). When deleting
 * the last vertical child of a stack, the now-empty stack wrapper is removed too
 * (a stack with no inner sections is not a meaningful slide). Returns true on
 * success, false when the eid is unknown.
 */
export function deleteSlide(model: DeckModel, eid: string): boolean {
  const found = findSectionAndParent(model, eid);
  if (!found) return false;
  const { parent, section } = found;
  detachSection(parent, section);

  // If we just emptied a vertical stack, drop the wrapper as well so it doesn't
  // linger as a blank top-level slide. (parent is a stack only when it is itself
  // a top-level <section> under .slides.)
  if (isSection(parent) && verticalChildren(parent).length === 0) {
    const container = findSlidesContainer(model);
    if (container && container.children.includes(parent)) {
      detachSection(container, parent);
    }
  }
  return true;
}

/**
 * P6-4: Reorder the top-level slide at element-index `fromIndex` to `toIndex`
 * (positions among top-level slides). Returns true on success, false when the
 * deck has no container or the index is out of range.
 */
export function moveSlide(model: DeckModel, fromIndex: number, toIndex: number): boolean {
  const container = findSlidesContainer(model);
  if (!container) return false;
  const slides = container.children.filter(isSection);
  if (fromIndex < 0 || fromIndex >= slides.length) return false;
  return moveChild(container, slides[fromIndex], toIndex);
}

/**
 * P6-5: Reorder a vertical slide within its stack from index `fromIndex` to
 * `toIndex`. Returns true on success.
 */
export function moveVerticalSlide(
  model: DeckModel,
  stackEid: string,
  fromIndex: number,
  toIndex: number,
): boolean {
  const found = findTopLevel(model, stackEid);
  if (!found) return false;
  const children = verticalChildren(found.section);
  if (fromIndex < 0 || fromIndex >= children.length) return false;
  return moveChild(found.section, children[fromIndex], toIndex);
}

/**
 * P6-5: Nest (demote) the top-level slide carrying `eid` so it becomes the last
 * vertical slide of the PREVIOUS top-level slide.
 *
 * If the previous slide is a simple slide, it is converted into a vertical stack:
 * its existing content is wrapped into a first inner `<section>` and the nested
 * slide is appended after it. If the previous slide is already a stack, the slide
 * is simply appended. Returns the nested section, or null when there is no
 * previous slide to nest under (or the eid is unknown).
 */
export function nestSlide(model: DeckModel, eid: string): ElementNode | null {
  const found = findTopLevel(model, eid);
  if (!found || found.index === 0) return null; // need a previous sibling
  const { container, section } = found;
  const slides = container.children.filter(isSection);
  const prev = slides[found.index - 1];

  detachSection(container, section);

  if (!isVerticalStack(prev)) {
    // Wrap prev's existing content into a first inner <section> so prev becomes
    // a stack wrapper. The wrapper keeps prev's attributes (incl. its data-eid);
    // the inner section is fresh and will be stamped by the caller.
    const inner = createElement('section');
    inner.children = prev.children; // adopt prev's content verbatim
    inner.dirty = true;
    prev.children = [createText(indentFor(prev)), inner];
    prev.dirty = true; // prev's structure changed → re-render
  }

  // Append the nested slide as the last vertical child of prev.
  insertSectionAfter(prev, null, section);
  prev.dirty = true;
  return section;
}

/**
 * P6-5: Promote a vertical slide carrying `eid` OUT of its stack so it becomes a
 * top-level slide positioned immediately after the (former) stack. If the stack
 * is emptied of vertical children by the promotion, the now-redundant wrapper is
 * removed. Returns the promoted section, or null when `eid` is not a vertical
 * child of a top-level stack.
 */
export function promoteSlide(model: DeckModel, eid: string): ElementNode | null {
  const container = findSlidesContainer(model);
  if (!container) return null;

  // Find the stack (a top-level section) and the vertical child to promote.
  let stack: ElementNode | null = null;
  let child: ElementNode | null = null;
  for (const top of container.children) {
    if (!isSection(top)) continue;
    const match = verticalChildren(top).find((s) => getAttribute(s, 'data-eid') === eid);
    if (match) {
      stack = top;
      child = match;
      break;
    }
  }
  if (!stack || !child) return null;

  detachSection(stack, child);
  insertSectionAfter(container, stack, child);

  // Drop the wrapper if it has no vertical slides left (it would otherwise be a
  // blank top-level slide).
  if (verticalChildren(stack).length === 0) {
    detachSection(container, stack);
  }
  return child;
}

/**
 * P6-6: Hide / show the slide carrying `eid`. Hiding sets
 * `data-visibility="hidden"` (reveal-native: the slide stays in source but is
 * skipped when presenting); showing removes the attribute. Returns true on
 * success, false when the eid is unknown.
 */
export function setSlideHidden(model: DeckModel, eid: string, hidden: boolean): boolean {
  const found = findSectionAndParent(model, eid);
  if (!found) return false;
  if (hidden) setAttribute(found.section, 'data-visibility', 'hidden');
  else removeAttribute(found.section, 'data-visibility');
  return true;
}
