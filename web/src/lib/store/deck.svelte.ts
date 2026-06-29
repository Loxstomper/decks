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
  setInlineColor,
  diffModels,
  validateSource,
  normalizeRemote,
  cloneSubtreeStripEids,
  getContainerKind,
  type DeckModel,
  type ElementNode,
  type LayoutProps,
  type LogicalRect,
  type ValidationError,
} from '$lib/model';
import {
  getThemeProps,
  setThemeProps,
  type ThemeName,
  type ThemeProps,
} from '$lib/model/theme';
import {
  addSlide as addSlideOp,
  duplicateSlide as duplicateSlideOp,
  deleteSlide as deleteSlideOp,
  moveSlide as moveSlideOp,
  moveVerticalSlide as moveVerticalSlideOp,
  nestSlide as nestSlideOp,
  promoteSlide as promoteSlideOp,
  setSlideHidden as setSlideHiddenOp,
  setSlideAutoslide as setSlideAutoslideOp,
  addSlideFromLayout as addSlideFromLayoutOp,
  changeSlideLayout as changeSlideLayoutOp,
} from '$lib/slides';
import { uploadAsset } from '$lib/blocks/api';
import { undoStore } from './undo.svelte';
import { highlightStore } from './highlight.svelte';
import { decideExternalChange, lineDiff, type DiffLine } from './conflict';
import { selectionStore } from '$lib/canvas/selection.svelte';
import {
  deleteElement as deleteElementOp,
  findChildAndParent,
  elementChildren,
  moveChild,
} from '$lib/canvas/structure-ops';
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
 * P13-7: SESSION-scoped element clipboard — a module-level, in-memory buffer of
 * cloned subtrees. Deliberately NOT persisted (no disk, no localStorage) and
 * fully offline: it lives only for the lifetime of the page session, mirroring a
 * native app's in-process clipboard. We store already-eid-stripped clones so the
 * buffer is fully independent of later model edits (cut can delete the originals
 * safely); each paste clones AGAIN so repeated pastes yield independent copies
 * that stampEids re-mints with fresh unique eids.
 */
let elementClipboard: ElementNode[] = [];

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

/**
 * Read a 422 PUT response body into validation errors (P8-3). The Go save path
 * returns the same JSON shape as POST .../validate; normalizeRemote tolerates
 * shape drift. Falls back to a single generic error when the body is not JSON.
 */
async function readValidationErrors(res: Response): Promise<ValidationError[]> {
  try {
    const data: unknown = await res.json();
    const result = normalizeRemote(data);
    if (result && result.errors.length > 0) return result.errors;
  } catch {
    // Non-JSON body — fall through to the generic message.
  }
  return [{ code: 'server', message: 'Server rejected the deck as invalid (HTTP 422).' }];
}

/** Parse without throwing; callers keep the previous model on failure. */
function safeParse(html: string): DeckModel | null {
  try {
    return parseDeck(html);
  } catch {
    return null;
  }
}

/**
 * P16-1: Per-slide background delta — the UI-facing vocabulary for the unified
 * Slide Background command. Each key maps to one reveal.js `data-background-*`
 * attribute (spec 16). Per-key semantics (identical convention to setThemeProps):
 *   • `undefined` (key absent) → leave that attribute untouched.
 *   • `null`                   → clear just that one attribute.
 *   • a string                 → set/override that one attribute.
 *
 * `image` / `video` srcs MUST already be deck-relative ('assets/…'): the store
 * performs NO network calls — localization happens up-front in the UI via
 * uploadAsset / copySharedAsset / fetchProviderImage (blocks/api.ts).
 */
export interface SlideBackgroundDelta {
  /** `data-background-color` — solid colour; may underlay any other type. */
  color?: string | null;
  /** `data-background-image` — relative asset path. Type: clears gradient+video. */
  image?: string | null;
  /** `data-background-size` — CSS background-size modifier for the image. */
  size?: string | null;
  /** `data-background-position` — CSS background-position modifier. */
  position?: string | null;
  /** `data-background-repeat` — CSS background-repeat modifier. */
  repeat?: string | null;
  /** `data-background-opacity` — 0–1 opacity modifier. */
  opacity?: string | null;
  /** `data-background-gradient` — CSS gradient. Type: clears image+video. */
  gradient?: string | null;
  /** `data-background-video` — relative asset path. Type: clears image+gradient. */
  video?: string | null;
  /** `data-background-video-loop` — loop flag modifier for the video. */
  videoLoop?: string | null;
  /** `data-background-video-muted` — muted flag modifier for the video. */
  videoMuted?: string | null;
}

/** A non-null, non-undefined value is being explicitly SET (vs cleared/untouched). */
function isSet(v: string | null | undefined): v is string {
  return v !== undefined && v !== null;
}

/**
 * P16-1: Translate a {@link SlideBackgroundDelta} into a `Partial<ThemeProps>`
 * for setThemeProps, ENFORCING a coherent single background TYPE.
 *
 * A slide background is exactly one of {image, gradient, video} (a solid `color`
 * may underlay any of them). So setting one type clears the other two — and the
 * video flags when video is cleared — to avoid contradictory `data-background-*`
 * combinations that reveal.js would resolve unpredictably. Modifiers (size /
 * position / repeat / opacity) are not types and are left to the caller.
 *
 * This is the SINGLE source for the managed background-color write: applySlide-
 * Theme also routes its theme colour through here (Phase 10 consolidation).
 */
function buildBackgroundProps(delta: SlideBackgroundDelta): Partial<ThemeProps> {
  const props: Partial<ThemeProps> = {};
  if (delta.color !== undefined) props.backgroundColor = delta.color;
  if (delta.image !== undefined) props.backgroundImage = delta.image;
  if (delta.size !== undefined) props.backgroundSize = delta.size;
  if (delta.position !== undefined) props.backgroundPosition = delta.position;
  if (delta.repeat !== undefined) props.backgroundRepeat = delta.repeat;
  if (delta.opacity !== undefined) props.backgroundOpacity = delta.opacity;
  if (delta.gradient !== undefined) props.backgroundGradient = delta.gradient;
  if (delta.video !== undefined) props.backgroundVideo = delta.video;
  if (delta.videoLoop !== undefined) props.backgroundVideoLoop = delta.videoLoop;
  if (delta.videoMuted !== undefined) props.backgroundVideoMuted = delta.videoMuted;

  // Type exclusivity: a non-null set of one type clears the competing types.
  if (isSet(delta.image)) {
    props.backgroundGradient = null;
    props.backgroundVideo = null;
    props.backgroundVideoLoop = null;
    props.backgroundVideoMuted = null;
  }
  if (isSet(delta.gradient)) {
    props.backgroundImage = null;
    props.backgroundVideo = null;
    props.backgroundVideoLoop = null;
    props.backgroundVideoMuted = null;
  }
  if (isSet(delta.video)) {
    props.backgroundImage = null;
    props.backgroundGradient = null;
  }
  return props;
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

  /**
   * P8-3: validation problems from the most recent save attempt. Non-empty means
   * the last save was BLOCKED (we did not PUT) because persisting `source` would
   * break the model. The ValidationBanner surfaces these; the user keeps editing.
   * Cleared on a clean save / fresh load.
   */
  validationErrors = $state<ValidationError[]>([]);

  /**
   * P8-6: an unresolved turn-taking conflict. Set when an external (Claude Code)
   * write arrives WHILE we have unsaved edits — adopting it would clobber the
   * user's work. `theirs` holds the incoming disk bytes; the ConflictPrompt lets
   * the user keep-mine / take-theirs / view-diff. Null when there is no conflict.
   */
  conflict = $state<{ theirs: string } | null>(null);

  /** Last bytes known to be on disk — distinguishes "unsaved" from "synced". */
  #savedSource = '';
  /** Pending debounced sync handle. */
  #syncTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * P10-3: cached theme-name → background-colour map from
   * GET /api/themes/backgrounds. The colours are derived from the embedded
   * reveal theme CSS and never change at runtime, so we fetch once and memoise.
   * `null` until the first fetch completes.
   */
  #themeBackgrounds: Record<string, string> | null = null;

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
    // Adopting disk truth resolves any pending conflict and clears stale
    // validation problems — this html is, by definition, the accepted state.
    this.conflict = null;
    this.validationErrors = [];
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

  // ── Per-slide theming (P10-3 / P10-4, spec 16) ────────────────────────────
  //
  // Two complementary commands set theming on a slide <section>:
  //   • applySlideTheme    — pick a NAMED bundled theme (data-theme + its bg).
  //   • applySlideColorVars — fine-grained FREE-FORM inline --r-* overrides
  //                           layered over (or independent of) a named theme.
  // Both follow the standard command pattern (mutate model → updateFromModel →
  // commitCommand): one undo entry + one autosave, byte-stable for everything
  // else (spec 12 #4). Unknown eids are safe no-ops (stale selection guard).

  /**
   * Fetch + memoise the theme-name → background-colour map (P10-3).
   *
   * The map is derived from the embedded reveal theme CSS server-side and is
   * immutable at runtime, so we cache the first successful response. A failed
   * fetch caches an empty map (offline-first: a missing colour simply means no
   * managed background is written — the named theme still applies).
   */
  async #fetchThemeBackgrounds(): Promise<Record<string, string>> {
    if (this.#themeBackgrounds) return this.#themeBackgrounds;
    try {
      const res = await fetch('/api/themes/backgrounds', { cache: 'no-store' });
      this.#themeBackgrounds = res.ok
        ? ((await res.json()) as Record<string, string>)
        : {};
    } catch {
      this.#themeBackgrounds = {};
    }
    return this.#themeBackgrounds;
  }

  /**
   * P10-3: Apply (or clear) a NAMED bundled theme on the slide `<section>` with
   * `eid` as ONE undo entry + ONE autosave.
   *
   * Sets BOTH `data-theme` and the section's managed `data-background-color`
   * (the colour looked up from the cached /api/themes/backgrounds map). Passing
   * `themeName === null` removes both — restoring the deck-level theme/background.
   *
   * The managed background colour is written THROUGH buildBackgroundProps (the
   * single source for the background-color write, shared with applySlideBackground
   * — P16 consolidation), so theme colours and explicit background edits agree.
   *
   * Invalid theme names throw (via setThemeProps) — same fail-fast convention as
   * setLayoutProps. Unknown eid is a safe no-op.
   */
  async applySlideTheme(eid: string, themeName: string | null): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;
    if (themeName === null) {
      // Clear both the named theme and its managed background colour.
      setThemeProps(el, { theme: null, ...buildBackgroundProps({ color: null }) });
    } else {
      const backgrounds = await this.#fetchThemeBackgrounds();
      const backgroundColor = backgrounds[themeName] ?? null;
      setThemeProps(el, {
        theme: themeName as ThemeName,
        ...buildBackgroundProps({ color: backgroundColor }),
      });
    }
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P10-4: Apply (or clear) FREE-FORM per-slide colour overrides on the section
   * with `eid` as ONE undo entry + ONE autosave.
   *
   * Each colour maps to an inline reveal.js CSS custom property on the section's
   * `style` attribute, layered over any named theme bundle:
   *   • heading → `--r-heading-color`
   *   • text    → `--r-main-color`
   *   • link    → `--r-link-color`
   *   • backgroundColor → `data-background-color` (the managed background attr)
   *
   * Per-key semantics (partial delta):
   *   • `undefined` (key absent) → leave that property untouched.
   *   • `null`                   → clear just that one property.
   *   • a string                 → set/override that one property.
   *
   * Clearing a single colour removes only that var; sibling `--r-*` vars and all
   * other style declarations round-trip verbatim. Unknown eid is a safe no-op.
   */
  async applySlideColorVars(
    eid: string,
    colors: {
      heading?: string | null;
      text?: string | null;
      link?: string | null;
      backgroundColor?: string | null;
    },
  ): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;

    const delta: Partial<ThemeProps> = {};

    // --r-* vars: merge the requested changes over the element's current vars so
    // we set/clear ONLY the named colours and preserve any others.
    const touchesVars =
      'heading' in colors || 'text' in colors || 'link' in colors;
    if (touchesVars) {
      const current = getThemeProps(el).inlineVars ?? {};
      const merged: Record<string, string> = { ...current };
      const apply = (name: string, value: string | null | undefined): void => {
        if (value === undefined) return; // untouched
        if (value === null) delete merged[name]; // clear just this var
        else merged[name] = value; // set/override
      };
      apply('--r-heading-color', colors.heading);
      apply('--r-main-color', colors.text);
      apply('--r-link-color', colors.link);
      // null → setThemeProps removes all --r-* vars (style cleared if empty).
      delta.inlineVars = Object.keys(merged).length > 0 ? merged : null;
    }

    if ('backgroundColor' in colors) {
      delta.backgroundColor = colors.backgroundColor ?? null;
    }

    setThemeProps(el, delta);
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P16-1: Apply (or clear) the UNIFIED slide background on the section with
   * `eid` as ONE undo entry + ONE autosave (spec 16).
   *
   * The `delta` carries any of { color, image, size, position, repeat, opacity,
   * gradient, video, videoLoop, videoMuted }; per-key undefined=untouched,
   * null=clear, value=set. buildBackgroundProps enforces a coherent single
   * background TYPE — setting image clears gradient+video, setting gradient
   * clears image+video, setting video clears image+gradient — while `color`
   * may coexist as an underlay.
   *
   * P16-2: NO network here. `image` / `video` srcs MUST already be deck-relative
   * ('assets/…'); the UI localizes up-front via uploadAsset / copySharedAsset /
   * fetchProviderImage (blocks/api.ts). See applySlideBackgroundImageFile for the
   * thin upload-then-apply convenience.
   *
   * Only the targeted section goes dirty, so every other element round-trips
   * byte-for-byte (spec 12 #4). Unknown eid is a safe no-op (stale selection).
   */
  async applySlideBackground(eid: string, delta: SlideBackgroundDelta): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;
    setThemeProps(el, buildBackgroundProps(delta));
    this.updateFromModel();
    await this.commitCommand();
  }

  /**
   * P16-2: Convenience — upload a local image File into the deck's assets/ dir
   * (POST stays in blocks/api.ts → uploadAsset), then set it as the slide
   * background via {@link applySlideBackground}. The store itself performs no
   * other network calls; this is the single sanctioned File → background path so
   * components don't have to wire upload + apply by hand.
   *
   * No-op when no deck is open. Propagates upload errors to the caller.
   */
  async applySlideBackgroundImageFile(eid: string, file: File): Promise<void> {
    if (!this.name) return;
    const src = await uploadAsset(this.name, file);
    await this.applySlideBackground(eid, { image: src });
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
   * P14-3: Add a new slide built from a layout PRESET (a `<section data-layout>`
   * snippet from GET /api/templates) after the slide with `afterEid` (or appended
   * when omitted). The preset's structure + starter prompt content is inserted and
   * fresh unique data-eids are stamped onto every managed element. Returns the new
   * slide's data-eid, or null when no deck is open or the snippet has no section.
   */
  async addSlideFromLayout(presetHtml: string, afterEid?: string): Promise<string | null> {
    if (!this.model) return null;
    const section = addSlideFromLayoutOp(this.model, presetHtml, afterEid);
    if (!section) return null;
    return await this.#commitNewSection(section);
  }

  /**
   * P14-4: Re-flow the slide carrying `sectionEid` into a new layout PRESET,
   * preserving its position + identity and moving ALL of its content into the new
   * layout's content slot (nothing is dropped — the preset's starter prompts are
   * replaced by the user's content). One undo entry + one autosave; undo restores
   * the prior structure byte-for-byte (the snapshot stack). Returns the re-flowed
   * slide's data-eid, or null when the eid is unknown / the snippet has no section.
   */
  async changeSlideLayout(sectionEid: string, presetHtml: string): Promise<string | null> {
    if (!this.model) return null;
    const section = changeSlideLayoutOp(this.model, sectionEid, presetHtml);
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
   * P9-7: Delete one or more elements (by eid) as ONE undo entry + ONE autosave
   * (spec 04 "Deleting elements"). Used by the Delete/Backspace keyboard handler,
   * which passes the current selection set (multi-select deletes all).
   *
   * Each eid is removed via deleteElementOp (structure-ops): a leaf drops the
   * node, a container drops it and its subtree, passthrough goes whole-or-nothing,
   * and slide <section>s are refused (whole-slide deletion lives in the navigator).
   * Only the affected parents go dirty, so every untouched sibling round-trips
   * byte-for-byte (spec 12 #4) and undo restores the deleted markup verbatim.
   *
   * Unknown / non-removable eids are skipped. Returns true when at least one
   * element was removed (the selection is then cleared); false when nothing
   * changed (a safe no-op for a stale selection after an external reload).
   */
  async deleteElements(eids: string[]): Promise<boolean> {
    if (!this.model) return false;
    let changed = false;
    for (const eid of eids) {
      if (deleteElementOp(this.model, eid)) changed = true;
    }
    if (!changed) return false;
    // The deleted subtrees' eids no longer resolve — drop the whole selection.
    selectionStore.clear();
    await this.#commitStructure();
    return true;
  }

  // ── Element duplicate / z-order / clipboard (P13-5/6/7, spec 04) ───────────
  //
  // All follow the one-command = one-undo + one-autosave pattern: mutate the
  // model (marking only the affected subtree dirty so untouched siblings round-
  // trip byte-for-byte, spec 12 #4) → updateFromModel() → commitCommand(). They
  // reuse the existing insert seam (#commitInsert) and structure-ops (moveChild).

  /**
   * P13-5: Duplicate the element with `eid`, inserting the copy immediately after
   * the original (the insertAfter / #commitInsert seam) and selecting the clone.
   *
   * The clone is a deep, eid-stripped copy (cloneSubtreeStripEids): stampEids
   * re-mints fresh unique data-eids on insert while `data-id` is preserved for
   * auto-animate pairing (spec 07). The clone is `dirty` so it serializes
   * canonically and is byte-stable; undo removes it.
   *
   * Refuses a `<section>` (returns null): whole-slide duplication lives in the
   * navigator (duplicateSlide). Unknown eid is a safe no-op (returns null).
   * Returns the clone's new data-eid.
   */
  async duplicateElement(eid: string): Promise<string | null> {
    if (!this.model) return null;
    const el = findByEid(this.model, eid);
    if (!el) return null;
    // Whole-slide duplication is the navigator's job, not the element path.
    if (el.tagName.toLowerCase() === 'section') return null;
    const clone = cloneSubtreeStripEids(el) as ElementNode;
    return await this.insertAfter(eid, clone);
  }

  /**
   * P13-6: Bring the free element with `eid` to the front (last among its
   * siblings, so it paints on top in a `data-lay="layers"` stack). One undo +
   * one save. No-op when the eid is unknown or it is already last.
   */
  async bringToFront(eid: string): Promise<boolean> {
    return await this.#reorderSibling(eid, 'front');
  }

  /**
   * P13-6: Send the free element with `eid` to the back (first among its
   * siblings, so it paints beneath the others). One undo + one save. No-op when
   * the eid is unknown or it is already first.
   */
  async sendToBack(eid: string): Promise<boolean> {
    return await this.#reorderSibling(eid, 'back');
  }

  /**
   * Shared z-order tail: reorder the element to the last ('front') or first
   * ('back') position among its parent's element children via structure-ops
   * moveChild (which marks only the moved element dirty — byte-stable per spec
   * 12 #4). Pre-checks the current position so an already-extremal element is a
   * no-op (no churn, no undo entry). One undo entry + one autosave on success.
   */
  async #reorderSibling(eid: string, where: 'front' | 'back'): Promise<boolean> {
    if (!this.model) return false;
    const found = findChildAndParent(this.model, eid);
    if (!found) return false;
    const { child, parent } = found;
    const els = elementChildren(parent);
    const idx = els.indexOf(child);
    const lastIdx = els.length - 1;
    // Already at the requested extreme → nothing to do (avoid needless churn).
    if (where === 'front' && idx === lastIdx) return false;
    if (where === 'back' && idx === 0) return false;
    // moveChild's target index is among element children EXCLUDING the moved
    // child; after detach there are (length-1) elements, so front = length-1.
    const target = where === 'front' ? lastIdx : 0;
    if (!moveChild(parent, child, target)) return false;
    await this.#commitStructure();
    return true;
  }

  /**
   * P13-7: Copy the elements with `eids` into the session clipboard.
   *
   * Stores deep, eid-stripped clones (independent of the live model), so a
   * following cut/delete or further edits cannot corrupt the buffer. `<section>`
   * eids and unknown eids are skipped (the element clipboard does not carry whole
   * slides). Eids are copied in the order given. Returns true when at least one
   * element was copied (the buffer is replaced only then; an all-empty copy
   * leaves the previous buffer intact).
   */
  copyElements(eids: string[]): boolean {
    if (!this.model) return false;
    const clones: ElementNode[] = [];
    for (const eid of eids) {
      const el = findByEid(this.model, eid);
      if (!el) continue;
      if (el.tagName.toLowerCase() === 'section') continue; // not a slide clipboard
      clones.push(cloneSubtreeStripEids(el) as ElementNode);
    }
    if (clones.length === 0) return false;
    elementClipboard = clones;
    return true;
  }

  /**
   * P13-7: Cut = copy + delete. Copies the elements into the clipboard, then
   * removes the originals via deleteElements (one undo entry + one autosave for
   * the removal). Returns true when something was cut. The clones are taken
   * BEFORE deletion, so the buffer holds independent copies.
   */
  async cutElements(eids: string[]): Promise<boolean> {
    if (!this.copyElements(eids)) return false;
    return await this.deleteElements(eids);
  }

  /** True when the session element clipboard holds at least one subtree. */
  get hasClipboard(): boolean {
    return elementClipboard.length > 0;
  }

  /**
   * P13-7: Paste the session clipboard, working ACROSS slides.
   *
   * Placement (target defaults to the current selection):
   *   • target is a CONTAINER → paste as its LAST children.
   *   • target is any other element → paste immediately AFTER it (as siblings).
   *   • no usable target → no-op (returns null).
   *
   * Each buffered subtree is cloned again (independent copies) and inserted as
   * one command: stampEids re-mints fresh unique data-eids, the first pasted
   * clone is selected, and the whole paste is a single undo entry + autosave.
   * Returns the first clone's data-eid, or null when the buffer is empty / there
   * is no usable target.
   */
  async pasteClipboard(targetEid?: string): Promise<string | null> {
    if (!this.model) return null;
    if (elementClipboard.length === 0) return null;
    const target = targetEid ?? selectionStore.eid ?? null;
    if (!target) return null;
    const anchor = findByEid(this.model, target);
    if (!anchor) return null;

    // Fresh, independent clones for this paste (buffer stays reusable).
    const clones = elementClipboard.map((n) => cloneSubtreeStripEids(n) as ElementNode);
    for (const c of clones) c.dirty = true;

    if (getContainerKind(anchor)) {
      // Paste as the last children of the selected container.
      anchor.children.push(...clones);
    } else {
      // Paste immediately after the selected (non-container) element.
      const parent = findParentOf(this.model, target);
      if (!parent) return null;
      const i = parent.children.findIndex(
        (c) => c.type === 'element' && getAttribute(c, 'data-eid') === target,
      );
      if (i < 0) return null;
      parent.children.splice(i + 1, 0, ...clones);
    }
    return await this.#commitInsertMany(clones);
  }

  /**
   * Multi-node variant of #commitInsert: stamp eids for every freshly inserted
   * subtree (idempotent for already-stamped nodes), reserialize, persist as ONE
   * command, and select the FIRST inserted block. Returns its eid.
   */
  async #commitInsertMany(nodes: ElementNode[]): Promise<string | null> {
    if (!this.model || nodes.length === 0) return null;
    stampEids(this.model);
    const eid = getAttribute(nodes[0], 'data-eid');
    this.updateFromModel();
    await this.commitCommand();
    if (eid) selectionStore.select(eid);
    return eid;
  }

  /**
   * P9-8: Set (or clear, when `color` is null) the inline `style="color: …"` on
   * the TEXT leaf with `eid` as ONE undo entry + ONE autosave (spec 09 "Text
   * appearance" — the single deliberate appearance exception).
   *
   * Whole-element scope (no sub-string runs): setInlineColor mutates only this
   * element's `style` attribute, so it goes dirty and serializes canonically
   * while every other element round-trips byte-for-byte (spec 12 #4). Unknown
   * eid is a safe no-op (stale selection after an external reload).
   */
  async applyTextColor(eid: string, color: string | null): Promise<void> {
    if (!this.model) return;
    const el = findByEid(this.model, eid);
    if (!el) return;
    setInlineColor(el, color);
    this.updateFromModel();
    await this.commitCommand();
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

  /**
   * P17-20: Set / clear the per-slide auto-advance interval (`data-autoslide`,
   * in ms) on slide `eid`. `ms` (non-negative integer) writes the override;
   * `null` removes it so the slide inherits the deck-level default. One undo
   * entry + one autosave; byte-stable. Returns true on success.
   */
  async setSlideAutoslide(eid: string, ms: number | null): Promise<boolean> {
    if (!this.model) return false;
    if (!setSlideAutoslideOp(this.model, eid, ms)) return false;
    await this.#commitStructure();
    return true;
  }

  /**
   * P17-20: Set the DECK-LEVEL auto-advance default (`autoSlide`, in ms) and
   * `loop` flag in Reveal.initialize. `ms` of 0 disables auto-advance. Unlike
   * the per-slide override, this lives inside the opaque reveal-init <script>,
   * so it is applied server-side via POST /api/decks/{name}/autoslide (a
   * byte-stable rewrite of deck.html) rather than through the model. We flush
   * any pending model edits first (save) so the server rewrites current bytes,
   * then re-adopt disk truth via load(). Returns true on success.
   */
  async applyDeckAutoslide(ms: number, loop: boolean): Promise<boolean> {
    if (!this.name) return false;
    // Flush pending edits so the server-side rewrite operates on current bytes
    // and load() below doesn't clobber unsaved work.
    await this.save();
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(this.name)}/autoslide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ms, loop }),
      });
      if (!res.ok) {
        this.error = `auto-advance update failed: HTTP ${res.status}`;
        return false;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
    // Re-read the rewritten deck.html so model + canvas reflect disk truth.
    await this.load(this.name);
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

  // ── External change adoption + highlight (P8-7) ───────────────────────────

  /**
   * Adopt an external write AND flash what changed (P8-7).
   *
   * We snapshot the CURRENT model first, then #adoptDisk re-parses the incoming
   * bytes (and stamps eids). Both models are eid-stamped, so diffModels matches
   * elements across the reload and yields added/removed/changed eids, which we
   * hand to the highlight store. The canvas overlay + outline then flash them so
   * the human can see exactly what Claude Code changed (spec 11).
   */
  #adoptExternal(html: string): void {
    const prev = this.model;
    this.#adoptDisk(html);
    highlightStore.flash(diffModels(prev, this.model));
  }

  // ── Conflict resolution (P8-6) ────────────────────────────────────────────

  /**
   * P8-6 "take theirs": discard local edits and adopt the external version.
   * Highlights what changed (P8-7). No-op when there is no active conflict.
   */
  resolveTakeTheirs(): void {
    const c = this.conflict;
    if (!c) return;
    // #adoptExternal clears `conflict` (via #adoptDisk); capture bytes first.
    this.#adoptExternal(c.theirs);
    this.status = 'synced';
  }

  /**
   * P8-6 "keep mine": reject the external version and keep local edits.
   *
   * The disk currently holds THEIRS, so we treat that as the new baseline: this
   * makes our in-memory source register as a pending change (mine !== theirs)
   * that the immediate save() then PUTs, overwriting their write so the human
   * wins this turn. If mine is invalid, save() surfaces it and does not persist
   * (the conflict is still considered resolved — the user chose their side).
   */
  resolveKeepMine(): void {
    const c = this.conflict;
    if (!c) return;
    this.#savedSource = c.theirs;
    this.conflict = null;
    this.status = 'unsaved';
    void this.save();
  }

  /** True while a conflict awaits the user's decision. */
  get hasConflict(): boolean {
    return this.conflict !== null;
  }

  /**
   * P8-6 "view diff": a line-level diff between MINE (in-memory source) and
   * THEIRS (incoming disk bytes) for the conflict prompt. Empty when no conflict.
   */
  get conflictDiff(): DiffLine[] {
    if (!this.conflict) return [];
    return lineDiff(this.source, this.conflict.theirs);
  }

  /** Dismiss the validation banner without saving (problems persist in source). */
  dismissValidation(): void {
    this.validationErrors = [];
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

    // P8-3 VALIDATE-ON-SAVE (client guard): never persist bytes that would break
    // the model. This fast, offline-first guard runs parse + round-trip + the
    // layout contract BEFORE we touch the network. On failure we surface the
    // errors and keep the user's edits in memory rather than clobbering disk with
    // malformed markup (spec 11 "caught instead of silently breaking the canvas";
    // "show the errors and let the user decide"). The Go endpoint remains the
    // single source of truth: the PUT below is the server's validate-on-write
    // seam, and an explicit re-check is available via validateRemote().
    const local = validateSource(body);
    if (!local.ok) {
      this.validationErrors = local.errors;
      if (this.status !== 'external') this.status = 'unsaved';
      return;
    }
    this.validationErrors = [];

    this.status = 'saving';
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(this.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body,
      });
      if (!res.ok) {
        // 422 Unprocessable Entity == server-side validation rejected the bytes
        // (the Go save path's own "slides validate"). Surface those problems
        // instead of a generic error, and DO NOT advance the saved baseline.
        if (res.status === 422) {
          this.validationErrors = await readValidationErrors(res);
          // We set status='saving' just above, so it cannot be 'external' here.
          this.status = 'unsaved';
          return;
        }
        throw new Error(`save failed: HTTP ${res.status}`);
      }
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

      // Pure turn-taking decision (spec 11 §4-5) — keeps the rule testable.
      const decision = decideExternalChange({
        current: this.source,
        saved: this.#savedSource,
        incoming: html,
      });
      switch (decision.kind) {
        case 'echo':
          // No real divergence (commonly the fsnotify echo of our own PUT).
          this.#savedSource = html;
          if (this.status !== 'saving') this.status = 'synced';
          return;
        case 'conflict':
          // P8-6 dirty guard: do NOT clobber in-progress local edits — stash the
          // incoming bytes and prompt (keep mine / take theirs / view diff).
          this.conflict = { theirs: decision.html };
          this.status = 'external';
          return;
        case 'adopt':
          // Clean: adopt the external version and flash what changed (P8-7).
          this.#adoptExternal(decision.html);
          this.status = 'synced';
          return;
      }
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
