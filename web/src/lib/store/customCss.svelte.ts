/**
 * customCss.svelte.ts — Per-deck custom.css store (P6-11, P6-12).
 *
 * WHY A SEPARATE STORE:
 * custom.css is a file distinct from deck.html. It has its own load/save
 * lifecycle and must not contaminate the deckStore's undo history or source
 * state. Keeping it separate also makes the CodeMirror pane (CustomCssPane)
 * and the CSS variable controls (CssVarControls) independently mountable.
 *
 * DATA-FLOW:
 *   1. loadForDeck(name) → GET /api/decks/{name}/custom.css → sets source.
 *   2. User edits in CustomCssPane → updateSource(next) → debounced save.
 *   3. applyVar(varName, value) → idempotent update of the :root block in
 *      source → immediate save (so the canvas re-renders instantly).
 *   4. Every save is a PUT /api/decks/{name}/custom.css (atomic on disk).
 *
 * IDEMPOTENT :root UPDATE (P6-12):
 * The store maintains a single canonical :root { } block at the START of the
 * CSS, making it easy for the regex logic to find and update variables without
 * accumulating duplicates. The user's free-form CSS below the :root block is
 * never touched by applyVar.
 */

/** How long to wait after the last keystroke before auto-saving. */
const DEBOUNCE_MS = 600;

type CssStatus = 'empty' | 'loading' | 'synced' | 'unsaved' | 'saving' | 'error';

class CustomCssStore {
  /** Name of the deck whose custom.css we are managing, or null. */
  deckName = $state<string | null>(null);
  /** Current CSS text (controlled by CustomCssPane). */
  source = $state('');
  /** Coarse save status for the status indicator. */
  status = $state<CssStatus>('empty');
  /** Last error message, if any. */
  error = $state<string | null>(null);

  /** Bytes last confirmed to be on disk. */
  #savedSource = '';
  /** Pending debounced save handle. */
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** True when source differs from the on-disk copy. */
  get dirty(): boolean {
    return this.source !== this.#savedSource;
  }

  /**
   * Load custom.css for a deck. Called by the integrator when the open deck
   * changes (matching the deckStore.name change).
   */
  async loadForDeck(name: string): Promise<void> {
    this.deckName = name;
    this.status = 'loading';
    this.error = null;
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(name)}/custom.css`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`load custom.css: HTTP ${res.status}`);
      const css = await res.text();
      this.#adoptDisk(css);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    }
  }

  /** Adopt a fresh from-disk copy. Resets the saved baseline. */
  #adoptDisk(css: string): void {
    this.#savedSource = css;
    this.source = css;
    this.status = 'synced';
  }

  /**
   * Called by CustomCssPane on every keystroke. Schedules a debounced save
   * so the user gets continuous feedback without hammering the server.
   */
  updateSource(next: string): void {
    if (next === this.source) return;
    this.source = next;
    this.status = 'unsaved';
    this.#scheduleDebounce();
  }

  /**
   * P6-12: Idempotently set a CSS custom property in the :root block.
   *
   * Ensures exactly ONE :root block at the top of the CSS with the variable
   * in it. If the variable already exists it is replaced in-place; if it does
   * not exist it is appended inside the :root block; if no :root block exists
   * one is created at the top. After updating source, immediately saves (no
   * debounce) so the canvas re-renders right away.
   *
   * The approach keeps the user's freeform CSS below the :root block intact —
   * we only modify the :root section.
   */
  applyVar(varName: string, value: string): void {
    this.source = setCssVar(this.source, varName, value);
    this.status = 'unsaved';
    // Immediate save so the canvas reflects the new variable instantly.
    void this.save();
  }

  #scheduleDebounce(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.save();
    }, DEBOUNCE_MS);
  }

  /** Persist source to disk via PUT /api/decks/{name}/custom.css. */
  async save(): Promise<void> {
    if (!this.deckName) return;
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    const body = this.source;
    if (body === this.#savedSource) {
      if (this.status !== 'error') this.status = 'synced';
      return;
    }
    this.status = 'saving';
    try {
      const res = await fetch(
        `/api/decks/${encodeURIComponent(this.deckName)}/custom.css`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'text/css; charset=utf-8' },
          body,
        },
      );
      if (!res.ok) throw new Error(`save custom.css: HTTP ${res.status}`);
      this.#savedSource = body;
      this.status = 'synced';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    }
  }

  /** Reset to empty state (called when deck is closed). */
  clear(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.deckName = null;
    this.source = '';
    this.#savedSource = '';
    this.status = 'empty';
    this.error = null;
  }
}

/**
 * setCssVar idempotently sets --varName: value in the first :root block of css.
 *
 * Rules (P6-12 idempotent requirement):
 *   1. Find the first ``:root {`` block.
 *   2. If ``--varName:`` already exists inside it → replace in-place.
 *   3. If not → append it before the closing ``}``.
 *   4. If no :root block exists → prepend ``:root { --varName: value; }\n\n``.
 *
 * WHY REGEX NOT A CSS PARSER:
 * A full CSS parser is heavy (no suitable zero-dep library for this size of
 * project). The simple regex approach works reliably for the structured :root
 * block we control. User CSS below the :root block is never touched.
 */
export function setCssVar(css: string, varName: string, value: string): string {
  // Normalise: varName should start with --
  if (!varName.startsWith('--')) varName = '--' + varName;

  // Try to find an existing :root { ... } block (handles multi-line).
  const rootRe = /(:root\s*\{)([^}]*?)(\})/s;
  const existing = rootRe.exec(css);

  if (!existing) {
    // No :root block — prepend one.
    const block = `:root {\n  ${varName}: ${value};\n}\n\n`;
    return block + css;
  }

  const [full, open, body, close] = existing;
  // Check if the variable already exists in the block.
  // Match the variable declaration (allow optional whitespace around colon).
  // WHY NOT CAPTURE GROUPS FOR REPLACEMENT: the space before the colon is inside
  // the capture group, so using $1 would preserve it. Instead we reconstruct the
  // declaration from scratch to always produce canonical `  --var: value;` output.
  const varRe = new RegExp(`${escapeRegex(varName)}\\s*:[^;]*;`, 's');
  if (varRe.test(body)) {
    // Replace the existing declaration with a normalised canonical form.
    const newBody = body.replace(varRe, `${varName}: ${value};`);
    return css.replace(full, open + newBody + close);
  }

  // Variable not yet in the block — append it before the closing brace.
  const newBody = body.replace(/\s*$/, '') + `\n  ${varName}: ${value};\n`;
  return css.replace(full, open + newBody + close);
}

/** Escape a string for use as a literal in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Singleton custom CSS store.
 * Load it when the open deck changes:
 *   $effect(() => { if (deckStore.name) customCssStore.loadForDeck(deckStore.name); });
 */
export const customCssStore = new CustomCssStore();
