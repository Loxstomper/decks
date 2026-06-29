/**
 * deck.svelte.ts — Current-deck store (P1-3, P1-8, P1-9, P2-7, P2-8).
 *
 * WHY THIS EXISTS (specs 02, 11):
 * ================================
 * One deck is open at a time. This store is the single source of truth that
 * binds together the three Phase-1 surfaces:
 *
 *   • SourcePane (CodeMirror) — edits `source` (the raw HTML text the user types).
 *   • RevealFrame (iframe)    — renders /decks/{name}/deck.html from the server,
 *                               reloaded whenever the on-disk bytes change.
 *   • the document model      — parseDeck(source), kept in sync for the outline /
 *                               properties panels that arrive in later phases.
 *
 * Data-flow invariants:
 *   1. `source` is canonical for what the user is editing. We SAVE the exact
 *      bytes of `source` (never a re-serialization) so the byte-stable
 *      round-trip invariant (spec 12 #4) is preserved end-to-end.
 *   2. `model` is a *derived* view, recomputed (debounced) from `source`. A parse
 *      failure never throws into the UI — the last good model is retained.
 *   3. The canvas reflects the SERVER copy. We only bump `reloadNonce` (which the
 *      shell turns into an iframe reload) AFTER a successful PUT, so the iframe
 *      always shows persisted, well-formed bytes rather than mid-keystroke HTML.
 *
 * Turn-taking (spec 11 §4/§5): an external write (Claude Code) arrives via SSE.
 * onExternalChange() re-reads the disk copy. If the user has no unsaved edits we
 * adopt it and re-render; if they DO have unsaved edits we surface the `external`
 * status instead of clobbering their work (no silent merge in v1).
 *
 * Undo/redo (P2-8, P2-7):
 * ========================
 * commitCommand() is the canonical way to record a "committed edit" — it pushes
 * the current source into the undoStore snapshot stack and immediately persists
 * to disk (bypassing the debounce).  undo() / redo() restore the adjacent
 * snapshot and also persist immediately, so disk always reflects the current
 * undo position.  The SSE echo of our own PUT is already filtered out by
 * onExternalChange() (html === source → no-op), preventing feedback loops.
 *
 * What counts as a "command":
 *   • Any structural model edit performed by Lane B (write-back panel): call
 *     updateFromModel() to sync source, then commitCommand().
 *   • Keystroke sequences in the SourcePane do NOT use commitCommand(); they use
 *     the debounced updateFromSource() path which saves automatically but does
 *     not produce individual undo entries (that would flood the stack).
 */

import {
  parseDeck,
  serializeDeck,
  stampEids,
  findByEid,
  getAttribute,
  setAttribute,
  setLayoutProps,
  toggleFree,
  findParentOf,
  getSlideNotes,
  setSlideNotes as setSlideNotesOp,
  type DeckModel,
  type ElementNode,
  type LayoutProps,
  type LogicalRect,
} from '$lib/model';
import {
  addSlide as addSlideOp,
  duplicateSlide as duplicateSlideOp,
  deleteSlide as deleteSlideOp,
  moveSlide as moveSlideOp,
  moveVerticalSlide as moveVerticalSlideOp,
  nestSlide as nestSlideOp,
  promoteSlide as promoteSlideOp,
  setSlideHidden as setSlideHiddenOp,
} from '$lib/slides';
import { undoStore } from './undo.svelte';
import { selectionStore } from '$lib/canvas/selection.svelte';
import { applyTextEditToModel } from '$lib/canvas/writeback';
import { setFreePosition } from '$lib/canvas/free-position';
import {
  toggleFragment as toggleFragmentOp,
  setFragmentIndex as setFragmentIndexOp,
  setFragmentStyle as setFragmentStyleOp,
  setSlideTransition as setSlideTransitionOp,
  setDeckTransition as setDeckTransitionOp,
  enableAutoAnimate as enableAutoAnimateOp,
  disableAutoAnimate as disableAutoAnimateOp,
  type FragmentStyle,
  type TransitionType,
  type TransitionSpeed,
} from '$lib/motion';

/** Debounce window for re-parse + autosave after a source edit (P1-8). */
const SYNC_DEBOUNCE_MS = 400;

/**
 * Status surfaced to the UI (spec 11 §5 "synced / external change / unsaved").
 *   empty    — no deck open.
 *   synced   — source matches the on-disk copy.
 *   unsaved  — local edits pending the debounced autosave.
 *   saving   — a PUT is in flight.
 *   external — an external write happened while we had unsaved edits (conflict).
 *   error    — last load/save failed.
 */
export type DeckStatus = 'empty' | 'synced' | 'unsaved' | 'saving' | 'external' | 'error';

/** Parse without throwing; callers keep the previous model on failure. */
function safeParse(html: string): DeckModel | null {
  try {
    return parseDeck(html);
  } catch {
    return null;
  }
}

class DeckStore {
  /** Name of the open deck, or null when none is open. */
  name = $state<string | null>(null);
  /** Raw HTML source — controlled value for the SourcePane. */
  source = $state('');
  /** Parsed document model (derived from `source`, debounced). */
  model = $state<DeckModel | null>(null);
  /** Coarse sync status for the status indicator. */
  status = $state<DeckStatus>('empty');
  /** True while a deck is being fetched. */
  loading = $state(false);
  /** Last error message, if any. */
  error = $state<string | null>(null);
  /**
   * Monotonic counter bumped whenever the on-disk file changes (initial load,
   * successful save, or adopted external change). The shell watches this and
   * reloads the iframe so the canvas mirrors persisted bytes.
   */
  reloadNonce = $state(0);

  /** Last bytes known to be on disk — distinguishes "unsaved" from "synced". */
  #savedSource = '';
  /** Pending debounced sync handle. */
  #syncTimer: ReturnType<typeof setTimeout> | null = null;

  /** URL the iframe loads; empty when no deck is open. */
  get deckUrl(): string {
    return this.name ? `/decks/${encodeURIComponent(this.name)}/deck.html` : '';
  }

  /** True when `source` differs from the on-disk copy. */
  get dirty(): boolean {
    return this.source !== this.#savedSource;
  }

  /** Load a deck by name: GET its HTML, parse it, render it. */
  async load(name: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(name)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`load failed: HTTP ${res.status}`);
      const html = await res.text();
      this.name = name;
      this.#adoptDisk(html);
      this.status = 'synced';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Adopt `html` as the new on-disk truth: reset source + saved snapshot, parse,
   * and request a canvas reload. Used by load() and by clean external changes.
   *
   * Also resets the undo history (P2-8): a fresh load or an adopted external
   * change is the new ground state — the user cannot undo "past" it.
   */
  #adoptDisk(html: string): void {
    // Disk truth is whatever bytes we just read.
    this.#savedSource = html;

    const model = safeParse(html);
    this.model = model;

    // P2-2: stamp a stable data-eid onto every managed element (container/leaf/
    // free) so the canvas can resolve clicks → model nodes and write edits back.
    // stampEids is IDEMPOTENT: a deck that is already fully stamped serializes
    // byte-for-byte identically, so subsequent loads cause zero churn (the
    // `stamped !== html` guard below stays false). The ONLY time this diverges
    // from disk is the first load of an un-stamped deck (or one Claude Code
    // wrote new un-stamped elements into) — we then persist that one-time
    // normalization so the rendered server copy carries the eids.
    let source = html;
    if (model) {
      stampEids(model);
      const stamped = serializeDeck(model);
      if (stamped !== html) source = stamped;
    }
    this.source = source;
    this.reloadNonce++;
    // Seed the undo stack with the (possibly stamped) baseline so the user can
    // neither undo past it nor undo the structural eid stamping itself.
    undoStore.reset(source);

    // Stamping added eids → in-memory source diverges from disk. Persist it once
    // (bypassing the debounce) so the canvas, which renders the *server* copy,
    // shows the stamped elements. save() bumps reloadNonce again on success.
    if (source !== html) {
      this.status = 'unsaved';
      void this.save();
    }
  }

  // ── Undo/redo public API (P2-8, P2-7) ────────────────────────────────────

  /**
   * Expose the undo store's reactive canUndo flag so consumers only need to
   * import deckStore (not also undoStore).
   */
  get canUndo(): boolean {
    return undoStore.canUndo;
  }

  /** Expose the undo store's reactive canRedo flag. */
  get canRedo(): boolean {
    return undoStore.canRedo;
  }

  /**
   * P2-8 / P2-7: Record the current source as a committed command and persist
   * immediately to disk (bypassing the keystroke debounce).
   *
   * Contract:
   *   1. The caller has already mutated the model and called updateFromModel()
   *      (or equivalent) so that `this.source` holds the post-command bytes.
   *   2. commitCommand() pushes those bytes onto the undo stack and saves.
   *   3. One call = one undo entry = one on-disk state.
   *
   * Typical Lane B pattern:
   *   setAttribute(el, 'class', 'fragment');
   *   deckStore.updateFromModel();
   *   await deckStore.commitCommand();
   */
  async commitCommand(): Promise<void> {
    // Push BEFORE saving so that if save() fails the snapshot is still recorded
    // (the user can undo back to the pre-command state even without disk sync).
    undoStore.push(this.source);
    // Cancel any pending debounced sync — the commit takes over persistence.
    if (this.#syncTimer) {
      clearTimeout(this.#syncTimer);
      this.#syncTimer = null;
    }
    await this.save();
  }

  /**
   * P2-8 / P2-7: Restore the previous snapshot (undo).
   * No-op when already at the beginning of history (canUndo === false).
   * Persists the restored state so disk always matches the current undo position.
   */
  async undo(): Promise<void> {
    const snapshot = undoStore.stepBack();
    if (snapshot === undefined) return;
    this.#applySnapshotLocally(snapshot);
    await this.save();
  }

  /**
   * P2-8 / P2-7: Reapply the next snapshot (redo).
   * No-op when already at the tip of history (canRedo === false).
   * Persists the reapplied state.
   */
  async redo(): Promise<void> {
    const snapshot = undoStore.stepForward();
    if (snapshot === undefined) return;
    this.#applySnapshotLocally(snapshot);
    await this.save();
  }

  /**
   * Apply a snapshot into memory (source + model) without touching the saved
   * baseline or the undo stack.  The caller must follow up with save() to
   * persist and update #savedSource + reloadNonce.
   *
   * WHY NOT CALL save() HERE:
   * The undo stack has already been updated (cursor moved) before this is called,
   * so if save() fails we still have a consistent in-memory state and the user
   * can retry.  Separating concerns also makes the save step mockable in tests.
   */
  #applySnapshotLocally(source: string): void {
    // Cancel any in-flight debounced sync — the restored snapshot supersedes it.
    if (this.#syncTimer) {
      clearTimeout(this.#syncTimer);
      this.#syncTimer = null;
    }
    this.source = source;
    this.model = safeParse(source);
    // Mark unsaved so save() knows it has real work to do (it checks
    // source !== #savedSource).
    this.status = 'unsaved';
  }

  /**
   * P1-8: the user edited the source pane. Update `source` synchronously (so the
   * controlled CodeMirror value stays consistent), then debounce the heavier
   * re-parse + autosave + re-render.
   */
  updateFromSource(next: string): void {
    if (next === this.source) return;
    this.source = next;
    if (this.name) this.status = 'unsaved';
    this.#scheduleSync();
  }

  /**
   * Reserialize the model into `source` after a structural edit (outline /
   * properties panels in later phases) and schedule a save. Kept here so all
   * mutation paths funnel through the same debounce + autosave machinery.
   */
  updateFromModel(): void {
    if (!this.model) return;
    const next = serializeDeck(this.model);
    if (next === this.source) return;
    this.source = next;
    this.status = 'unsaved';
    this.#scheduleSync();
  }

  /**
   * P2-6: Canvas write-back of a committed in-place text edit.
   *
   * The CanvasInteraction controller calls this when a contenteditable session
   * commits. We mutate ONLY the node carrying `eid` (writeback.ts → edit.ts), so
   * just that subtree goes dirty and the rest of the deck round-trips byte-for-
   * byte (spec 12 #4). We then funnel through the standard command path so the
   * edit becomes one undo entry and is persisted immediately:
   *   updateFromModel()  → reserialize model into source
   *   commitCommand()    → push undo snapshot + save (bypassing the debounce)
   *
   * Returns false (and does nothing) if the eid is unknown — e.g. a stale
   * selection after an external reload — so the caller can no-op safely.
   */
  applyTextEdit(eid: string, newLiteralText: string): boolean {
    if (!this.model) return false;
    const changed = applyTextEditToModel(this.model, eid, newLiteralText);
    if (!changed) return false;
    const next = serializeDeck(this.model);
    // No-op edit (text identical) → don't churn source / undo stack.
    if (next === this.source) return true;
    this.updateFromModel();
    void this.commitCommand();
    return true;
  }

  /**
   * P3-4 (properties panel): apply a layout-prop delta to the container with
   * `eid` as ONE undo entry + one autosave.
   *
   * The properties panel (Lane C) fires onApplyLayoutChange → this method. We
   * mutate ONLY the targeted element's data-* attrs via setLayoutProps (which
   * marks just that subtree dirty), reserialize, and commit. Untouched siblings
   * round-trip byte-for-byte (spec 12 #4). Unknown eid is a safe no-op — a stale
   * selection after an external reload must not throw into the UI.
   */
  async applyLayoutChange(eid: string, delta: Partial<LayoutProps>): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;
    setLayoutProps(el, delta); // validates + marks the element dirty
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P3-4 "Equal columns/rows": set data-grow="1" on every element child of the
   * container so a row/stack distributes free space evenly (spec 03 intent,
   * no pixel arithmetic). One undo entry + one autosave. Unknown eid = no-op.
   */
  async applyEqualColumns(containerEid: string): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, containerEid);
    if (!el) return;
    for (const child of el.children) {
      // Only element children carry layout intent; skip whitespace/text nodes.
      if (child.type === 'element') setAttribute(child, 'data-grow', '1');
    }
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P4-6: Apply a batch of free-element position changes as ONE undo entry and
   * ONE autosave. Used by the align/distribute toolbar so that, e.g., "align
   * left on 5 elements" is a single Ctrl+Z entry.
   *
   * `positions` maps each eid to its new logical {x, y} position.  Only
   * elements found in the current model are updated; unknown eids are silently
   * skipped (safe for stale selections after an external edit).  Returns false
   * when no elements were changed (the caller can treat it as a no-op).
   *
   * This intentionally mirrors the pattern of applyLayoutChange: mutate model →
   * updateFromModel → commitCommand.  All element mutations go through
   * setFreePosition (which calls setAttribute → marks only that element dirty),
   * so the byte-stable round-trip (spec 12 #4) is preserved for every unchanged
   * element.
   */
  async applyFreeGeometryBatch(
    positions: Map<string, { x: number; y: number }>,
  ): Promise<boolean> {
    if (!this.model) return false;
    let changed = false;
    for (const [eid, pos] of positions) {
      const el = findByEid(this.model, eid);
      if (!el) continue;
      setFreePosition(el, pos);
      changed = true;
    }
    if (!changed) return false;
    this.updateFromModel();
    await this.commitCommand();
    return true;
  }

  /**
   * P4-1: Toggle the free-positioning escape hatch on the element with `eid` as
   * ONE undo entry + one autosave.
   *
   * The model layer cannot measure rendered geometry (it has no DOM), so the
   * CALLER (a canvas component with iframe access) measures the element's current
   * LOGICAL rect and passes it here. On enable we stamp data-free + data-x/y/w/h
   * from that rect so the element does not visually jump; on disable toggleFree
   * strips all five attributes (the rect is ignored). Only the toggled element
   * goes dirty (spec 12 #4) — every sibling round-trips byte-for-byte.
   *
   * Returns the new state (true = now free, false = now structured) or null when
   * the eid is unknown (e.g. a stale selection after an external reload) — the
   * caller can no-op safely.
   */
  async toggleFree(eid: string, rect?: LogicalRect): Promise<boolean | null> {
    if (!this.model) return null;
    const next = toggleFree(this.model, eid, rect);
    if (next === null) return null; // unknown eid — nothing changed
    this.updateFromModel();
    await this.commitCommand();
    return next;
  }

  /**
   * P6-10: Switch the active reveal.js theme by rewriting the theme <link> in
   * the source HTML. The bundled themes live at
   * assets/vendor/reveal/theme/{name}.css (spec 12 offline-first).
   *
   * WHY SOURCE REGEX INSTEAD OF MODEL:
   * The theme link is in <head>, not inside <section> slides. parseDeck/
   * serializeDeck focus on the presentation content; patching the <head> via
   * the raw source string is simpler, safer, and guarantees a byte-stable
   * round-trip (we only touch the one matching substring).
   *
   * If the theme path is not found in the source (e.g. the user hand-edited the
   * head), this is a no-op so the user retains control over their <head>.
   */
  async applyTheme(themeName: string): Promise<void> {
    // Match the reveal theme link href — covers any bundled theme filename.
    const themePathRe = /assets\/vendor\/reveal\/theme\/[\w-]+\.css/g;
    const next = this.source.replace(
      themePathRe,
      `assets/vendor/reveal/theme/${themeName}.css`,
    );
    // No-op if theme link not found or already on this theme.
    if (next === this.source) return;
    this.updateFromSource(next);
    await this.commitCommand();
  }

  /**
   * P5-1 INSERT SEAM (owned by Lane FE-A; used by FE-B too).
   *
   * Insert a model subtree `node` (built via the blocks/ builders → edit.ts
   * factories) as the LAST child of the container with `parentEid`, or at
   * `index` when given. One call == one undo entry + one autosave + selection of
   * the new block.
   *
   * Byte-stability (spec 12 §4): the new subtree is `dirty` (createElement/
   * createText set it), so the serializer re-renders ONLY it. The parent keeps
   * its own original tag bytes and every existing sibling round-trips verbatim —
   * we splice the node in rather than mark the parent dirty.
   *
   * Returns the new block's `data-eid` (minted by the post-insert stamp pass), or
   * null when no deck is open or `parentEid` is unknown (a safe no-op for a stale
   * selection after an external reload).
   */
  async insertBlock(
    parentEid: string,
    node: ElementNode,
    index?: number,
  ): Promise<string | null> {
    if (!this.model) return null;
    const parent = findByEid(this.model, parentEid);
    if (!parent) return null;
    const at =
      index === undefined
        ? parent.children.length
        : Math.max(0, Math.min(index, parent.children.length));
    parent.children.splice(at, 0, node);
    node.dirty = true; // belt-and-braces: ensure canonical render of the new root
    return await this.#commitInsert(node);
  }

  /**
   * P5-1: Insert `node` as the next sibling immediately AFTER the element with
   * `siblingEid` (the "insert after the current selection" path). Same one-undo /
   * autosave / select-new-block contract as {@link insertBlock}.
   *
   * Returns the new block's `data-eid`, or null when the sibling (or its parent)
   * is not found.
   */
  async insertAfter(siblingEid: string, node: ElementNode): Promise<string | null> {
    if (!this.model) return null;
    const parent = findParentOf(this.model, siblingEid);
    if (!parent) return null;
    const i = parent.children.findIndex(
      (c) => c.type === 'element' && getAttribute(c, 'data-eid') === siblingEid,
    );
    if (i < 0) return null;
    parent.children.splice(i + 1, 0, node);
    node.dirty = true;
    return await this.#commitInsert(node);
  }

  /**
   * Shared tail for the insert seam: stamp eids for the freshly inserted subtree
   * (idempotent for everything already stamped — only the new managed elements
   * get ids), reserialize, persist as one command, and select the new block by
   * its eid so the properties panel / canvas focus it immediately.
   */
  async #commitInsert(node: ElementNode): Promise<string | null> {
    if (!this.model) return null;
    stampEids(this.model);
    const eid = getAttribute(node, 'data-eid');
    this.updateFromModel();
    await this.commitCommand();
    if (eid) selectionStore.select(eid);
    return eid;
  }

  // ── Slide management (P6, spec 06) ────────────────────────────────────────
  //
  // Every slide op follows the same command pattern as insertBlock / applyLayout-
  // Change: mutate the model via the pure ops in $lib/slides (which mark only the
  // affected subtree dirty, preserving the byte-stable round-trip — spec 12 #4),
  // then funnel through #commitStructure() so each is exactly ONE undo entry +
  // ONE autosave. Methods that create a section return its freshly-minted
  // data-eid (post-stamp); reorder/hide return a boolean. Unknown eids are safe
  // no-ops (a stale navigator click after an external reload must not throw).

  /**
   * Shared tail for slide ops that ADD a section (add / duplicate / nest /
   * promote): stamp eids (idempotent for everything already stamped — only the
   * new section + any new wrapper get ids), reserialize, persist as one command,
   * and select the new section so the canvas + panels focus it. Returns the new
   * section's eid.
   */
  async #commitNewSection(section: ElementNode): Promise<string | null> {
    if (!this.model) return null;
    stampEids(this.model);
    const eid = getAttribute(section, 'data-eid');
    this.updateFromModel();
    await this.commitCommand();
    if (eid) selectionStore.select(eid);
    return eid;
  }

  /**
   * Shared tail for slide ops that only MOVE / MUTATE existing sections (delete /
   * move / hide): reserialize + persist as one command. (No stamping needed —
   * no new managed elements are introduced.)
   */
  async #commitStructure(): Promise<void> {
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P6-3: Add a new slide after the slide with `afterEid` (or appended when
   * omitted). Returns the new slide's data-eid, or null when no deck is open.
   */
  async addSlide(afterEid?: string): Promise<string | null> {
    if (!this.model) return null;
    const section = addSlideOp(this.model, afterEid);
    if (!section) return null;
    return await this.#commitNewSection(section);
  }

  /**
   * P6-3: Duplicate the slide carrying `eid` (top-level or vertical). The copy's
   * data-eids are regenerated while data-ids are preserved for auto-animate
   * pairing (spec 07). Returns the copy's new data-eid, or null when `eid` is
   * unknown.
   */
  async duplicateSlide(eid: string): Promise<string | null> {
    if (!this.model) return null;
    const clone = duplicateSlideOp(this.model, eid);
    if (!clone) return null;
    return await this.#commitNewSection(clone);
  }

  /**
   * P6-3: Delete the slide carrying `eid`. Clears the selection when the deleted
   * slide (or one of its descendants) was selected so the panels don't show a
   * stale node. Returns true on success.
   */
  async deleteSlide(eid: string): Promise<boolean> {
    if (!this.model) return false;
    const ok = deleteSlideOp(this.model, eid);
    if (!ok) return false;
    // The deleted subtree's eids no longer resolve — drop them from selection.
    if (selectionStore.eid && !findByEid(this.model, selectionStore.eid)) {
      selectionStore.clear();
    }
    await this.#commitStructure();
    return true;
  }

  /**
   * P6-4: Reorder the top-level slide at `fromIndex` to `toIndex`. Returns true
   * on success.
   */
  async moveSlide(fromIndex: number, toIndex: number): Promise<boolean> {
    if (!this.model) return false;
    if (!moveSlideOp(this.model, fromIndex, toIndex)) return false;
    await this.#commitStructure();
    return true;
  }

  /**
   * P6-5: Reorder a vertical slide within the stack `stackEid` from `fromIndex`
   * to `toIndex`. Returns true on success.
   */
  async moveVerticalSlide(
    stackEid: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<boolean> {
    if (!this.model) return false;
    if (!moveVerticalSlideOp(this.model, stackEid, fromIndex, toIndex)) return false;
    await this.#commitStructure();
    return true;
  }

  /**
   * P6-5: Nest (demote) the top-level slide `eid` under the previous slide,
   * making it a vertical slide. Returns the (re-selected) slide's eid, or null
   * when there is no previous slide to nest under.
   */
  async nestSlide(eid: string): Promise<string | null> {
    if (!this.model) return null;
    const section = nestSlideOp(this.model, eid);
    if (!section) return null;
    return await this.#commitNewSection(section);
  }

  /**
   * Alias for {@link nestSlide} — "demote" a horizontal slide one level into the
   * preceding vertical stack (spec 06 nest/promote/demote vocabulary).
   */
  async demoteSlide(eid: string): Promise<string | null> {
    return await this.nestSlide(eid);
  }

  /**
   * P6-5: Promote a vertical slide `eid` out of its stack to become a top-level
   * slide. Returns the (re-selected) slide's eid, or null when `eid` is not a
   * vertical slide.
   */
  async promoteSlide(eid: string): Promise<string | null> {
    if (!this.model) return null;
    const section = promoteSlideOp(this.model, eid);
    if (!section) return null;
    // promoteSlide preserves eids (no new section created), but re-running the
    // add tail keeps the behaviour uniform: stamp is a no-op, and we re-select.
    return await this.#commitNewSection(section);
  }

  /**
   * P6-6: Hide / show the slide `eid` (sets/removes data-visibility="hidden").
   * The slide stays in source but is skipped when presenting. Returns true on
   * success.
   */
  async setSlideHidden(eid: string, hidden: boolean): Promise<boolean> {
    if (!this.model) return false;
    if (!setSlideHiddenOp(this.model, eid, hidden)) return false;
    await this.#commitStructure();
    return true;
  }

  // ── Motion commands (P6-7 fragments, P6-8 transitions, P6-9 auto-animate) ──
  //
  // Each command follows the same one-undo / autosave pattern: find element(s)
  // in the model → apply the pure-op mutation (marks only affected nodes dirty,
  // byte-stable per spec 12 #4) → updateFromModel() → commitCommand().
  //
  // Unknown eids are safe no-ops — stale selections after external reloads must
  // not throw into the UI.

  /**
   * P6-7: Toggle the `fragment` class on the element with `eid`.
   *
   * When adding, optionally stamps `data-fragment-index` so the user can
   * control step order from the panel.  When removing, clears the index.
   * Returns `true` when the element is now a fragment, `false` when it is
   * not, or `null` when the eid is unknown.
   */
  async toggleFragment(eid: string, index?: number): Promise<boolean | null> {
    if (!this.model) return null;
    const el = findByEid(this.model, eid);
    if (!el) return null;
    const isNowFragment = toggleFragmentOp(el, index);
    this.updateFromModel();
    await this.commitCommand();
    return isNowFragment;
  }

  /**
   * P6-7: Set the `data-fragment-index` on the element with `eid`.
   *
   * Used by the fragment-order panel to reorder step reveals without toggling
   * them on/off.  No-op when the eid is unknown.
   */
  async setFragmentIndex(eid: string, index: number): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;
    setFragmentIndexOp(el, index);
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P6-7: Set the fragment animation style class on the element with `eid`.
   *
   * Pass `null` to remove any explicit style (restoring reveal's default
   * fade-in animation).  The `fragment` class itself is preserved.
   * No-op when the eid is unknown.
   */
  async setFragmentStyle(eid: string, style: FragmentStyle | null): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;
    setFragmentStyleOp(el, style);
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P6-8: Set `data-transition` (and optionally `data-transition-speed`) on
   * the slide section with `slideEid`.
   *
   * Pass `null` for `transition` to remove the per-slide override so the slide
   * uses the deck default.  Omit `speed` to leave the existing value in place.
   * No-op when the eid is unknown.
   */
  async setSlideTransition(
    slideEid: string,
    transition: TransitionType | null,
    speed?: TransitionSpeed | null,
  ): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, slideEid);
    if (!el) return;
    setSlideTransitionOp(el, transition, speed);
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P6-8: Set the deck-level default transition on the `<div class="reveal">`.
   *
   * The companion slides-layout-init.js picks up `data-transition` and
   * `data-transition-speed` from the reveal div at runtime and calls
   * `Reveal.configure()` to apply them as the deck default, overriding the
   * hardcoded value in the passthrough `<script>` block (spec 12 offline-safe).
   *
   * Returns `false` when the reveal div is not found in the model (malformed
   * deck — safe no-op for the caller).
   */
  async setDeckTransition(
    transition: TransitionType | null,
    speed?: TransitionSpeed | null,
  ): Promise<boolean> {
    if (!this.model) return false;
    const changed = setDeckTransitionOp(this.model, transition, speed);
    if (!changed) return false;
    this.updateFromModel();
    await this.commitCommand();
    return true;
  }

  /**
   * P6-9: Enable "animate from previous slide" for the slide with `slideEid`.
   *
   * Sets `data-auto-animate` on both the target slide and its previous sibling
   * section, then derives `data-id` values (from `data-eid`) for matched element
   * pairs so reveal can tween them automatically (spec 07 "signature feature").
   *
   * Returns `true` on success, `false` when the slide is not found or has no
   * previous sibling (e.g. the first slide in the deck).
   */
  async enableAutoAnimate(slideEid: string): Promise<boolean> {
    if (!this.model) return false;
    const ok = enableAutoAnimateOp(this.model, slideEid);
    if (!ok) return false;
    this.updateFromModel();
    await this.commitCommand();
    return true;
  }

  /**
   * P6-9: Remove `data-auto-animate` from the slide with `slideEid`.
   *
   * `data-id` attributes are intentionally left intact so the user can re-enable
   * auto-animate later without losing established element pairings.
   *
   * Returns `true` on success, `false` when the slide is not found.
   */
  async disableAutoAnimate(slideEid: string): Promise<boolean> {
    if (!this.model) return false;
    const ok = disableAutoAnimateOp(this.model, slideEid);
    if (!ok) return false;
    this.updateFromModel();
    await this.commitCommand();
    return true;
  }

  // ── Speaker notes (P7-2 / spec 10) ──────────────────────────────────────────
  //
  // Notes are stored as <aside class="notes"> inside each slide <section>.
  // The reveal speaker window (S key on the present route) reads them. We expose
  // a reactive getter and a store command so the NotesPanel component can stay
  // store-agnostic.

  /**
   * P7-2: Return the decoded speaker notes text for the slide with `slideEid`.
   *
   * Returns `''` when the eid is unknown, when no deck is open, or when the
   * slide has no `<aside class="notes">` child. This is a pure derived read
   * (no mutation, no dirty marking) — callers can call it in `$derived` blocks.
   */
  getSlideNotesText(slideEid: string | null): string {
    if (!slideEid || !this.model) return '';
    const el = findByEid(this.model, slideEid);
    if (!el) return '';
    return getSlideNotes(el);
  }

  /**
   * P7-2: Set the speaker notes for the slide with `slideEid` as ONE undo
   * entry + ONE autosave.
   *
   * Behaviour mirrors setSlideNotesOp (model/notes.ts):
   *   • Non-empty text → create or update the `<aside class="notes">`.
   *   • Empty string   → remove the aside if present (no-op if absent).
   *
   * Only the affected aside (or the section when the aside is removed) is
   * marked dirty — all other elements round-trip byte-for-byte (spec 12 #4).
   * Unknown `slideEid` is a safe no-op (stale selection after external reload).
   */
  async setSlideNotes(slideEid: string, text: string): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, slideEid);
    if (!el) return;
    setSlideNotesOp(el, text);
    this.updateFromModel();
    await this.commitCommand();
  }

  #scheduleSync(): void {
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = null;
      // Re-parse first so the model reflects the latest source even if the save
      // fails, then persist.
      this.model = safeParse(this.source);
      void this.save();
    }, SYNC_DEBOUNCE_MS);
  }

  /** Persist `source` to disk (PUT) and reload the canvas on success. */
  async save(): Promise<void> {
    if (!this.name) return;
    if (this.#syncTimer) {
      clearTimeout(this.#syncTimer);
      this.#syncTimer = null;
    }
    const body = this.source;
    if (body === this.#savedSource) {
      if (this.status !== 'external') this.status = 'synced';
      return;
    }
    this.status = 'saving';
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(this.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body,
      });
      if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
      this.#savedSource = body;
      // Canvas now reflects persisted bytes — reload it.
      this.reloadNonce++;
      this.status = 'synced';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    }
  }

  /**
   * P1-9: an SSE "changed" event for this deck arrived. Re-read disk and decide:
   *   - identical to current source → echo of our own write; just resync.
   *   - we have unsaved edits        → conflict; surface `external`, keep edits.
   *   - clean                        → adopt the external version and re-render.
   */
  async onExternalChange(): Promise<void> {
    if (!this.name) return;
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(this.name)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();

      if (html === this.source) {
        // No real divergence (commonly the fsnotify echo of our own PUT).
        this.#savedSource = html;
        if (this.status !== 'saving') this.status = 'synced';
        return;
      }
      if (this.dirty) {
        // Turn-taking conflict: do not destroy in-progress local edits.
        this.status = 'external';
        return;
      }
      this.#adoptDisk(html);
      this.status = 'synced';
    } catch {
      // Transient fetch error — leave state unchanged; SSE will fire again.
    }
  }
}

/**
 * Singleton store — one deck is open at a time, so a module-level instance is
 * the single source of truth shared by the shell and every panel.
 */
export const deckStore = new DeckStore();
