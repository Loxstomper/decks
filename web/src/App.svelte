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
  import ContextMenu, { type MenuItem } from './components/canvas/ContextMenu.svelte';
  import SourcePane from './components/source/SourcePane.svelte';
  import InsertPalette from './components/insert/InsertPalette.svelte';
  import OutlinePanel from './components/outline/OutlinePanel.svelte';
  import PropertiesPanel from './components/properties/PropertiesPanel.svelte';
  // Phase 6 surfaces (integrated here):
  //   Navigator     — slide filmstrip (Lane A): add/dup/delete/reorder/nest/hide.
  //   Motion panels — fragments / transitions / auto-animate (Lane B).
  //   ThemingPanel  — theme picker + custom.css editor + CSS-var + fonts (Lane C).
  import Navigator from './components/navigator/Navigator.svelte';
  import FragmentsPanel from './components/motion/FragmentsPanel.svelte';
  import TransitionPanel from './components/motion/TransitionPanel.svelte';
  import AutoAnimatePanel from './components/motion/AutoAnimatePanel.svelte';
  import ThemingPanel from './components/theming/ThemingPanel.svelte';
  import WorkspaceThemePicker from './components/theming/WorkspaceThemePicker.svelte';
  // Phase 7 surfaces (present + speaker notes + export):
  //   PresentButton — opens /present/{name} (pure reveal, press S for speaker view).
  //   NotesPanel    — per-slide speaker-notes editor (<aside class="notes">).
  //   ExportPanel   — PDF (headless Chrome) + self-contained HTML-bundle zip.
  import PresentButton from './components/presenting/PresentButton.svelte';
  import NotesPanel from './components/presenting/NotesPanel.svelte';
  import ExportPanel from './components/presenting/ExportPanel.svelte';
  // Phase 8 surfaces (turn-taking + validation + change-highlight):
  //   StatusIndicator        — accessible sync/conflict/blocked badge (P8-5).
  //   ConflictPrompt         — dirty-guard modal: keep-mine / take-theirs (P8-6).
  //   ValidationBanner       — surfaces blocked-save validation errors (P8-3).
  //   ChangeHighlightOverlay — flashes eids Claude changed after reload (P8-7).
  import StatusIndicator from './components/status/StatusIndicator.svelte';
  import ConflictPrompt from './components/status/ConflictPrompt.svelte';
  import ValidationBanner from './components/status/ValidationBanner.svelte';
  import ChangeHighlightOverlay from './components/canvas/ChangeHighlightOverlay.svelte';
  import CommandPalette from '$lib/commands/CommandPalette.svelte';
  import ShortcutHelp from '$lib/commands/ShortcutHelp.svelte';
  import { createSseClient } from '$lib/sse';
  import { deckStore } from '$lib/store/deck.svelte.ts';
  import { customCssStore } from '$lib/store/customCss.svelte.ts';
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
  import { menuItemsFor, type MenuSelection } from '$lib/canvas/context-menu.ts';
  import { isSlideHidden, onSlideChanged, indicesToEid } from '$lib/slides';
  import { viewedSlide } from '$lib/canvas/viewed-slide.svelte.ts';
  import { ensurePresets, layoutPresets } from '$lib/store/layout-presets.svelte';
  import {
    classify,
    findByEid,
    findParentOf,
    getAttribute,
    getSlides,
    type ElementNode,
    type LogicalRect,
  } from '$lib/model';
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

  // ── P17-12/13: command palette + shortcut help overlay state ─────────────────
  let commandPaletteOpen = $state(false);
  let shortcutHelpOpen = $state(false);

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
    // Pre-fetch layout presets so they are ready by the time the user opens a
    // context menu or the navigator layout picker (P14-6a / P14-6b).
    ensurePresets();
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
    // Switching decks: drop any selection carried over from the previous deck.
    // eids are only unique WITHIN a deck (every deck reuses s1, h1, p1, …), so a
    // stale selection would silently point at a same-eid element in the new deck
    // (phantom multi-select, broken navigation). The outline/properties panels
    // are also remounted per deck name (see the {#key} in the outline snippet),
    // which clears their per-eid expand state for the same reason.
    selectionStore.clear();
    await deckStore.load(name);
  }

  // P9-12: Called by Navigator after POST /api/decks/{name} succeeds.
  // Refresh the deck list then open the new deck so the user lands in it.
  async function onDeckCreated(name: string): Promise<void> {
    try {
      const res = await fetch('/api/decks');
      if (res.ok) decks = await res.json();
    } catch { /* best-effort */ }
    await openDeck(name);
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

    // ── P17-12: Cmd/Ctrl+K → command palette ─────────────────────────────────
    if (mod && e.key.toLowerCase() === 'k') {
      if (!isEditableTarget(document.activeElement)) {
        e.preventDefault();
        commandPaletteOpen = true;
      }
      return;
    }

    // ── P17-13: ? → shortcut help overlay ────────────────────────────────────
    // Triggered by Shift+/ (US keyboards) or any layout that produces '?'.
    // Guard against text-editing contexts so '?' can still be typed normally.
    if (!mod && e.key === '?') {
      if (!isEditableTarget(document.activeElement)) {
        e.preventDefault();
        shortcutHelpOpen = true;
      }
      return;
    }

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

  // Status badge mapping now lives in StatusIndicator (P8-5), which owns the
  // synced / unsaved / saving / external / error + conflict + 'Save blocked'
  // states and renders an accessible role=status live region.

  // ── Phase 6: custom.css lifecycle (Lane C) ──────────────────────────────────
  // The custom.css document is a separate file (decks/<name>/custom.css) served
  // by its own endpoints, so it is NOT part of the deck source/model. Load it
  // whenever the open deck changes; clear it when no deck is open. customCssStore
  // owns its own debounced PUT-save.
  $effect(() => {
    if (deckStore.name) customCssStore.loadForDeck(deckStore.name);
    else customCssStore.clear();
  });

  // ── Phase 6: current slide for the motion panels (Lanes A↔B) ─────────────────
  // The motion panels (fragments / transition / auto-animate) operate on "the
  // current slide". We resolve that as the nearest enclosing <section> of the
  // current selection (so editing an element inside a slide targets that slide),
  // falling back to the slide the canvas is actually PRESENTING (viewedSlide),
  // and only then to the first slide. reveal is 2D, so the innermost enclosing
  // <section> is exactly the presented slide.
  const currentSlideEid = $derived.by<string | null>(() => {
    const model = deckStore.model;
    if (!model) return null;
    const sel = selectionStore.eid;
    if (sel) {
      let cursor: ElementNode | null = findByEid(model, sel);
      while (cursor) {
        if (cursor.tagName.toLowerCase() === 'section') {
          return getAttribute(cursor, 'data-eid');
        }
        const eid = getAttribute(cursor, 'data-eid');
        cursor = eid ? findParentOf(model, eid) : null;
      }
    }
    const viewed = indicesToEid(model, viewedSlide.h, viewedSlide.v);
    if (viewed) return viewed;
    const slides = getSlides(model);
    return slides.length ? getAttribute(slides[0], 'data-eid') : null;
  });

  // Track the slide reveal is presenting into the app-global viewedSlide store,
  // so the insert seam and the motion panels target the slide on screen rather
  // than slide 1. ONE authoritative subscription (App owns the canvas iframe);
  // re-subscribe when the iframe is recreated or the deck reloads (reloadNonce
  // bump → reveal re-inits with a fresh event bus).
  $effect(() => {
    void deckStore.reloadNonce;
    const iframe = canvasIframe;
    if (!iframe) return;
    const unsub = onSlideChanged(iframe, ({ h, v }) => viewedSlide.set(h, v));
    return unsub;
  });

  // Right-panel lower zone: tabbed between element Properties, Motion authoring,
  // and Theme/Styles. Outline (element tree) stays pinned above the tabs.
  let rightTab = $state<'properties' | 'motion' | 'theme' | 'notes' | 'export'>('properties');

  // ── Right-click context menu (P13-2 / P13-4 / P13-8) ────────────────────────
  // ONE menu instance, mounted in the canvas-stack, shared by the canvas
  // (CanvasInteraction → element/slide menu) and the outline (OutlineTreeNode →
  // element menu). It is purely a UI surface over existing deckStore commands
  // (menuItemsFor builds the descriptors); App owns only open/close + placement.

  // The position:relative box the menu is mounted in; its rect converts the
  // outline panel's viewport-space cursor into canvas-stack-local pixels (the
  // canvas path already supplies stack-local coords via the shared transform).
  let canvasStackEl = $state<HTMLElement | undefined>();

  let ctxMenu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
    open: false,
    x: 0,
    y: 0,
    items: [],
  });

  // Selection signature + reload nonce captured at open-time, so the close
  // effect fires on a SUBSEQUENT change (not on the selection mutation that
  // opening the menu itself performs).
  let ctxSelKey = '';
  let ctxOpenNonce = 0;

  function closeContextMenu(): void {
    ctxMenu = { ...ctxMenu, open: false };
  }

  /**
   * Slide-level actions (P13-8): shown when the right-click resolved to no
   * element (empty slide background). Targets the current slide and routes
   * through the existing slide ops (one undo entry + autosave each).
   */
  function slideMenuItems(slideEid: string | null = currentSlideEid): MenuItem[] {
    if (!slideEid || !deckStore.model) return [];
    const section = findByEid(deckStore.model, slideEid);
    const hidden = section ? isSlideHidden(section) : false;

    // "Change layout" submenu (P14-6b): one entry per preset fetched from
    // GET /api/templates (layoutPresets is reactive — populated once the cache
    // resolves). When not yet loaded, show the item as disabled so the user
    // can see the option exists; opening the menu again after load will show
    // the full submenu.
    const presets = layoutPresets.value;
    const changeLayoutItem: MenuItem =
      presets.length > 0
        ? {
            label: 'Change layout',
            submenu: presets.map((p) => ({
              label: p.label,
              run: () => void deckStore.changeSlideLayout(slideEid, p.html),
            })),
          }
        : { label: 'Change layout', disabled: true };

    return [
      { label: 'Insert slide', run: () => void deckStore.addSlide(slideEid) },
      { label: 'Duplicate slide', run: () => void deckStore.duplicateSlide(slideEid) },
      {
        label: hidden ? 'Show slide' : 'Hide slide',
        run: () => void deckStore.setSlideHidden(slideEid, !hidden),
      },
      changeLayoutItem,
      {
        label: 'Set background…',
        run: () => {
          // Select the slide so the Properties panel shows the SlideBackgroundControl,
          // then switch to the Properties tab so the control is immediately visible.
          selectionStore.select(slideEid);
          rightTab = 'properties';
        },
      },
      { label: '', separator: true },
      { label: 'Delete slide', danger: true, run: () => void deckStore.deleteSlide(slideEid) },
    ];
  }

  /**
   * Open the shared menu at `x`/`y` (canvas-stack-local px). Reads the (already
   * updated) selectionStore: a non-empty selection → element menu via
   * menuItemsFor; empty → the slide-level menu.
   */
  function openContextMenuAt(x: number, y: number): void {
    const eids = selectionStore.eids;
    let items: MenuItem[];
    if (eids.length === 0 || !selectionStore.primary) {
      items = slideMenuItems();
    } else if (deckStore.model) {
      const sel: MenuSelection = { primary: selectionStore.primary, eids };
      items = menuItemsFor(sel, deckStore.model, { hasClipboard: deckStore.hasClipboard });
    } else {
      items = [];
    }
    if (items.length === 0) return;
    ctxSelKey = eids.join(',');
    ctxOpenNonce = deckStore.reloadNonce;
    ctxMenu = { open: true, x, y, items };
  }

  // Outline row right-click (P13-4): the row already selected its node; convert
  // the viewport cursor to canvas-stack-local px, then open the same menu.
  function openContextMenuFromOutline(_eid: string, clientX: number, clientY: number): void {
    const rect = canvasStackEl?.getBoundingClientRect();
    openContextMenuAt(
      rect ? clientX - rect.left : clientX,
      rect ? clientY - rect.top : clientY,
    );
  }

  // Navigator slide-row right-click: the row already selected + jumped to the
  // slide; open the slide-level menu (never the element menu) for that slide.
  // The cursor sits left of the canvas pane (which clips its children), so the
  // stack-local x is clamped to ≥ 0 — the menu lands at the pane's left edge at
  // cursor height.
  function openContextMenuFromNavigator(eid: string, clientX: number, clientY: number): void {
    const items = slideMenuItems(eid);
    if (items.length === 0) return;
    const rect = canvasStackEl?.getBoundingClientRect();
    ctxSelKey = selectionStore.eids.join(',');
    ctxOpenNonce = deckStore.reloadNonce;
    ctxMenu = {
      open: true,
      x: rect ? Math.max(0, clientX - rect.left) : clientX,
      y: rect ? Math.max(0, clientY - rect.top) : clientY,
      items,
    };
  }

  // Auto-dismiss: close when the selection changes or the deck reloads while the
  // menu is open (Escape + click-outside are handled inside ContextMenu).
  $effect(() => {
    const key = selectionStore.eids.join(',');
    const nonce = deckStore.reloadNonce;
    if (!ctxMenu.open) return;
    if (key !== ctxSelKey || nonce !== ctxOpenNonce) closeContextMenu();
  });
</script>

<PaneLayout>
  {#snippet navigator()}
    <!--
      Navigator zone (P6-1..P6-6): deck switcher + sync status on top, then the
      live slide filmstrip filling the rest. The filmstrip (Lane A's Navigator)
      reads deckStore + selectionStore singletons itself; its only prop is the
      live canvas iframe so clicking a slide drives Reveal.slide() and the current
      slide is reflected back.
    -->
    <div class="flex flex-col h-full min-h-0 gap-2">
      <!-- Sync status indicator (spec 11 §5 / P8-5): turn-taking handoff state. -->
      <div class="px-1 flex-shrink-0">
        <StatusIndicator />
        <!-- Workspace chrome theme switcher (P9-10): persists in localStorage. -->
        <WorkspaceThemePicker />
      </div>

      <!-- Deck list -->
      {#if decks.length === 0}
        <p class="text-xs text-fg/30 text-center flex-shrink-0">No decks yet</p>
      {:else}
        <ul class="flex flex-col gap-0.5 flex-shrink-0">
          {#each decks as name (name)}
            <li>
              <button
                type="button"
                class="w-full text-left px-2 py-1 rounded text-xs truncate transition-colors
                       {name === deckStore.name
                         ? 'bg-accent/20 text-fg'
                         : 'text-fg/60 hover:bg-white/5 hover:text-fg'}"
                onclick={() => openDeck(name)}
              >
                {name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Slide filmstrip (P6-1..P6-6). Fills the remaining height and scrolls. -->
      <div class="flex-1 min-h-0 overflow-y-auto border-t border-surface-overlay pt-2">
        <Navigator
          iframeEl={canvasIframe}
          {onDeckCreated}
          onSlideContextMenu={openContextMenuFromNavigator}
        />
      </div>
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
    <div class="canvas-stack" bind:this={canvasStackEl}>
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
        onContextMenu={({ x, y }) => openContextMenuAt(x, y)}
      />

      <!--
        Change-highlight overlay (P8-7): flashes amber (changed) / emerald (added)
        outlines inside the reveal iframe for the eids Claude Code just touched,
        after an adopted external change. It owns no DOM of its own (it injects a
        one-off stylesheet into the same-origin iframe) and re-applies on
        reloadNonce so the flash lands on the freshly-rendered adopted document.
      -->
      <ChangeHighlightOverlay iframe={canvasIframe} reloadNonce={deckStore.reloadNonce} />

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
        Right-click context menu (P13-1..P13-8): a single shared instance for
        the canvas (element + slide menus) and the outline rows. Rendered only
        while open; positioned at the cursor in canvas-stack-local pixels and
        edge-flipped to stay in-pane. Items come from menuItemsFor / slide ops;
        Escape + click-outside dismiss via onClose.
      -->
      {#if ctxMenu.open}
        <ContextMenu
          items={ctxMenu.items}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={closeContextMenu}
        />
      {/if}

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

        <!--
          Present (P7-1): opens /present/{name} in a new tab — pure reveal, no
          editor chrome. Press S there for the speaker window (notes + timer).
          Inherits .canvas-toolbar-btn styling.
        -->
        <PresentButton deckName={deckStore.name} />
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
    <!--
      {#key deckStore.name}: fully remount the outline + properties panels when
      the open deck changes. Their internal state is keyed by data-eid (outline
      expand map, tree node identity), and eids are only unique within a single
      deck — so without a remount the previous deck's tree/expand state is reused
      for colliding eids in the new deck (stale rows, wrong content). Remounting
      rebuilds both panels from the new deck's model.
    -->
    {#key deckStore.name}
    <div class="outline-zone flex flex-col h-full min-h-0">
      <div class="flex-1 min-h-0 overflow-hidden">
        <OutlinePanel
          model={deckStore.model}
          selection={selectionStore}
          onContextMenu={openContextMenuFromOutline}
        />
      </div>

      <!--
        Tabbed lower zone (P3-3/4 + P6-7..P6-13): the element tree stays pinned
        above; below it the user switches between element Properties, Motion
        authoring (fragments / transitions / auto-animate), and Theme/Styles.
        All three operate on the live selection / current slide and route their
        mutations through deckStore / customCssStore (one undo entry + autosave).
      -->
      <div class="right-tabs flex flex-col border-t border-surface-overlay min-h-0">
        <div class="right-tabbar flex gap-1 px-2 py-1 flex-shrink-0" role="tablist" aria-label="Inspector tabs">
          <button
            type="button" role="tab" class="right-tab" class:active={rightTab === 'properties'}
            aria-selected={rightTab === 'properties'} onclick={() => (rightTab = 'properties')}
          >Properties</button>
          <button
            type="button" role="tab" class="right-tab" class:active={rightTab === 'motion'}
            aria-selected={rightTab === 'motion'} onclick={() => (rightTab = 'motion')}
          >Motion</button>
          <button
            type="button" role="tab" class="right-tab" class:active={rightTab === 'theme'}
            aria-selected={rightTab === 'theme'} onclick={() => (rightTab = 'theme')}
          >Theme</button>
          <button
            type="button" role="tab" class="right-tab" class:active={rightTab === 'notes'}
            aria-selected={rightTab === 'notes'} onclick={() => (rightTab = 'notes')}
          >Notes</button>
          <button
            type="button" role="tab" class="right-tab" class:active={rightTab === 'export'}
            aria-selected={rightTab === 'export'} onclick={() => (rightTab = 'export')}
          >Export</button>
        </div>

        <div class="right-tab-content flex-1 min-h-0 overflow-y-auto">
          {#if rightTab === 'properties'}
            <PropertiesPanel
              selectedEid={selectionStore.eid}
              onApplyLayoutChange={(eid, delta) => deckStore.applyLayoutChange(eid, delta)}
              onApplyEqualColumns={(eid) => deckStore.applyEqualColumns(eid)}
            />
          {:else if rightTab === 'motion'}
            <div class="flex flex-col gap-3 p-2">
              <FragmentsPanel
                slideEid={currentSlideEid}
                selectedEid={selectionStore.eid}
                onToggleFragment={(eid, index) => deckStore.toggleFragment(eid, index)}
                onSetFragmentIndex={(eid, n) => deckStore.setFragmentIndex(eid, n)}
                onSetFragmentStyle={(eid, style) => deckStore.setFragmentStyle(eid, style)}
              />
              <TransitionPanel
                slideEid={currentSlideEid}
                onSetSlideTransition={(eid, type, speed) => deckStore.setSlideTransition(eid, type, speed)}
                onSetDeckTransition={(type, speed) => deckStore.setDeckTransition(type, speed)}
              />
              <AutoAnimatePanel
                slideEid={currentSlideEid}
                onEnableAutoAnimate={(eid) => deckStore.enableAutoAnimate(eid)}
                onDisableAutoAnimate={(eid) => deckStore.disableAutoAnimate(eid)}
              />
            </div>
          {:else if rightTab === 'theme'}
            <ThemingPanel />
          {:else if rightTab === 'notes'}
            <!--
              Speaker notes (P7-2): editor for the current slide's
              <aside class="notes">. Routes through deckStore.setSlideNotes →
              one undo entry + autosave; reveal's speaker window reads it.
            -->
            <NotesPanel
              slideEid={currentSlideEid}
              onSetNotes={(eid, text) => deckStore.setSlideNotes(eid, text)}
            />
          {:else}
            <!--
              Export (P7-3/P7-4): PDF (headless Chrome, graceful 503 when absent)
              and self-contained HTML-bundle zip. Operates on the open deck.
            -->
            <ExportPanel deckName={deckStore.name} />
          {/if}
        </div>
      </div>
    </div>
    {/key}
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

<!--
  Phase 8 turn-taking surfaces, mounted once at the shell root (both self-gate on
  deckStore state, rendering nothing until needed):
    • ValidationBanner — appears when a save was blocked by validation errors
      (P8-3); lists the problems with a dismiss action.
    • ConflictPrompt — modal that appears when an external (Claude Code) write
      lands while we have unsaved edits (P8-6 dirty-guard); the user resolves via
      keep-mine / take-theirs / view-diff before the canvas adopts disk truth.
-->
<ValidationBanner />
<ConflictPrompt />

<!--
  P17-12/13: Command palette + shortcut help overlay.
  Mounted once at the shell root; open/close driven by keyboard shortcuts
  (Cmd/Ctrl+K and ?) wired in handleKeydown. Both render nothing when closed.
-->
<CommandPalette open={commandPaletteOpen} onclose={() => (commandPaletteOpen = false)} />
<ShortcutHelp open={shortcutHelpOpen} onclose={() => (shortcutHelpOpen = false)} />

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

  /* Right-panel inspector tabs (Properties / Motion / Theme). */
  .right-tab {
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    border: 1px solid transparent;
    background: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .right-tab:hover:not(.active) {
    color: rgba(255, 255, 255, 0.65);
  }
  .right-tab.active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.9);
  }

  /*
   * The tabbed lower zone shares the right-top panel height with the outline.
   * Cap it so the outline tree always keeps room; the content scrolls inside.
   */
  .right-tabs {
    max-height: 60%;
  }
</style>
