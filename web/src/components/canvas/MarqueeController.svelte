<script lang="ts">
  /**
   * MarqueeController.svelte — Marquee (rubber-band) multi-select controller (P4-5).
   *
   * WHY THIS EXISTS (spec canvas-interaction "Marquee (drag-select) for multi-select"):
   * ===================================================================
   * Dragging on EMPTY canvas space draws a selection rectangle; on release every
   * element whose LOGICAL rect is touched by (intersect) or enclosed in (contain)
   * the band is selected together via the multi-select selection API. Like its
   * siblings CanvasInteraction/DragController, this does NOT own the iframe: it
   * takes the live iframe element + the coords.ts transform as props, attaches
   * pointer listeners to the same-origin iframe document, and renders the band in
   * an overlay layer over (but outside) the iframe.
   *
   * COORDINATE MODEL (spec canvas-interaction "all hit-testing in logical space"):
   *   • Pointer events INSIDE the iframe report clientX/Y in the iframe's own
   *     viewport = LOGICAL space (iframe is sized 1920×1080, reveal at scale 1).
   *   • Pointer events on the PARENT window (cursor left the iframe mid-drag) are
   *     screen pixels → converted via coords.ts screenToLogical through the overlay
   *     wrapper's box. One logical space end-to-end; the transform is re-applied
   *     only to DRAW the band.
   *   • Candidate element rects are getBoundingClientRect() inside the iframe →
   *     already logical (overlay-geometry.ts). The hit test (marquee.ts) is pure.
   *
   * WHY ONLY EMPTY SPACE STARTS A MARQUEE:
   *   A press on a selectable element is a click (CanvasInteraction) or a drag-move
   *   (DragController). We start a marquee ONLY when the press resolves to no
   *   selectable element — exactly the gap those two controllers leave.
   *
   * THE TRAILING-CLICK PROBLEM (load-bearing):
   *   After a marquee drag the browser fires a `click` on empty space, which
   *   CanvasInteraction (listening on the iframe DOCUMENT) would turn into
   *   selectionStore.clear() — wiping the marquee result. We swallow that one click
   *   with a CAPTURE-phase listener on the iframe WINDOW: capturing traversal hits
   *   `window` BEFORE `document`, so stopPropagation there preempts
   *   CanvasInteraction deterministically (no listener-registration-order races).
   *   A plain click (no drag) is never swallowed, so empty-click-to-deselect works.
   */

  import {
    screenToLogical,
    type Transform,
    type Point,
  } from '$lib/coords.ts';
  import { resolveSelectable, isLeafTag, type ElementLike } from '$lib/canvas/eid.ts';
  import { domRectToLogical, logicalRectToScreen, type Rect } from '$lib/canvas/overlay-geometry.ts';
  import {
    marqueeRectFromPoints,
    elementsInMarquee,
    type MarqueeCandidate,
    type MarqueeMode,
  } from '$lib/canvas/marquee.ts';
  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import MarqueeOverlay from './MarqueeOverlay.svelte';

  interface Props {
    iframe: HTMLIFrameElement | null | undefined;
    transform: Transform;
    reloadNonce?: number;
  }

  let { iframe, transform, reloadNonce = 0 }: Props = $props();

  /** Movement (LOGICAL units) before a press becomes a marquee — avoids hijacking
   *  a plain empty-space click that should deselect. */
  const MARQUEE_THRESHOLD = 4;

  // ── Reactive overlay state ──────────────────────────────────────────────────

  /** Screen-space band rect, or null when no marquee is in progress. */
  let bandScreen = $state<Rect | null>(null);

  // ── Non-reactive controller state ───────────────────────────────────────────

  /** Overlay wrapper — its box origin matches the iframe's, so window pointer
   *  coords convert through it into overlay-local screen space. */
  let wrapperEl: HTMLDivElement | undefined = $state();

  interface MarqueeState {
    /** Anchor (logical) where the press began. */
    start: Point;
    /** Latest pointer (logical). */
    current: Point;
    /** True once movement passed the threshold (a real marquee, not a click). */
    active: boolean;
  }
  let marquee: MarqueeState | null = null;

  /** Set when an active marquee just ended, so the trailing click is swallowed. */
  let suppressNextClick = false;

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

  /** Convert a PARENT-window pointer event to overlay-local LOGICAL coordinates. */
  function windowEventToLogical(e: PointerEvent): Point | null {
    if (!wrapperEl) return null;
    const box = wrapperEl.getBoundingClientRect();
    return screenToLogical({ x: e.clientX - box.left, y: e.clientY - box.top }, transform);
  }

  /**
   * Build the candidate list: every element with a data-eid that is a selectable
   * LEAF or a FREE element, paired with its logical rect. Containers (sections /
   * layout boxes) are excluded — marquee selects content/free items, mirroring the
   * click-selects-a-leaf rule (eid.ts); containers are chosen via the outline.
   */
  function buildCandidates(): MarqueeCandidate[] {
    const doc = getDoc();
    if (!doc) return [];
    const out: MarqueeCandidate[] = [];
    for (const el of Array.from(doc.querySelectorAll('[data-eid]'))) {
      const eid = el.getAttribute('data-eid');
      if (!eid) continue;
      const isFree = el.hasAttribute('data-free');
      if (!isFree && !isLeafTag(el.tagName)) continue;
      out.push({ eid, rect: domRectToLogical(el.getBoundingClientRect()) });
    }
    return out;
  }

  /** Push the marquee result into the multi-select selection store (Lane A API).
   *  `additive` (Shift held) UNIONs the hits with the existing selection — the
   *  standard "add another group" gesture; otherwise the band REPLACES it. */
  function applySelection(eids: string[], additive: boolean): void {
    if (additive) {
      for (const eid of eids) selectionStore.add(eid);
    } else {
      // set([]) clears — an empty marquee over nothing deselects, matching intent.
      selectionStore.set(eids);
    }
  }

  // ── Press / drag lifecycle ──────────────────────────────────────────────────

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // primary button only
    // Only EMPTY space starts a marquee: a selectable target is a click/drag-move.
    const sel = resolveSelectable(e.target as unknown as ElementLike | null);
    if (sel) return;

    // Inside-iframe clientX/Y is already logical (see header).
    const start = { x: e.clientX, y: e.clientY };
    marquee = { start, current: start, active: false };
  }

  function onMove(pt: Point, e: PointerEvent): void {
    if (!marquee) return;
    marquee.current = pt;
    if (!marquee.active) {
      if (Math.hypot(pt.x - marquee.start.x, pt.y - marquee.start.y) < MARQUEE_THRESHOLD) return;
      marquee.active = true;
    }
    // We own the gesture now — suppress text selection / native drag.
    e.preventDefault();
    const logical = marqueeRectFromPoints(marquee.start, marquee.current);
    bandScreen = logicalRectToScreen(logical, transform);
  }

  function onUp(e: PointerEvent): void {
    const m = marquee;
    marquee = null;
    bandScreen = null;
    if (!m || !m.active) return; // a plain click — let CanvasInteraction handle it.

    // Alt = require full containment (precise), default = intersect (forgiving).
    const mode: MarqueeMode = e.altKey ? 'contain' : 'intersect';
    const logical = marqueeRectFromPoints(m.start, m.current);
    const eids = elementsInMarquee(logical, buildCandidates(), mode);
    applySelection(eids, e.shiftKey);

    // Swallow the click the browser will fire next, so it cannot clear selection.
    suppressNextClick = true;
  }

  // ── Click swallow (window-capture, beats CanvasInteraction's doc listener) ────

  function onWindowClickCapture(e: Event): void {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    // Stop the document-level click handler (CanvasInteraction) from clearing.
    e.stopPropagation();
    e.preventDefault();
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

  function attach(doc: Document, win: Window): void {
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointermove', onDocMove, true);
    doc.addEventListener('pointerup', onUp, true);
    // Window-capture click swallow: fires before the document-phase click handler.
    win.addEventListener('click', onWindowClickCapture, true);
    // Editor-window listeners cover the cursor leaving the iframe mid-drag.
    // Bind to the editor's own `window` (the iframe's parent) rather than
    // `win.parent`: the latter goes null once RevealFrame's {#key} block tears
    // down the old iframe, which would throw in detach() on reload.
    window.addEventListener('pointermove', onWinMove, true);
    window.addEventListener('pointerup', onUp, true);
  }

  function detach(doc: Document, win: Window): void {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointermove', onDocMove, true);
    doc.removeEventListener('pointerup', onUp, true);
    win.removeEventListener('click', onWindowClickCapture, true);
    window.removeEventListener('pointermove', onWinMove, true);
    window.removeEventListener('pointerup', onUp, true);
  }

  $effect(() => {
    const frame = iframe;
    if (!frame) return;
    reloadNonce; // re-attach after a save/reload recreates the document.

    let attached: { doc: Document; win: Window } | null = null;

    const attachIfReady = () => {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (doc && win && doc !== attached?.doc) {
        if (attached) detach(attached.doc, attached.win);
        attach(doc, win);
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
      if (attached) detach(attached.doc, attached.win);
      marquee = null;
      bandScreen = null;
      suppressNextClick = false;
    };
  });
</script>

<div bind:this={wrapperEl} class="marquee-controller-overlay" aria-hidden="true">
  <MarqueeOverlay rect={bandScreen} />
</div>

<style>
  .marquee-controller-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden; /* clip the band to the canvas, matching the iframe clip */
    /* Visual only — all pointer handling happens on the iframe doc / window. */
    pointer-events: none;
    z-index: 3;
  }
</style>
