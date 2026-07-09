/**
 * diff.ts — Pure structural diff between two deck models (P8-7 / spec claude-code-integration, document-model).
 *
 * WHY THIS EXISTS:
 * ================
 * Claude Code edits `deck.html` on disk between human turns (spec claude-code-integration turn-taking).
 * After the editor re-parses an external write it must show the user *what
 * changed* ("highlight what Claude changed" — spec claude-code-integration §"Targeting & change
 * visibility"). This module is the load-bearing pure core of that feature: given
 * the model BEFORE the external write and the model AFTER, it returns the set of
 * managed `data-eid`s that were added, removed, or had their content change.
 *
 * It deliberately keys on `data-eid` (spec document-model "stable IDs"): both models are
 * stamped (deck store stamps on every load/adopt), so an element keeps the same
 * eid across the reload and we can match it pre/post even if it moved in the
 * tree. An element whose eid disappears was removed; a brand-new eid was added;
 * an eid present in both whose *content signature* differs was changed.
 *
 * PURITY: no DOM, no side effects, no reliance on `dirty` flags — it works off
 * the parsed tree alone, so it is fully unit-testable under the `node` vitest
 * environment (see diff.test.ts).
 */

import { walk, getAttribute } from './edit';
import type { DeckModel, ElementNode } from './types';

/**
 * The result of diffing two models. Every entry is a managed element's
 * `data-eid`. Arrays are sorted for deterministic output (stable tests + stable
 * highlight ordering).
 *
 *   added   — eid present in `next` but not in `prev` (newly inserted element).
 *   removed — eid present in `prev` but not in `next` (deleted element).
 *   changed — eid present in BOTH, but its content signature differs (the
 *             element's attributes, direct text, or child arrangement changed).
 */
export interface ModelDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * Compute a stable content signature for one element.
 *
 * The signature captures everything we consider "this element's content" for
 * change-detection purposes WITHOUT recursing into managed descendants (those
 * have their own eids and are diffed independently — so a deep text edit flags
 * only the leaf that changed, not every ancestor):
 *
 *   • tag name,
 *   • attributes EXCLUDING `data-eid` itself (the eid is the identity key, not
 *     content; including it would make every freshly-stamped element look
 *     "changed"). Attributes are sorted so attribute REORDERING by Claude is not
 *     treated as a content change.
 *   • direct child text, whitespace-normalised (re-indentation is not a content
 *     change),
 *   • for each child ELEMENT: its eid if managed (`#eid` — the recursive diff
 *     covers its content), otherwise its verbatim `raw` (`R:…`) so changes
 *     inside an UNMANAGED/passthrough child still bubble up to the nearest
 *     managed ancestor and get highlighted.
 *
 * This makes "changed" mean "the smallest managed element whose own markup or
 * immediate arrangement differs", which is exactly what we want to flash.
 */
function signatureOf(el: ElementNode): string {
  const parts: string[] = [el.tagName.toLowerCase()];

  const attrs = el.attributes
    .filter((a) => a.name.toLowerCase() !== 'data-eid')
    .map((a) => `${a.name.toLowerCase()}=${a.value ?? ''}`)
    .sort();
  parts.push('{' + attrs.join('&') + '}');

  for (const child of el.children) {
    if (child.type === 'element') {
      const eid = getAttribute(child, 'data-eid');
      // Managed child → reference by eid (diffed on its own). Unmanaged child →
      // inline its raw so passthrough edits register on this ancestor.
      parts.push(eid ? `#${eid}` : `R:${child.raw}`);
    } else if (child.type === 'text') {
      const norm = child.value.replace(/\s+/g, ' ').trim();
      // Skip whitespace-only text so indentation churn never flags a change.
      if (norm !== '') parts.push(`T:${norm}`);
    } else {
      // Comments / CDATA / doctype: include verbatim (rare inside managed els,
      // but a content change there is still a real change worth surfacing).
      parts.push(`X:${child.raw}`);
    }
  }

  return parts.join('|');
}

/** Walk a model and collect `data-eid` → content signature for managed elements. */
function collectSignatures(model: DeckModel | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!model) return map;
  walk(model, (node) => {
    if (node.type !== 'element') return;
    const eid = getAttribute(node, 'data-eid');
    if (eid) map.set(eid, signatureOf(node));
  });
  return map;
}

/**
 * Diff two parsed deck models by their managed `data-eid`s.
 *
 * Either side may be `null` (e.g. the very first load has no previous model):
 * a null `prev` yields everything as `added`; a null `next` yields everything as
 * `removed`. Both null → empty diff.
 *
 * Pure: depends only on the trees, returns sorted arrays.
 */
export function diffModels(prev: DeckModel | null, next: DeckModel | null): ModelDiff {
  const a = collectSignatures(prev);
  const b = collectSignatures(next);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [eid, sig] of b) {
    const before = a.get(eid);
    if (before === undefined) added.push(eid);
    else if (before !== sig) changed.push(eid);
  }
  for (const eid of a.keys()) {
    if (!b.has(eid)) removed.push(eid);
  }

  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

/** True when a diff records no additions, removals, or content changes. */
export function isEmptyDiff(d: ModelDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}
