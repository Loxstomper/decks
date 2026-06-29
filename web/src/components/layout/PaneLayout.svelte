<script lang="ts">
  /**
   * PaneLayout.svelte — Three-zone resizable editor layout (P1-1).
   *
   * Layout (spec 04):
   *   ┌──────────────┬──────────────────────────┬─────────────────────────┐
   *   │  Navigator   │        Canvas            │  Outline+Props / Source │
   *   │  (filmstrip) │  (iframe + overlay)      │  (tabbed right panel)   │
   *   └──────────────┴──────────────────────────┴─────────────────────────┘
   *
   * Each zone is separated by a lightweight <Splitter> drag handle.
   * Widths are stored as CSS pixel values; on first render they use sensible
   * percentage-based defaults computed from the viewport width.
   *
   * The right panel has a vertical split between Outline+Properties (top)
   * and Source / CodeMirror (bottom) — also resizable.
   */

  import Splitter from './Splitter.svelte';

  // Panel widths in CSS pixels.  Defaults: Nav=220, Right=380, Canvas=remainder.
  let navWidth   = $state(220);
  let rightWidth = $state(380);

  // Right-panel inner split (Outline+Props top, Source bottom).
  let rightTopHeight = $state(300);

  function onNavResize(e: CustomEvent<number>) {
    navWidth = Math.max(140, Math.min(navWidth + e.detail, 500));
  }

  function onRightResize(e: CustomEvent<number>) {
    rightWidth = Math.max(200, Math.min(rightWidth - e.detail, 700));
  }

  function onRightInnerResize(e: CustomEvent<number>) {
    rightTopHeight = Math.max(100, rightTopHeight + e.detail);
  }
</script>

<div class="editor-shell flex h-full w-full overflow-hidden bg-surface text-white">

  <!-- ── Navigator pane ────────────────────────────────────────────────── -->
  <aside
    class="navigator flex flex-col border-r border-surface-overlay bg-surface-raised overflow-hidden"
    style="width: {navWidth}px; min-width: 140px; max-width: 500px;"
  >
    <header class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50">
      Navigator
    </header>
    <div class="flex-1 overflow-y-auto px-2 py-1">
      <!-- Slide filmstrip — populated in P6-1 -->
      <p class="text-xs text-white/30 mt-4 text-center">No slides yet</p>
    </div>
  </aside>

  <Splitter direction="col" on:resize={onNavResize} />

  <!-- ── Canvas pane ────────────────────────────────────────────────────── -->
  <main class="canvas-pane flex-1 flex flex-col overflow-hidden bg-black/30 relative">
    <header class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-surface-overlay flex items-center gap-2">
      <span>Canvas</span>
      <!-- Zoom controls slot — wired up in P1-2 -->
      <span class="ml-auto text-white/30">100%</span>
    </header>

    <!-- Canvas viewport — iframe + overlay layer live here (P1-2+) -->
    <div class="canvas-viewport flex-1 relative overflow-hidden flex items-center justify-center">
      <div class="canvas-placeholder flex flex-col items-center gap-2 text-white/20 select-none">
        <!-- Visual proof that Tailwind utilities work -->
        <div class="w-16 h-16 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-accent/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
          </svg>
        </div>
        <span class="text-sm">Canvas (iframe + overlay)</span>
        <span class="text-xs">1920 × 1080 logical</span>
      </div>
    </div>
  </main>

  <Splitter direction="col" on:resize={onRightResize} />

  <!-- ── Right panel (Outline+Properties / Source) ─────────────────────── -->
  <aside
    class="right-panel flex flex-col border-l border-surface-overlay bg-surface-raised overflow-hidden"
    style="width: {rightWidth}px; min-width: 200px; max-width: 700px;"
  >
    <!-- Outline + Properties (top) -->
    <div
      class="outline-props flex flex-col overflow-hidden"
      style="height: {rightTopHeight}px; min-height: 100px;"
    >
      <header class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-surface-overlay">
        Outline / Properties
      </header>
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <!-- Element tree — populated in P3-3 -->
        <p class="text-xs text-white/30 mt-4 text-center">Select an element</p>
      </div>
    </div>

    <Splitter direction="row" on:resize={onRightInnerResize} />

    <!-- Source pane (bottom) -->
    <div class="source-pane flex-1 flex flex-col overflow-hidden">
      <header class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-surface-overlay">
        Source
      </header>
      <div class="flex-1 overflow-auto px-2 py-1 font-mono text-xs text-white/30">
        <!-- CodeMirror 6 mounts here in P1-7 -->
        <pre class="whitespace-pre-wrap">No deck open.</pre>
      </div>
    </div>
  </aside>

</div>
