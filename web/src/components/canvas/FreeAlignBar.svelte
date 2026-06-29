<script lang="ts">
  /**
   * FreeAlignBar.svelte — Align/distribute toolbar for free multi-selection (P4-6).
   *
   * WHY THIS EXISTS (spec 04 "Align / distribute"):
   * ================================================
   * When the user selects 2+ `data-free` elements (via Shift+click on the canvas
   * or from the outline panel), this floating bar appears with buttons to:
   *   • Align edges/centers: left / right / top / bottom / center-H / center-V
   *   • Distribute: horizontally (equal horizontal gaps) / vertically (equal gaps)
   *
   * Each operation:
   *   1. Measures the current logical rects of selected free elements from the
   *      iframe (getBoundingClientRect inside the iframe = logical coords per
   *      overlay-geometry.ts).
   *   2. Calls the pure align/distribute function from align-distribute.ts.
   *   3. Calls `deckStore.applyFreeGeometryBatch(positions)` — ONE undo entry +
   *      ONE autosave for the whole multi-element operation.
   *
   * INTEGRATION CONTRACT:
   *   Mount this as a sibling of CanvasInteraction/DragController inside the same
   *   `position:relative` wrapper.  Pass the SAME live `iframe` element.
   *   The component is fully self-contained: it reads selectionStore.eids directly
   *   and hides itself when fewer than 2 free elements are selected.
   *
   * Distribute is available only for 3+ elements (2 elements already define the
   * span — there is nothing between them to distribute).
   *
   * `pointer-events: auto` on the bar itself so the buttons are clickable; but the
   * bar does NOT intercept pointer events on the canvas (it is absolutely
   * positioned outside the slide area).
   */

  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import { deckStore } from '$lib/store/deck.svelte.ts';
  import { domRectToLogical } from '$lib/canvas/overlay-geometry.ts';
  import {
    alignLeft,
    alignRight,
    alignTop,
    alignBottom,
    alignCenterH,
    alignCenterV,
    distributeHorizontally,
    distributeVertically,
    type FreeRect,
  } from '$lib/canvas/align-distribute.ts';

  interface Props {
    /**
     * The live reveal.js iframe — used to measure element rects in logical space.
     * When null/undefined the bar remains hidden (no deck loaded).
     */
    iframe: HTMLIFrameElement | null | undefined;
  }

  let { iframe }: Props = $props();

  // ── Derived state ──────────────────────────────────────────────────────────

  /**
   * The bar is visible when 2+ elements are selected (we don't know yet if they
   * are ALL free — that is checked at click time; structural elements are simply
   * skipped during measurement). Re-evaluates whenever selectionStore.eids changes.
   */
  const visible = $derived(selectionStore.eids.length >= 2);

  /** True when 3+ are selected — enables the distribute buttons. */
  const canDistribute = $derived(selectionStore.eids.length >= 3);

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Query the iframe document for a `data-eid` element, returning null on
   * cross-origin errors or if the iframe is not yet loaded.
   */
  function findInIframe(eid: string): HTMLElement | null {
    try {
      const doc = iframe?.contentDocument;
      if (!doc) return null;
      const esc =
        typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid.replace(/"/g, '\\"');
      return doc.querySelector<HTMLElement>(`[data-eid="${esc}"]`);
    } catch {
      return null;
    }
  }

  /**
   * Collect logical rects for all currently selected FREE elements by measuring
   * their getBoundingClientRect inside the iframe (already logical units — see
   * overlay-geometry.ts header).
   *
   * Silently skips eids that are not present in the iframe (e.g. structural
   * elements, or stale eids after an external reload). Callers should check that
   * the returned array has at least 2 entries before proceeding.
   */
  function collectFreeRects(): FreeRect[] {
    const result: FreeRect[] = [];
    for (const eid of selectionStore.eids) {
      const el = findInIframe(eid);
      if (!el) continue;
      // Only act on free elements (data-free attribute signals free positioning)
      if (!el.hasAttribute('data-free')) continue;
      result.push({ eid, rect: domRectToLogical(el.getBoundingClientRect()) });
    }
    return result;
  }

  /**
   * Execute an alignment/distribution operation:
   *   1. Measure current free-element rects.
   *   2. Compute new positions via the pure op function.
   *   3. Apply via store (one undo entry + one save).
   */
  async function apply(
    op: (rects: FreeRect[]) => Map<string, { left: number; top: number; width: number; height: number }>,
  ): Promise<void> {
    const rects = collectFreeRects();
    if (rects.length < 2) return; // safety guard
    const newRects = op(rects);
    // Convert rect positions (left/top) to the {x, y} format applyFreeGeometryBatch expects
    const positions = new Map<string, { x: number; y: number }>();
    for (const [eid, rect] of newRects) {
      positions.set(eid, { x: rect.left, y: rect.top });
    }
    await deckStore.applyFreeGeometryBatch(positions);
  }

  // ── Button handlers ────────────────────────────────────────────────────────

  const doAlignLeft       = () => apply(alignLeft);
  const doAlignRight      = () => apply(alignRight);
  const doAlignTop        = () => apply(alignTop);
  const doAlignBottom     = () => apply(alignBottom);
  const doAlignCenterH    = () => apply(alignCenterH);
  const doAlignCenterV    = () => apply(alignCenterV);
  const doDistributeH     = () => apply(distributeHorizontally);
  const doDistributeV     = () => apply(distributeVertically);
</script>

{#if visible}
  <!--
    Floating bar that appears when 2+ free elements are selected.
    The integrator can position this relative to the canvas pane or the
    properties panel — it is `position: relative` inside whatever container
    mounts it. The `pointer-events: none` on the parent canvas overlays does
    NOT apply here (this component lives outside those overlays).
  -->
  <div class="free-align-bar" role="toolbar" aria-label="Align and distribute">

    <!-- ── Align group ──────────────────────────────────────────────────── -->
    <div class="group" aria-label="Align">
      <button class="btn" title="Align left edges" onclick={doAlignLeft}>
        <!-- Left-align icon: left edge line + items flush to it -->
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <line x1="4" y1="2" x2="4" y2="18"/>
          <rect x="4" y="4"  width="9"  height="4" rx="1"/>
          <rect x="4" y="12" width="12" height="4" rx="1"/>
        </svg>
        <span class="sr-only">Align left</span>
      </button>

      <button class="btn" title="Align horizontal centers" onclick={doAlignCenterH}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <line x1="10" y1="2" x2="10" y2="18"/>
          <rect x="5"  y="4"  width="10" height="4" rx="1"/>
          <rect x="2"  y="12" width="16" height="4" rx="1"/>
        </svg>
        <span class="sr-only">Align horizontal centers</span>
      </button>

      <button class="btn" title="Align right edges" onclick={doAlignRight}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <line x1="16" y1="2" x2="16" y2="18"/>
          <rect x="4"  y="4"  width="12" height="4" rx="1"/>
          <rect x="7"  y="12" width="9"  height="4" rx="1"/>
        </svg>
        <span class="sr-only">Align right</span>
      </button>

      <div class="sep" aria-hidden="true"></div>

      <button class="btn" title="Align top edges" onclick={doAlignTop}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <line x1="2" y1="4" x2="18" y2="4"/>
          <rect x="4"  y="4" width="4"  height="9"  rx="1"/>
          <rect x="12" y="4" width="4"  height="12" rx="1"/>
        </svg>
        <span class="sr-only">Align top</span>
      </button>

      <button class="btn" title="Align vertical centers" onclick={doAlignCenterV}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <line x1="2" y1="10" x2="18" y2="10"/>
          <rect x="4"  y="5"  width="4" height="10" rx="1"/>
          <rect x="12" y="2"  width="4" height="16" rx="1"/>
        </svg>
        <span class="sr-only">Align vertical centers</span>
      </button>

      <button class="btn" title="Align bottom edges" onclick={doAlignBottom}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <line x1="2" y1="16" x2="18" y2="16"/>
          <rect x="4"  y="4"  width="4" height="12" rx="1"/>
          <rect x="12" y="7"  width="4" height="9"  rx="1"/>
        </svg>
        <span class="sr-only">Align bottom</span>
      </button>
    </div>

    <!-- ── Distribute group (3+ elements only) ──────────────────────────── -->
    {#if canDistribute}
      <div class="sep-v" aria-hidden="true"></div>
      <div class="group" aria-label="Distribute">
        <button class="btn" title="Distribute horizontally (equal gaps)" onclick={doDistributeH}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="1"  y="5" width="3" height="10" rx="1"/>
            <rect x="8"  y="5" width="3" height="10" rx="1"/>
            <rect x="15" y="5" width="3" height="10" rx="1"/>
            <!-- gap indicators -->
            <line x1="4"  y1="10" x2="8"  y2="10" stroke="currentColor" stroke-width="1" fill="none"/>
            <line x1="11" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="1" fill="none"/>
          </svg>
          <span class="sr-only">Distribute horizontally</span>
        </button>

        <button class="btn" title="Distribute vertically (equal gaps)" onclick={doDistributeV}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="5" y="1"  width="10" height="3" rx="1"/>
            <rect x="5" y="8"  width="10" height="3" rx="1"/>
            <rect x="5" y="15" width="10" height="3" rx="1"/>
          </svg>
          <span class="sr-only">Distribute vertically</span>
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .free-align-bar {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    background: rgba(30, 30, 35, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    /* Allow pointer events — buttons must be clickable. */
    pointer-events: auto;
    user-select: none;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  /* Vertical divider between align and distribute groups */
  .sep-v {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.12);
    margin: 0 4px;
  }

  /* Thin spacer within a group (between left/center/right vs top/center/bottom) */
  .sep {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.08);
    margin: 0 2px;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .btn:active {
    background: rgba(59, 130, 246, 0.25);
    color: #fff;
  }

  .btn svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
