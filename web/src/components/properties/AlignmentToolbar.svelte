<script lang="ts">
  /**
   * AlignmentToolbar.svelte — Alignment-as-intent button strip (P3-5 / spec layout-vocabulary).
   *
   * WHY THIS EXISTS:
   * ================
   * Spec layout-vocabulary §"Alignment-as-intent" states that alignment controls set CONTAINER
   * PROPERTIES (data-align / data-justify), NOT pixel coordinates.  This keeps
   * layout intent in the model so it survives resolution changes (spec scaling-and-resolution).
   *
   * This component is PURELY PRESENTATIONAL — it receives the current container
   * props and fires typed callbacks when the user clicks a button.  All model
   * writes go through the parent's `onPropChange` which routes to `setLayoutProps`
   * + `deckStore.applyLayoutChange(eid, delta)` (one undo entry, autosaved).
   *
   * It shows:
   *   • Cross-axis align  (data-align):   start | center | end | stretch
   *   • Main-axis justify (data-justify): start | center | end | between | around
   *
   * For grid containers both controls are available; for `layers` containers
   * align/justify don't apply (flex-free CSS) so the toolbar is hidden.
   *
   * Svelte 5 runes: no createEventDispatcher — callbacks are prop functions
   * (spec: "Use Svelte 5 callback props").
   */

  import type { LayValue, AlignValue, JustifyValue, LayoutProps } from '$lib/model/layout';

  interface Props {
    /** The `data-lay` type of the active container. `null` for sections. */
    lay: LayValue | null;
    /** Current `data-align` value (null = not set / browser default = stretch). */
    align: AlignValue | null;
    /** Current `data-justify` value (null = not set / browser default = start). */
    justify: JustifyValue | null;
    /** Called when user clicks an align button. */
    onAlignChange: (value: AlignValue | null) => void;
    /** Called when user clicks a justify button. */
    onJustifyChange: (value: JustifyValue | null) => void;
  }

  let { lay, align, justify, onAlignChange, onJustifyChange }: Props = $props();

  /**
   * Layers containers use absolute z-stacking — flex align/justify have no
   * effect on them.  Hide the toolbar entirely rather than show useless controls.
   */
  const showAlignJustify = $derived(lay !== 'layers');

  /**
   * Label that tells the user which axis they're aligning (depends on lay type).
   *   stack (column): cross-axis = horizontal, main-axis = vertical
   *   row   (row):    cross-axis = vertical,   main-axis = horizontal
   *   grid: both cross and main apply (align-items / justify-content)
   *   null (section): show generic labels
   */
  const alignLabel = $derived(
    lay === 'stack' ? 'Align (H)' :
    lay === 'row'   ? 'Align (V)' :
    'Align'
  );

  const justifyLabel = $derived(
    lay === 'stack' ? 'Justify (V)' :
    lay === 'row'   ? 'Justify (H)' :
    'Justify'
  );

  /**
   * Toggle helper: clicking the already-active button deselects (sets null),
   * matching the expected "toggle off to reset to default" affordance.
   */
  function handleAlign(value: AlignValue): void {
    onAlignChange(align === value ? null : value);
  }

  function handleJustify(value: JustifyValue): void {
    onJustifyChange(justify === value ? null : value);
  }
</script>

{#if showAlignJustify}
  <div class="alignment-toolbar flex flex-col gap-2">

    <!-- ── Cross-axis align ─────────────────────────────────────────────── -->
    <div class="control-group">
      <span class="label">{alignLabel}</span>
      <div class="btn-row">
        {#each (['start', 'center', 'end', 'stretch'] as AlignValue[]) as value}
          <button
            class="icon-btn"
            class:active={align === value}
            title="data-align={value}"
            onclick={() => handleAlign(value)}
            aria-pressed={align === value}
          >
            {#if value === 'start'}
              <!-- align-items: flex-start — items hug the start edge -->
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <line x1="3" y1="4"  x2="3"  y2="16"/>
                <rect x="4" y="6"  width="5" height="8" rx="1"/>
                <rect x="10" y="7" width="7" height="6" rx="1"/>
              </svg>
            {:else if value === 'center'}
              <!-- align-items: center — items centered on cross axis -->
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <line x1="10" y1="2" x2="10" y2="18"/>
                <rect x="3" y="7"  width="5" height="6" rx="1"/>
                <rect x="9" y="6"  width="7" height="8" rx="1"/>
              </svg>
            {:else if value === 'end'}
              <!-- align-items: flex-end — items hug the end edge -->
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <line x1="17" y1="4" x2="17" y2="16"/>
                <rect x="3" y="7"  width="5" height="6" rx="1"/>
                <rect x="9" y="6"  width="7" height="8" rx="1"/>
              </svg>
            {:else}
              <!-- align-items: stretch — items fill the cross axis -->
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <line x1="3" y1="4"  x2="3"  y2="16"/>
                <line x1="17" y1="4" x2="17" y2="16"/>
                <rect x="4" y="5" width="12" height="10" rx="1"/>
              </svg>
            {/if}
            <span class="sr-only">{value}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- ── Main-axis justify ─────────────────────────────────────────────── -->
    <div class="control-group">
      <span class="label">{justifyLabel}</span>
      <div class="btn-row">
        {#each (['start', 'center', 'end', 'between', 'around'] as JustifyValue[]) as value}
          <button
            class="icon-btn"
            class:active={justify === value}
            title="data-justify={value}"
            onclick={() => handleJustify(value)}
            aria-pressed={justify === value}
          >
            {#if value === 'start'}
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="3" y="5" width="3" height="10" rx="1"/>
                <rect x="8" y="5" width="3" height="10" rx="1"/>
                <rect x="13" y="5" width="3" height="10" rx="1" opacity="0.25"/>
              </svg>
            {:else if value === 'center'}
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="3" y="5" width="3" height="10" rx="1" opacity="0.25"/>
                <rect x="8" y="5" width="3" height="10" rx="1"/>
                <rect x="13" y="5" width="3" height="10" rx="1" opacity="0.25"/>
              </svg>
            {:else if value === 'end'}
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="3" y="5" width="3" height="10" rx="1" opacity="0.25"/>
                <rect x="8" y="5" width="3" height="10" rx="1"/>
                <rect x="13" y="5" width="3" height="10" rx="1"/>
              </svg>
            {:else if value === 'between'}
              <!-- space-between: first/last flush, even gap between -->
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="2"  y="5" width="3" height="10" rx="1"/>
                <rect x="8"  y="5" width="3" height="10" rx="1"/>
                <rect x="14" y="5" width="3" height="10" rx="1"/>
              </svg>
            {:else}
              <!-- space-around: equal space around each item -->
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="1"  y="5" width="3" height="10" rx="1" opacity="0.4"/>
                <rect x="7"  y="5" width="3" height="10" rx="1"/>
                <rect x="13" y="5" width="3" height="10" rx="1" opacity="0.4"/>
              </svg>
            {/if}
            <span class="sr-only">{value}</span>
          </button>
        {/each}
      </div>
    </div>

  </div>
{/if}

<style>
  .alignment-toolbar {
    /* Sits inside the PropertiesPanel section separator. */
    display: contents;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    user-select: none;
  }

  .btn-row {
    display: flex;
    flex-direction: row;
    gap: 3px;
  }

  .icon-btn {
    /* 28×28 icon buttons — compact enough for the narrow right panel. */
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    padding: 0;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.9);
  }

  .icon-btn.active {
    background: rgba(var(--color-accent, 59 130 246) / 0.25);
    border-color: rgba(var(--color-accent, 59 130 246) / 0.5);
    color: rgba(255, 255, 255, 0.95);
  }

  .icon-btn svg {
    width: 16px;
    height: 16px;
  }

  /* Visually hidden but accessible to screen readers. */
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
