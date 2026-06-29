<script lang="ts">
  /**
   * GridOverlay.svelte — Visual snap grid (P3-8 / spec 04 "Snap-to-grid").
   *
   * WHY THIS EXISTS:
   * ================
   * When the grid is enabled, the user wants to SEE the lines their drags/nudges
   * snap to. The grid is defined in LOGICAL units (default 8); we draw it in the
   * parent overlay using the SAME coords.ts transform RevealFrame applies to the
   * iframe, so the lines stay pixel-aligned with the slide at any zoom/pan.
   *
   * Rendering: a single positioned box covering the logical canvas (mapped to
   * screen via the transform) filled with a repeating-linear-gradient at the
   * scaled grid spacing — cheap, GPU-friendly, no per-line DOM nodes. Purely
   * decorative: pointer-events:none so it never intercepts drags.
   *
   * INTEGRATION: mount as a sibling of RevealFrame/CanvasInteraction inside the
   * same positioned wrapper; pass `transform` (bind:transform from RevealFrame),
   * `visible` (gridStore.enabled && gridStore.showOverlay) and `gridSize`
   * (gridStore.size). Logical dimensions default to 1920×1080.
   */

  import { logicalToScreen, LOGICAL_WIDTH, LOGICAL_HEIGHT, type Transform } from '$lib/coords.ts';

  interface Props {
    transform: Transform;
    gridSize?: number;
    visible?: boolean;
    logicalWidth?: number;
    logicalHeight?: number;
  }

  let {
    transform,
    gridSize = 8,
    visible = false,
    logicalWidth = LOGICAL_WIDTH,
    logicalHeight = LOGICAL_HEIGHT,
  }: Props = $props();

  // Top-left of the logical canvas in overlay-local screen pixels.
  const origin = $derived(logicalToScreen({ x: 0, y: 0 }, transform));
  // Grid spacing scaled into screen pixels (>= a sane floor so it stays visible).
  const stepPx = $derived(Math.max(2, gridSize * transform.scale));
  const widthPx = $derived(logicalWidth * transform.scale);
  const heightPx = $derived(logicalHeight * transform.scale);
</script>

{#if visible && transform.scale > 0}
  <div
    class="grid-overlay"
    aria-hidden="true"
    style:left="{origin.x}px"
    style:top="{origin.y}px"
    style:width="{widthPx}px"
    style:height="{heightPx}px"
    style:background-size="{stepPx}px {stepPx}px"
  ></div>
{/if}

<style>
  /*
   * Two crossed repeating gradients draw the vertical + horizontal lines. The
   * box is clipped to the logical canvas so the grid does not bleed over the
   * letterbox bars. Subtle colour so it guides without dominating the content.
   */
  .grid-overlay {
    position: absolute;
    pointer-events: none;
    z-index: 1;
    background-image:
      linear-gradient(to right, rgba(120, 160, 255, 0.18) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(120, 160, 255, 0.18) 1px, transparent 1px);
    background-position: 0 0;
  }
</style>
