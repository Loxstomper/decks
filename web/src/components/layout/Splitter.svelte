<script lang="ts">
  /**
   * Splitter.svelte — Lightweight drag handle for resizable panes (P9-5).
   *
   * Usage (Svelte 5 callback props — no createEventDispatcher):
   *   <Splitter direction="col" onresize={(delta) => (leftWidth += delta)} />
   *   <Splitter direction="row" onresize={(delta) => (topHeight += delta)} />
   *
   * The host pane receives the *delta* in px (this pointer position minus the
   * last) so the parent updates its own sizing state. Keeping it delta-based
   * (rather than absolute) means the splitter never needs to know pane sizes.
   *
   * `onresizeend` (optional) fires once on pointer-up so the parent can persist
   * the final size without writing to storage on every pointer move.
   */

  interface Props {
    direction?: 'col' | 'row';
    /** Called with the px delta since the last move while dragging. */
    onresize?: (delta: number) => void;
    /** Called once when a drag gesture completes (pointer up). */
    onresizeend?: () => void;
  }

  let { direction = 'col', onresize, onresizeend }: Props = $props();

  let dragging = $state(false);
  let lastPos  = $state(0);

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    lastPos  = direction === 'col' ? e.clientX : e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const current = direction === 'col' ? e.clientX : e.clientY;
    const delta   = current - lastPos;
    lastPos = current;
    onresize?.(delta);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    onresizeend?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="splitter"
  class:splitter-row={direction === 'row'}
  class:dragging
  role="separator"
  aria-orientation={direction === 'col' ? 'vertical' : 'horizontal'}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
></div>
