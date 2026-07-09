/**
 * writeback.ts — Canvas rich-text edit → model mutation (P2-6 / P17-3).
 *
 * WHY THIS EXISTS (spec document-model byte-stability, spec canvas-interaction "edit-in-place"):
 * ==================================================================
 * When the user commits an in-place contenteditable edit, we must push the new
 * content into the *model* — not by re-parsing the whole document, but by
 * surgically replacing the children of the one leaf identified by `data-eid`.
 * This keeps the byte-stable round-trip invariant (spec principles-and-invariants #4) intact: only the
 * edited leaf's child subtree goes dirty and re-serializes canonically; the
 * leaf's OWN tag bytes, every sibling, and every other slide are emitted verbatim
 * from their original bytes.
 *
 * INLINE-PRESERVING (P17-3): the contenteditable hands us the leaf's `innerHTML`,
 * which may contain inline marks (strong/em/u/s/a/span/br) plus browser junk and
 * pasted hostile content. We route it through {@link parseInlineNodes}, which
 * sanitises + canonicalises to the fixed allowlist (spec principles-and-invariants security) and returns
 * dirty model nodes. So `<strong>` SURVIVES (it is no longer flattened to text);
 * `<script>`/`on*`/`javascript:` are stripped; `<b>`→`<strong>` etc.
 *
 * We deliberately operate at the MODEL level (not the store) so the
 * transformation is a pure function of (model, eid, html) and is unit testable:
 * feed a parsed model in, apply, serialize, assert the marks survive and
 * untouched siblings are byte-identical.
 */

import { createText, findByEid, type DeckModel } from '$lib/model';
import { parseInlineNodes } from '$lib/model/inline';

/**
 * Apply a committed rich-text edit (the leaf's `innerHTML`) to the model node
 * carrying `eid`.
 *
 * Returns `true` if a leaf was found and updated, `false` if the eid is unknown
 * (e.g. a stale selection after an external reload) so the caller can no-op.
 *
 * The leaf's children are REPLACED with the sanitised, canonical inline nodes
 * (all dirty, so they re-serialize canonically). The leaf itself is NOT marked
 * dirty, so its open/close tag bytes are preserved — only its child subtree
 * reformats. An edit that clears all content leaves a single empty (dirty) text
 * node so the now-empty leaf still re-serializes (rather than emitting its stale
 * original bytes via clean passthrough). Nothing outside this leaf is touched.
 */
export function applyRichTextEditToModel(
  model: DeckModel,
  eid: string,
  html: string,
): boolean {
  const el = findByEid(model, eid);
  if (!el) return false;

  const nodes = parseInlineNodes(html);
  // Guarantee at least one dirty child so subtreeDirty(leaf) is true and the
  // leaf re-renders its (possibly empty) new content instead of its old bytes.
  el.children = nodes.length > 0 ? nodes : [createText('')];
  return true;
}
