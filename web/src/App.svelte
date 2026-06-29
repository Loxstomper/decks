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
  import FreeTransformOverlay from './components/canvas/FreeTransformOverlay.svelte';
  import MarqueeController from './components/canvas/MarqueeController.svelte';
  import AspectRepositionOffer from './components/canvas/AspectRepositionOffer.svelte';
  import FreeAlignBar from './components/canvas/FreeAlignBar.svelte';
  import SourcePane from './components/source/SourcePane.svelte';
  import InsertPalette from './components/insert/InsertPalette.svelte';
  import OutlinePanel from './components/outline/OutlinePanel.svelte';
  import PropertiesPanel from './components/properties/PropertiesPanel.svelte';
  import { createSseClient } from '$lib/sse';
  import { deckStore, type DeckStatus } from '$lib/store/deck.svelte.ts';
  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import { gridStore } from '$lib/canvas/grid.svelte.ts';
  import { aspectStore } from '$lib/canvas/aspect.svelte.ts';
  import {
    ASPECT_PRESETS,
    DEFAULT_ASPECT,
    logicalSizeToAspect,
  } from '$lib/canvas/aspect.ts';
  import {
    collectFreeRects,
    persistAspectChange,
    readLogicalSizeFromInit,
  } from '$lib/canvas/aspect-commands.ts';
  import { domRectToLogical } from '$lib/canvas/overlay-geometry.ts';
  import { classify, findByEid, type LogicalRect } from '$lib/model';
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

  // ── Aspect ratio (P4-7) ─────────────────────────────────────────────────────
  // The logical canvas size is the spec-05 single source of truth living inside
  // the deck's `Reveal.initialize({ width, height })` call. The aspectStore holds
  // the reactive size that RevealFrame renders at (bound below) and that coords.ts
  // threads through every overlay. Seed it from the persisted deck whenever the
  // on-disk bytes change (load / save / external edit), so the canvas always
  // matches what reveal will actually render. We slice from "Reveal.initialize" so
  // a stray `width:` in CSS cannot be mistaken for the canvas size, and skip while
  // an aspect change is mid-decision (pending offer) so we don't fight the user.
  let lastSeededNonce = -1;
  $effect(() => {
    const n = deckStore.reloadNonce;
    if (n === lastSeededNonce || aspectStore.pending) return;
    lastSeededNonce = n;
    const src = deckStore.source;
    const idx = src.indexOf('Reveal.initialize');
    const size = idx >= 0 ? readLogicalSizeFromInit(src.slice(idx)) : null;
    aspectStore.init(size ? logicalSizeToAspect(size) : DEFAULT_ASPECT);
  });

  // Aspect picker → begin an aspect change. begin() updates the live canvas size
  // immediately (structured content reflows via flex/grid) and computes a
  // reposition OFFER for every free element (spec 05 forbids silently moving them).
  // When there are no free elements the change is purely structural — there is no
  // dialog to show, so we persist the new size directly as one undo entry.
  function onAspectPick(value: string): void {
    if (!deckStore.model || value === aspectStore.aspect) return;
    aspectStore.begin(value, collectFreeRects(deckStore.model));
    if (!aspectStore.pending) {
      const size = aspectStore.newSize ?? aspectStore.size;
      void persistAspectChange(size, []).then(() => aspectStore.finish());
    }
  }

  // ── Make free / Make structured (P4-1) ──────────────────────────────────────
  // The data-free toggle is a canvas concern: the model cannot measure rendered
  // geometry, so we measure the selected element's current LOGICAL rect inside the
  // iframe (getBoundingClientRect there is already logical — see overlay-geometry)
  // and hand it to the store command, which stamps data-free + data-x/y/w/h so the
  // element does not visually jump. One undo entry + one autosave.
  const primaryEl = $derived(
    selectionStore.primary && deckStore.model
      ? findByEid(deckStore.model, selectionStore.primary)
      : null,
  );
  const primaryIsFree = $derived(primaryEl ? classify(primaryEl) === 'free' : false);
  const canToggleFree = $derived(!!primaryEl);

  async function onToggleFree(): Promise<void> {
    const eid = selectionStore.primary;
    if (!eid) return;
    let rect: LogicalRect | undefined;
    const doc = canvasIframe?.contentDocument ?? null;
    if (doc) {
      const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid;
      const el = doc.querySelector(`[data-eid="${esc}"]`);
      if (el) {
        const r = domRectToLogical(el.getBoundingClientRect());
        rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    await deckStore.toggleFree(eid, rect);
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
        width={aspectStore.width}
        height={aspectStore.height}
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
        logicalWidth={aspectStore.width}
        logicalHeight={aspectStore.height}
      />

      <!--
        Marquee controller (P4-5): rubber-band multi-select on empty-space drag.
        Starts a marquee ONLY when the press resolves to no selectable element, so
        it never conflicts with CanvasInteraction's click-select or DragController's
        element drag. z-index:3 (visual band only — all pointer handling is on the
        iframe doc/window). Mounted before FreeTransformOverlay so the latter's
        handles (z-index:8) win pointer capture over a free element.
      -->
      <MarqueeController
        iframe={canvasIframe}
        transform={canvasTransform}
        reloadNonce={deckStore.reloadNonce}
      />

      <!--
        Free-transform overlay (P4-2 move / P4-3 resize): renders the 8 resize
        handles + a move-frame ONLY when the selection is a single free, non-editing
        element. Its handle DOM lives in the parent doc (pointer-events:auto) at
        z-index:8 so a grab is captured before the iframe sees it; everything else
        passes through to the iframe. A move-frame drag translates every selected
        free element (multi-select), resize stays single-element.
      -->
      <FreeTransformOverlay
        iframe={canvasIframe}
        transform={canvasTransform}
        reloadNonce={deckStore.reloadNonce}
      />

      <!--
        Aspect reposition offer (P4-7): renders nothing unless an aspect change is
        pending. Lists each free element with old→suggested coords for accept/decline
        (spec 05: free elements must never be silently moved). Apply persists the new
        reveal size + accepted offers as one undo entry; Cancel reverts the canvas.
      -->
      <AspectRepositionOffer />

      <!--
        Align / distribute bar (P4-6): self-shows when 2+ elements are selected and
        applies coordinate ops to the free ones via deckStore.applyFreeGeometryBatch
        (one undo entry). Anchored bottom-center over the canvas.
      -->
      <div class="free-align-anchor">
        <FreeAlignBar iframe={canvasIframe} />
      </div>

      <!-- Undo / redo toolbar (bonus). Reflects canUndo/canRedo reactively. -->
      <div class="canvas-toolbar">
        <!--
          Insert palette (P5-1): the single seam for adding blocks (text / table /
          shape / embed / image / code / math). Self-contained — reads deckStore +
          selectionStore directly and registers every block type on import of
          $lib/blocks. Opens with the "+ Insert" button or the `/` hotkey.
        -->
        <InsertPalette />

        <!--
          Aspect-ratio picker (P4-7). Reflects aspectStore.aspect; choosing a preset
          begins an aspect change (re-fits the canvas + surfaces the reposition
          offer for free elements). Disabled when no deck is open.
        -->
        <select
          class="canvas-toolbar-select"
          title="Aspect ratio"
          aria-label="Aspect ratio"
          disabled={!deckStore.name}
          value={aspectStore.aspect}
          onchange={(e) => onAspectPick((e.currentTarget as HTMLSelectElement).value)}
        >
          {#each Object.keys(ASPECT_PRESETS) as preset (preset)}
            <option value={preset}>{preset}</option>
          {/each}
          {#if !(aspectStore.aspect in ASPECT_PRESETS)}
            <!-- Custom size loaded from the deck that matches no preset. -->
            <option value={aspectStore.aspect}>{aspectStore.aspect}</option>
          {/if}
        </select>

        <!--
          Make free / Make structured toggle (P4-1). Enabled when an element is
          selected; toggles the data-free escape hatch, capturing the element's
          current logical rect so it does not jump.
        -->
        <button
          type="button"
          class="canvas-toolbar-btn"
          class:is-active={primaryIsFree}
          title={primaryIsFree ? 'Make structured (remove free positioning)' : 'Make free (absolute positioning)'}
          aria-label="Toggle free positioning"
          aria-pressed={primaryIsFree}
          disabled={!canToggleFree}
          onclick={onToggleFree}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>

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

  /* Aspect-ratio picker — matches the toolbar button visual language. */
  .canvas-toolbar-select {
    height: 1.75rem;
    padding: 0 0.4rem;
    border-radius: 0.375rem;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    background-color: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    font-size: 0.7rem;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s, opacity 0.12s;
  }

  .canvas-toolbar-select:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .canvas-toolbar-select:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /*
   * Floating anchor for the align/distribute bar (FreeAlignBar self-hides when
   * fewer than 2 elements are selected). Bottom-center over the canvas, above the
   * pointer-events:none overlays. pointer-events:none here so the empty margins
   * never block canvas interaction; the bar itself re-enables pointer events.
   */
  .free-align-anchor {
    position: absolute;
    bottom: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    pointer-events: none;
  }

  .canvas-toolbar-btn svg {
    width: 1rem;
    height: 1rem;
  }
</style>
