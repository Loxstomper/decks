/**
 * undo.svelte.ts — Svelte-reactive wrapper around UndoHistory (P2-8).
 *
 * WHY A THIN WRAPPER:
 * ===================
 * Svelte 5's $state runes are compiled by the Svelte vite plugin.  Putting them
 * here (a .svelte.ts file) while keeping the stack algorithm in the plain
 * undo-history.ts module gives us:
 *
 *   • Testability: pure logic in undo-history.ts has no rune dependency and can
 *     be imported into .test.ts files without the Svelte compiler.
 *   • Reactivity: UI components (toolbar, keyboard shortcuts) read `canUndo` /
 *     `canRedo` reactively; the $state vars here are the reactive source.
 *
 * USAGE (Lane B / integrators):
 * ==============================
 * Don't call undoStore directly — go through deckStore which owns the full
 * command lifecycle (adoptSnapshot + save + undoStore bookkeeping):
 *
 *   import { deckStore } from '$lib/store/deck.svelte';
 *   // After a structural model edit:
 *   deckStore.updateFromModel();
 *   await deckStore.commitCommand();   // → push snapshot + persist
 *   // Keyboard shortcut:
 *   await deckStore.undo();            // → restore + persist
 *   await deckStore.redo();            // → reapply + persist
 */

import { UndoHistory } from './undo-history';

class UndoStore {
  readonly #history = new UndoHistory();

  // $state mirrors so Svelte components react to canUndo/canRedo changes
  // without iterating the whole snapshot array in a $derived.
  #canUndo = $state(false);
  #canRedo = $state(false);

  // ── Public reactive getters (consumed by toolbar, menu, keybindings) ─────

  get canUndo(): boolean {
    return this.#canUndo;
  }

  get canRedo(): boolean {
    return this.#canRedo;
  }

  // ── Internal sync helper ─────────────────────────────────────────────────

  /** Sync $state mirrors from the underlying history after every mutation. */
  #sync(): void {
    this.#canUndo = this.#history.canUndo;
    this.#canRedo = this.#history.canRedo;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Seed / clear history with the given source.  Called by deckStore whenever
   * a deck is freshly loaded (initial load or clean external adoption from SSE).
   * Clears any previous undo history so undo cannot jump across deck lifetimes.
   */
  reset(source: string): void {
    this.#history.reset(source);
    this.#sync();
  }

  // ── Stack mutations ──────────────────────────────────────────────────────

  /**
   * Push a committed-command snapshot.  Clears the redo stack and advances the
   * cursor.  Idempotent: identical consecutive pushes are no-ops (the history
   * class enforces this).
   */
  push(source: string): void {
    this.#history.push(source);
    this.#sync();
  }

  /**
   * Move to the previous snapshot and return it, or `undefined` if already at
   * the beginning of history.  The caller (deckStore.undo) adopts the returned
   * bytes and persists them.
   */
  stepBack(): string | undefined {
    const snap = this.#history.stepBack();
    this.#sync();
    return snap;
  }

  /**
   * Move to the next snapshot and return it, or `undefined` if there is nothing
   * to redo.
   */
  stepForward(): string | undefined {
    const snap = this.#history.stepForward();
    this.#sync();
    return snap;
  }
}

/**
 * Module-level singleton — one session, one undo stack.  Components import
 * `canUndo` / `canRedo` from here for reactive UI state.  All mutations go
 * through deckStore (which coordinates save + model refresh + undoStore bookkeeping).
 */
export const undoStore = new UndoStore();
