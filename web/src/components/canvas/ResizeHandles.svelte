<script lang="ts">
  /**
   * ResizeHandles.svelte — The eight resize handles around a free element (P4-3).
   *
   * WHY THIS EXISTS (spec canvas-interaction "Resize handles: 8 handles"):
   * ======================================================
   * Purely presentational: given a screen-space rect (already projected from the
   * element's LOGICAL rect × the coords.ts transform by the controller), it draws
   * the eight grab dots and a move-frame, and reports which handle a pointer-down
   * landed on. It knows nothing about the iframe, the model, snapping, or the
   * transform — all of that lives in FreeTransformOverlay + the pure geometry
   * module, keeping this component trivial and the math unit-testable.
   *
   * Handles are the ONLY pointer-interactive part of the canvas overlay: each has
   * `pointer-events: auto` so it can be grabbed, while the surrounding overlay
   * stays `pointer-events: none` so clicks pass through to the iframe content.
   */

  import { HANDLES, type Handle } from '$lib/canvas/resize-geometry.ts';
  import type { Rect } from '$lib/canvas/overlay-geometry.ts';

  interface Props {
    /** The element's bounding box in overlay-local SCREEN pixels, or null. */
    rect: Rect | null;
    /** Fired on pointer-down on a handle (resize) — null target = the move frame. */
    onhandledown: (handle: Handle | null, event: PointerEvent) => void;
  }

  let { rect, onhandledown }: Props = $props();

  /** CSS cursor per handle so the affordance reads correctly at the edge. */
  const CURSORS: Record<Handle, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
  };

  /**
   * Screen-space center of a handle within the rect. Mirrors
   * resize-geometry.handlePoint but operates on the already-projected SCREEN rect
   * so the dots land exactly on the selection box at any zoom.
   */
  function handleCenter(r: Rect, handle: Handle): { x: number; y: number } {
    const left = handle === 'nw' || handle === 'w' || handle === 'sw';
    const right = handle === 'ne' || handle === 'e' || handle === 'se';
    const top = handle === 'nw' || handle === 'n' || handle === 'ne';
    const bottom = handle === 'sw' || handle === 's' || handle === 'se';
    const x = left ? r.left : right ? r.left + r.width : r.left + r.width / 2;
    const y = top ? r.top : bottom ? r.top + r.height : r.top + r.height / 2;
    return { x, y };
  }
</script>

{#if rect}
  <!--
    Move frame: covers the element so a drag anywhere on it repositions (P4-2).
    Sits BELOW the handle dots (z-order) so corners/edges win the hit-test.
  -->
  <div
    class="move-frame"
    style:left="{rect.left}px"
    style:top="{rect.top}px"
    style:width="{rect.width}px"
    style:height="{rect.height}px"
    onpointerdown={(e) => onhandledown(null, e)}
    role="presentation"
  ></div>

  {#each HANDLES as handle (handle)}
    {@const c = handleCenter(rect, handle)}
    <div
      class="resize-handle"
      style:left="{c.x}px"
      style:top="{c.y}px"
      style:cursor={CURSORS[handle]}
      onpointerdown={(e) => onhandledown(handle, e)}
      role="presentation"
      data-handle={handle}
    ></div>
  {/each}
{/if}

<style>
  /*
   * The move frame is invisible (the SelectionOverlay already draws the box) but
   * grabbable. pointer-events:auto so it captures drags; the rest of the canvas
   * overlay is pointer-events:none and lets clicks reach the iframe.
   */
  .move-frame {
    position: absolute;
    pointer-events: auto;
    cursor: move;
    /* Above the iframe + selection box, below the handle dots. */
    z-index: 6;
  }

  .resize-handle {
    position: absolute;
    /* Center the 10px dot on its logical corner/edge point. */
    width: 10px;
    height: 10px;
    margin-left: -5px;
    margin-top: -5px;
    box-sizing: border-box;
    background-color: #ffffff;
    border: 1.5px solid #3b82f6; /* matches selection accent */
    border-radius: 2px;
    pointer-events: auto;
    /* Above the move frame so a grab near a corner resizes, not moves. */
    z-index: 7;
    /* Re-rendered every zoom/drag frame. */
    will-change: left, top;
  }
</style>
