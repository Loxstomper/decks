/**
 * transitions.ts — Reveal.js transition model operations (P6-8 / spec 07).
 *
 * WHY:
 * Reveal transitions are controlled via:
 *   • Per-slide:  `data-transition` / `data-transition-speed` on `<section>` elements.
 *   • Deck-level: stored as `data-transition` / `data-transition-speed` on the
 *     `.reveal` root div; the slides-layout-init.js companion script reads these
 *     attributes after Reveal initializes and calls `Reveal.configure()` to apply
 *     them as the deck default.
 *
 * WHY USE THE .REVEAL DIV FOR DECK DEFAULTS:
 * The `Reveal.initialize({transition:'slide'})` call is inside a raw-text `<script>`
 * element that our source-preserving parser treats as passthrough (spec 12 —
 * never destroy the unknown).  We cannot safely parse JS to update it.  Storing
 * the preference as a data attribute on a well-known HTML element (`.reveal`) and
 * reading it at runtime via Reveal.configure() is the offline-safe alternative.
 *
 * BYTE STABILITY:
 * All mutations go through setAttribute / removeAttribute (edit.ts), so only the
 * modified element is marked dirty.  Untouched nodes serialize verbatim (spec 12 #4).
 */

import { getAttribute, setAttribute, removeAttribute, walk } from '$lib/model/edit';
import type { DeckModel, ElementNode } from '$lib/model/types';

// ── Transition value unions ──────────────────────────────────────────────────

/**
 * The reveal.js built-in transition names.
 * `none` disables animation; the others are CSS-based transitions.
 */
export type TransitionType = 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';

/**
 * Reveal.js transition speed qualifiers.
 * `default` corresponds to the reveal default (typically ~700ms).
 */
export type TransitionSpeed = 'default' | 'fast' | 'slow';

export const TRANSITION_TYPES: TransitionType[] = ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'];
export const TRANSITION_SPEEDS: TransitionSpeed[] = ['default', 'fast', 'slow'];

// ── Per-slide transition ops ─────────────────────────────────────────────────

/**
 * Read `data-transition` and `data-transition-speed` from a `<section>` element.
 * Returns `null` for any attribute that is absent (reveal uses the deck default).
 */
export function getSlideTransition(el: ElementNode): {
  transition: TransitionType | null;
  speed: TransitionSpeed | null;
} {
  const t = getAttribute(el, 'data-transition');
  const s = getAttribute(el, 'data-transition-speed');
  return {
    transition: (t as TransitionType | null) ?? null,
    speed: (s as TransitionSpeed | null) ?? null,
  };
}

/**
 * Set the transition (and optionally the speed) on a `<section>` element.
 *
 * Passing `null` for `transition` removes the attribute (the slide reverts to
 * the deck default).  Passing `undefined` for `speed` leaves it unchanged.
 * Passing `null` for `speed` removes the attribute.
 *
 * WHY SEPARATE transition / speed:
 * Callers often update just the type OR just the speed independently, so making
 * `speed` optional and defaulting to "leave untouched" avoids redundant no-ops.
 */
export function setSlideTransition(
  el: ElementNode,
  transition: TransitionType | null,
  speed?: TransitionSpeed | null,
): void {
  if (transition !== null) {
    setAttribute(el, 'data-transition', transition);
  } else {
    removeAttribute(el, 'data-transition');
  }
  if (speed !== undefined) {
    if (speed !== null) {
      setAttribute(el, 'data-transition-speed', speed);
    } else {
      removeAttribute(el, 'data-transition-speed');
    }
  }
}

// ── Deck-level transition ops ────────────────────────────────────────────────

/**
 * Locate the `<div class="reveal">` root element in the model.
 * This is where deck-level transition preferences are stored as data attributes.
 * Returns `null` if the reveal div is not found (malformed deck).
 */
function findRevealDiv(model: DeckModel): ElementNode | null {
  let found: ElementNode | null = null;
  walk(model, (node) => {
    if (found || node.type !== 'element') return;
    if (node.tagName.toLowerCase() === 'div') {
      const cls = getAttribute(node, 'class') ?? '';
      if (cls.split(/\s+/).includes('reveal')) found = node;
    }
  });
  return found;
}

/**
 * Read the deck-level transition preferences from the `<div class="reveal">`.
 * Returns `null` for any attribute that is absent (reveal uses its built-in default).
 */
export function getDeckTransition(model: DeckModel): {
  transition: TransitionType | null;
  speed: TransitionSpeed | null;
} {
  const revealDiv = findRevealDiv(model);
  if (!revealDiv) return { transition: null, speed: null };
  const t = getAttribute(revealDiv, 'data-transition');
  const s = getAttribute(revealDiv, 'data-transition-speed');
  return {
    transition: (t as TransitionType | null) ?? null,
    speed: (s as TransitionSpeed | null) ?? null,
  };
}

/**
 * Set the deck-level transition preference on the `<div class="reveal">`.
 *
 * The companion slides-layout-init.js picks up these attributes at runtime and
 * calls `Reveal.configure({ transition, transitionSpeed })` after Reveal is ready,
 * overriding the hardcoded transition in the Reveal.initialize() call (which
 * lives in a passthrough <script> we cannot modify from the model layer).
 *
 * Passing `null` for `transition` removes the attribute (reverts to the
 * hardcoded Reveal.initialize default).  Passing `undefined` for `speed` leaves
 * the existing value unchanged.
 *
 * Returns `false` when the reveal div is not found (no-op, safe to ignore).
 */
export function setDeckTransition(
  model: DeckModel,
  transition: TransitionType | null,
  speed?: TransitionSpeed | null,
): boolean {
  const revealDiv = findRevealDiv(model);
  if (!revealDiv) return false;
  if (transition !== null) {
    setAttribute(revealDiv, 'data-transition', transition);
  } else {
    removeAttribute(revealDiv, 'data-transition');
  }
  if (speed !== undefined) {
    if (speed !== null) {
      setAttribute(revealDiv, 'data-transition-speed', speed);
    } else {
      removeAttribute(revealDiv, 'data-transition-speed');
    }
  }
  return true;
}
