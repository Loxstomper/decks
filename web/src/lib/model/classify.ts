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
 *                 NOTE: inline-only tags (span, em, strong, a, br …) are NOT leaves —
 *                 they live *inside* leaf content and are preserved verbatim there.
 *                 `<aside>` (reveal.js speaker notes) is passthrough because the
 *                 editor has no speaker-notes editing UI in scope for P2.
 *
 *   PASSTHROUGH — everything else: structural HTML (html/head/body/div without
 *                 data-lay), raw-text elements (script/style/textarea/title),
 *                 metadata (meta/link), unknown custom elements, etc. The editor
 *                 never touches these; they round-trip byte-identically (spec 12 #4).
 */

import { hasAttribute } from './edit';
import type { ElementNode } from './types';

export type ElementClass = 'container' | 'leaf' | 'free' | 'passthrough';

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
export function classify(el: ElementNode): ElementClass {
  // Rule 1 — free escape-hatch (highest priority so data-free wins over data-lay).
  if (hasAttribute(el, 'data-free')) return 'free';

  const tag = el.tagName.toLowerCase();

  // Rule 2 — container: layout primitive or slide root.
  if (hasAttribute(el, 'data-lay') || tag === 'section') return 'container';

  // Rule 3 — leaf: known block-content tag.
  if (LEAF_TAGS.has(tag)) return 'leaf';

  // Rule 4 — passthrough: everything else.
  return 'passthrough';
}
