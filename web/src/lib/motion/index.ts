/**
 * motion/index.ts — Public surface of the motion library (P6-7, P6-8, P6-9 / spec 07).
 *
 * Exports all pure model operations for fragments, transitions, and auto-animate.
 * The store commands in deck.svelte.ts import from here and wrap these ops in
 * the standard "mutate model → updateFromModel → commitCommand" pattern so they
 * become undoable autosaved commands (spec 12 byte-stable).
 */

// ── Fragments (P6-7) ─────────────────────────────────────────────────────────
export {
  toggleFragment,
  setFragmentIndex,
  setFragmentStyle,
  getFragmentIndex,
  getFragmentStyle,
  getFragmentsInSlide,
  isFragment,
  addClassToken,
  removeClassToken,
  hasClassToken,
  FRAGMENT_STYLES,
} from './fragments';
export type { FragmentStyle, FragmentInfo } from './fragments';

// ── Transitions (P6-8) ───────────────────────────────────────────────────────
export {
  getSlideTransition,
  setSlideTransition,
  getDeckTransition,
  setDeckTransition,
  TRANSITION_TYPES,
  TRANSITION_SPEEDS,
} from './transitions';
export type { TransitionType, TransitionSpeed } from './transitions';

// ── Auto-animate (P6-9) ──────────────────────────────────────────────────────
export {
  enableAutoAnimate,
  disableAutoAnimate,
  hasAutoAnimate,
} from './auto-animate';
