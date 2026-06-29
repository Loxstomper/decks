/**
 * selection.svelte.ts — Canvas selection store (P2-3).
 *
 * WHY THIS EXISTS (spec 04 "Selection"):
 * ======================================
 * Selection is shared state: the canvas overlay draws the box, the (future)
 * properties/outline panels reflect and drive it, and editor hotkeys act on it.
 * One deck is open at a time, so a single module-level store — addressed by the
 * stable `data-eid` rather than a DOM node reference — is the source of truth.
 * Using the eid (not an element) means the selection survives an iframe reload:
 * after a save the iframe is recreated, but the same eid still identifies the
 * same node, so the overlay can re-acquire it.
 *
 * `.svelte.ts` so the `$state` runes give every consumer fine-grained
 * reactivity.
 */

class SelectionStore {
  /** The `data-eid` of the selected leaf, or null when nothing is selected. */
  eid = $state<string | null>(null);

  /**
   * True while the selected leaf is in an in-place contenteditable session
   * (P2-5). The overlay dims/steps aside while editing so it never fights the
   * caret, and panels can show an "editing" affordance.
   */
  editing = $state(false);

  /** Select a leaf by eid. Selecting a different node exits any edit session. */
  select(eid: string): void {
    if (this.eid !== eid) {
      this.eid = eid;
      this.editing = false;
    }
  }

  /** Clear selection (click on empty space). Also exits editing. */
  clear(): void {
    this.eid = null;
    this.editing = false;
  }

  /** Mark that the selected node has entered/left an edit session. */
  setEditing(value: boolean): void {
    this.editing = value;
  }
}

/**
 * Singleton — one open deck, one selection. Shared by the canvas interaction
 * layer and any panel that reads/sets selection.
 */
export const selectionStore = new SelectionStore();
