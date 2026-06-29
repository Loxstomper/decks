<script lang="ts">
  /**
   * Splitter.svelte — Lightweight drag handle for resizable panes.
   *
   * Usage:
   *   <Splitter direction="col" on:resize={(e) => (leftWidth = e.detail)} />
   *   <Splitter direction="row" on:resize={(e) => (topHeight = e.detail)} />
   *
   * The host pane passes a resize event with the *delta* in px so the parent
   * can update its own sizing state.  Keeping delta-based (rather than
   * absolute) means the splitter does not need to know the pane dimensions.
   */

  import { createEventDispatcher } from 'svelte';

  interface Props {
    direction?: 'col' | 'row';
  }

  let { direction = 'col' }: Props = $props();

  const dispatch = createEventDispatcher<{ resize: number }>();

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
    dispatch('resize', delta);
  }

  function onPointerUp(e: PointerEvent) {
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
