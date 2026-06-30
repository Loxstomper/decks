<script lang="ts">
  /**
   * ThemingPanel.svelte — P6-10…P6-13 + P10-5 theming container.
   *
   * Wires together:
   *   - ThemePicker      → deckStore.applyTheme (changes reveal theme link) [whole-deck]
   *   - CssVarControls   → customCssStore.applyVar (color/font-size pickers) [whole-deck]
   *   - FontChooser      → POST /api/decks/{name}/fonts → updates custom.css [whole-deck]
   *   - CustomCssPane    → direct custom.css editing via CM6
   *
   * P10-5 SCOPE TOGGLE:
   * A "Whole deck / This slide" segment control at the top of the Style tab
   * lets the user scope theme changes to just the selected slide <section>.
   *
   *   Whole deck (default):
   *     ThemePicker + CssVarControls + FontChooser — existing behaviour.
   *
   *   This slide (enabled only when a slide section is selected):
   *     • Named theme dropdown (THEME_NAMES) → deckStore.applySlideTheme(eid, name)
   *     • Free-form color swatches (heading/text/link/background) →
   *         deckStore.applySlideColorVars(eid, delta)
   *     • "Clear override" button → applySlideTheme(eid, null) + clear all vars
   *
   * The "selected slide eid" is resolved from selectionStore by scanning the
   * slide tree.  If the selection is a slide section eid (top-level or vertical)
   * it is used directly; block eids inside a slide resolve to null (scope toggle
   * remains disabled — user must click the slide row in the navigator).
   *
   * INTEGRATION NOTE (for App.svelte wiring):
   * Mount this component alongside the Outline/Properties panel or as a new
   * "Style" tab. It reads deckStore and customCssStore singletons directly so
   * the integrator does not need to thread props through multiple layers.
   *
   * The integrator MUST call customCssStore.loadForDeck(name) when the open
   * deck changes. A $effect watching deckStore.name is the canonical pattern:
   *
   *   $effect(() => {
   *     if (deckStore.name) customCssStore.loadForDeck(deckStore.name);
   *     else customCssStore.clear();
   *   });
   *
   * TABS:
   * A lightweight tab switcher keeps the panel compact:
   *   "Style" tab  — scope toggle + ThemePicker + CssVarControls + FontChooser
   *   "CSS" tab    — CustomCssPane (full CodeMirror CSS editor)
   */

  import { deckStore } from '$lib/store/deck.svelte.ts';
  import { customCssStore, parseFooterBlock } from '$lib/store/customCss.svelte.ts';
  import { selectionStore } from '$lib/canvas/selection.svelte';
  import { buildSlideTree } from '$lib/slides';
  import { findByEid } from '$lib/model';
  import { THEME_NAMES, getThemeProps } from '$lib/model/theme';
  import ThemePicker from './ThemePicker.svelte';
  import CssVarControls from './CssVarControls.svelte';
  import FontChooser from './FontChooser.svelte';
  import CustomCssPane from './CustomCssPane.svelte';

  let activeTab = $state<'style' | 'css'>('style');
  let scope = $state<'deck' | 'slide'>('deck');

  const isOpen = $derived(!!deckStore.name);

  // ── Slide tree + selected slide resolution (P10-5) ──────────────────────────

  const tree = $derived(buildSlideTree(deckStore.model));

  /**
   * Resolve the eid of the slide <section> that is currently selected.
   * Returns the eid when the selected eid is a top-level or vertical slide.
   * Returns null otherwise (block selected, or nothing selected).
   */
  const selectedSlideEid = $derived.by<string | null>(() => {
    const sel = selectionStore.eid;
    if (!sel) return null;
    for (const t of tree) {
      if (t.eid === sel) return t.eid;
      for (const v of t.verticals) {
        if (v.eid === sel) return v.eid;
      }
    }
    return null;
  });

  /** True when "This slide" scope is available (a slide section is selected). */
  const canScopeSlide = $derived(selectedSlideEid !== null);

  // Auto-fall-back: if we're in slide scope but the selection leaves a slide,
  // revert to deck scope so the panel doesn't show stale/empty controls.
  $effect(() => {
    if (scope === 'slide' && !canScopeSlide) {
      scope = 'deck';
    }
  });

  // ── Whole-deck theme (existing) ──────────────────────────────────────────────

  const currentTheme = $derived((() => {
    const m = /assets\/vendor\/reveal\/theme\/([\w-]+)\.css/.exec(deckStore.source);
    return m ? m[1] : '';
  })());

  function onApplyTheme(name: string): void {
    void deckStore.applyTheme(name);
  }

  function onApplyVar(varName: string, value: string): void {
    customCssStore.applyVar(varName, value);
  }

  function onFontApplied(result: { cssPath: string; family: string }): void {
    let css = customCssStore.source;
    const importLine = `@import url("${result.cssPath}");`;
    if (!css.includes(importLine)) {
      css = importLine + '\n' + css;
    }
    customCssStore.source = css;
    customCssStore.applyVar('--r-main-font', `"${result.family}", sans-serif`);
  }

  // ── Deck-level auto-advance (P17-20) ─────────────────────────────────────────
  //
  // The autoSlide/loop config lives inside the opaque Reveal.initialize <script>,
  // so we READ the current values by regex over deckStore.source and WRITE via
  // deckStore.applyDeckAutoslide (POST /api/decks/{name}/autoslide → byte-stable
  // deck.html rewrite → reload). Reading from source keeps the controls in sync
  // after the reload with no local mirror to drift.

  const deckAutoslideMs = $derived.by<number>(() => {
    const m = /autoSlide:\s*(\d+)/.exec(deckStore.source);
    return m ? parseInt(m[1], 10) : 0;
  });
  const deckLoop = $derived(/\bloop:\s*true\b/.test(deckStore.source));

  let autoslideBusy = $state(false);

  async function applyDeckAutoslide(ms: number, loop: boolean): Promise<void> {
    if (autoslideBusy) return;
    autoslideBusy = true;
    try {
      await deckStore.applyDeckAutoslide(ms, loop);
    } finally {
      autoslideBusy = false;
    }
  }

  function onDeckAutoslideInput(e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).value.trim();
    const ms = raw === '' ? 0 : parseInt(raw, 10);
    if (!Number.isFinite(ms) || ms < 0) return;
    void applyDeckAutoslide(ms, deckLoop);
  }

  function onDeckLoopToggle(e: Event): void {
    void applyDeckAutoslide(deckAutoslideMs, (e.currentTarget as HTMLInputElement).checked);
  }

  // ── Deck-level slide numbers (P17-17) ────────────────────────────────────────
  //
  // The slideNumber config lives inside the opaque Reveal.initialize <script>, so
  // we READ current state by regex over deckStore.source and WRITE via
  // deckStore.applyDeckSlideNumber (POST /api/decks/{name}/slide-number →
  // byte-stable deck.html rewrite → reload). Reading from source keeps the
  // controls in sync after the reload with no local mirror to drift.

  /** Current slideNumber format token ('' = off). */
  const slideNumberFormat = $derived.by<string>(() => {
    const m = /slideNumber:\s*'([^']*)'/.exec(deckStore.source);
    return m ? m[1] : '';
  });
  const slideNumberEnabled = $derived(slideNumberFormat !== '');

  let slideNumberBusy = $state(false);

  async function applyDeckSlideNumber(enabled: boolean, format: string): Promise<void> {
    if (slideNumberBusy) return;
    slideNumberBusy = true;
    try {
      await deckStore.applyDeckSlideNumber(enabled, format);
    } finally {
      slideNumberBusy = false;
    }
  }

  function onSlideNumberToggle(e: Event): void {
    const on = (e.currentTarget as HTMLInputElement).checked;
    void applyDeckSlideNumber(on, on ? slideNumberFormat || 'c/t' : '');
  }

  function onSlideNumberFormat(e: Event): void {
    const fmt = (e.currentTarget as HTMLSelectElement).value;
    void applyDeckSlideNumber(true, fmt);
  }

  // ── Deck footer (P17-18, managed custom.css block) ───────────────────────────
  //
  // The footer is a managed region in custom.css. We READ it back from
  // customCssStore.source via parseFooterBlock and WRITE via setFooter/clearFooter
  // (idempotent block ops). Per-slide opt-out is in the Properties panel.

  const footer = $derived(parseFooterBlock(customCssStore.source));
  const footerText = $derived(footer?.text ?? '');
  const footerLogo = $derived(footer?.logoSrc ?? '');

  function onFooterTextInput(e: Event): void {
    const text = (e.currentTarget as HTMLInputElement).value;
    if (text.trim() === '' && !footerLogo) {
      customCssStore.clearFooter();
    } else {
      customCssStore.setFooter(text, footerLogo || null);
    }
  }

  function onFooterLogoInput(e: Event): void {
    const logo = (e.currentTarget as HTMLInputElement).value.trim();
    if (footerText.trim() === '' && logo === '') {
      customCssStore.clearFooter();
    } else {
      customCssStore.setFooter(footerText, logo || null);
    }
  }

  function onClearFooter(): void {
    customCssStore.clearFooter();
  }

  // ── Per-slide theming (P10-5) ────────────────────────────────────────────────

  const slideThemeProps = $derived.by(() => {
    const eid = selectedSlideEid;
    if (!eid || !deckStore.model) return null;
    const el = findByEid(deckStore.model, eid);
    if (!el) return null;
    return getThemeProps(el);
  });

  const themeNames = $derived([...THEME_NAMES].sort());

  const slideCurrentTheme = $derived(slideThemeProps?.theme ?? '');

  const slideColors = $derived({
    heading:    slideThemeProps?.inlineVars?.['--r-heading-color'] ?? '',
    text:       slideThemeProps?.inlineVars?.['--r-main-color'] ?? '',
    link:       slideThemeProps?.inlineVars?.['--r-link-color'] ?? '',
    background: slideThemeProps?.backgroundColor ?? '',
  });

  const hasSlideOverride = $derived(
    !!(slideThemeProps?.theme || slideThemeProps?.backgroundColor || slideThemeProps?.inlineVars),
  );

  /** Color swatches shown in the "This slide" panel. */
  const COLOR_FIELDS: Array<{ field: keyof typeof slideColors; label: string }> = [
    { field: 'heading',    label: 'Heading'    },
    { field: 'text',       label: 'Body text'  },
    { field: 'link',       label: 'Links'      },
    { field: 'background', label: 'Background' },
  ];

  function onApplySlideTheme(e: Event): void {
    const eid = selectedSlideEid;
    if (!eid) return;
    const val = (e.currentTarget as HTMLSelectElement).value;
    void deckStore.applySlideTheme(eid, val || null);
  }

  function onApplySlideColor(field: keyof typeof slideColors, e: Event): void {
    const eid = selectedSlideEid;
    if (!eid) return;
    const val = (e.currentTarget as HTMLInputElement).value;
    if (field === 'background') {
      void deckStore.applySlideColorVars(eid, { backgroundColor: val });
    } else {
      void deckStore.applySlideColorVars(eid, { [field]: val });
    }
  }

  function onClearSlideOverride(): void {
    const eid = selectedSlideEid;
    if (!eid) return;
    // Clear named theme + background-color via applySlideTheme(null).
    void deckStore.applySlideTheme(eid, null);
    // Clear inline --r-* vars.
    void deckStore.applySlideColorVars(eid, {
      heading: null,
      text: null,
      link: null,
      backgroundColor: null,
    });
  }

  /**
   * Convert a CSS color string to a 6-digit hex for <input type="color">.
   * Falls back to #000000 for unknown/empty values.
   */
  function toPickerColor(css: string): string {
    if (!css) return '#000000';
    const t = css.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
    if (/^#[0-9a-fA-F]{3}$/.test(t)) {
      const m = t.match(/^#(.)(.)(.)$/);
      if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
    }
    const rgb = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) {
      return '#' + [rgb[1], rgb[2], rgb[3]]
        .map((n) => parseInt(n, 10).toString(16).padStart(2, '0'))
        .join('');
    }
    return '#000000';
  }
</script>

<div class="theming-panel">
  <!-- Tab bar -->
  <div class="tab-bar" role="tablist" aria-label="Theming panel tabs">
    <button
      type="button"
      role="tab"
      class="tab-btn"
      class:active={activeTab === 'style'}
      aria-selected={activeTab === 'style'}
      onclick={() => (activeTab = 'style')}
    >Style</button>
    <button
      type="button"
      role="tab"
      class="tab-btn"
      class:active={activeTab === 'css'}
      aria-selected={activeTab === 'css'}
      onclick={() => (activeTab = 'css')}
    >CSS</button>

    <!-- Save status indicator for custom.css -->
    {#if customCssStore.status === 'saving'}
      <span class="save-indicator saving" aria-live="polite">Saving…</span>
    {:else if customCssStore.status === 'unsaved'}
      <span class="save-indicator unsaved" aria-live="polite">Unsaved</span>
    {:else if customCssStore.status === 'error'}
      <span class="save-indicator error" title={customCssStore.error ?? ''}>Error</span>
    {/if}
  </div>

  <!-- Style tab: pickers + font chooser -->
  {#if activeTab === 'style'}
    <div class="tab-content style-tab" role="tabpanel" aria-label="Style controls">

      <!-- P10-5: Scope toggle "Whole deck" / "This slide" -->
      <div class="scope-toggle" role="group" aria-label="Theme scope">
        <button
          type="button"
          class="scope-btn"
          class:active={scope === 'deck'}
          onclick={() => (scope = 'deck')}
          aria-pressed={scope === 'deck'}
        >Whole deck</button>
        <button
          type="button"
          class="scope-btn"
          class:active={scope === 'slide'}
          disabled={!canScopeSlide}
          onclick={() => { if (canScopeSlide) scope = 'slide'; }}
          aria-pressed={scope === 'slide'}
          title={canScopeSlide
            ? 'Apply theme to this slide only'
            : 'Select a slide in the navigator first'}
        >This slide</button>
      </div>

      <div class="separator"></div>

      {#if scope === 'deck'}
        <!-- ── Whole-deck controls (unchanged) ─────────────────────────── -->
        <ThemePicker
          {currentTheme}
          disabled={!isOpen}
          onApply={onApplyTheme}
        />

        <div class="separator"></div>

        <CssVarControls
          cssSource={customCssStore.source}
          disabled={!isOpen}
          {onApplyVar}
        />

        <div class="separator"></div>

        <FontChooser
          deckName={deckStore.name}
          disabled={!isOpen}
          {onFontApplied}
        />

        <div class="separator"></div>

        <!-- ── Deck-level auto-advance (P17-20) ─────────────────────────── -->
        <div class="slide-theme-section">
          <div class="section-title">Auto-advance</div>
          <div class="control-row">
            <label class="control-label" for="deck-autoslide">Default (ms)</label>
            <input
              id="deck-autoslide"
              class="picker-select"
              type="number"
              min="0"
              step="500"
              placeholder="off"
              disabled={!isOpen || autoslideBusy}
              value={deckAutoslideMs || ''}
              onchange={onDeckAutoslideInput}
            />
          </div>
          <div class="control-row">
            <label class="control-label" for="deck-loop">Loop deck</label>
            <input
              id="deck-loop"
              type="checkbox"
              disabled={!isOpen || autoslideBusy}
              checked={deckLoop}
              onchange={onDeckLoopToggle}
            />
          </div>
        </div>

        <div class="separator"></div>

        <!-- ── Slide numbers (P17-17) ──────────────────────────────────── -->
        <div class="slide-theme-section">
          <div class="section-title">Slide numbers</div>
          <div class="control-row">
            <label class="control-label" for="deck-slide-number">Show</label>
            <input
              id="deck-slide-number"
              type="checkbox"
              disabled={!isOpen || slideNumberBusy}
              checked={slideNumberEnabled}
              onchange={onSlideNumberToggle}
            />
          </div>
          {#if slideNumberEnabled}
            <div class="control-row">
              <label class="control-label" for="deck-slide-number-format">Format</label>
              <select
                id="deck-slide-number-format"
                class="picker-select"
                disabled={!isOpen || slideNumberBusy}
                value={slideNumberFormat}
                onchange={onSlideNumberFormat}
              >
                <option value="c">1</option>
                <option value="c/t">current / total</option>
              </select>
            </div>
          {/if}
        </div>

        <div class="separator"></div>

        <!-- ── Deck footer (P17-18) ────────────────────────────────────── -->
        <div class="slide-theme-section">
          <div class="section-title">Footer</div>
          <div class="control-row">
            <label class="control-label" for="deck-footer-text">Text</label>
            <input
              id="deck-footer-text"
              class="picker-select"
              type="text"
              placeholder="(none)"
              disabled={!isOpen}
              value={footerText}
              onchange={onFooterTextInput}
            />
          </div>
          <div class="control-row">
            <label class="control-label" for="deck-footer-logo">Logo</label>
            <input
              id="deck-footer-logo"
              class="picker-select"
              type="text"
              placeholder="assets/logo.png"
              disabled={!isOpen}
              value={footerLogo}
              onchange={onFooterLogoInput}
            />
          </div>
          {#if footerText || footerLogo}
            <button
              type="button"
              class="clear-btn"
              onclick={onClearFooter}
              title="Remove the deck footer"
            >
              Clear footer
            </button>
          {/if}
        </div>

      {:else}
        <!-- ── Per-slide theming (P10-5) ───────────────────────────────── -->
        <div class="slide-theme-section">
          <div class="section-title">Named theme</div>
          <div class="control-row">
            <label class="control-label" for="slide-theme-select">Theme</label>
            <select
              id="slide-theme-select"
              class="picker-select"
              value={slideCurrentTheme}
              onchange={onApplySlideTheme}
            >
              <option value="">— inherit deck —</option>
              {#each themeNames as name (name)}
                <option value={name}>
                  {name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </option>
              {/each}
            </select>
          </div>
        </div>

        <div class="separator"></div>

        <div class="slide-theme-section">
          <div class="section-title">Color overrides</div>
          {#each COLOR_FIELDS as { field, label } (field)}
            <div class="control-row">
              <label class="control-label" for="slide-color-{field}">{label}</label>
              <input
                id="slide-color-{field}"
                type="color"
                class="color-swatch"
                value={toPickerColor(slideColors[field])}
                onchange={(e) => onApplySlideColor(field, e)}
                title="{label} color override"
                aria-label="{label} color override for this slide"
              />
              {#if slideColors[field]}
                <span class="color-value">{slideColors[field]}</span>
              {/if}
            </div>
          {/each}
        </div>

        <div class="separator"></div>

        <div class="slide-theme-section">
          <button
            type="button"
            class="clear-btn"
            disabled={!hasSlideOverride}
            onclick={onClearSlideOverride}
            title="Remove all per-slide theme overrides — inherits from deck"
          >
            Clear override → inherit deck
          </button>
        </div>
      {/if}
    </div>

  <!-- CSS tab: full CodeMirror custom.css editor -->
  {:else}
    <div class="tab-content css-tab" role="tabpanel" aria-label="Custom CSS editor">
      {#if !isOpen}
        <p class="empty-state">No deck open.</p>
      {:else}
        <CustomCssPane
          value={customCssStore.source}
          onChange={(next) => customCssStore.updateSource(next)}
          class="h-full"
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .theming-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.75);
  }

  /* ── Tab bar ── */
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    flex-shrink: 0;
  }

  .tab-btn {
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .tab-btn.active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.9);
  }

  .tab-btn:hover:not(.active) {
    color: rgba(255, 255, 255, 0.65);
  }

  .save-indicator {
    margin-left: auto;
    font-size: 0.6rem;
    font-weight: 600;
  }

  .save-indicator.saving { color: rgba(96, 165, 250, 0.8); }
  .save-indicator.unsaved { color: rgba(251, 191, 36, 0.8); }
  .save-indicator.error { color: rgba(248, 113, 113, 0.9); cursor: help; }

  /* ── Tab content ── */
  .tab-content {
    flex: 1;
    overflow: hidden;
  }

  .style-tab {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .css-tab {
    display: flex;
    flex-direction: column;
  }

  .separator {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 0;
  }

  .empty-state {
    padding: 16px 12px;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.3);
    text-align: center;
  }

  /* ── P10-5: Scope toggle ── */
  .scope-toggle {
    display: flex;
    gap: 0;
    padding: 6px 12px;
    flex-shrink: 0;
  }

  .scope-btn {
    flex: 1;
    padding: 3px 8px;
    font-size: 0.63rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .scope-btn:first-child {
    border-radius: 4px 0 0 4px;
  }

  .scope-btn:last-child {
    border-radius: 0 4px 4px 0;
    border-left: none;
  }

  .scope-btn.active {
    background: rgba(79, 140, 255, 0.2);
    border-color: rgba(79, 140, 255, 0.4);
    color: rgba(139, 195, 255, 0.95);
  }

  .scope-btn:hover:not(.active):not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
  }

  .scope-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* ── P10-5: Per-slide theme controls ── */
  .slide-theme-section {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .control-label {
    flex: 0 0 72px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
  }

  .picker-select {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.1s;
  }

  .picker-select:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }

  .color-swatch {
    width: 28px;
    height: 20px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    background: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .color-value {
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.35);
    font-family: monospace;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clear-btn {
    width: 100%;
    padding: 5px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 160, 120, 0.85);
    font-size: 0.65rem;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    transition: background 0.1s, color 0.1s;
  }

  .clear-btn:hover:not(:disabled) {
    background: rgba(220, 80, 60, 0.2);
    color: rgba(255, 130, 100, 1);
  }

  .clear-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
