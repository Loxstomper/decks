<script lang="ts">
  /**
   * MarqueeOverlay.svelte — The rubber-band selection rectangle (P4-5).
   *
   * WHY THIS EXISTS (spec 04 "Marquee (drag-select) for multi-select"):
   * ===================================================================
   * Purely presentational: given a screen-space rect (the controller computed it
   * from the LOGICAL marquee × the coords.ts transform), draw the dashed band. It
   * knows nothing about the iframe, hit-testing, or coordinates — that separation
   * keeps the geometry pure/unit-tested (marquee.ts) and this component trivial.
   *
   * `pointer-events: none`: the band is a visual annotation; all pointer handling
   * happens in MarqueeController on the iframe document/window.
   */

  import type { Rect } from '$lib/canvas/overlay-geometry.ts';

  interface Props {
    /** Band position/size in overlay-local screen pixels, or null when inactive. */
    rect: Rect | null;
  }

  let { rect }: Props = $props();
</script>

{#if rect}
  <div
    class="marquee-band"
    style:left="{rect.left}px"
    style:top="{rect.top}px"
    style:width="{rect.width}px"
    style:height="{rect.height}px"
    aria-hidden="true"
  ></div>
{/if}

<style>
  .marquee-band {
    position: absolute;
    box-sizing: border-box;
    /* Dashed accent border + faint fill — the standard rubber-band look. */
    border: 1px dashed #3b82f6;
    background-color: rgba(59, 130, 246, 0.1);
    pointer-events: none;
    /* Re-rendered every pointermove frame — promote to its own layer. */
    will-change: left, top, width, height;
    z-index: 6;
  }
</style>
