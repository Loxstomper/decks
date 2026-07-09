/**
 * fragments.ts — Reveal.js fragment (step reveal) model operations (P6-7 / spec motion-and-transitions).
 *
 * WHY:
 * Reveal fragments are driven purely by HTML attributes on elements inside a
 * <section>: `class="fragment"` marks the element as hidden-until-stepped, and
 * `data-fragment-index` controls the reveal order.  Additional class tokens
 * (fade-up, highlight-red, …) select animation styles.
 *
 * All mutations go through edit.ts setAttribute/removeAttribute so that:
 *  • only the modified element's `dirty` flag is set (spec principles-and-invariants #4 byte-stability)
 *  • class lists are never wholesale-replaced — only the `fragment` token and
 *    style tokens are touched, leaving any user/author classes intact
 *
 * BYTE STABILITY:
 * Because we use setAttribute (which encodes literals and marks dirty), only
 * changed elements re-render on the next serializeDeck.  Untouched siblings
 * round-trip verbatim.
 */

import { getAttribute, setAttribute, removeAttribute } from '$lib/model/edit';
import type { ElementNode } from '$lib/model/types';

// ── Fragment animation style union ──────────────────────────────────────────

/**
 * All reveal.js-supported fragment styles.
 * The empty-string default ("fade-in") is represented by the absence of a
 * style class — a bare `class="fragment"` uses reveal's default animation.
 */
export type FragmentStyle =
  | 'fade-out'
  | 'fade-up'
  | 'fade-down'
  | 'fade-left'
  | 'fade-right'
  | 'fade-in-then-out'
  | 'fade-in-then-semi-out'
  | 'current-visible'
  | 'grow'
  | 'semi-fade-out'
  | 'shrink'
  | 'strike'
  | 'highlight-red'
  | 'highlight-blue'
  | 'highlight-green'
  | 'highlight-current-red'
  | 'highlight-current-blue'
  | 'highlight-current-green';

export const FRAGMENT_STYLES: FragmentStyle[] = [
  'fade-out',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'fade-in-then-out',
  'fade-in-then-semi-out',
  'current-visible',
  'grow',
  'semi-fade-out',
  'shrink',
  'strike',
  'highlight-red',
  'highlight-blue',
  'highlight-green',
  'highlight-current-red',
  'highlight-current-blue',
  'highlight-current-green',
];

// Set of all style class names for fast membership testing.
const FRAGMENT_STYLE_SET = new Set<string>(FRAGMENT_STYLES);

// ── Class token helpers ──────────────────────────────────────────────────────

/**
 * True when `el`'s class attribute contains `token` as a whitespace-delimited
 * class.  Does not modify the element.
 */
export function hasClassToken(el: ElementNode, token: string): boolean {
  const cls = getAttribute(el, 'class') ?? '';
  return cls.split(/\s+/).includes(token);
}

/**
 * Add `token` to the element's class list.  No-op if already present.
 * Only the `class` attribute is marked dirty — other attributes are untouched.
 */
export function addClassToken(el: ElementNode, token: string): void {
  const cls = getAttribute(el, 'class') ?? '';
  const tokens = cls.split(/\s+/).filter(Boolean);
  if (tokens.includes(token)) return; // already present — byte-stable
  tokens.push(token);
  setAttribute(el, 'class', tokens.join(' '));
}

/**
 * Remove `token` from the element's class list.  If the class list becomes
 * empty, the `class` attribute is removed entirely (cleaner markup, avoids
 * `class=""`).  No-op if the token was not present.
 */
export function removeClassToken(el: ElementNode, token: string): void {
  const cls = getAttribute(el, 'class') ?? '';
  const tokens = cls.split(/\s+/).filter((t) => t !== '' && t !== token);
  if (tokens.length === 0) {
    removeAttribute(el, 'class');
  } else {
    setAttribute(el, 'class', tokens.join(' '));
  }
}

// ── Fragment query helpers ───────────────────────────────────────────────────

/** True when `el` carries the `fragment` class (i.e. is a reveal fragment). */
export function isFragment(el: ElementNode): boolean {
  return hasClassToken(el, 'fragment');
}

/**
 * Read the `data-fragment-index` as an integer, or `null` when absent or
 * non-numeric (reveal uses document order as the fallback, so null = auto).
 */
export function getFragmentIndex(el: ElementNode): number | null {
  const val = getAttribute(el, 'data-fragment-index');
  if (val === null) return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Read the active fragment style class from `el`, or `null` when the element
 * uses reveal's default fade-in animation (no explicit style class).
 */
export function getFragmentStyle(el: ElementNode): FragmentStyle | null {
  const cls = getAttribute(el, 'class') ?? '';
  for (const token of cls.split(/\s+/)) {
    if (FRAGMENT_STYLE_SET.has(token)) return token as FragmentStyle;
  }
  return null;
}

// ── Fragment mutation operations ─────────────────────────────────────────────

/**
 * Toggle the `fragment` class on `el`.
 *
 * When adding:
 *   • appends `fragment` to the class list
 *   • optionally stamps `data-fragment-index` if `index` is provided
 * When removing:
 *   • removes the `fragment` class token
 *   • removes `data-fragment-index` (the step ordering is no longer meaningful)
 *   • fragment style classes (fade-up, highlight-red, …) are intentionally
 *     LEFT in place so re-enabling the fragment restores the previous style
 *
 * Returns `true` when the element is now a fragment, `false` when it is not.
 */
export function toggleFragment(el: ElementNode, index?: number): boolean {
  if (isFragment(el)) {
    // Element IS a fragment → remove the `fragment` marker.
    removeClassToken(el, 'fragment');
    removeAttribute(el, 'data-fragment-index');
    return false;
  } else {
    // Element is NOT a fragment → mark it.
    addClassToken(el, 'fragment');
    if (index !== undefined) {
      setAttribute(el, 'data-fragment-index', String(index));
    }
    return true;
  }
}

/**
 * Set the `data-fragment-index` on `el` to `index`.
 * Useful for reordering fragments in the panel without toggling them.
 * This is meaningful only when `isFragment(el)` is true; we do not guard
 * against it being called on non-fragments because the index attribute is
 * harmless on non-fragment elements and the caller controls context.
 */
export function setFragmentIndex(el: ElementNode, index: number): void {
  setAttribute(el, 'data-fragment-index', String(index));
}

/**
 * Set the fragment animation style for `el`.
 *
 * When `style` is non-null, all existing fragment style classes are removed
 * and the new style is appended.  When `style` is null, all style classes are
 * removed (restoring the default fade-in animation).
 *
 * The `fragment` class itself is preserved regardless of the style.  This
 * function ONLY manages the style sub-token(s), not the core `fragment` class.
 */
export function setFragmentStyle(el: ElementNode, style: FragmentStyle | null): void {
  const cls = getAttribute(el, 'class') ?? '';
  // Filter out all known style tokens, leaving non-fragment-style classes intact.
  const tokens = cls.split(/\s+/).filter((t) => t !== '' && !FRAGMENT_STYLE_SET.has(t));
  if (style !== null) tokens.push(style);
  if (tokens.length === 0) {
    removeAttribute(el, 'class');
  } else {
    setAttribute(el, 'class', tokens.join(' '));
  }
}

// ── Fragment list query (for the panel) ─────────────────────────────────────

/** Info about a single fragment element, passed to the panel for rendering. */
export interface FragmentInfo {
  el: ElementNode;
  /** The element's data-eid (for store dispatch and selection). */
  eid: string | null;
  /** Resolved step index (explicit data-fragment-index or null → auto/sequential). */
  index: number | null;
  /** Current style class, or null for the default animation. */
  style: FragmentStyle | null;
}

/**
 * Collect all fragment elements within `slideEl` (depth-first, skipping the
 * slide section itself) and return them sorted by their effective step order:
 * explicit index ascending first, then auto-indexed (null index) in document
 * order at the end.
 *
 * WHY SORT NULLS LAST:
 * Reveal assigns auto-indices to un-indexed fragments AFTER all explicitly
 * indexed ones, so the panel order matches reveal's actual reveal order.
 */
export function getFragmentsInSlide(slideEl: ElementNode): FragmentInfo[] {
  const fragments: FragmentInfo[] = [];

  const recurse = (el: ElementNode) => {
    // Don't check the slide section itself — only its descendants.
    if (el !== slideEl && isFragment(el)) {
      fragments.push({
        el,
        eid: getAttribute(el, 'data-eid'),
        index: getFragmentIndex(el),
        style: getFragmentStyle(el),
      });
    }
    for (const child of el.children) {
      if (child.type === 'element') recurse(child);
    }
  };
  recurse(slideEl);

  // Sort: explicit index ascending, then nulls in document order (stable sort
  // preserves the original ordering for null-indexed fragments).
  fragments.sort((a, b) => {
    const ai = a.index ?? Infinity;
    const bi = b.index ?? Infinity;
    return ai - bi;
  });
  return fragments;
}
