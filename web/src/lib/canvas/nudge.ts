/**
 * nudge.ts — Keyboard-nudge delta + guard logic (P3-9 / spec canvas-interaction "Keyboard nudge").
 *
 * WHY THIS EXISTS (spec canvas-interaction: "arrows = 1 logical unit; Shift+arrows = 10"):
 * ========================================================================
 * Arrow keys move the current selection in LOGICAL units (spec scaling-and-resolution) so the nudge
 * amount is independent of editor zoom — pressing → always moves the element 1
 * logical unit regardless of how the canvas is scaled on screen.
 *
 * Two element kinds get different nudge semantics (spec canvas-interaction "Two drag semantics"):
 *   • FREE element (`data-free`)  → arrows adjust its logical data-x/data-y.
 *   • STRUCTURED element          → up/left and down/right reorder it ±1 among
 *                                    its siblings (geometric position is owned by
 *                                    the layout, so "nudge" maps to reorder).
 *
 * These are pure functions of (key, modifiers); the store command (and the drag
 * controller's keydown handler) decide which to apply based on classify(). Kept
 * DOM-free so they are unit-testable headless.
 */

/** Nudge step sizes in LOGICAL units (spec canvas-interaction). */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

/** The four arrow keys we act on (KeyboardEvent.key values). */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** True when `key` is one of the four arrow keys. */
export function isArrowKey(key: string): boolean {
  return ARROW_KEYS.has(key);
}

/** A 2-D logical translation produced by an arrow press. */
export interface NudgeDelta {
  dx: number;
  dy: number;
}

/**
 * Compute the logical translation for a FREE element from an arrow press.
 *
 * Shift selects the large step (10) vs the fine step (1), matching spec canvas-interaction.
 * Returns `null` for non-arrow keys so the caller can ignore the event (and let
 * it bubble to other handlers).
 */
export function freeNudgeDelta(key: string, shift: boolean): NudgeDelta | null {
  if (!isArrowKey(key)) return null;
  const step = shift ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (key) {
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    default:
      return null;
  }
}

/**
 * Compute the reorder direction for a STRUCTURED element from an arrow press.
 *
 *   ArrowUp / ArrowLeft   → -1 (move one slot earlier among siblings)
 *   ArrowDown / ArrowRight → +1 (move one slot later)
 *
 * The magnitude is always one slot (Shift has no larger meaning for discrete
 * reordering). Returns `0` for non-arrow keys (no-op).
 */
export function reorderNudgeDirection(key: string): -1 | 0 | 1 {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      return -1;
    case 'ArrowDown':
    case 'ArrowRight':
      return 1;
    default:
      return 0;
  }
}

/**
 * The minimal shape of a focused element we need to decide whether a keypress is
 * "text editing" (and therefore must NOT be hijacked as a nudge). Real DOM
 * elements satisfy this; tests pass lightweight fakes.
 */
export interface FocusTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  /** CSS `closest()` — used to detect a CodeMirror editor ancestor. */
  closest?: (selector: string) => unknown;
}

/** Form/text-entry tags whose own key handling must win over nudge. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True when the keyboard focus is in a text-editing context where arrow keys
 * mean "move the caret", not "nudge the selection" (spec canvas-interaction guard).
 *
 * Covers:
 *   • a P2-5 in-place contenteditable session (passed via `editing`),
 *   • native form inputs / textareas / selects,
 *   • any `contenteditable` element,
 *   • CodeMirror 6 (the Source pane) — detected by the `.cm-editor` ancestor
 *     class (CodeMirror's own arrow-key handling must not be stolen).
 */
export function isEditingContext(target: FocusTargetLike | null, editing: boolean): boolean {
  if (editing) return true;
  if (!target) return false;
  if (target.tagName && TEXT_ENTRY_TAGS.has(target.tagName.toUpperCase())) return true;
  if (target.isContentEditable) return true;
  if (typeof target.closest === 'function' && target.closest('.cm-editor')) return true;
  return false;
}
