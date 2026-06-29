<script lang="ts">
  /**
   * ThemingPanel.svelte — P6-10…P6-13 theming container.
   *
   * Wires together:
   *   - ThemePicker      → deckStore.applyTheme (changes reveal theme link)
   *   - CssVarControls   → customCssStore.applyVar (color/font-size pickers)
   *   - FontChooser      → POST /api/decks/{name}/fonts → updates custom.css
   *   - CustomCssPane    → direct custom.css editing via CM6
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
   *   "Style" tab  — ThemePicker + CssVarControls + FontChooser
   *   "CSS" tab    — CustomCssPane (full CodeMirror CSS editor)
   */

  import { deckStore } from '$lib/store/deck.svelte.ts';
  import { customCssStore } from '$lib/store/customCss.svelte.ts';
  import ThemePicker from './ThemePicker.svelte';
  import CssVarControls from './CssVarControls.svelte';
  import FontChooser from './FontChooser.svelte';
  import CustomCssPane from './CustomCssPane.svelte';

  let activeTab = $state<'style' | 'css'>('style');

  const isOpen = $derived(!!deckStore.name);

  /**
   * Parse the active theme name from the deck source.
   * Looks for: assets/vendor/reveal/theme/{name}.css
   * Returns '' when no matching theme link is found.
   */
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

  /**
   * FontChooser callback: localization succeeded.
   * 1. Inject @import at the top of custom.css (if not already present).
   * 2. Update --r-main-font to use the new family.
   */
  function onFontApplied(result: { cssPath: string; family: string }): void {
    let css = customCssStore.source;
    const importLine = `@import url("${result.cssPath}");`;

    // Only add the @import once (idempotent).
    if (!css.includes(importLine)) {
      css = importLine + '\n' + css;
    }

    // Update --r-main-font with the new family + a sensible fallback.
    customCssStore.source = css;
    customCssStore.applyVar('--r-main-font', `"${result.family}", sans-serif`);
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
    /* CustomCssPane fills its own height via CM6 internals. */
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
</style>
