/**
 * classify.ts — Per-node element classification (P2-1 / spec 02 / spec 03).
 *
 * Every ElementNode in the model falls into exactly one of four classes.
 * The classification drives which editing surface the canvas shows, whether
 * an element receives a `data-eid`, and how the serializer treats it.
 *
 * Rules (first match wins):
 *
 *   FREE        — carries `data-free` (absolute-positioning escape hatch, spec 03).
 *                 Wins over container so that `data-free data-lay` is unambiguous.
 *
 *   CONTAINER   — carries `data-lay` (layout primitive: stack / row / grid / layers)
 *                 OR is a `<section>` (the slide root — the outermost layout unit the
 *                 editor controls; sections nest for vertical stacks, all managed).
 *
 *   LEAF        — a known block-content element the editor can directly edit:
 *                 headings, paragraph, list (ul/ol/li), blockquote, pre/code, img,
 *                 figure/figcaption, table family (table/thead/tbody/tfoot/tr/th/td),
 *                 iframe, svg, video, audio.
 *
 *   INLINE      — an allowlisted inline mark (strong/em/u/s/a/span/br + legacy
 *                 b/i/font) that lives WITHIN a leaf as managed rich-text content
 *                 (P17). It is NOT a new leaf and NOT passthrough: the editor owns
 *                 it (the inline serializer canonicalises it), but it never gets a
 *                 `data-eid` of its own — it is addressed through its owning leaf.
 *                 `<aside>` (reveal.js speaker notes) is passthrough because the
 *                 editor has no speaker-notes editing UI in scope for P2.
 *
 *   PASSTHROUGH — everything else: structural HTML (html/head/body/div without
 *                 data-lay), raw-text elements (script/style/textarea/title),
 *                 metadata (meta/link), unknown custom elements, etc. The editor
 *                 never touches these; they round-trip byte-identically (spec 12 #4).
 */

import { hasAttribute, getAttribute } from './edit';
import { isInlineMarkTag } from './inline';
import type { ElementNode } from './types';

export type ElementClass = 'container' | 'leaf' | 'inline' | 'free' | 'passthrough';

/**
 * Known block-content tag names that the editor treats as leaves.
 * Lower-cased for O(1) lookup.
 */
const LEAF_TAGS = new Set<string>([
  // Text blocks
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p',
  'blockquote',
  // Lists
  'ul', 'ol', 'li',
  // Code / preformatted
  'pre', 'code',
  // Media
  'img',
  'video', 'audio',
  // Figures
  'figure', 'figcaption',
  // Table family
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  // Embed / vector
  'iframe',
  'svg',
]);

/**
 * Return the classification of an ElementNode per spec 02 / 03.
 *
 * This is a pure function of the node's tag name and attributes — it does not
 * walk children or inspect ancestors. Call it at any point; it never mutates.
 */
/** True when `el`'s class attribute contains `token` as a whitespace-delimited class. */
function hasClassToken(el: ElementNode, token: string): boolean {
  const cls = getAttribute(el, 'class');
  if (!cls) return false;
  return cls.split(/\s+/).includes(token);
}

export function classify(el: ElementNode): ElementClass {
  // Rule 1 — free escape-hatch (highest priority so data-free wins over data-lay).
  if (hasAttribute(el, 'data-free')) return 'free';

  const tag = el.tagName.toLowerCase();

  // Rule 2 — container: layout primitive or slide root.
  if (hasAttribute(el, 'data-lay') || tag === 'section') return 'container';

  // Rule 3 — leaf: known block-content tag.
  if (LEAF_TAGS.has(tag)) return 'leaf';

  // Rule 3b — math block: a KaTeX leaf has no dedicated HTML tag, so the editor
  // marks it with its OWN class token `math-block` (see blocks/builders.ts).
  // spec 03 lists Math as a leaf block type — recognise the editor's own marker
  // so the math block gets a data-eid and is individually selectable/styleable.
  // This is the editor's emitted marker, not user styling, so reading it here
  // does not violate the "no class-string parsing for layout" principle.
  if ((tag === 'div' || tag === 'span') && hasClassToken(el, 'math-block')) {
    return 'leaf';
  }

  // Rule 3c — chart block (P17-15): a Chart.js chart is a <canvas> carrying the
  // editor's own marker attribute `data-chart` (see blocks/builders.ts). spec 03
  // lists Chart as a leaf block type — recognise the marker so the chart gets a
  // data-eid and is individually selectable (its JSON data is edited in the
  // inspector). A bare <canvas> WITHOUT data-chart is left passthrough — the
  // editor only owns charts it emitted. Dual-encoded with classify-equivalent
  // recognition in internal/validate/validate.go and getChartProps in layout.ts.
  if (tag === 'canvas' && hasAttribute(el, 'data-chart')) {
    return 'leaf';
  }

  // Rule 4 — inline mark: managed rich-text content inside a leaf (P17). Checked
  // AFTER leaf/math/chart so `<span class="math-block">` stays a leaf. Inline
  // marks are never stamped with a data-eid (see eid.ts) — addressed via the leaf.
  if (isInlineMarkTag(tag)) return 'inline';

  // Rule 5 — passthrough: everything else.
  return 'passthrough';
}

/**
 * Text-bearing leaf tags the editor's per-element colour control applies to
 * (P9-8 / spec 09 "Text appearance": heading / paragraph / list / text leaf).
 * Media/embed leaves (img, video, svg, iframe, table cells aside) carry no
 * directly-coloured text, so they are intentionally excluded.
 */
const TEXT_LEAF_TAGS = new Set<string>([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p',
  'blockquote',
  'ul', 'ol', 'li',
  'figcaption',
  'th', 'td',
]);

/**
 * True when `el` is a TEXT leaf — a leaf (per {@link classify}) whose content is
 * directly-coloured text. Drives whether the inspector shows the text-colour
 * control (spec 09). Pure; never mutates.
 */
export function isTextLeaf(el: ElementNode): boolean {
  if (classify(el) !== 'leaf') return false;
  return TEXT_LEAF_TAGS.has(el.tagName.toLowerCase());
}
