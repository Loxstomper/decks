<script lang="ts">
  /**
   * PropertiesPanel.svelte — Container layout properties panel (P3-4 / spec 03).
   *
   * WHY THIS EXISTS:
   * ================
   * When the user selects an element in the canvas or outline, this panel shows
   * editable controls for the element's layout properties (gap, align, justify,
   * pad, cols, rows) and an alignment-as-intent toolbar (P3-5).
   *
   * SINGLE SOURCE OF TRUTH:
   * Layout props are read from the model via `getLayoutProps(el)` and written back
   * via `setLayoutProps(el, delta)` + `onApplyLayoutChange(eid, delta)`.  The
   * panel never stores a local copy — every control is a derived view of the model
   * that re-reads on each render cycle triggered by the reactive `deckStore.model`.
   *
   * STORE COMMAND PATTERN (spec 02 byte-stability):
   * The panel fires `onApplyLayoutChange(eid, partialProps)`.  The integrator
   * wires this to `deckStore.applyLayoutChange(eid, delta)` (a new method the
   * integrator adds to DeckStore — see integration_notes):
   *
   *   async applyLayoutChange(eid: string, delta: Partial<LayoutProps>) {
   *     const el = findByEid(this.model, eid);
   *     if (!el) return;
   *     setLayoutProps(el, delta);
   *     this.updateFromModel();
   *     await this.commitCommand(); // one undo entry + autosave
   *   }
   *
   * The callback approach keeps this panel free of direct store imports so it
   * remains easily testable.  For "equal columns" (set data-grow="1" on children)
   * a separate `onApplyEqualColumns(containerEid)` callback is provided.
   *
   * SELECTION RESOLUTION:
   * The panel accepts `selectedEid` as a prop (from selectionStore.eid).
   * Internally it calls `resolveContainerForEid()` to determine WHICH container's
   * props to display.  If a leaf is selected, the parent container is shown; a
   * banner tells the user which container they are editing.
   *
   * SVELTE 5: no createEventDispatcher — all callbacks are typed prop functions.
   *
   * TYPE NOTE: avoid naming local variables `props` — it collides with the Svelte
   * `$props` rune symbol in svelte-check's type analysis and produces spurious
   * "used before declaration" errors.  Use `layoutProps` instead.
   */

  import { deckStore } from '$lib/store/deck.svelte';
  import {
    getLayoutProps,
    resolveContainerForEid,
    type LayoutProps,
    type AlignValue,
    type JustifyValue,
  } from '$lib/model/layout';
  import { getAttribute, findByEid, isTextLeaf, getInlineColor, getFooterHidden } from '$lib/model';
  import type { ElementNode } from '$lib/model/types';
  import AlignmentToolbar from './AlignmentToolbar.svelte';
  import TextColorControl from './TextColorControl.svelte';
  import SlideBackgroundControl from './SlideBackgroundControl.svelte';

  // ── Component props ────────────────────────────────────────────────────────

  interface PanelProps {
    /**
     * The `data-eid` of the currently selected element, or null when nothing
     * is selected.  Normally wired to `selectionStore.eid`.
     */
    selectedEid: string | null;

    /**
     * Called when the user changes any layout prop.
     * Integrator wires to `deckStore.applyLayoutChange(eid, delta)`.
     *
     * WHY A CALLBACK INSTEAD OF CALLING THE STORE DIRECTLY:
     * The panel does not import deckStore so it stays testable and composable.
     */
    onApplyLayoutChange?: (eid: string, delta: Partial<LayoutProps>) => void;

    /**
     * Called when the user clicks "Equal columns/rows".
     * Sets data-grow="1" on all element children of the given container.
     * Integrator wires to `deckStore.applyEqualColumns(eid)`.
     */
    onApplyEqualColumns?: (containerEid: string) => void;
  }

  let { selectedEid, onApplyLayoutChange, onApplyEqualColumns }: PanelProps = $props();

  // ── Resolution helpers (typed functions break $derived type-inference cycles) ──

  /**
   * WHY A NAMED FUNCTION:
   * Svelte 5's $derived.by() with a captured $props() variable causes svelte-check
   * to report circular type-inference errors ("referenced directly or indirectly in
   * its own initializer").  Extracting the logic into a named function gives
   * TypeScript an explicit return type to anchor the inference chain.
   */
  function resolveContainer(
    eid: string | null,
  ): { el: ElementNode; isOwnContainer: boolean } | null {
    if (!eid || !deckStore.model) return null;
    return resolveContainerForEid(deckStore.model, eid);
  }

  function deriveContainerEid(el: ElementNode | null): string | null {
    return el ? getAttribute(el, 'data-eid') : null;
  }

  function deriveLayoutProps(el: ElementNode | null): LayoutProps | null {
    return el ? getLayoutProps(el) : null;
  }

  function deriveKind(el: ElementNode | null, lp: LayoutProps | null): string {
    if (!el) return '';
    if (el.tagName.toLowerCase() === 'section') return 'Slide';
    return lp?.lay ?? 'container';
  }

  // ── Reactive derived state ─────────────────────────────────────────────────

  const resolved = $derived(resolveContainer(selectedEid));
  const container: ElementNode | null = $derived(resolved?.el ?? null);
  const isOwnContainer: boolean = $derived(resolved?.isOwnContainer ?? false);
  const layoutProps: LayoutProps | null = $derived(deriveLayoutProps(container));
  const containerEid: string | null = $derived(deriveContainerEid(container));
  const containerKind: string = $derived(deriveKind(container, layoutProps));
  const isGrid: boolean = $derived(layoutProps?.lay === 'grid');
  /** True when something is selected but no editable container could be found. */
  const isPassthrough: boolean = $derived(!!selectedEid && !container);

  // ── P17-18: per-slide footer opt-out (data-footer-hidden) ───────────────────
  /** Whether the resolved Slide section opts out of the deck footer. */
  const slideFooterHidden: boolean = $derived(
    containerKind === 'Slide' && container ? getFooterHidden(container) : false,
  );

  function onFooterHiddenToggle(e: Event): void {
    if (!containerEid) return;
    const hidden = (e.currentTarget as HTMLInputElement).checked;
    void deckStore.setSlideFooterHidden(containerEid, hidden);
  }

  // ── P9-8: per-element text colour (spec 09 "Text appearance") ──────────────
  //
  // Shown only when the SELECTED element itself is a text leaf (heading /
  // paragraph / list / leaf) — independent of the resolved layout container. The
  // colour is read from / written to that exact element's inline style.

  /**
   * The selected element when it is a text leaf, else null. Named function for
   * the same $derived type-inference reason documented above.
   */
  function deriveTextLeaf(eid: string | null): ElementNode | null {
    if (!eid || !deckStore.model) return null;
    const el = findByEid(deckStore.model, eid);
    return el && isTextLeaf(el) ? el : null;
  }

  const textLeaf: ElementNode | null = $derived(deriveTextLeaf(selectedEid));
  const textColor: string | null = $derived(textLeaf ? getInlineColor(textLeaf) : null);

  function onTextColorChange(value: string | null): void {
    if (!selectedEid) return;
    // Panel already depends on deckStore (model reads); call the command directly
    // so wiring needs no new prop on the shell (App.svelte stays untouched).
    void deckStore.applyTextColor(selectedEid, value);
  }

  // ── Mutation helpers ───────────────────────────────────────────────────────

  function applyDelta(delta: Partial<LayoutProps>): void {
    if (!containerEid || !onApplyLayoutChange) return;
    onApplyLayoutChange(containerEid, delta);
  }

  function parsePxInput(raw: string): number | null {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  // ── Input handlers ─────────────────────────────────────────────────────────

  function onGapInput(e: Event): void {
    applyDelta({ gap: parsePxInput((e.target as HTMLInputElement).value) });
  }

  function onPadInput(e: Event): void {
    applyDelta({ pad: parsePxInput((e.target as HTMLInputElement).value) });
  }

  function onColsInput(e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim();
    applyDelta({ cols: raw || null });
  }

  function onRowsInput(e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim();
    applyDelta({ rows: raw || null });
  }

  function onAlignChange(value: AlignValue | null): void {
    applyDelta({ align: value });
  }

  function onJustifyChange(value: JustifyValue | null): void {
    applyDelta({ justify: value });
  }

  function onEqualColumns(): void {
    if (!containerEid || !onApplyEqualColumns) return;
    onApplyEqualColumns(containerEid);
  }
</script>

<!-- ── Panel root ──────────────────────────────────────────────────────────── -->
<div class="properties-panel">

  <!-- ── P9-8: text colour — shown whenever a TEXT leaf is selected ────────── -->
  {#if textLeaf}
    <TextColorControl color={textColor} onColorChange={onTextColorChange} />
    <div class="separator"></div>
  {/if}

  {#if !selectedEid}
    <!-- Empty state: nothing selected -->
    <p class="empty-state">Select an element to see its properties.</p>

  {:else if isPassthrough}
    <!-- Passthrough or unrecognised element: no layout controls -->
    <p class="empty-state muted">
      This element has no editable layout properties.
    </p>

  {:else if container && layoutProps}

    <!-- ── Context banner when viewing a leaf's parent container ──────── -->
    {#if !isOwnContainer}
      <div class="context-banner">
        <svg class="icon-inline" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zm0 3.25a.75.75 0 100 1.5.75.75 0 000-1.5zm-.75 2.5a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3z"/>
        </svg>
        Showing parent <strong>{containerKind}</strong> container
      </div>
    {/if}

    <!-- ── Container kind badge ───────────────────────────────────────── -->
    <div class="section-header">
      <span class="kind-badge">{containerKind}</span>
      <span class="eid-label">{containerEid}</span>
    </div>

    <!-- ── Alignment-as-intent toolbar (P3-5) ───────────────────────── -->
    <div class="prop-section">
      <AlignmentToolbar
        lay={layoutProps.lay}
        align={layoutProps.align}
        justify={layoutProps.justify}
        {onAlignChange}
        {onJustifyChange}
      />

      <!-- Equal columns/rows: sets data-grow=1 on all element children so
           flex distributes space evenly (spec 03 "equal columns" intent).
           Not shown for grid (use data-cols template instead) or layers. -->
      {#if layoutProps.lay === 'row' || layoutProps.lay === 'stack'}
        <button class="action-btn" onclick={onEqualColumns}>
          Equal {layoutProps.lay === 'row' ? 'columns' : 'rows'}
        </button>
      {/if}
    </div>

    <div class="separator"></div>

    <!-- ── Spacing controls ───────────────────────────────────────────── -->
    <div class="prop-section">
      <div class="prop-row">
        <label class="prop-label" for="prop-gap">Gap</label>
        <div class="input-with-unit">
          <input
            id="prop-gap"
            class="prop-input"
            type="number"
            min="0"
            step="4"
            placeholder="—"
            value={layoutProps.gap ?? ''}
            onchange={onGapInput}
          />
          <span class="unit">px</span>
        </div>
      </div>

      <div class="prop-row">
        <label class="prop-label" for="prop-pad">Pad</label>
        <div class="input-with-unit">
          <input
            id="prop-pad"
            class="prop-input"
            type="number"
            min="0"
            step="4"
            placeholder="—"
            value={layoutProps.pad ?? ''}
            onchange={onPadInput}
          />
          <span class="unit">px</span>
        </div>
      </div>
    </div>

    <!-- ── Grid-only controls ─────────────────────────────────────────── -->
    {#if isGrid}
      <div class="separator"></div>
      <div class="prop-section">
        <div class="section-sublabel">Grid</div>

        <div class="prop-row">
          <label class="prop-label" for="prop-cols">Cols</label>
          <input
            id="prop-cols"
            class="prop-input prop-input--text"
            type="text"
            placeholder="3 · repeat(3,1fr)"
            value={layoutProps.cols ?? ''}
            onchange={onColsInput}
          />
        </div>

        <div class="prop-row">
          <label class="prop-label" for="prop-rows">Rows</label>
          <input
            id="prop-rows"
            class="prop-input prop-input--text"
            type="text"
            placeholder="auto"
            value={layoutProps.rows ?? ''}
            onchange={onRowsInput}
          />
        </div>
      </div>
    {/if}

    <!-- ── P16-3a: slide background — shown when the resolved container is a Slide ── -->
    {#if containerKind === 'Slide' && containerEid}
      <div class="separator"></div>
      <SlideBackgroundControl slideEid={containerEid} />

      <!-- ── P17-18: per-slide footer opt-out (data-footer-hidden) ── -->
      <div class="separator"></div>
      <div class="prop-section">
        <div class="section-sublabel">Footer</div>
        <div class="prop-row">
          <label class="prop-label" for="slide-footer-hidden">Hide on this slide</label>
          <input
            id="slide-footer-hidden"
            type="checkbox"
            checked={slideFooterHidden}
            onchange={onFooterHiddenToggle}
          />
        </div>
      </div>
    {/if}

  {/if}
</div>

<style>
  .properties-panel {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 8px 0;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.75);
  }

  /* ── Empty states ───────────────────────────────────────────────────────── */
  .empty-state {
    padding: 16px 12px;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.3);
    text-align: center;
    user-select: none;
  }

  .empty-state.muted {
    color: rgba(255, 255, 255, 0.2);
  }

  /* ── Context banner ─────────────────────────────────────────────────────── */
  .context-banner {
    margin: 0 8px 6px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(255, 200, 50, 0.08);
    border: 1px solid rgba(255, 200, 50, 0.2);
    color: rgba(255, 200, 100, 0.8);
    font-size: 0.65rem;
    line-height: 1.4;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .icon-inline {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    opacity: 0.6;
  }

  /* ── Section header (kind badge + eid) ──────────────────────────────────── */
  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px 8px;
  }

  .kind-badge {
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: rgba(147, 197, 253, 0.9);
    font-weight: 600;
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .eid-label {
    color: rgba(255, 255, 255, 0.25);
    font-family: var(--font-mono, monospace);
    font-size: 0.65rem;
  }

  /* ── Prop sections ──────────────────────────────────────────────────────── */
  .prop-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 12px;
  }

  .section-sublabel {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 2px;
  }

  .separator {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 2px 0;
  }

  /* ── Prop rows ──────────────────────────────────────────────────────────── */
  .prop-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .prop-label {
    flex: 0 0 40px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
  }

  /* ── Inputs ─────────────────────────────────────────────────────────────── */
  .input-with-unit {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .prop-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.1s;
  }

  .prop-input:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }

  /* Hide number spinners — waste space in the narrow panel. */
  .prop-input[type="number"]::-webkit-inner-spin-button,
  .prop-input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    appearance: none;
  }

  .prop-input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
    width: 56px;
    flex: none;
  }

  .prop-input--text {
    width: 100%;
  }

  .unit {
    color: rgba(255, 255, 255, 0.3);
    font-size: 0.65rem;
  }

  /* ── Action buttons ─────────────────────────────────────────────────────── */
  .action-btn {
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
    align-self: flex-start;
    margin-top: 4px;
    transition: background 0.1s, color 0.1s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }
</style>
