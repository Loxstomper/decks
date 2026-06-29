<script lang="ts">
  /**
   * PaneLayout.svelte — Three-zone resizable/collapsible editor layout
   * (P1-1, extended in P9-3/4/5).
   *
   * Layout (spec 04):
   *   ┌──────────────┬──────────────────────────┬─────────────────────────┐
   *   │  Navigator   │        Canvas            │  Outline+Props / Source │
   *   │  (filmstrip) │  (iframe + overlay)      │  (tabbed right panel)   │
   *   └──────────────┴──────────────────────────┴─────────────────────────┘
   *
   * Collapsible & resizable chrome (P9):
   *   - Navigator and the right panel each collapse to a thin rail via a
   *     chevron; clicking the rail restores the previous width.
   *   - The source pane (bottom of the right panel) collapses independently via
   *     a header toggle; the outline/properties then use the full panel height.
   *   - Every boundary is an individually draggable <Splitter> within min/max.
   *   - All sizes + collapse flags persist at workspace level (localStorage).
   */

  import Splitter from './Splitter.svelte';
  import type { Snippet } from 'svelte';
  import {
    PANE_BOUNDS,
    RAIL_WIDTH,
    clamp,
    loadPaneState,
    savePaneState,
    type PaneState,
  } from '$lib/layout/panes';

  /**
   * Zone snippets (P1 wiring). The shell (App.svelte) injects the live
   * components — Navigator deck list, RevealFrame canvas, SourcePane editor —
   * while PaneLayout stays a pure layout primitive. Each is optional.
   */
  interface Props {
    navigator?: Snippet;
    canvasHeader?: Snippet;
    canvas?: Snippet;
    outline?: Snippet;
    source?: Snippet;
  }
  let { navigator, canvasHeader, canvas, outline, source }: Props = $props();

  // ── Persisted layout state ─────────────────────────────────────────────────
  const initial: PaneState = loadPaneState();

  let navWidth        = $state(initial.navWidth);
  let rightWidth      = $state(initial.rightWidth);
  let rightTopHeight  = $state(initial.rightTopHeight);
  let navCollapsed    = $state(initial.navCollapsed);
  let rightCollapsed  = $state(initial.rightCollapsed);
  let sourceCollapsed = $state(initial.sourceCollapsed);

  /** Live height of the right-panel content, used to bound the inner split. */
  let rightPanelHeight = $state(0);

  /** Minimum height (px) the source pane must keep when expanded. */
  const SOURCE_MIN = 120;

  function persist(): void {
    savePaneState({
      navWidth,
      rightWidth,
      rightTopHeight,
      navCollapsed,
      rightCollapsed,
      sourceCollapsed,
    });
  }

  // ── Drag handlers (delta-based, clamped to bounds) ─────────────────────────
  function onNavResize(delta: number) {
    navWidth = clamp(navWidth + delta, PANE_BOUNDS.navWidth);
  }

  function onRightResize(delta: number) {
    // Dragging the handle left (negative delta) widens the right panel.
    rightWidth = clamp(rightWidth - delta, PANE_BOUNDS.rightWidth);
  }

  function onRightInnerResize(delta: number) {
    // Clamp against both the static bound and the live panel height so the
    // source pane always keeps SOURCE_MIN of usable space.
    const dynamicMax = rightPanelHeight > 0
      ? Math.max(PANE_BOUNDS.rightTopHeight.min, rightPanelHeight - SOURCE_MIN)
      : PANE_BOUNDS.rightTopHeight.max;
    const next = rightTopHeight + delta;
    rightTopHeight = Math.min(
      Math.min(dynamicMax, PANE_BOUNDS.rightTopHeight.max),
      Math.max(PANE_BOUNDS.rightTopHeight.min, next),
    );
  }

  // ── Collapse toggles ───────────────────────────────────────────────────────
  function toggleNav() {
    navCollapsed = !navCollapsed;
    persist();
  }
  function toggleRight() {
    rightCollapsed = !rightCollapsed;
    persist();
  }
  function toggleSource() {
    sourceCollapsed = !sourceCollapsed;
    persist();
  }
</script>

<div class="editor-shell flex h-full w-full overflow-hidden bg-surface text-white">

  <!-- ── Navigator pane ────────────────────────────────────────────────── -->
  {#if navCollapsed}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button
      class="pane-rail flex flex-col items-center gap-2 border-r border-surface-overlay bg-surface-raised py-2 text-white/50 hover:text-white"
      style="width: {RAIL_WIDTH}px;"
      title="Expand navigator"
      aria-label="Expand navigator"
      onclick={toggleNav}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      <span class="pane-rail-label">Navigator</span>
    </button>
  {:else}
    <aside
      class="navigator flex flex-col border-r border-surface-overlay bg-surface-raised overflow-hidden"
      style="width: {navWidth}px; min-width: {PANE_BOUNDS.navWidth.min}px; max-width: {PANE_BOUNDS.navWidth.max}px;"
    >
      <header class="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50">
        <span>Navigator</span>
        <button
          class="text-white/40 hover:text-white"
          title="Collapse navigator"
          aria-label="Collapse navigator"
          onclick={toggleNav}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </header>
      <div class="flex-1 overflow-y-auto px-2 py-1">
        {#if navigator}
          {@render navigator()}
        {:else}
          <p class="text-xs text-white/30 mt-4 text-center">No slides yet</p>
        {/if}
      </div>
    </aside>

    <Splitter direction="col" onresize={onNavResize} onresizeend={persist} />
  {/if}

  <!-- ── Canvas pane ────────────────────────────────────────────────────── -->
  <main class="canvas-pane flex-1 flex flex-col overflow-hidden bg-black/30 relative">
    <header class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-surface-overlay flex items-center gap-2">
      <span>Canvas</span>
      {#if canvasHeader}
        {@render canvasHeader()}
      {:else}
        <span class="ml-auto text-white/30">100%</span>
      {/if}
    </header>

    <div class="canvas-viewport flex-1 relative overflow-hidden flex items-center justify-center">
      {#if canvas}
        {@render canvas()}
      {:else}
        <div class="canvas-placeholder flex flex-col items-center gap-2 text-white/20 select-none">
          <div class="w-16 h-16 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-accent/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </div>
          <span class="text-sm">Canvas (iframe + overlay)</span>
          <span class="text-xs">1920 × 1080 logical</span>
        </div>
      {/if}
    </div>
  </main>

  <!-- ── Right panel (Outline+Properties / Source) ─────────────────────── -->
  {#if rightCollapsed}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button
      class="pane-rail flex flex-col items-center gap-2 border-l border-surface-overlay bg-surface-raised py-2 text-white/50 hover:text-white"
      style="width: {RAIL_WIDTH}px;"
      title="Expand panel"
      aria-label="Expand right panel"
      onclick={toggleRight}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      <span class="pane-rail-label">Outline / Source</span>
    </button>
  {:else}
    <Splitter direction="col" onresize={onRightResize} onresizeend={persist} />

    <aside
      class="right-panel flex flex-col border-l border-surface-overlay bg-surface-raised overflow-hidden"
      style="width: {rightWidth}px; min-width: {PANE_BOUNDS.rightWidth.min}px; max-width: {PANE_BOUNDS.rightWidth.max}px;"
      bind:clientHeight={rightPanelHeight}
    >
      <!-- Outline + Properties (top). Takes the full height when source is collapsed. -->
      <div
        class="outline-props flex flex-col overflow-hidden"
        class:flex-1={sourceCollapsed}
        style={sourceCollapsed ? '' : `height: ${rightTopHeight}px; min-height: ${PANE_BOUNDS.rightTopHeight.min}px;`}
      >
        <header class="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-surface-overlay">
          <span>Outline / Properties</span>
          <button
            class="text-white/40 hover:text-white"
            title="Collapse panel"
            aria-label="Collapse right panel"
            onclick={toggleRight}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </header>
        <div class="flex-1 overflow-y-auto px-2 py-1">
          {#if outline}
            {@render outline()}
          {:else}
            <p class="text-xs text-white/30 mt-4 text-center">Select an element</p>
          {/if}
        </div>
      </div>

      {#if !sourceCollapsed}
        <Splitter direction="row" onresize={onRightInnerResize} onresizeend={persist} />
      {/if}

      <!-- Source pane (bottom). Header is always visible; body toggles. -->
      <div
        class="source-pane flex flex-col overflow-hidden"
        class:flex-1={!sourceCollapsed}
      >
        <header class="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-surface-overlay">
          <span>Source</span>
          <button
            class="text-white/40 hover:text-white"
            title={sourceCollapsed ? 'Expand source' : 'Collapse source'}
            aria-label={sourceCollapsed ? 'Expand source pane' : 'Collapse source pane'}
            aria-expanded={!sourceCollapsed}
            onclick={toggleSource}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              {#if sourceCollapsed}
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
              {:else}
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              {/if}
            </svg>
          </button>
        </header>
        {#if !sourceCollapsed}
          {#if source}
            <div class="flex-1 overflow-hidden">
              {@render source()}
            </div>
          {:else}
            <div class="flex-1 overflow-auto px-2 py-1 font-mono text-xs text-white/30">
              <pre class="whitespace-pre-wrap">No deck open.</pre>
            </div>
          {/if}
        {/if}
      </div>
    </aside>
  {/if}

</div>

<style>
  .pane-rail {
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .pane-rail:hover {
    background-color: var(--color-surface-overlay, rgba(255, 255, 255, 0.06));
  }
  /* Vertical rail label so the thin rail still reads as the pane it restores. */
  .pane-rail-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    user-select: none;
    white-space: nowrap;
  }
</style>
