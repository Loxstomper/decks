/**
 * deck.svelte.ts — Current-deck store (P1-3, P1-8, P1-9).
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
 */

import { parseDeck, serializeDeck, type DeckModel } from '$lib/model';

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
   */
  #adoptDisk(html: string): void {
    this.#savedSource = html;
    this.source = html;
    this.model = safeParse(html);
    this.reloadNonce++;
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
