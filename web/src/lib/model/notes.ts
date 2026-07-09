/**
 * notes.ts — Speaker notes model operations (P7-2 / spec presenting-and-export).
 *
 * Reveal.js stores speaker notes as `<aside class="notes">` inside each
 * `<section>`. These pure helpers get/set/remove that element while preserving
 * byte-stability (spec principles-and-invariants #4):
 *
 *   • Untouched sections round-trip verbatim — we only mark nodes dirty when
 *     their content actually changes.
 *   • When an aside already exists, we replace its children in-place and mark
 *     only the aside dirty (the section's own open/close tag bytes are kept).
 *   • When a new aside is created, it is appended as a new dirty child.
 *   • When notes are cleared (empty text), the aside is removed from the
 *     section's children list and the section is marked dirty.
 *
 * WHY `<aside class="notes">`:
 * This is reveal.js's canonical speaker-notes element (spec presenting-and-export). The built-in
 * speaker window (S key) picks it up automatically on the present route.
 */

import { getAttribute, createElement, createText } from './edit';
import { decodeEntities } from './entities';
import type { ElementNode } from './types';

/**
 * True when `el` is an `<aside class="notes">` as defined by reveal.js.
 * We use an "includes" check so additional classes do not break matching.
 */
function isNotesAside(el: ElementNode): boolean {
  if (el.tagName.toLowerCase() !== 'aside') return false;
  const cls = getAttribute(el, 'class') ?? '';
  return cls.split(/\s+/).includes('notes');
}

/**
 * Find the first `<aside class="notes">` among a section's direct children,
 * or `null` when none is present.
 */
function findNotesAside(section: ElementNode): ElementNode | null {
  for (const child of section.children) {
    if (child.type === 'element' && isNotesAside(child)) return child;
  }
  return null;
}

/**
 * Collect all text content from an element by concatenating descendant text
 * node values (entity-decoded so the caller receives a literal string suitable
 * for display in a textarea).
 */
function collectText(el: ElementNode): string {
  let out = '';
  for (const child of el.children) {
    if (child.type === 'text') {
      out += decodeEntities(child.value);
    } else if (child.type === 'element') {
      out += collectText(child);
    }
  }
  return out;
}

/**
 * Return the speaker notes text for a slide `<section>`.
 *
 * Returns the decoded text content of the first `<aside class="notes">` child,
 * or an empty string when no notes are present.
 */
export function getSlideNotes(section: ElementNode): string {
  const aside = findNotesAside(section);
  return aside ? collectText(aside) : '';
}

/**
 * Set the speaker notes for a slide `<section>`.
 *
 * Behaviour by case:
 *   • `text` is non-empty + aside exists  → replace aside's children with one
 *     fresh text node; marks only the aside dirty (byte-stable siblings).
 *   • `text` is non-empty + no aside      → create `<aside class="notes">`
 *     with a single text child and append it; marks the aside dirty.
 *   • `text` is empty string + aside      → remove the aside from the section's
 *     children and mark the section dirty (no empty-element churn).
 *   • `text` is empty string + no aside   → no-op (already clean).
 *
 * The `section` element's own open/close tag bytes are preserved in all cases
 * except the "remove" case, where the section must be re-rendered because its
 * children list changed.
 */
export function setSlideNotes(section: ElementNode, text: string): void {
  const existing = findNotesAside(section);

  if (text === '') {
    // Clear: remove the aside if present, mark the section dirty.
    if (!existing) return; // already clean — no-op preserves bytes
    section.children = section.children.filter((c) => c !== existing);
    section.dirty = true;
    return;
  }

  if (existing) {
    // Update in place: replace children with a single text node.
    // Only the aside goes dirty — the section's own tag bytes are unchanged.
    existing.children = [createText(text)];
    existing.dirty = true;
    return;
  }

  // Create a new <aside class="notes"> and append it.
  const aside = createElement('aside', { class: 'notes' });
  aside.children.push(createText(text));
  // appendChild would also mark the child dirty, but createElement already
  // sets dirty:true and createText does too — explicitly push for clarity.
  section.children.push(aside);
  // The section's tag bytes do not change (we only added a child), but the
  // serializer needs to re-render the section's children now that a new dirty
  // node is present. Because subtreeDirty() will find `aside.dirty === true`
  // it will recurse into the section automatically — we do NOT need to mark
  // the section itself dirty, which preserves its original tag bytes.
}
