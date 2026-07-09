<script lang="ts">
  /**
   * GuidesOverlay.svelte — Renders smart alignment guide lines (P4-4).
   *
   * WHY THIS EXISTS (spec canvas-interaction "Smart guides"):
   * ==========================================
   * Purely presentational. The `DragController` computes which guides are active
   * (see `computeGuides` in alignment-guides.ts) and passes them here as props.
   * This component converts each guide's LOGICAL position to SCREEN pixels via
   * the coords.ts transform and draws a full-span colored line.
   *
   * Guide anatomy:
   *   axis='x' → vertical line (shows horizontal / left-right alignment)
   *   axis='y' → horizontal line (shows vertical / top-bottom alignment)
   *
   * Lines span the full logical canvas (left→right for 'y', top→bottom for 'x')
   * and are clipped to the overlay's bounds (overflow:hidden on the parent).
   *
   * `pointer-events: none` — the guide lines are purely visual.
   */

  import type { AlignGuide } from '$lib/canvas/alignment-guides.ts';
  import { logicalToScreen } from '$lib/coords.ts';
  import type { Transform } from '$lib/coords.ts';
  import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '$lib/coords.ts';

  interface Props {
    /** Active guide lines produced by computeGuides. Empty = hidden. */
    guides: AlignGuide[];
    /** The active logical→screen transform (same one applied to the iframe). */
    transform: Transform;
    /** Logical canvas width (default 1920). Used to determine line extent. */
    logicalWidth?: number;
    /** Logical canvas height (default 1080). */
    logicalHeight?: number;
  }

  let {
    guides,
    transform,
    logicalWidth = LOGICAL_WIDTH,
    logicalHeight = LOGICAL_HEIGHT,
  }: Props = $props();

  /**
   * Convert a guide to an absolutely-positioned line in screen space.
   *
   * axis='x' (vertical line): positioned at screen-x, spans full canvas height.
   * axis='y' (horizontal line): positioned at screen-y, spans full canvas width.
   *
   * WHY span the full canvas: the guide communicates "everything at this
   * logical coordinate is aligned" — a line that only connects two elements would
   * be ambiguous. Spanning the whole canvas matches standard design-tool UX.
   */
  function guideStyle(guide: AlignGuide): string {
    if (guide.axis === 'x') {
      // Vertical line at logical x = guide.position
      const screenX = logicalToScreen({ x: guide.position, y: 0 }, transform).x;
      const screenTop = logicalToScreen({ x: 0, y: 0 }, transform).y;
      const screenH = logicalHeight * transform.scale;
      return `left:${screenX}px; top:${screenTop}px; width:1px; height:${screenH}px;`;
    } else {
      // Horizontal line at logical y = guide.position
      const screenY = logicalToScreen({ x: 0, y: guide.position }, transform).y;
      const screenLeft = logicalToScreen({ x: 0, y: 0 }, transform).x;
      const screenW = logicalWidth * transform.scale;
      return `left:${screenLeft}px; top:${screenY}px; width:${screenW}px; height:1px;`;
    }
  }
</script>

{#if guides.length > 0}
  <div class="guides-overlay" aria-hidden="true">
    {#each guides as guide (`${guide.axis}:${guide.position}`)}
      <div class="guide-line" style={guideStyle(guide)}></div>
    {/each}
  </div>
{/if}

<style>
  .guides-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 6; /* above SelectionOverlay (z:5) so guides are clearly visible */
  }

  .guide-line {
    position: absolute;
    /* Cyan/teal is the standard "smart guide" colour in most design tools,
       distinct from the blue selection box (#3b82f6) and orange snap grid. */
    background-color: #00c8ff;
    opacity: 0.85;
    /* Sub-pixel hint so the 1px line stays crisp on HiDPI displays. */
    will-change: left, top;
  }
</style>
