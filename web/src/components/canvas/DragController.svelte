<script lang="ts">
  /**
   * DragController.svelte — Reorder / reparent / free-move drag controller
   * (P3-6, P3-7, P3-8 for free drags / spec 04 "Two drag semantics").
   *
   * WHY THIS EXISTS:
   * ================
   * This is the parent-side controller that turns a press-and-drag on an element
   * inside the reveal.js iframe into a STRUCTURAL move (reorder among siblings /
   * reparent into another container) or a FREE move (data-x/data-y reposition).
   * Like its sibling CanvasInteraction.svelte, it does NOT own the iframe: it
   * takes the live iframe element + the current coords.ts transform as props,
   * attaches pointer listeners to the same-origin iframe document, and renders a
   * drop indicator / drag ghost in an overlay layer over (but outside) the iframe.
   *
   * COORDINATE MODEL (spec 04 "all hit-testing in logical space"):
   *   • Pointer events that fire INSIDE the iframe report clientX/clientY in the
   *     iframe's own viewport, which is the LOGICAL 1920×1080 space (the iframe is
   *     sized at logical dimensions and reveal renders at scale 1 — the parent's
   *     CSS transform does not affect the child's internal coordinates). So those
   *     coordinates ARE already logical — the same space resolveDrop expects.
   *   • Pointer events that fire on the PARENT window (when the cursor leaves the
   *     iframe mid-drag) are in screen pixels; we convert them with the SAME
   *     transform via coords.ts `screenToLogical`. Listening on both surfaces lets
   *     a drag continue past the iframe edge.
   *   • Candidate container/child rects are measured with getBoundingClientRect()
   *     inside the iframe → also logical (overlay-geometry.ts). One logical space
   *     end-to-end; the transform is only re-applied to DRAW the overlay.
   *
   * The actual model mutation + undo + autosave is delegated to the store commands
   * (structure-commands.ts) so a drop is one undo entry and one on-disk state.
   *
   * INTEGRATION CONTRACT (see integration_notes): mount as a sibling of
   * <RevealFrame>/<CanvasInteraction> inside the SAME position:relative wrapper
   * that both fill (inset:0). Pass the live iframe element, the SAME transform
   * RevealFrame publishes, and reloadNonce so listeners re-attach after a reload.
   */

  import {
    screenToLogical,
    logicalToScreen,
    type Transform,
    type Point,
    LOGICAL_WIDTH,
    LOGICAL_HEIGHT,
  } from '$lib/coords.ts';
  import { resolveSelectable, type ElementLike } from '$lib/canvas/eid.ts';
  import { logicalRectToScreen, domRectToLogical, type Rect } from '$lib/canvas/overlay-geometry.ts';
  import {
    buildContainerCandidates,
    isFreeEl,
  } from '$lib/canvas/drag-dom.ts';
  import {
    resolveDrop,
    dropIndicatorRect,
    type ContainerCandidate,
    type DropTarget,
  } from '$lib/canvas/drag-geometry.ts';
  import { reparentChildCommand, moveFreeCommand } from '$lib/canvas/structure-commands.ts';
  import { snapPointToGrid } from '$lib/canvas/snap-grid.ts';
  import { gridStore } from '$lib/canvas/grid.svelte.ts';
  import { computeGuides, DEFAULT_GUIDE_THRESHOLD, type AlignGuide } from '$lib/canvas/alignment-guides.ts';
  import GuidesOverlay from './GuidesOverlay.svelte';

  interface Props {
    iframe: HTMLIFrameElement | null | undefined;
    transform: Transform;
    reloadNonce?: number;
    /**
     * Logical canvas dimensions (for guide computation against slide edges/center).
     * Defaults to the standard 1920×1080 logical canvas.
     */
    logicalWidth?: number;
    logicalHeight?: number;
  }

  let {
    iframe,
    transform,
    reloadNonce = 0,
    logicalWidth = LOGICAL_WIDTH,
    logicalHeight = LOGICAL_HEIGHT,
  }: Props = $props();

  /** Movement (in LOGICAL units) before a press becomes a drag — avoids hijacking
   *  plain clicks that CanvasInteraction turns into selection. */
  const DRAG_THRESHOLD = 5;

  // ── Reactive overlay state (drives rendering) ───────────────────────────────

  /** Screen-space rect of the structural drop indicator line, or null. */
  let indicatorScreen = $state<Rect | null>(null);
  /** Screen-space rect of the free-move ghost outline, or null. */
  let ghostScreen = $state<Rect | null>(null);
  /**
   * Active smart alignment guides to render during a free drag.
   * Computed by `computeGuides` in updateFree; cleared on drag end.
   */
  let activeGuides = $state<AlignGuide[]>([]);

  // ── Non-reactive controller state ───────────────────────────────────────────

  /** The overlay wrapper element — its box origin matches the iframe's, so window
   *  pointer coordinates convert through it into overlay-local screen space. */
  let wrapperEl: HTMLDivElement | undefined = $state();

  interface DragState {
    eid: string;
    kind: 'structured' | 'free';
    /** Pointer position (logical) at press. */
    start: Point;
    /** True once movement passed the threshold. */
    active: boolean;
    /** Cached candidate containers (structured) measured at activation. */
    candidates: ContainerCandidate[];
    /** Origin logical position of a free element (data-x/data-y). */
    freeOrigin: Point;
    /** Logical size of the dragged element (for the free ghost). */
    size: { width: number; height: number };
    /** Latest resolved structural drop target. */
    drop: DropTarget | null;
    /** Latest resolved free landing position (snapped). */
    freeTarget: Point | null;
    /**
     * Logical rects of OTHER free elements on the same slide, collected at
     * drag-activation time (not re-measured per move for performance).
     * Used by computeGuides for sibling alignment snapping.
     */
    siblingRects: Rect[];
  }

  let drag: DragState | null = null;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getDoc(): Document | null {
    try {
      return iframe?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  function getWin(): Window | null {
    try {
      return iframe?.contentWindow ?? null;
    } catch {
      return null;
    }
  }

  /** The dragged element's live DOM node in the current iframe document. */
  function draggedEl(eid: string): Element | null {
    const doc = getDoc();
    if (!doc) return null;
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid;
    return doc.querySelector(`[data-eid="${esc}"]`);
  }

  /** Parse a free element's logical origin from its data-x/data-y (fallback rect). */
  function freeOriginOf(el: Element, rect: Rect): Point {
    const px = parseFloat(el.getAttribute('data-x') ?? '');
    const py = parseFloat(el.getAttribute('data-y') ?? '');
    return {
      x: Number.isFinite(px) ? px : rect.left,
      y: Number.isFinite(py) ? py : rect.top,
    };
  }

  /** Convert a PARENT-window pointer event into overlay-local logical coordinates. */
  function windowEventToLogical(e: PointerEvent): Point | null {
    if (!wrapperEl) return null;
    const box = wrapperEl.getBoundingClientRect();
    return screenToLogical({ x: e.clientX - box.left, y: e.clientY - box.top }, transform);
  }

  // ── Press / drag lifecycle ──────────────────────────────────────────────────

  function onPointerDown(e: PointerEvent): void {
    // Only primary button initiates a drag; ignore right/middle.
    if (e.button !== 0) return;
    const sel = resolveSelectable(e.target as unknown as ElementLike | null);
    if (!sel) return;

    const el = draggedEl(sel.eid);
    if (!el) return;

    const rect = domRectToLogical(el.getBoundingClientRect());
    const kind: DragState['kind'] = isFreeEl(el) ? 'free' : 'structured';

    drag = {
      eid: sel.eid,
      kind,
      // Inside-iframe clientX/Y is already logical (see header).
      start: { x: e.clientX, y: e.clientY },
      active: false,
      candidates: [],
      freeOrigin: kind === 'free' ? freeOriginOf(el, rect) : { x: 0, y: 0 },
      size: { width: rect.width, height: rect.height },
      drop: null,
      freeTarget: null,
      siblingRects: [],
    };
  }

  /** Shared move handler — `pt` is already in LOGICAL space. */
  function onMove(pt: Point, e: PointerEvent): void {
    if (!drag) return;

    if (!drag.active) {
      const dx = pt.x - drag.start.x;
      const dy = pt.y - drag.start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      activate();
    }
    // Suppress text selection / native drag once we own the gesture.
    e.preventDefault();

    if (drag.kind === 'structured') updateStructured(pt);
    else updateFree(pt);
  }

  function activate(): void {
    if (!drag) return;
    drag.active = true;

    const doc = getDoc();
    const win = getWin();

    if (drag.kind === 'structured') {
      if (doc && win) {
        const all = buildContainerCandidates(doc, win);
        // Exclude the dragged element and any container nested inside it — you
        // cannot drop a subtree into its own descendant.
        const self = draggedEl(drag.eid);
        drag.candidates = all.filter(
          (c) => c.eid !== drag!.eid && !(self && isInside(doc, c.eid, self)),
        );
      }
    } else if (drag.kind === 'free' && doc) {
      // Collect logical rects of all OTHER data-free elements on the slide so
      // computeGuides can check alignment against them. Measured once at
      // activation (not per-move) — free elements don't reflow during a drag.
      const siblings: Rect[] = [];
      const freeEls = doc.querySelectorAll<HTMLElement>('[data-free]');
      for (const el of freeEls) {
        const eid = el.getAttribute('data-eid');
        if (!eid || eid === drag.eid) continue; // skip the dragging element
        siblings.push(domRectToLogical(el.getBoundingClientRect()));
      }
      drag.siblingRects = siblings;
    }
  }

  /** True when the container with `eid` is nested inside `ancestor`. */
  function isInside(doc: Document, eid: string, ancestor: Element): boolean {
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid;
    const el = doc.querySelector(`[data-eid="${esc}"]`);
    return el !== null && ancestor.contains(el);
  }

  function updateStructured(pt: Point): void {
    if (!drag) return;
    const target = resolveDrop(pt, drag.candidates, drag.eid);
    drag.drop = target;
    if (!target) {
      indicatorScreen = null;
      return;
    }
    const container = drag.candidates.find((c) => c.eid === target.parentEid);
    if (!container) {
      indicatorScreen = null;
      return;
    }
    const logical = dropIndicatorRect(container, target.index, drag.eid);
    indicatorScreen = logicalRectToScreen(logical, transform);
    ghostScreen = null;
  }

  function updateFree(pt: Point): void {
    if (!drag) return;

    // Raw position from drag delta
    const raw: Point = {
      x: drag.freeOrigin.x + (pt.x - drag.start.x),
      y: drag.freeOrigin.y + (pt.y - drag.start.y),
    };

    // Step 1: Apply smart guide snapping (P4-4).
    //   computeGuides returns a snappedRect nudged toward alignment targets.
    //   Only snap via guides when the grid is NOT dominant — if the guide snap
    //   and grid snap point in opposite directions, the guide wins (it is more
    //   intentional). Both can be applied axis-independently.
    const rawRect = { left: raw.x, top: raw.y, width: drag.size.width, height: drag.size.height };
    const { snappedRect, guides } = computeGuides(
      rawRect,
      drag.siblingRects,
      { width: logicalWidth, height: logicalHeight },
      DEFAULT_GUIDE_THRESHOLD,
    );
    activeGuides = guides;

    // Step 2: Grid snap on each axis, but only if no guide already snapped that axis.
    //   A guide snap is signalled by a non-zero displacement (snappedRect differs
    //   from rawRect). If both axes have guide snaps, grid snap is skipped entirely;
    //   if only one axis snapped, apply grid to the other for consistency.
    const guideSnappedX = snappedRect.left !== raw.x;
    const guideSnappedY = snappedRect.top !== raw.y;
    const gridSize = gridStore.effectiveSize;

    const finalX = guideSnappedX ? snappedRect.left : snapPointToGrid({ x: snappedRect.left, y: 0 }, gridSize).x;
    const finalY = guideSnappedY ? snappedRect.top : snapPointToGrid({ x: 0, y: snappedRect.top }, gridSize).y;

    const finalPt: Point = { x: finalX, y: finalY };
    drag.freeTarget = finalPt;

    ghostScreen = logicalRectToScreen(
      { left: finalPt.x, top: finalPt.y, width: drag.size.width, height: drag.size.height },
      transform,
    );
    indicatorScreen = null;
  }

  function onUp(): void {
    if (!drag) {
      clearOverlay();
      return;
    }
    const d = drag;
    drag = null;
    clearOverlay();

    if (!d.active) return; // was a click, not a drag — let selection handle it.

    if (d.kind === 'structured') {
      if (d.drop) reparentChildCommand(d.eid, d.drop.parentEid, d.drop.index);
    } else if (d.freeTarget) {
      moveFreeCommand(d.eid, d.freeTarget);
    }
  }

  function clearOverlay(): void {
    indicatorScreen = null;
    ghostScreen = null;
    activeGuides = [];
  }

  // ── Document / window attach ────────────────────────────────────────────────

  function onDocMove(e: PointerEvent): void {
    // Inside the iframe → clientX/Y already logical.
    onMove({ x: e.clientX, y: e.clientY }, e);
  }
  function onWinMove(e: PointerEvent): void {
    const pt = windowEventToLogical(e);
    if (pt) onMove(pt, e);
  }
  function onDocUp(): void {
    onUp();
  }
  function onWinUp(): void {
    onUp();
  }

  function attachDoc(doc: Document, win: Window): void {
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointermove', onDocMove, true);
    doc.addEventListener('pointerup', onDocUp, true);
    // Editor-window listeners cover the cursor leaving the iframe mid-drag.
    // Bind to the editor's own `window` (the iframe's parent) rather than
    // `win.parent`: the latter goes null once RevealFrame's {#key} block tears
    // down the old iframe, which would throw in detachDoc() on reload.
    window.addEventListener('pointermove', onWinMove, true);
    window.addEventListener('pointerup', onWinUp, true);
  }

  function detachDoc(doc: Document, win: Window): void {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointermove', onDocMove, true);
    doc.removeEventListener('pointerup', onDocUp, true);
    window.removeEventListener('pointermove', onWinMove, true);
    window.removeEventListener('pointerup', onWinUp, true);
  }

  $effect(() => {
    const frame = iframe;
    if (!frame) return;
    // Depend on reloadNonce so we re-attach after a save/reload recreates the doc.
    reloadNonce;

    let attached: { doc: Document; win: Window } | null = null;

    const attachIfReady = () => {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (doc && win && doc !== attached?.doc) {
        if (attached) detachDoc(attached.doc, attached.win);
        attachDoc(doc, win);
        attached = { doc, win };
      }
    };

    const onLoad = () => attachIfReady();
    frame.addEventListener('load', onLoad);
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete') {
      attachIfReady();
    }

    return () => {
      frame.removeEventListener('load', onLoad);
      if (attached) detachDoc(attached.doc, attached.win);
      drag = null;
      clearOverlay();
    };
  });
</script>

<div bind:this={wrapperEl} class="drag-controller-overlay" aria-hidden="true">
  {#if indicatorScreen}
    <div
      class="drop-indicator"
      style:left="{indicatorScreen.left}px"
      style:top="{indicatorScreen.top}px"
      style:width="{indicatorScreen.width}px"
      style:height="{indicatorScreen.height}px"
    ></div>
  {/if}
  {#if ghostScreen}
    <div
      class="drag-ghost"
      style:left="{ghostScreen.left}px"
      style:top="{ghostScreen.top}px"
      style:width="{ghostScreen.width}px"
      style:height="{ghostScreen.height}px"
    ></div>
  {/if}
  <!-- Smart alignment guides (P4-4): rendered during free-element drag -->
  <GuidesOverlay guides={activeGuides} {transform} {logicalWidth} {logicalHeight} />
</div>

<style>
  .drag-controller-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* Visual only — all pointer handling happens on the iframe doc / window. */
    pointer-events: none;
    z-index: 2;
  }

  /* Structural reorder/reparent insertion line. */
  .drop-indicator {
    position: absolute;
    background-color: #4a9eff;
    border-radius: 2px;
    box-shadow: 0 0 4px rgba(74, 158, 255, 0.8);
  }

  /* Free-move landing outline. */
  .drag-ghost {
    position: absolute;
    border: 1.5px dashed #4a9eff;
    background-color: rgba(74, 158, 255, 0.08);
    border-radius: 2px;
  }
</style>
