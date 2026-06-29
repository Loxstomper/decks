<script lang="ts">
  /**
   * FreeTransformOverlay.svelte — Absolute drag-move + resize for free elements
   * (P4-2 move, P4-3 resize handles / spec 04 "Free → Move", "Resize handles").
   *
   * WHY THIS EXISTS:
   * ================
   * When a single `data-free` element is selected, this overlay draws the eight
   * resize handles + a move-frame OVER the element and turns drags on them into
   * geometry edits (data-x/y/w/h). It is a SIBLING of RevealFrame /
   * CanvasInteraction / DragController and, crucially, attaches NO listeners to
   * the iframe document — all interaction happens on its own overlay handle DOM
   * (pointer-events:auto) plus the parent window during a drag. That means it can
   * never break DragController's structured reorder/reparent behaviour: a grab on
   * a handle/move-frame is captured by THIS parent overlay before the iframe ever
   * sees the pointer-down, and when no free element is selected this overlay
   * renders nothing and the iframe handlers run unchanged.
   *
   * COORDINATE MODEL (spec 04 + 05, all geometry LOGICAL):
   *   • The element's authoritative rect is its LOGICAL data-x/y/w/h (falling back
   *     to a measured getBoundingClientRect, which is logical inside the iframe).
   *   • Pointer events fire on the PARENT window (the handles live in the parent
   *     doc). We convert their screen pixels to LOGICAL via the SAME coords.ts
   *     transform RevealFrame uses, so deltas fed to the pure geometry are logical.
   *   • Only the final screen projection (logicalRectToScreen) is in pixels — for
   *     drawing. Behaviour is therefore identical at any zoom / output resolution.
   *
   * The model mutation + undo + autosave is delegated to free-geometry-commands so
   * a whole gesture is one undo entry and one on-disk state.
   *
   * INTEGRATION CONTRACT (see integration_notes): mount as a sibling of
   * <RevealFrame>/<CanvasInteraction>/<DragController> inside the SAME
   * position:relative wrapper they fill (inset:0). Pass the live iframe element,
   * the SAME transform RevealFrame publishes, and reloadNonce so it re-measures
   * after a save/reload recreates the document. Place ABOVE DragController so its
   * move-frame supersedes DragController's free-drag branch (structured drags,
   * which start on non-free elements, are unaffected).
   */

  import {
    screenToLogical,
    type Transform,
    type Point,
  } from '$lib/coords.ts';
  import {
    logicalRectToScreen,
    domRectToLogical,
    type Rect,
  } from '$lib/canvas/overlay-geometry.ts';
  import { resizeRect, dragRect, type Handle } from '$lib/canvas/resize-geometry.ts';
  import { isFreeEl } from '$lib/canvas/drag-dom.ts';
  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import { gridStore } from '$lib/canvas/grid.svelte.ts';
  import {
    applyFreeGeometry,
    applyFreeGeometryBatch,
    type FreeGeometryEntry,
  } from '$lib/canvas/free-geometry-commands.ts';
  import ResizeHandles from './ResizeHandles.svelte';

  interface Props {
    iframe: HTMLIFrameElement | null | undefined;
    transform: Transform;
    reloadNonce?: number;
  }

  let { iframe, transform, reloadNonce = 0 }: Props = $props();

  // ── Reactive state (drives rendering) ───────────────────────────────────────

  /** Measured LOGICAL rect of the selected free element (null when N/A). */
  let baseRect = $state<Rect | null>(null);
  /** Live LOGICAL rect during an active move/resize gesture (else null). */
  let previewRect = $state<Rect | null>(null);
  /** True iff the current selection is a single free, non-editing element. */
  let freeSelected = $state(false);

  /** The overlay wrapper — its box origin matches the iframe's, so parent-window
   *  pointer coords convert through it into overlay-local screen space. */
  let wrapperEl: HTMLDivElement | undefined = $state();

  /** The rect we actually draw handles around: the live preview, else the base. */
  const displayLogical = $derived<Rect | null>(previewRect ?? baseRect);

  /** Screen-space (overlay-local) rect. Recomputes on geometry OR transform. */
  const screenRect = $derived<Rect | null>(
    freeSelected && displayLogical ? logicalRectToScreen(displayLogical, transform) : null,
  );

  // ── Non-reactive gesture state ──────────────────────────────────────────────

  interface Gesture {
    mode: 'move' | 'resize';
    /** Resize handle being dragged (null for a move). */
    handle: Handle | null;
    /** Pointer position (LOGICAL) at press. */
    startLogical: Point;
    /** Origin rect of the primary element (resize anchor / move preview). */
    primaryOrigin: Rect;
    /** All selected free elements + their origin rects (move applies to each). */
    origins: FreeGeometryEntry[];
    /** Latest logical delta, captured for the commit. */
    delta: Point;
    /** Latest modifier state (Shift = aspect, Alt = from-center). */
    aspect: boolean;
    fromCenter: boolean;
  }

  let gesture: Gesture | null = null;
  /** Watches the selected element for reflow so handles follow size changes. */
  let elementRO: ResizeObserver | null = null;

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function getDoc(): Document | null {
    try {
      return iframe?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  function eidSelector(eid: string): string {
    const esc =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid.replace(/"/g, '\\"');
    return `[data-eid="${esc}"]`;
  }

  function findEl(eid: string): Element | null {
    return getDoc()?.querySelector(eidSelector(eid)) ?? null;
  }

  /**
   * The element's LOGICAL rect: its data-x/y/w/h when present, else the measured
   * bounding rect (logical inside the iframe) — so a content-sized free element
   * still yields a concrete rect for the handles. data-x/y are taken even when
   * w/h are absent, and vice-versa, so a half-specified element stays anchored.
   */
  function measureRect(el: Element): Rect {
    const measured = domRectToLogical(el.getBoundingClientRect());
    const num = (attr: string, fallback: number): number => {
      const raw = el.getAttribute(attr);
      if (raw === null) return fallback;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      left: num('data-x', measured.left),
      top: num('data-y', measured.top),
      width: num('data-w', measured.width),
      height: num('data-h', measured.height),
    };
  }

  /** The current selection set as an eid array. With multi-select landed (P4-5/6)
   *  this returns the FULL set so a move-frame drag translates every selected free
   *  element by the same logical delta (applyFreeGeometryBatch = one undo entry).
   *  Resize stays single-element (the primary) by design — see onHandleDown. */
  function selectionEids(): string[] {
    return selectionStore.eids;
  }

  /**
   * Re-measure the selected free element and (re)attach the reflow observer.
   * Clears everything when the selection is not a single free, non-editing
   * element — handles must never appear on structured elements or mid text-edit.
   */
  function remeasure(): void {
    elementRO?.disconnect();

    const eid = selectionStore.eid;
    const el = eid ? findEl(eid) : null;
    // Gate: single free element, not in a contenteditable session.
    if (!el || !isFreeEl(el) || selectionStore.editing) {
      freeSelected = false;
      baseRect = null;
      return;
    }
    freeSelected = true;
    // Don't clobber a live gesture's preview with a stale base measure.
    if (!gesture) baseRect = measureRect(el);

    if (typeof ResizeObserver !== 'undefined') {
      elementRO ??= new ResizeObserver(() => {
        if (gesture) return; // a drag owns the geometry; ignore reflow noise
        const live = selectionStore.eid ? findEl(selectionStore.eid) : null;
        baseRect = live ? measureRect(live) : null;
      });
      elementRO.observe(el);
    }
  }

  // ── Pointer → logical conversion ────────────────────────────────────────────

  /** Convert a PARENT-window pointer event into overlay-local LOGICAL coords. */
  function eventToLogical(e: PointerEvent): Point | null {
    if (!wrapperEl) return null;
    const box = wrapperEl.getBoundingClientRect();
    return screenToLogical({ x: e.clientX - box.left, y: e.clientY - box.top }, transform);
  }

  // ── Gesture lifecycle ───────────────────────────────────────────────────────

  /** Pointer-down on a handle (resize) or the move-frame (handle === null). */
  function onHandleDown(handle: Handle | null, e: PointerEvent): void {
    if (e.button !== 0 || !freeSelected || !baseRect) return;
    const start = eventToLogical(e);
    if (!start) return;
    // We own this gesture — stop it bubbling to selection / iframe handlers.
    e.preventDefault();
    e.stopPropagation();

    // Move applies to every selected element; resize only to the primary one.
    const origins: FreeGeometryEntry[] =
      handle === null
        ? selectionEids()
            .map((id) => {
              const node = findEl(id);
              return node && isFreeEl(node) ? { eid: id, rect: measureRect(node) } : null;
            })
            .filter((x): x is FreeGeometryEntry => x !== null)
        : selectionStore.eid
          ? [{ eid: selectionStore.eid, rect: baseRect }]
          : [];
    if (origins.length === 0) return;

    gesture = {
      mode: handle === null ? 'move' : 'resize',
      handle,
      startLogical: start,
      primaryOrigin: baseRect,
      origins,
      delta: { x: 0, y: 0 },
      aspect: e.shiftKey,
      fromCenter: e.altKey,
    };

    // Capture so the drag keeps tracking even if the pointer leaves the handle.
    (e.target as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onWinMove, true);
    window.addEventListener('pointerup', onWinUp, true);
  }

  function onWinMove(e: PointerEvent): void {
    if (!gesture) return;
    const pt = eventToLogical(e);
    if (!pt) return;
    e.preventDefault();

    const dx = pt.x - gesture.startLogical.x;
    const dy = pt.y - gesture.startLogical.y;
    gesture.delta = { x: dx, y: dy };
    gesture.aspect = e.shiftKey;
    gesture.fromCenter = e.altKey;

    const snap = gridStore.effectiveSize;
    if (gesture.mode === 'resize' && gesture.handle) {
      previewRect = resizeRect(gesture.primaryOrigin, gesture.handle, dx, dy, {
        aspect: gesture.aspect,
        fromCenter: gesture.fromCenter,
        snap,
      });
    } else {
      // Preview shows the primary element; commit applies the same delta to all.
      previewRect = dragRect(gesture.primaryOrigin, dx, dy, snap);
    }
  }

  function onWinUp(): void {
    const g = gesture;
    gesture = null;
    window.removeEventListener('pointermove', onWinMove, true);
    window.removeEventListener('pointerup', onWinUp, true);
    previewRect = null;
    if (!g) return;

    const snap = gridStore.effectiveSize;
    if (g.mode === 'resize' && g.handle && selectionStore.eid) {
      const finalRect = resizeRect(g.primaryOrigin, g.handle, g.delta.x, g.delta.y, {
        aspect: g.aspect,
        fromCenter: g.fromCenter,
        snap,
      });
      applyFreeGeometry(selectionStore.eid, finalRect);
    } else {
      // Move: apply the same logical delta to every selected element's own origin.
      const entries: FreeGeometryEntry[] = g.origins.map(({ eid, rect }) => ({
        eid,
        rect: dragRect(rect, g.delta.x, g.delta.y, snap),
      }));
      applyFreeGeometryBatch(entries);
    }
    // The commit reloads the iframe (reloadNonce++) → remeasure picks up new geom.
  }

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Re-acquire the selected element when the iframe (re)loads.
  $effect(() => {
    const frame = iframe;
    if (!frame) return;
    reloadNonce; // re-run after a save/reload recreates the document

    const onLoad = () => remeasure();
    frame.addEventListener('load', onLoad);
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete') {
      remeasure();
    }
    return () => {
      frame.removeEventListener('load', onLoad);
      elementRO?.disconnect();
      // Abort any in-flight gesture if the frame goes away.
      window.removeEventListener('pointermove', onWinMove, true);
      window.removeEventListener('pointerup', onWinUp, true);
      gesture = null;
      previewRect = null;
    };
  });

  // Follow selection + editing changes (P4-3 handles track the active selection).
  $effect(() => {
    selectionStore.eid;
    selectionStore.editing;
    reloadNonce;
    remeasure();
  });
</script>

<div bind:this={wrapperEl} class="free-transform-overlay">
  <ResizeHandles rect={screenRect} onhandledown={onHandleDown} />
</div>

<style>
  .free-transform-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* The container is inert; only the handle dots / move-frame inside opt back
       into pointer events. Everything else passes clicks through to the iframe. */
    pointer-events: none;
    /* Above CanvasInteraction's selection box + DragController so handles win. */
    z-index: 8;
  }
</style>
