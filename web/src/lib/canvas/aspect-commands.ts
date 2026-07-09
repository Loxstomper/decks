/**
 * aspect-commands.ts — Model/DOM adapters + undoable store command for an
 * aspect-ratio change (P4-7, spec scaling-and-resolution).
 *
 * WHY THIS EXISTS:
 * ================
 * aspect.ts is pure math; aspect.svelte.ts is reactive UI state. This module is
 * the bridge that touches the document MODEL and the deck STORE:
 *
 *   • collectFreeRects(model)   — read every free element's stored logical rect
 *                                 (data-x/y/w/h) so the offer can be computed.
 *   • persistAspectChange(...)  — write the new canvas size into the reveal init
 *                                 script (spec scaling-and-resolution single source of truth) AND the
 *                                 accepted reposition offers (data-x/y/w/h), then
 *                                 commit as ONE undo entry + one autosave (the same
 *                                 command pattern as structure-commands.ts).
 *
 * PERSISTENCE DECISION (spec scaling-and-resolution "Config lives in the reveal init script inside
 * deck.html — single source of truth; no sidecar"): the logical canvas size is
 * persisted as `width`/`height` in the `Reveal.initialize({ … })` call. We rewrite
 * those keys in the init <script> (a raw-text element, emitted verbatim — so its JS
 * is never entity-escaped). On load the integrator can recover the size via
 * readLogicalSizeFromInit() and reverse-map it to a preset id for the UI. We do NOT
 * introduce a sidecar or a deck-level data attribute, honouring the spec.
 */

import { deckStore } from '$lib/store/deck.svelte.ts';
import { walk, getAttribute, setAttribute, classify } from '$lib/model';
import type { DeckModel, ElementNode, SlideNode } from '$lib/model';
import type { FreeRect, LogicalSize, RepositionOffer } from './aspect.ts';

/** Format a logical coordinate for attribute storage: integers without a `.0`. */
function formatCoord(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v);
}

/**
 * Read a free element's stored logical rect from its data-* attributes.
 * Missing x/y default to 0 (origin); missing w/h stay undefined (content-sized).
 */
function readFreeRect(el: ElementNode): FreeRect {
  const num = (raw: string | null): number | undefined => {
    if (raw === null) return undefined;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const rect: FreeRect = {
    x: num(getAttribute(el, 'data-x')) ?? 0,
    y: num(getAttribute(el, 'data-y')) ?? 0,
  };
  const w = num(getAttribute(el, 'data-w'));
  const h = num(getAttribute(el, 'data-h'));
  if (w !== undefined) rect.w = w;
  if (h !== undefined) rect.h = h;
  return rect;
}

/**
 * Enumerate every FREE element in the model (classify === 'free') that carries a
 * data-eid, paired with its stored logical rect. This is the candidate list for
 * computeRepositionOffers(). Structured elements are intentionally excluded — they
 * reflow automatically (spec scaling-and-resolution) and have no absolute coords to remap.
 */
export function collectFreeRects(model: DeckModel): { eid: string; rect: FreeRect }[] {
  const out: { eid: string; rect: FreeRect }[] = [];
  walk(model, (node) => {
    if (node.type !== 'element') return;
    if (classify(node) !== 'free') return;
    const eid = getAttribute(node, 'data-eid');
    if (!eid) return;
    out.push({ eid, rect: readFreeRect(node) });
  });
  return out;
}

// ── reveal init <script> width/height surgery (pure string helpers) ───────────

/**
 * Set (or inject) one numeric key inside a `Reveal.initialize({ … })` call.
 * If the key already exists its value is replaced; otherwise it is injected as the
 * first key of the init object. Returns the original text unchanged when there is
 * no Reveal.initialize call to edit.
 */
function setInitKey(js: string, key: string, value: number): string {
  const replace = new RegExp(`(\\b${key}\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)`);
  if (replace.test(js)) return js.replace(replace, `$1${value}`);
  // Inject as the first key of the initialize object literal.
  return js.replace(/(Reveal\.initialize\s*\(\s*\{)/, `$1 ${key}: ${value},`);
}

/**
 * Rewrite the `width`/`height` of a `Reveal.initialize` JS snippet to `size`.
 * Pure — operates on (and returns) the script's JS text.
 */
export function applyLogicalSizeToInit(js: string, size: LogicalSize): string {
  let out = setInitKey(js, 'width', size.width);
  out = setInitKey(out, 'height', size.height);
  return out;
}

/**
 * Read the logical size from a `Reveal.initialize` JS snippet, or null when either
 * dimension is absent (caller then assumes the default canvas).
 */
export function readLogicalSizeFromInit(js: string): LogicalSize | null {
  const w = /\bwidth\s*:\s*(-?\d+(?:\.\d+)?)/.exec(js);
  const h = /\bheight\s*:\s*(-?\d+(?:\.\d+)?)/.exec(js);
  if (!w || !h) return null;
  return { width: parseFloat(w[1]), height: parseFloat(h[1]) };
}

/** Concatenate the verbatim text of a raw-text element's children (its JS). */
function rawTextOf(el: ElementNode): string {
  let s = '';
  for (const child of el.children) {
    if (child.type === 'text') s += child.raw;
  }
  return s;
}

/**
 * Find the `<script>` element containing the `Reveal.initialize(` call, or null.
 * Raw-text elements (script) hold a single verbatim text child (parser invariant).
 */
function findRevealInitScript(model: DeckModel): ElementNode | null {
  let found: ElementNode | null = null;
  walk(model, (node) => {
    if (found || node.type !== 'element') return;
    if (node.tagName.toLowerCase() !== 'script') return;
    if (rawTextOf(node).includes('Reveal.initialize')) found = node;
  });
  return found;
}

/**
 * Rewrite the reveal init script's width/height to `size` in place (model edit).
 * Returns true when the script was found and its content changed. The script is a
 * raw-text element, so we set the text child's `value` to the new JS VERBATIM
 * (never via setText, which entity-encodes for HTML — wrong for JS) and mark it
 * dirty so serialize emits the new content while preserving the <script …> tag.
 */
function writeRevealSizeToModel(model: DeckModel, size: LogicalSize): boolean {
  const script = findRevealInitScript(model);
  if (!script) return false;
  const textChild = script.children.find((c): c is Extract<SlideNode, { type: 'text' }> =>
    c.type === 'text',
  );
  if (!textChild) return false;
  const current = textChild.raw;
  const next = applyLogicalSizeToInit(current, size);
  if (next === current) return false;
  // Raw-text serialization emits `value` verbatim for a dirty child (serialize.ts),
  // so assigning the JS directly is correct — NO entity encoding.
  textChild.value = next;
  textChild.raw = next;
  textChild.dirty = true;
  return true;
}

/**
 * Apply accepted reposition offers to the model: write each free element's new
 * data-x/y (and data-w/h when present). Returns the count of elements changed.
 */
function writeOffersToModel(model: DeckModel, accepted: RepositionOffer[]): number {
  let changed = 0;
  for (const offer of accepted) {
    let el: ElementNode | null = null;
    walk(model, (node) => {
      if (el || node.type !== 'element') return;
      if (getAttribute(node, 'data-eid') === offer.eid) el = node;
    });
    if (!el) continue;
    const s = offer.suggested;
    setAttribute(el, 'data-x', formatCoord(s.x));
    setAttribute(el, 'data-y', formatCoord(s.y));
    if (s.w !== undefined) setAttribute(el, 'data-w', formatCoord(s.w));
    if (s.h !== undefined) setAttribute(el, 'data-h', formatCoord(s.h));
    changed++;
  }
  return changed;
}

/**
 * Pure model mutation for an aspect change (no store): rewrite the reveal init
 * size and apply the accepted reposition offers. Returns true when anything in the
 * model changed. Exported so it can be unit-tested headlessly against a parsed
 * model (the store commit path is a thin wrapper below).
 */
export function applyAspectChangeToModel(
  model: DeckModel,
  newSize: LogicalSize,
  acceptedOffers: RepositionOffer[],
): boolean {
  const sizeChanged = writeRevealSizeToModel(model, newSize);
  const offersChanged = writeOffersToModel(model, acceptedOffers);
  return sizeChanged || offersChanged > 0;
}

/**
 * P4-7 command: persist an aspect-ratio change as ONE undo entry + one autosave.
 *
 *   1. Rewrite the reveal init script width/height to `newSize` (spec-05 source of
 *      truth) so the saved deck renders — and the canvas reloads — at the new size.
 *   2. Apply the user's ACCEPTED reposition offers to the affected free elements.
 *      Declined elements keep their old coords (the spec says we must not silently
 *      move them — declining is honoured).
 *   3. updateFromModel() → commitCommand(): reserialize + push one undo snapshot +
 *      save immediately, exactly like every other canvas command.
 *
 * Returns false (no edit, no history) when nothing changed — e.g. the size already
 * matched and no offers were accepted — so a no-op aspect "change" is free.
 */
export async function persistAspectChange(
  newSize: LogicalSize,
  acceptedOffers: RepositionOffer[],
): Promise<boolean> {
  const model = deckStore.model;
  if (!model) return false;

  if (!applyAspectChangeToModel(model, newSize, acceptedOffers)) return false;

  deckStore.updateFromModel();
  await deckStore.commitCommand();
  return true;
}
