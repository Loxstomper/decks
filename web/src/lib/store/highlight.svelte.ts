/**
 * highlight.svelte.ts — External-change highlight store (P8-7 / spec claude-code-integration).
 *
 * WHY THIS EXISTS:
 * ================
 * After the editor adopts an external (Claude Code) write it diffs the previous
 * model against the reloaded one (model/diff.ts) and asks this store to FLASH the
 * changed elements. Both the canvas (ChangeHighlightOverlay, which outlines the
 * eids inside the iframe) and the outline panel read this store so the human can
 * instantly see "what Claude changed" (spec claude-code-integration "highlight what Claude changed").
 *
 * The store holds the set of currently-highlighted eids plus, per eid, WHICH
 * kind of change it was ('added' | 'changed') so consumers can colour them
 * differently. Removed eids are intentionally NOT highlighted on the canvas
 * (the element no longer exists to outline) but ARE exposed via `removed` so the
 * outline / a toast can mention them.
 *
 * The highlight auto-clears after {@link HIGHLIGHT_MS} so it is a transient
 * "flash", not persistent decoration. The timer is injectable-free (uses the
 * ambient setTimeout) but `clear()` lets callers cancel it (e.g. when the user
 * switches decks).
 */

import type { ModelDiff } from '$lib/model/diff';

/** How long (ms) an external-change flash stays visible before auto-clearing. */
export const HIGHLIGHT_MS = 2600;

/** Kind of change for a highlighted eid (drives colour in the overlay). */
export type HighlightKind = 'added' | 'changed';

class HighlightStore {
  /**
   * eid → kind for every element currently flashing. Reactive: components read
   * this in `$derived` / `$effect` to add/remove their flash decoration.
   */
  marks = $state<Map<string, HighlightKind>>(new Map());

  /** eids that were removed in the last external change (cannot be outlined). */
  removed = $state<string[]>([]);

  /**
   * Bumped on every flash() so consumers that paint into the iframe (which is
   * itself reloading) can re-run their effect even if `marks` is referentially
   * compared — a fresh nonce guarantees re-application after the reload settles.
   */
  nonce = $state(0);

  #timer: ReturnType<typeof setTimeout> | null = null;

  /** True when any element is currently highlighted. */
  get active(): boolean {
    return this.marks.size > 0;
  }

  /** The kind for a given eid, or null when it is not currently highlighted. */
  kindOf(eid: string): HighlightKind | null {
    return this.marks.get(eid) ?? null;
  }

  /** True when `eid` is currently highlighted. */
  has(eid: string): boolean {
    return this.marks.has(eid);
  }

  /**
   * Flash the elements named by a {@link ModelDiff}: added + changed eids are
   * highlighted (added first so the kind map prefers 'added' on the rare overlap
   * — an eid cannot be both, but be defensive). Resets the auto-clear timer.
   *
   * A no-op diff clears any existing highlight (nothing changed → nothing to
   * show), keeping the indicator honest.
   */
  flash(diff: ModelDiff): void {
    const next = new Map<string, HighlightKind>();
    for (const eid of diff.changed) next.set(eid, 'changed');
    for (const eid of diff.added) next.set(eid, 'added');

    this.marks = next;
    this.removed = [...diff.removed];
    this.nonce++;

    if (this.#timer) clearTimeout(this.#timer);
    if (next.size === 0 && diff.removed.length === 0) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.clear();
    }, HIGHLIGHT_MS);
  }

  /** Immediately clear all highlights (e.g. deck switch, or timer fired). */
  clear(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.marks.size > 0) this.marks = new Map();
    if (this.removed.length > 0) this.removed = [];
  }
}

/**
 * Singleton — one deck is open at a time, so a single shared highlight store is
 * read by the canvas overlay and the outline panel.
 */
export const highlightStore = new HighlightStore();
