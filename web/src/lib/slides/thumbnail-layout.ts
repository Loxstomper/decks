/**
 * thumbnail-layout.ts — PURE static port of the numeric layout vocabulary
 * (P12-4 / spec layout-vocabulary, spec principles-and-invariants).
 *
 * WHY THIS EXISTS:
 * ================
 * Slide thumbnails are rendered script-free (no reveal.js, no
 * decks-layout-init.js running in the DOM). But the layout contract resolves
 * its numeric `data-*` attributes (gap, padding, grid templates, flex, free
 * coordinates) into inline styles AT RUNTIME via
 * `internal/deck/vendor/decks-layout-init.js`. Without that script a thumbnail
 * would lose all numeric layout.
 *
 * This module is a faithful, pure mirror of that script's `applyToElement`
 * rules — it deep-clones a `<section>` subtree and writes the exact same inline
 * styles the runtime script would, so a thumbnail rendered from the clone looks
 * the same as the live slide. It is the SINGLE SOURCE for thumbnail layout
 * resolution; it must mirror the runtime script's rules exactly and invent none.
 *
 * PURITY:
 *   • Never mutates the input model — operates on a deep clone
 *     ({@link cloneSubtreeStripEids}; eids are irrelevant in thumbnails).
 *   • Merges into any pre-existing inline `style` (never clobbers user/Claude
 *     declarations); new layout declarations win over same-named existing ones.
 */

import { cloneSubtreeStripEids } from '../model/clone';
import { getAttribute, hasAttribute, setAttribute } from '../model/edit';
import type { ElementNode, SlideNode } from '../model/types';

/** Matches a bare non-negative integer (mirrors the runtime script's `/^\d+$/`). */
const INT_RE = /^\d+$/;

interface Decl {
  prop: string;
  value: string;
}

/** Split a `style` literal into property/value declarations (preserves order). */
function parseStyle(style: string): Decl[] {
  return style
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((d) => {
      const i = d.indexOf(':');
      if (i < 0) return { prop: d.trim(), value: '' };
      return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    });
}

/** Reserialize declarations back into a canonical `prop: value; …` string. */
function serializeStyle(decls: Decl[]): string {
  return decls.map((d) => (d.value ? `${d.prop}: ${d.value}` : d.prop)).join('; ');
}

/**
 * Merge the given layout declarations into `el`'s existing inline `style`,
 * preserving every prior declaration. A new declaration whose property already
 * exists replaces that declaration in place (keeping its position); otherwise it
 * is appended. No-op when there is nothing to add.
 */
function mergeStyle(el: ElementNode, additions: Decl[]): void {
  if (additions.length === 0) return;
  const existing = getAttribute(el, 'style') ?? '';
  const decls = parseStyle(existing);
  for (const add of additions) {
    const lprop = add.prop.toLowerCase();
    const idx = decls.findIndex((d) => d.prop.toLowerCase() === lprop);
    if (idx >= 0) decls[idx] = add;
    else decls.push(add);
  }
  setAttribute(el, 'style', serializeStyle(decls));
}

/**
 * Resolve the numeric `data-*` layout attributes of a single (already-cloned)
 * element into inline-style declarations. Mirrors `applyToElement` in
 * `decks-layout-init.js` exactly.
 */
function layoutDeclsFor(el: ElementNode): Decl[] {
  const out: Decl[] = [];

  // ── Container: gap / padding (logical px) ──────────────────────────────────
  const gap = getAttribute(el, 'data-gap');
  if (gap !== null) out.push({ prop: 'gap', value: `${gap}px` });

  const pad = getAttribute(el, 'data-pad');
  if (pad !== null) out.push({ prop: 'padding', value: `${pad}px` });

  // ── Grid: columns / rows (integer → repeat(N, 1fr) or raw template) ────────
  const cols = getAttribute(el, 'data-cols');
  if (cols !== null) {
    out.push({
      prop: 'grid-template-columns',
      value: INT_RE.test(cols) ? `repeat(${cols}, 1fr)` : cols,
    });
  }

  const rows = getAttribute(el, 'data-rows');
  if (rows !== null) {
    out.push({
      prop: 'grid-template-rows',
      value: INT_RE.test(rows) ? `repeat(${rows}, 1fr)` : rows,
    });
  }

  // ── Child: flex-grow factor ────────────────────────────────────────────────
  const grow = getAttribute(el, 'data-grow');
  if (grow !== null) out.push({ prop: 'flex-grow', value: grow });

  // ── Child: flex-basis (plain integer → px, otherwise raw e.g. "50%") ───────
  const basis = getAttribute(el, 'data-basis');
  if (basis !== null) {
    out.push({ prop: 'flex-basis', value: INT_RE.test(basis) ? `${basis}px` : basis });
  }

  // ── Child: grid-column span ────────────────────────────────────────────────
  const span = getAttribute(el, 'data-span');
  if (span !== null) out.push({ prop: 'grid-column', value: `span ${span}` });

  // ── Free element: absolute positioning in logical coords ───────────────────
  if (hasAttribute(el, 'data-free')) {
    const x = getAttribute(el, 'data-x');
    const y = getAttribute(el, 'data-y');
    const w = getAttribute(el, 'data-w');
    const h = getAttribute(el, 'data-h');
    const rot = getAttribute(el, 'data-rot');
    if (x !== null) out.push({ prop: 'left', value: `${x}px` });
    if (y !== null) out.push({ prop: 'top', value: `${y}px` });
    if (w !== null) out.push({ prop: 'width', value: `${w}px` });
    if (h !== null) out.push({ prop: 'height', value: `${h}px` });
    if (rot !== null) out.push({ prop: 'transform', value: `rotate(${rot}deg)` });
  }

  return out;
}

/** Recursively resolve layout declarations into inline styles on a clone. */
function applyRecursive(node: SlideNode): void {
  if (node.type !== 'element') return;
  mergeStyle(node, layoutDeclsFor(node));
  for (const child of node.children) applyRecursive(child);
}

/**
 * Deep-clone `section` and write inline styles equivalent to the runtime
 * `decks-layout-init.js` for every numeric `data-*` layout attribute, applied
 * recursively across the whole subtree. The input model is never mutated.
 *
 * @param section a `<section>` (or any) element node from the deck model
 * @returns a fresh, layout-resolved clone safe to render in a script-free thumbnail
 */
export function applyThumbnailLayout(section: ElementNode): ElementNode {
  const clone = cloneSubtreeStripEids(section) as ElementNode;
  applyRecursive(clone);
  return clone;
}
