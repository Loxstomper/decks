/**
 * undo-history.ts — Pure (no Svelte runes) snapshot stack (P2-8).
 *
 * WHY SEPARATE FROM THE REACTIVE WRAPPER:
 * ========================================
 * The snapshot algorithm is pure data-structure logic: a bounded cursor-in-array
 * structure. Keeping it here (a plain .ts module) lets vitest test it without
 * needing the Svelte compiler to process $state runes.  The reactive wrapper in
 * undo.svelte.ts reads `.canUndo` / `.canRedo` after each mutation and syncs them
 * into $state so Svelte components react automatically.
 *
 * APPROACH:
 * =========
 * We maintain one flat array of snapshots and a cursor.  The cursor always points
 * to the "current" snapshot (what is on screen right now).
 *
 *   history.snapshots = [ S0, S1, S2, S3 ]
 *   history.cursor    =              ^^^  3  (on S3)
 *
 * After undo: cursor moves to 2 → restore S2, S3 is still in the array (redo
 * available).  After a NEW command is committed while cursor < length-1, we
 * truncate forward history (redo stack cleared) then push the new snapshot.
 *
 * The stack is bounded to MAX_HISTORY entries.  When the limit is hit we drop
 * the OLDEST snapshot (index 0) and adjust the cursor — the user loses the
 * ability to undo all the way back to the very first state, which is acceptable
 * since git keeps durable history (spec project-structure).
 */

/** Maximum number of snapshots retained in the undo stack (session-only). */
export const MAX_HISTORY = 100;

export class UndoHistory {
  readonly snapshots: string[] = [];
  cursor = -1;

  // ── Derived state (cheap recompute) ──────────────────────────────────────

  /** True when there is a previous snapshot to restore. */
  get canUndo(): boolean {
    return this.cursor > 0;
  }

  /** True when there is a next snapshot to reapply. */
  get canRedo(): boolean {
    return this.cursor < this.snapshots.length - 1;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Seed the history with the initial deck source (called on load / external
   * adoption).  Clears any previous session history so undo cannot cross deck
   * boundaries.
   */
  reset(source: string): void {
    this.snapshots.length = 0;
    this.snapshots.push(source);
    this.cursor = 0;
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Record `source` as a committed command snapshot.
   *
   * The current-cursor snapshot (what was on screen before the command) stays
   * in place; we push `source` immediately after it and advance the cursor.
   * Any "future" snapshots beyond the old cursor are discarded (a new command
   * always invalidates the redo stack).
   *
   * If the incoming snapshot is identical to the current one we skip the push
   * (idempotent — e.g. two rapid commits of the same bytes).
   */
  push(source: string): void {
    // Guard: don't push a no-op snapshot
    if (this.cursor >= 0 && this.snapshots[this.cursor] === source) return;

    // Truncate any redo future
    this.snapshots.splice(this.cursor + 1);
    this.snapshots.push(source);

    // Enforce the cap: drop the oldest entry and keep cursor consistent
    if (this.snapshots.length > MAX_HISTORY) {
      this.snapshots.splice(0, this.snapshots.length - MAX_HISTORY);
    }
    this.cursor = this.snapshots.length - 1;
  }

  /**
   * Move the cursor one step back and return the restored snapshot, or
   * `undefined` if already at the beginning of history.
   */
  stepBack(): string | undefined {
    if (!this.canUndo) return undefined;
    this.cursor--;
    return this.snapshots[this.cursor];
  }

  /**
   * Move the cursor one step forward and return the reapplied snapshot, or
   * `undefined` if there is nothing to redo.
   */
  stepForward(): string | undefined {
    if (!this.canRedo) return undefined;
    this.cursor++;
    return this.snapshots[this.cursor];
  }
}
