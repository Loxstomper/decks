/**
 * writeback.ts — Canvas text edit → model mutation (P2-6).
 *
 * WHY THIS EXISTS (spec 02 byte-stability, spec 04 "edit-in-place"):
 * ==================================================================
 * When the user commits an in-place contenteditable edit (P2-5), we must push
 * the new text into the *model* — not by re-parsing the whole document, but by
 * surgically updating the one node identified by `data-eid`. This keeps the
 * byte-stable round-trip invariant (spec 12 #4) intact: only the edited subtree
 * goes dirty and re-serializes canonically; every sibling and every other slide
 * is emitted verbatim from its original bytes.
 *
 * We deliberately operate at the MODEL level (not the store) so the
 * transformation is a pure-ish function of (model, eid, text) and is unit
 * testable: feed a parsed model in, apply, serialize, assert the edit shows and
 * untouched siblings are byte-identical.
 */

import { createText, findByEid, setText, type DeckModel } from '$lib/model';

/**
 * Apply a committed plain-text edit to the model node carrying `eid`.
 *
 * Returns `true` if a node was found and updated, `false` if the eid is unknown
 * (e.g. stale selection after an external reload) so the caller can no-op.
 *
 * Two cases, both scoped to the single target element:
 *
 *   • Single text child  — the common leaf shape (`<h1>Title</h1>`). We rewrite
 *     that text node via `setText`, which marks ONLY the text node dirty. The
 *     element keeps its original open/close tag bytes (passthrough), so the tag
 *     is not reformatted — minimal churn.
 *
 *   • Mixed / empty content — markup we can't safely diff (e.g. inline `<span>`s,
 *     or an empty element). Contenteditable commit gives us flattened text, so
 *     we replace the children with a single canonical text node. The new text
 *     node is dirty (re-rendered); the element keeps its tag bytes because we do
 *     NOT mark the element itself dirty — only its replaced child subtree
 *     re-serializes. Inline formatting inside this one leaf is intentionally
 *     flattened (text-edit semantics); rich-content editing is a later phase.
 *
 * In both cases nothing outside this element is touched, preserving byte-stable
 * passthrough for the rest of the deck.
 */
export function applyTextEditToModel(
  model: DeckModel,
  eid: string,
  newLiteralText: string,
): boolean {
  const el = findByEid(model, eid);
  if (!el) return false;

  if (el.children.length === 1 && el.children[0].type === 'text') {
    setText(el.children[0], newLiteralText);
    return true;
  }

  // Mixed/empty: replace with one canonical text node (createText marks it
  // dirty). Element tag bytes are preserved (element itself stays non-dirty).
  el.children = [createText(newLiteralText)];
  return true;
}
