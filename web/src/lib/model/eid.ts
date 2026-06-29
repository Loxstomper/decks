/**
 * eid.ts — Stable `data-eid` stamping for managed elements (P2-2 / spec 02).
 *
 * INVARIANTS (all tested in classify.test.ts):
 *
 *   IDEMPOTENT  — stampEids on an already-stamped model is a no-op: no `dirty`
 *                 bits are set, so a subsequent serializeDeck produces identical
 *                 bytes. Concretely: if an element already has a `data-eid` we
 *                 skip it; only genuinely unstamped elements get setAttribute.
 *
 *   STABLE      — Because we only stamp elements that LACK a `data-eid`, eids
 *                 survive parse → serialize → re-parse cycles untouched. The
 *                 serializer keeps the attribute in place; the parser reads it
 *                 back verbatim; stampEids sees it and skips.
 *
 *   UNIQUE      — A two-pass algorithm: (1) collect all eids already in the
 *                 document into a Set; (2) generate new eids that skip any id
 *                 already present. This respects hand-authored eids from Claude
 *                 Code and avoids collisions between the two passes.
 *
 *   SCOPED DIRTY — Each stamp call goes through setAttribute which sets ONLY
 *                  that element's `dirty = true`. Neighbouring elements that
 *                  already had eids remain clean and serialize via verbatim
 *                  byte passthrough (spec 12 #4).
 *
 *   NO PASSTHROUGH — classify(el) === 'passthrough' elements never receive an
 *                    eid; the editor does not manage them.
 *
 * ID SCHEME
 * ---------
 * `<prefix><counter>` where prefix is a short mnemonic derived from the tag
 * name (e.g. `s` for section, `h` for headings, `p` for paragraph, `img` for
 * img, `lay` for layout containers, `fr` for free elements, `el` for anything
 * else managed). Counter starts at 1 and increments until the candidate id is
 * not already in use. Example eids: s1, h1, p1, p2, img1, lay1, fr1.
 *
 * This is deterministic within a single stampEids call on a given document
 * traversal order (depth-first, document order). If the document is re-parsed
 * from its stamped output, all eids are already present and no new ones are
 * generated, so the counter never runs.
 */

import { getAttribute, setAttribute, walk } from './edit';
import type { DeckModel, ElementNode } from './types';
import { classify } from './classify';

/**
 * Prefix map: lower-cased tag name → short eid prefix string.
 * Tags not in the map fall back to 'el' (for any unexpected managed tag).
 */
const TAG_PREFIX: Record<string, string> = {
  // Slide root
  section: 's',
  // Headings (all share 'h'; counter disambiguates h1 vs h2 by document order)
  h1: 'h', h2: 'h', h3: 'h', h4: 'h', h5: 'h', h6: 'h',
  // Block text
  p: 'p',
  blockquote: 'bq',
  // Lists
  ul: 'ul', ol: 'ol', li: 'li',
  // Code
  pre: 'pre', code: 'cd',
  // Media
  img: 'img',
  video: 'vid', audio: 'aud',
  // Figures
  figure: 'fig', figcaption: 'fig',
  // Table family
  table: 'tbl', thead: 'thd', tbody: 'tbd', tfoot: 'tft',
  tr: 'tr', th: 'th', td: 'td',
  // Embed / vector
  iframe: 'ifr',
  svg: 'svg',
  // Layout container (div/article/main/… carrying data-lay)
  div: 'lay', article: 'lay', main: 'lay', header: 'lay',
  footer: 'lay', nav: 'lay', section_lay: 'lay', // section already mapped above
};

/**
 * Derive the eid prefix for a managed element.
 *
 * Free elements always use 'fr' regardless of tag (their defining characteristic
 * is absolute positioning, not their tag name). Layout containers (data-lay) use
 * a tag-derived prefix when available, falling back to 'lay'. Other managed
 * elements use their tag prefix or 'el'.
 */
function eidPrefix(el: ElementNode): string {
  const cls = classify(el);
  // Free always uses 'fr' — the tag is incidental to the free concept.
  if (cls === 'free') return 'fr';
  const tag = el.tagName.toLowerCase();
  return TAG_PREFIX[tag] ?? 'el';
}

/**
 * Generate the next unique eid for `prefix` that is not already in `usedEids`.
 * Mutates `usedEids` by adding the new eid so callers can chain calls without
 * collisions.
 *
 * Example: nextEid('p', new Set(['p1', 'p2'])) → 'p3'
 */
export function nextEid(prefix: string, usedEids: Set<string>): string {
  let i = 1;
  while (usedEids.has(`${prefix}${i}`)) i++;
  const eid = `${prefix}${i}`;
  usedEids.add(eid);
  return eid;
}

/**
 * Assign a stable, unique `data-eid` to every managed element (container,
 * leaf, free) in the model that does not already have one.
 *
 * See module-level doc for the full invariant specification.
 */
export function stampEids(model: DeckModel): void {
  // Pass 1 — collect every eid already present in the document.
  // This includes hand-authored eids from Claude Code and eids from previous
  // stamp runs; we must never collide with or overwrite them.
  const usedEids = new Set<string>();
  walk(model, (node) => {
    if (node.type !== 'element') return;
    const eid = getAttribute(node, 'data-eid');
    if (eid !== null) usedEids.add(eid);
  });

  // Pass 2 — stamp only the managed elements that lack a data-eid.
  // Using setAttribute ensures: (a) only this element is marked dirty,
  // (b) the value is entity-encoded correctly, (c) the attribute is appended
  // in document order (consistent with spec canonical attribute ordering).
  walk(model, (node) => {
    if (node.type !== 'element') return;

    // Passthrough elements are never stamped — the editor doesn't manage them.
    const cls = classify(node);
    if (cls === 'passthrough') return;

    // Already stamped — skip to preserve idempotency and byte-stability.
    if (getAttribute(node, 'data-eid') !== null) return;

    const prefix = eidPrefix(node);
    const eid = nextEid(prefix, usedEids);
    // setAttribute marks node.dirty = true for ONLY this element;
    // siblings and ancestors remain clean (byte-stable passthrough on next save).
    setAttribute(node, 'data-eid', eid);
  });
}
