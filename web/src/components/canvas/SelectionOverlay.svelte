<script lang="ts">
  /**
   * SelectionOverlay.svelte — The selection bounding box (P2-4).
   *
   * WHY THIS EXISTS (spec canvas-interaction "An overlay layer in the parent document sits over
   * the iframe, drawing selection boxes"):
   * ====================================================================
   * Purely presentational: given a screen-space rect (already computed by the
   * controller from the element's logical rect × the coords.ts transform), it
   * draws a tracking box. It knows nothing about the iframe, the model, or
   * coordinates — that separation keeps the geometry math unit-testable
   * (overlay-geometry.ts) and this component trivial.
   *
   * `pointer-events: none` everywhere: the box is a visual annotation only. All
   * hit-testing happens on the iframe document (the controller attaches there),
   * so the box must never swallow clicks meant for the slide content.
   */

  import type { Rect } from '$lib/canvas/overlay-geometry.ts';

  interface Props {
    /** Box position/size in overlay-local screen pixels, or null when hidden. */
    rect: Rect | null;
    /** Dim the box while the node is being text-edited (P2-5). */
    editing?: boolean;
  }

  let { rect, editing = false }: Props = $props();
</script>

{#if rect}
  <!--
    One absolutely-positioned box. Sub-pixel left/top kept as-is (no rounding)
    so the box stays glued to the element across fractional zoom levels.
  -->
  <div
    class="selection-box"
    class:editing
    style:left="{rect.left}px"
    style:top="{rect.top}px"
    style:width="{rect.width}px"
    style:height="{rect.height}px"
    aria-hidden="true"
  ></div>
{/if}

<style>
  .selection-box {
    position: absolute;
    /*
     * box-sizing: border-box so the 2px outline sits ON the element's edge
     * rather than expanding the visual box beyond the measured rect.
     */
    box-sizing: border-box;
    border: 2px solid #3b82f6; /* blue-500 — matches editor accent */
    border-radius: 1px;
    /* Faint fill makes small leaves visible without obscuring content. */
    background-color: rgba(59, 130, 246, 0.08);
    pointer-events: none;
    /* Promote to its own layer: the box re-renders every zoom/resize frame. */
    will-change: left, top, width, height;
    z-index: 5;
  }

  /* While editing, recede to a dashed hairline so the caret/text is unobscured. */
  .selection-box.editing {
    border-style: dashed;
    border-color: rgba(59, 130, 246, 0.6);
    background-color: transparent;
  }
</style>
