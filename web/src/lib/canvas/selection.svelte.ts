/**
 * selection.svelte.ts — Canvas selection store (P2-3, extended P4-5/6).
 *
 * WHY THIS EXISTS (spec 04 "Selection"):
 * ======================================
 * Selection is shared state: the canvas overlay draws the box, the outline /
 * properties panels reflect and drive it, and editor hotkeys act on it.
 * One deck is open at a time, so a single module-level store — addressed by
 * stable `data-eid` values rather than DOM node references — is the source of
 * truth. Using eids (not element refs) means selection survives an iframe
 * reload: after a save the iframe is recreated, but the same eid still
 * identifies the same node.
 *
 * MULTI-SELECT DESIGN (P4-5/6):
 * ==============================
 * The store now maintains a **selection set** of eids rather than a single eid.
 * Backward compatibility is preserved: all existing callers that used `.select()`,
 * `.eid`, and `.clear()` continue to work unchanged.
 *
 * Selection set semantics:
 *   - The first eid added becomes the **primary** (anchor for property panels).
 *   - `.select(eid)` replaces the entire set with just that eid (single-select).
 *   - `.add(eid)` extends the set; primary stays the first if already set.
 *   - `.remove(eid)` shrinks the set; if primary is removed, the new primary
 *     is the remaining first eid (or null if the set becomes empty).
 *   - `.toggle(eid)` adds if absent, removes if present.
 *   - `.set(eids[])` replaces the entire selection; first eid → primary.
 *   - `.clear()` empties the set and clears primary.
 *
 * `.eid` is a GETTER returning `.primary` — backward-compatible with all
 * single-select callers that read `selectionStore.eid`.
 *
 * `.svelte.ts` so the `$state` runes give every consumer fine-grained
 * reactivity.
 */

class SelectionStore {
  /**
   * Ordered array of selected eids. First element is the primary (anchor).
   * Internal state — consumers should use the getters/methods below.
   *
   * WHY an array rather than a Set:
   *   Svelte 5 $state tracks value by reference; replacing the array triggers
   *   reactivity without needing SvelteSet. The array also preserves insertion
   *   order so the primary (first-added) is stable.
   */
  private _eids = $state<string[]>([]);

  /**
   * The primary (anchor) eid — drives the properties panel; null when nothing
   * is selected. Kept separate from _eids[0] so it can be set independently
   * (e.g. Shift+click on existing selection changes primary without changing set).
   */
  private _primary = $state<string | null>(null);

  /**
   * True while the selected leaf is in an in-place contenteditable session
   * (P2-5). The overlay dims/steps aside while editing, and panels show an
   * "editing" affordance.
   */
  editing = $state(false);

  // ── Getters ────────────────────────────────────────────────────────────────

  /**
   * Backward-compat getter: the primary selected eid, or null.
   *
   * Existing single-select callers read `selectionStore.eid` — this getter
   * preserves that contract while the store now tracks a full set.
   */
  get eid(): string | null {
    return this._primary;
  }

  /**
   * The primary (anchor) eid — same as `.eid` but self-documenting for new
   * code that is explicitly multi-select-aware.
   */
  get primary(): string | null {
    return this._primary;
  }

  /**
   * All currently selected eids in insertion order (primary first).
   * Returns a snapshot array — callers must not mutate it.
   */
  get eids(): string[] {
    return this._eids;
  }

  // ── Mutation methods ────────────────────────────────────────────────────────

  /**
   * Single-select: replace the entire selection with just `eid`.
   *
   * Backward-compatible: all existing canvas-click callers use this.
   * Selecting a different node exits any in-place edit session.
   */
  select(eid: string): void {
    // No-op if already the sole selection (prevents spurious reactive updates).
    if (this._primary === eid && this._eids.length === 1) return;
    this._eids = [eid];
    this._primary = eid;
    this.editing = false;
  }

  /**
   * Add an eid to the selection set without clearing the rest.
   *
   * If the eid is already in the set, this is a no-op (idempotent).
   * If the set was empty, the added eid also becomes the primary.
   * Does NOT exit editing — the caller decides (multi-select while editing
   * is an unusual UX edge; the caller should call setEditing(false) if needed).
   */
  add(eid: string): void {
    if (this._eids.includes(eid)) return; // already in set
    this._eids = [...this._eids, eid];
    if (this._primary === null) {
      this._primary = eid;
    }
  }

  /**
   * Remove an eid from the selection set.
   *
   * If the removed eid was the primary, the new primary becomes the first
   * remaining eid (or null if the set becomes empty).
   * No-op if the eid is not in the set.
   */
  remove(eid: string): void {
    if (!this._eids.includes(eid)) return;
    const next = this._eids.filter((e) => e !== eid);
    this._eids = next;
    if (this._primary === eid) {
      this._primary = next.length > 0 ? next[0] : null;
    }
    if (next.length === 0) this.editing = false;
  }

  /**
   * Toggle the selection state of `eid`: add if absent, remove if present.
   *
   * This is the standard Shift+click / Cmd+click multi-select gesture.
   */
  toggle(eid: string): void {
    if (this._eids.includes(eid)) {
      this.remove(eid);
    } else {
      this.add(eid);
    }
  }

  /**
   * Replace the entire selection set with the given array of eids.
   *
   * The first eid in the array becomes the primary. Passing an empty array
   * is equivalent to `.clear()`.
   */
  set(eids: string[]): void {
    this._eids = [...eids];
    this._primary = eids.length > 0 ? eids[0] : null;
    this.editing = false;
  }

  /**
   * Clear all selection (click on empty space). Also exits editing.
   *
   * Backward-compatible: the original API had this exact signature.
   */
  clear(): void {
    this._eids = [];
    this._primary = null;
    this.editing = false;
  }

  /**
   * Mark that the selected node has entered or left an in-place edit session.
   *
   * Backward-compatible: callers pass `true` on focus, `false` on blur/commit.
   */
  setEditing(value: boolean): void {
    this.editing = value;
  }
}

/**
 * Singleton — one open deck, one selection. Shared by the canvas interaction
 * layer and any panel that reads/sets selection.
 */
export const selectionStore = new SelectionStore();
