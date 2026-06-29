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
  setAttribute,
  setLayoutProps,
  type DeckModel,
  type LayoutProps,
} from '$lib/model';
import { undoStore } from './undo.svelte';
import { applyTextEditToModel } from '$lib/canvas/writeback';

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
