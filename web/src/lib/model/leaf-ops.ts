/**
 * leaf-ops.ts — Whole-leaf structural mark ops on the MODEL (P17-8, P17-10).
 *
 * WHY THIS EXISTS (spec canvas-interaction rich text, spec principles-and-invariants byte-stability):
 * ===========================================================
 * The floating toolbar formats a sub-string RANGE in the live DOM (inline-marks.ts)
 * and commits via the sanitizer. But two affordances act on a WHOLE text leaf even
 * when it is NOT being edited:
 *   • the context-menu "Add/Edit link…" / "Remove link" (P17-10) — wrap/unwrap the
 *     entire leaf in an `<a href>`;
 *   • the inspector list indent / outdent (P17-8) — re-nest a `<ul>`/`<ol>` leaf.
 *
 * These run as deck-store commands over the parsed model (no live DOM), so they
 * live here as pure model mutations: feed an ElementNode leaf, mutate its child
 * subtree, and let the standard command path re-serialize + persist. The byte-
 * stable round-trip (spec principles-and-invariants #4) is preserved because only the edited leaf's
 * subtree goes dirty; every untouched element still emits its original bytes.
 *
 * Mark/href canonicalisation is still owned by inline.ts: an href written here is
 * validated by the caller via `isSafeHref`, and the serializer re-emits it
 * canonically. We never introduce a second emitter.
 */

import { createElement, createText } from './edit';
import type { ElementNode, SlideNode } from './types';

/** Recursively drop every `<a>` element under `node`, keeping its children. */
function stripAnchors(node: ElementNode): boolean {
  let changed = false;
  const out: SlideNode[] = [];
  for (const child of node.children) {
    if (child.type === 'element' && child.tagName.toLowerCase() === 'a') {
      stripAnchors(child); // flatten nested anchors first
      out.push(...child.children);
      changed = true;
    } else {
      if (child.type === 'element') {
        if (stripAnchors(child)) changed = true;
      }
      out.push(child);
    }
  }
  node.children = out;
  return changed;
}

/**
 * Remove every `<a>` mark inside the leaf `el`, unwrapping each to its content
 * (P17-9/10 "Remove link"). Returns true when an anchor was removed. Marks the
 * leaf dirty so the now-anchor-free subtree re-serializes (a pure removal leaves
 * only clean children, which would otherwise emit the stale original bytes).
 */
export function unlinkLeaf(el: ElementNode): boolean {
  const changed = stripAnchors(el);
  if (changed) el.dirty = true;
  return changed;
}

/**
 * Wrap the ENTIRE content of the text leaf `el` in a single `<a href>` (P17-9
 * linkElement / P17-10 context-menu "Add link"). Any pre-existing anchors inside
 * are first flattened so links never nest. The new anchor is dirty, so the leaf's
 * subtree re-serializes while the leaf's own tag bytes are preserved.
 *
 * The caller must validate `href` with `isSafeHref` first; the serializer also
 * re-emits it through the canonical path.
 */
export function linkLeaf(el: ElementNode, href: string): void {
  stripAnchors(el);
  const anchor = createElement('a', { href });
  anchor.children = el.children.length > 0 ? el.children : [createText('')];
  el.children = [anchor];
}

const LIST_TAGS = new Set(['ul', 'ol']);

/** True when `el` is a list leaf (`<ul>`/`<ol>`) eligible for indent/outdent. */
export function isListLeaf(el: ElementNode): boolean {
  return LIST_TAGS.has(el.tagName.toLowerCase());
}

/** Element children of `node` (skips whitespace/text nodes). */
function elementChildren(node: ElementNode): ElementNode[] {
  return node.children.filter((c): c is ElementNode => c.type === 'element');
}

/**
 * Detect the exact nested shape `indentList('in')` produces: the list holds a
 * single `<li>` whose only element child is a same-tag sub-list. Returns that
 * inner list so `outdent` can lift it back out, else null.
 */
function nestedSubList(el: ElementNode): ElementNode | null {
  const tag = el.tagName.toLowerCase();
  const kids = elementChildren(el);
  if (kids.length !== 1 || kids[0].tagName.toLowerCase() !== 'li') return null;
  const liKids = elementChildren(kids[0]);
  if (liKids.length !== 1) return null;
  const inner = liKids[0];
  return inner.tagName.toLowerCase() === tag ? inner : null;
}

/**
 * Re-nest a `<ul>`/`<ol>` list leaf one level deeper (`'in'`) or shallower
 * (`'out'`), as ONE byte-stable, reversible step (P17-8).
 *
 *   indent: `<ul> ITEMS </ul>`  →  `<ul><li><ul> ITEMS </ul></li></ul>`
 *   outdent: the inverse (only when the list is in exactly that nested shape).
 *
 * The data-eid leaf stays the OUTER list across the transform, so selection /
 * identity is preserved. Returns true when a change was made (outdent on a flat
 * list is a no-op). The new wrapper nodes are dirty, so the leaf subtree
 * re-serializes while the leaf's own tag bytes are preserved.
 */
export function indentList(el: ElementNode, dir: 'in' | 'out'): boolean {
  if (!isListLeaf(el)) return false;
  const tag = el.tagName.toLowerCase();

  if (dir === 'in') {
    const inner = createElement(tag);
    inner.children = el.children;
    const li = createElement('li');
    li.children = [inner];
    el.children = [li];
    return true;
  }

  // outdent: only reverse our own nested shape (otherwise nothing to lift).
  const inner = nestedSubList(el);
  if (!inner) return false;
  el.children = inner.children;
  el.dirty = true; // pure unwrap → mark dirty so the flattened subtree re-renders
  return true;
}
