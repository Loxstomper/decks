<script lang="ts">
  /**
   * App.svelte — editor shell wiring (Phase 1 integration).
   *
   * Responsibilities:
   *   • Discover decks (GET /api/decks) on startup and open the first one.
   *   • Bind the deck store to the three Phase-1 surfaces:
   *       Navigator → deck list + sync status
   *       Canvas    → RevealFrame (iframe), reloaded when on-disk bytes change
   *       Source    → SourcePane (CodeMirror), edits funnel through the store
   *   • Bridge SSE external-change events into the store (P1-9 turn-taking).
   *
   * The store (deckStore) owns all data-flow rules; this component is pure glue.
   */

  import { onMount, onDestroy } from 'svelte';
  import PaneLayout from './components/layout/PaneLayout.svelte';
  import RevealFrame from './components/canvas/RevealFrame.svelte';
  import CanvasInteraction from './components/canvas/CanvasInteraction.svelte';
  import DragController from './components/canvas/DragController.svelte';
  import GridOverlay from './components/canvas/GridOverlay.svelte';
  import NudgeController from './components/canvas/NudgeController.svelte';
  import SourcePane from './components/source/SourcePane.svelte';
  import OutlinePanel from './components/outline/OutlinePanel.svelte';
  import PropertiesPanel from './components/properties/PropertiesPanel.svelte';
  import { createSseClient } from '$lib/sse';
  import { deckStore, type DeckStatus } from '$lib/store/deck.svelte.ts';
  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import { gridStore } from '$lib/canvas/grid.svelte.ts';
  import type { Transform } from '$lib/coords.ts';

  // RevealFrame instance (exposes reload()); bound via the canvas snippet.
  let frame = $state<{ reload: () => void } | undefined>();

  // ── Canvas overlay plumbing (P2-3…P2-6) ─────────────────────────────────────
  // RevealFrame publishes its live <iframe> element and the exact transform it
  // applies; CanvasInteraction (a sibling overlaying the same box) consumes both
  // so its selection box is pixel-aligned and it can reach the same-origin
  // contentDocument. These are `bind:`-bound to RevealFrame's bindable props.
  let canvasIframe = $state<HTMLIFrameElement | null>(null);
  let canvasTransform = $state<Transform>({ scale: 0, offsetX: 0, offsetY: 0 });

  // Available deck names (from GET /api/decks).
  let decks = $state<string[]>([]);

  // ── SSE: external (Claude Code) writes → reload model + canvas (P1-9) ───────
  const sse = createSseClient();
  // Wildcard subscription: filter to the open deck inside the handler so that
  // opening a different deck does not require re-subscribing.
  const offDeckChanged = sse.onDeckChanged(null, (ev) => {
    if (ev.deck === deckStore.name) void deckStore.onExternalChange();
  });

  onMount(async () => {
    try {
      const res = await fetch('/api/decks');
      if (res.ok) decks = await res.json();
    } catch {
      // Backend unreachable (e.g. running the SPA without the Go server).
      // The empty state is the correct fallback.
    }
    if (decks.length > 0) await deckStore.load(decks[0]);
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    offDeckChanged();
    sse.close();
    window.removeEventListener('keydown', handleKeydown);
  });

  // ── Canvas reload bridge ────────────────────────────────────────────────────
  // The store bumps reloadNonce whenever the on-disk file changes (initial load,
  // successful save, adopted external change). Translate that into an explicit
  // iframe reload so the canvas always mirrors persisted bytes. We track the last
  // handled value to avoid reacting to unrelated re-renders.
  let lastNonce = 0;
  $effect(() => {
    const n = deckStore.reloadNonce;
    if (n !== lastNonce) {
      lastNonce = n;
      frame?.reload();
    }
  });

  async function openDeck(name: string): Promise<void> {
    if (name === deckStore.name) return;
    await deckStore.load(name);
  }

  // ── Undo / redo (P2-7, P2-8) ────────────────────────────────────────────────
  // Global keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) =
  // redo. Each maps to ONE on-disk state via deckStore.undo()/redo().
  //
  // WHY THE EDITABLE-TARGET GUARD: when the user is typing in the source pane
  // (CodeMirror, a contenteditable) we must NOT hijack Cmd+Z — CodeMirror owns
  // local text undo there. In-canvas contenteditable lives inside the sandboxed
  // iframe, whose key events never bubble to this window, so it is naturally
  // unaffected. So we only drive deck-level undo when focus is in the chrome
  // (canvas selection, toolbar, body) — i.e. not in a text-input surface.
  function isEditableTarget(el: Element | null): boolean {
    if (!el) return false;
    if ((el as HTMLElement).isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    // CodeMirror 6 mounts its editable surface under `.cm-editor`.
    return el.closest('.cm-editor') !== null;
  }

  function handleKeydown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();

    // Redo: Cmd/Ctrl+Shift+Z, or Ctrl+Y (Windows convention).
    const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
    const isUndo = key === 'z' && !e.shiftKey;
    if (!isUndo && !isRedo) return;

    // Don't steal undo from a focused text editor (see WHY above).
    if (isEditableTarget(document.activeElement)) return;

    e.preventDefault();
    if (isRedo) void deckStore.redo();
    else void deckStore.undo();
  }

  // Human-readable status label + colour for the indicator (spec 11 §5).
  const STATUS_META: Record<DeckStatus, { label: string; class: string }> = {
    empty:    { label: 'No deck',        class: 'text-white/30' },
    synced:   { label: 'Synced',         class: 'text-emerald-400/80' },
    unsaved:  { label: 'Unsaved…',  class: 'text-amber-400/80' },
    saving:   { label: 'Saving…',   class: 'text-sky-400/80' },
    external: { label: 'External change', class: 'text-accent' },
    error:    { label: 'Error',          class: 'text-red-400' },
  };
  const statusMeta = $derived(STATUS_META[deckStore.status]);
</script>

<PaneLayout>
  {#snippet navigator()}
    <div class="flex flex-col gap-3">
      <!-- Sync status indicator (spec 11 §5) -->
      <div class="flex items-center gap-2 px-1">
        <span class="inline-block w-2 h-2 rounded-full {statusMeta.class}" style="background-color: currentColor;"></span>
        <span class="text-xs {statusMeta.class}">{statusMeta.label}</span>
      </div>

      <!-- Deck list -->
      {#if decks.length === 0}
        <p class="text-xs text-white/30 mt-2 text-center">No decks yet</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each decks as name (name)}
            <li>
              <button
                type="button"
                class="w-full text-left px-2 py-1 rounded text-xs truncate transition-colors
                       {name === deckStore.name
                         ? 'bg-accent/20 text-white'
                         : 'text-white/60 hover:bg-white/5 hover:text-white'}"
                onclick={() => openDeck(name)}
              >
                {name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/snippet}

  {#snippet canvas()}
    <!--
      Canvas stack: RevealFrame (scaled iframe) + CanvasInteraction (selection
      overlay) as SIBLINGS inside ONE position:relative box that both fill.
      The overlay is position:absolute inset:0, so its offset-parent is this
      wrapper — the exact box the iframe is scaled within — which is why passing
      RevealFrame's own transform lines the selection box up pixel-perfectly.
    -->
    <div class="canvas-stack">
      <RevealFrame
        bind:this={frame}
        deckUrl={deckStore.deckUrl}
        bind:iframeEl={canvasIframe}
        bind:transform={canvasTransform}
      />
      <CanvasInteraction
        iframe={canvasIframe}
        transform={canvasTransform}
        reloadNonce={deckStore.reloadNonce}
      />

      <!--
        Snap-grid overlay (P3-8): drawn beneath the drag overlay (z-index:1),
        visible only while the grid is enabled. Shares the SAME transform so its
        lines stay pixel-aligned with the slide at any zoom/pan.
      -->
      <GridOverlay
        transform={canvasTransform}
        gridSize={gridStore.size}
        visible={gridStore.enabled && gridStore.showOverlay}
      />

      <!--
        Drag controller (P3-6/7/8): reorder / reparent structured children and
        free-move data-free elements. Like CanvasInteraction it does not own the
        iframe — it attaches its own pointer listeners to the same-origin doc and
        re-attaches after a reload (reloadNonce). Its overlay sits at z-index:2,
        above the grid; both are pointer-events:none so they never block selection.
      -->
      <DragController
        iframe={canvasIframe}
        transform={canvasTransform}
        reloadNonce={deckStore.reloadNonce}
      />

      <!-- Undo / redo toolbar (bonus). Reflects canUndo/canRedo reactively. -->
      <div class="canvas-toolbar">
        <!--
          Snap-to-grid toggle (P3-8). Reflects gridStore.enabled; clicking flips
          it. When on, drags/nudges snap to gridStore.size and the GridOverlay
          becomes visible.
        -->
        <button
          type="button"
          class="canvas-toolbar-btn"
          class:is-active={gridStore.enabled}
          title="Toggle snap-to-grid"
          aria-label="Toggle snap-to-grid"
          aria-pressed={gridStore.enabled}
          onclick={() => gridStore.toggle()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="1" />
            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
          </svg>
        </button>
        <button
          type="button"
          class="canvas-toolbar-btn"
          title="Undo (Cmd/Ctrl+Z)"
          aria-label="Undo"
          disabled={!deckStore.canUndo}
          onclick={() => deckStore.undo()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
          </svg>
        </button>
        <button
          type="button"
          class="canvas-toolbar-btn"
          title="Redo (Cmd/Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!deckStore.canRedo}
          onclick={() => deckStore.redo()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9a5 5 0 0 0 0 10h1" />
          </svg>
        </button>
      </div>
    </div>
  {/snippet}

  {#snippet outline()}
    <!--
      Outline + Properties share the right panel's top zone (P3-3 / P3-4).
      OutlinePanel (the element tree) scrolls and fills the upper portion;
      PropertiesPanel (layout controls + alignment toolbar) sits below it.
      Both read/drive the SAME selectionStore singleton the canvas uses, so
      selection stays in sync three ways: canvas ↔ outline ↔ properties.
    -->
    <div class="outline-zone flex flex-col h-full min-h-0">
      <div class="flex-1 min-h-0 overflow-hidden">
        <OutlinePanel model={deckStore.model} selection={selectionStore} />
      </div>
      <div class="properties-zone overflow-y-auto border-t border-surface-overlay">
        <PropertiesPanel
          selectedEid={selectionStore.eid}
          onApplyLayoutChange={(eid, delta) => deckStore.applyLayoutChange(eid, delta)}
          onApplyEqualColumns={(eid) => deckStore.applyEqualColumns(eid)}
        />
      </div>
    </div>
  {/snippet}

  {#snippet source()}
    <SourcePane
      value={deckStore.source}
      onChange={(next) => deckStore.updateFromSource(next)}
    />
  {/snippet}
</PaneLayout>

<!--
  Keyboard nudge (P3-9): mounted once, renders nothing. Listens on window for
  arrow keys, reads selectionStore + deckStore directly, and guards against
  hijacking text-editing contexts (inputs / contenteditable / CodeMirror).
-->
<NudgeController />

<style>
  /*
   * The canvas stack is the single position:relative box that BOTH RevealFrame
   * and the selection overlay fill. It must exactly overlap the iframe's scaled
   * container so CanvasInteraction's absolutely-positioned overlay shares the
   * iframe's coordinate origin (see the canvas snippet comment).
   */
  .canvas-stack {
    position: relative;
    width: 100%;
    height: 100%;
  }

  /* Floating undo/redo toolbar, top-right of the canvas. */
  .canvas-toolbar {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 20; /* above the selection overlay (which is pointer-events:none) */
    display: flex;
    gap: 0.25rem;
  }

  .canvas-toolbar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border-radius: 0.375rem;
    color: rgba(255, 255, 255, 0.7);
    background-color: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    transition: background-color 0.12s, color 0.12s, opacity 0.12s;
  }

  .canvas-toolbar-btn:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .canvas-toolbar-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* Active (pressed) state for the snap-grid toggle. */
  .canvas-toolbar-btn.is-active {
    background-color: rgba(74, 158, 255, 0.35);
    color: #fff;
  }

  .canvas-toolbar-btn svg {
    width: 1rem;
    height: 1rem;
  }
</style>
