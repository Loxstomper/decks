/**
 * buildOutlineTree.ts — Pure model-to-view-tree mapping (P3-3 / spec 04).
 *
 * WHY A PURE FUNCTION (not embedded in a Svelte component):
 * ==========================================================
 * The spec (04) requires the panel to work from the document model, not the
 * live DOM.  Keeping the mapping pure lets us:
 *   1. Unit-test it against the model fixtures without spinning up any Svelte
 *      runtime or DOM environment.
 *   2. Derive the tree inside a `$derived()` in the panel with no side effects.
 *   3. Keep the component strictly presentational — it consumes OutlineNodes
 *      and emits selection events; it never touches the model directly.
 *
 * TREE SCOPE:
 * ===========
 * The outline mirrors the _slide content_ hierarchy only — starting from the
 * direct <section> children of `.reveal>.slides` (what `getSlides()` returns)
 * and recursively descending into element children.  The structural passthrough
 * wrapper divs (.reveal, .slides, <html>, <head>, <body>) are excluded because
 * they are not part of the editable slide content.
 *
 * Passthrough elements that appear INSIDE slides (e.g. <aside class="notes">,
 * unknown custom elements) ARE included in the tree so the user can see what
 * is in the source, but they are visually marked "source only" (klass ===
 * 'passthrough', no data-eid, non-interactive in the selection sense).
 */

import {
  classify,
  getAttribute,
  getSlides,
  decodeEntities,
  type DeckModel,
  type ElementNode,
  type ElementClass,
} from '$lib/model';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single node in the outline view-tree.  This is a plain data object —
 * no Svelte reactivity, no DOM references — so it can be serialised, diffed,
 * or snapshot-tested in a pure Node.js environment.
 */
export interface OutlineNode {
  /** `data-eid` value, or null for passthrough elements (never stamped). */
  eid: string | null;
  /** Lower-cased tag name, e.g. `'section'`, `'h2'`, `'div'`. */
  tag: string;
  /** Classification per classify.ts (container | leaf | free | passthrough). */
  klass: ElementClass;
  /**
   * Human-readable label shown in the tree row.  Format depends on klass:
   *   container  — "tag #eid (lay-type)"  or "section #eid"
   *   leaf       — "tag #eid: text snippet"  (snippet truncated to 50 chars)
   *   free       — "tag #eid @ x,y"
   *   passthrough — "tag"  (no eid because we never stamp passthroughs)
   */
  label: string;
  /** Recursive child element nodes (element children only; text/comment nodes
   *  are not included — they form the label snippet instead). */
  children: OutlineNode[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Collect the text content of an element's IMMEDIATE text-node children,
 * decode HTML entities, normalise whitespace, and truncate.
 *
 * WHY IMMEDIATE ONLY:
 * For leaves (h1, p, li …) the meaningful text is in the direct text children.
 * Going deeper would pull in nested-element text too (e.g. the `<code>` inside
 * a `<pre>`), producing misleading snippets.  Depth-0 is the right tradeoff
 * for a one-line label.
 */
function immediateText(el: ElementNode, maxLen = 50): string {
  const parts: string[] = [];
  for (const child of el.children) {
    if (child.type === 'text') {
      parts.push(decodeEntities(child.value));
    }
  }
  const text = parts.join('').trim().replace(/\s+/g, ' ');
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…'; // '…'
}

/**
 * Derive a concise, human-readable label for an element node.
 * Each classification gets a distinct format so the user can instantly
 * recognise what kind of element they are looking at.
 */
function computeLabel(el: ElementNode, klass: ElementClass): string {
  const tag = el.tagName.toLowerCase();
  const eid = getAttribute(el, 'data-eid');
  // Passthrough elements have no eid; show tag only (keep it dim in the UI).
  const eidSuffix = eid ? ` #${eid}` : '';

  if (klass === 'passthrough') {
    // Just the tag — the "source only" badge in the UI provides the rest.
    return tag;
  }

  if (klass === 'container') {
    if (tag === 'section') {
      // Sections are slides (or vertical-stack cells).  Surface any
      // notable data attributes as a hint (e.g. bg colour for title slides).
      const bg =
        getAttribute(el, 'data-background-color') ??
        getAttribute(el, 'data-background') ??
        null;
      return bg ? `section${eidSuffix} (bg: ${bg.slice(0, 20)})` : `section${eidSuffix}`;
    }
    // Layout containers: show the data-lay type so the user can distinguish
    // a row from a stack at a glance.
    const lay = getAttribute(el, 'data-lay');
    return lay ? `${tag}${eidSuffix} (${lay})` : `${tag}${eidSuffix}`;
  }

  if (klass === 'free') {
    // Free elements are identified by position — show their logical coords.
    const x = getAttribute(el, 'data-x') ?? '?';
    const y = getAttribute(el, 'data-y') ?? '?';
    const snippet = immediateText(el);
    return snippet
      ? `${tag}${eidSuffix} @ ${x},${y}: ${snippet}`
      : `${tag}${eidSuffix} @ ${x},${y}`;
  }

  // klass === 'leaf'
  if (tag === 'img') {
    // Images have no meaningful text children; use alt text instead.
    const alt = getAttribute(el, 'alt') ?? '';
    return alt ? `img${eidSuffix}: ${alt.slice(0, 40)}` : `img${eidSuffix}`;
  }
  if (tag === 'iframe') {
    const src = getAttribute(el, 'src') ?? '';
    return src ? `iframe${eidSuffix}: ${src.slice(0, 40)}` : `iframe${eidSuffix}`;
  }
  if (tag === 'svg') {
    return `svg${eidSuffix}`;
  }
  if (tag === 'video' || tag === 'audio') {
    const src = getAttribute(el, 'src') ?? '';
    return src ? `${tag}${eidSuffix}: ${src.slice(0, 30)}` : `${tag}${eidSuffix}`;
  }
  // All other leaves (headings, p, li, table cells, …): show text snippet.
  const snippet = immediateText(el);
  return snippet ? `${tag}${eidSuffix}: ${snippet}` : `${tag}${eidSuffix}`;
}

/**
 * Recursively build an OutlineNode for a single ElementNode and all of its
 * element descendants.
 *
 * Text nodes, comments, CDATA, and doctypes are never included as outline
 * children — they are folded into the label snippet instead.
 */
export function buildOutlineNode(el: ElementNode): OutlineNode {
  const klass = classify(el);
  const eid = getAttribute(el, 'data-eid');
  const tag = el.tagName.toLowerCase();
  const label = computeLabel(el, klass);

  // Descend into element children only. Inline marks (strong/em/a/span/br …,
  // P17) are managed rich-text content WITHIN a leaf, not structural rows — they
  // are folded into the leaf's label snippet, so they never appear in the tree.
  const children: OutlineNode[] = el.children
    .filter((c): c is ElementNode => c.type === 'element' && classify(c) !== 'inline')
    .map(buildOutlineNode);

  return { eid, tag, klass, label, children };
}

/**
 * Build the complete outline view-tree from a DeckModel.
 *
 * Entry points are the direct <section> children of `.reveal>.slides`
 * (i.e. what `getSlides()` returns — horizontal slides, plus the vertical-
 * stack wrapper sections).  Each returned OutlineNode's `children` array
 * recursively covers the full element subtree so the panel can render any
 * depth of nesting.
 *
 * Returns an empty array when `model` is null (no deck open) or when no
 * slides are found (malformed deck).
 *
 * This function is a pure transformation — it reads the model but never
 * mutates it.  Safe to call inside `$derived()` or a Vitest test.
 */
export function buildOutlineTree(model: DeckModel | null): OutlineNode[] {
  if (!model) return [];
  const slides = getSlides(model);
  return slides.map(buildOutlineNode);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Recursively collect all eids from an OutlineNode tree that have children
 * (i.e., nodes that CAN be expanded/collapsed).  Used by the panel to
 * initialise the expand state.
 */
export function collectExpandableEids(nodes: OutlineNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.children.length > 0) {
      // Passthrough nodes don't have eids; we always show them expanded (no
      // toggle), so only add managed nodes.
      if (node.eid !== null) out.push(node.eid);
      out.push(...collectExpandableEids(node.children));
    }
  }
  return out;
}
