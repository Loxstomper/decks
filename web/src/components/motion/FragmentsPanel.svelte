<script lang="ts">
  /**
   * FragmentsPanel.svelte — Per-slide fragment (step reveal) control panel (P6-7 / spec 07).
   *
   * WHY A SEPARATE PANEL:
   * Fragment authoring has two distinct UI modes:
   *   1. Toggle: click an element in the canvas → it becomes a step reveal.
   *   2. Order:  this panel lists every fragment in the current slide and lets
   *              the user reorder them by editing data-fragment-index values.
   *
   * CALLBACK PATTERN (Lane B):
   * The panel fires callbacks instead of importing the store directly, keeping
   * it testable and decoupled from store internals.  The integrator (App.svelte)
   * wires the callbacks to deckStore.toggleFragment / setFragmentIndex / setFragmentStyle.
   *
   * SVELTE 5 (runes):
   * State is fully derived from props — no local caching of model data so the
   * panel is always consistent with the source of truth.
   *
   * PROPS:
   *   slideEid           — data-eid of the currently visible slide section.
   *   selectedEid        — data-eid of the currently selected canvas element.
   *   onToggleFragment   — (eid, index?) => void
   *   onSetFragmentIndex — (eid, index)  => void
   *   onSetFragmentStyle — (eid, style)  => void
   */

  import { deckStore } from '$lib/store/deck.svelte';
  import { getAttribute, findByEid } from '$lib/model';
  import {
    getFragmentsInSlide,
    isFragment,
    FRAGMENT_STYLES,
    type FragmentInfo,
    type FragmentStyle,
  } from '$lib/motion';
  import type { ElementNode, SlideNode } from '$lib/model/types';

  // ── Props ─────────────────────────────────────────────────────────────────

  interface Props {
    /** data-eid of the current slide section (null = no slide selected). */
    slideEid: string | null;
    /** data-eid of the selected element in the canvas (null = nothing selected). */
    selectedEid?: string | null;
    /** Toggle fragment on/off for the element. `index` sets the step order. */
    onToggleFragment: (eid: string, index?: number) => void;
    /** Update only the step order for an existing fragment. */
    onSetFragmentIndex: (eid: string, index: number) => void;
    /** Set the fragment animation style class, or null to restore default. */
    onSetFragmentStyle: (eid: string, style: FragmentStyle | null) => void;
  }

  let {
    slideEid,
    selectedEid = null,
    onToggleFragment,
    onSetFragmentIndex,
    onSetFragmentStyle,
  }: Props = $props();

  // ── Derived state (no local model caching — always fresh from store) ──────

  /**
   * Find an element by eid synchronously from the current model.
   * Returns null when model is not loaded or eid is not found.
   */
  function findEl(eid: string | null): ElementNode | null {
    if (!eid || !deckStore.model) return null;
    return findByEid(deckStore.model, eid);
  }

  const currentSlide = $derived(findEl(slideEid));
  const fragments = $derived<FragmentInfo[]>(currentSlide ? getFragmentsInSlide(currentSlide) : []);
  const selectedEl = $derived(findEl(selectedEid ?? null));
  const selectedIsFragment = $derived(selectedEl ? isFragment(selectedEl) : false);

  /**
   * Build a human-readable label for a fragment element: "<tag> first-30-chars-of-text".
   * Entities are partially decoded for readability (& < >).
   */
  function elementLabel(el: ElementNode): string {
    const tag = el.tagName.toLowerCase();
    let text = '';
    const gatherText = (nodes: SlideNode[]) => {
      for (const n of nodes) {
        if (n.type === 'text') text += n.value;
        else if (n.type === 'element') gatherText(n.children);
        if (text.length > 60) return;
      }
    };
    gatherText(el.children);
    const display = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
      .slice(0, 30);
    return `<${tag}>${display ? ' ' + display + (text.trim().length > 30 ? '…' : '') : ''}`;
  }

  /** Parse a step-index input value; ignore non-numeric / negative. */
  function handleIndexChange(eid: string, raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0) onSetFragmentIndex(eid, n);
  }
</script>

<section class="fragments-panel" aria-label="Fragments — step reveal">

  <!-- ── Toggle affordance for the currently selected element ─────────────── -->
  {#if selectedEid && selectedEl}
    <div class="toggle-row">
      <button
        class="toggle-btn"
        class:active={selectedIsFragment}
        onclick={() => onToggleFragment(selectedEid!)}
        title={selectedIsFragment
          ? 'Remove fragment — element will always be visible'
          : 'Make element a step reveal — it hides until clicked through'}
      >
        {selectedIsFragment ? '✕ Remove step reveal' : '+ Add step reveal'}
      </button>
    </div>
  {:else}
    <p class="hint">Select an element on the canvas to toggle its step reveal.</p>
  {/if}

  <!-- ── Fragment order list for the current slide ──────────────────────────── -->
  {#if fragments.length > 0}
    <div class="list" role="list" aria-label="Step reveal order">
      <div class="list-header" aria-hidden="true">
        <span>Index</span>
        <span>Element</span>
        <span>Style</span>
      </div>
      {#each fragments as frag (frag.eid ?? frag.el)}
        {@const isSelected = frag.eid === selectedEid}
        <div class="list-row" class:selected={isSelected} role="listitem">
          <!-- data-fragment-index (editable; empty = auto-order) -->
          <input
            class="index-input"
            type="number"
            min="0"
            step="1"
            placeholder="auto"
            value={frag.index !== null ? String(frag.index) : ''}
            onchange={(e) => {
              if (frag.eid) handleIndexChange(frag.eid, (e.currentTarget as HTMLInputElement).value);
            }}
            aria-label={`Step index for ${elementLabel(frag.el)}`}
          />
          <!-- Human-readable element label -->
          <span class="element-label" title={frag.eid ?? '(no eid)'}>
            {elementLabel(frag.el)}
          </span>
          <!-- Animation style selector -->
          <select
            class="style-select"
            value={frag.style ?? ''}
            onchange={(e) => {
              if (frag.eid) {
                const v = (e.currentTarget as HTMLSelectElement).value;
                onSetFragmentStyle(frag.eid, (v || null) as FragmentStyle | null);
              }
            }}
            aria-label={`Fragment animation style for ${elementLabel(frag.el)}`}
          >
            <option value="">default (fade-in)</option>
            {#each FRAGMENT_STYLES as style}
              <option value={style}>{style}</option>
            {/each}
          </select>
        </div>
      {/each}
    </div>

  {:else if currentSlide}
    <p class="hint">No step reveals on this slide. Select an element and click "Add step reveal".</p>
  {:else}
    <p class="hint">Select a slide to manage its step reveals.</p>
  {/if}

</section>

<style>
  .fragments-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text, #e0e0e0);
  }

  /* ── Toggle button ─────────────────────────────────────────────────── */
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toggle-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border, #444);
    border-radius: 4px;
    background: var(--color-surface, #2a2a2a);
    color: var(--color-text, #e0e0e0);
    cursor: pointer;
    font-size: 0.8125rem;
    transition: background 0.15s;
  }
  .toggle-btn:hover {
    background: var(--color-surface-hover, #383838);
  }
  .toggle-btn.active {
    background: var(--color-accent, #6366f1);
    border-color: var(--color-accent, #6366f1);
    color: #fff;
  }

  /* ── Fragment list ─────────────────────────────────────────────────── */
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .list-header,
  .list-row {
    display: grid;
    /* index | label | style */
    grid-template-columns: 3.5rem 1fr 7.5rem;
    gap: 0.375rem;
    align-items: center;
  }

  .list-header {
    padding: 0 0.25rem 0.3rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .list-row {
    padding: 0.2rem 0.25rem;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .list-row:hover {
    background: var(--color-surface-hover, #2e2e2e);
  }
  .list-row.selected {
    background: var(--color-selected, #1e293b);
    outline: 1px solid var(--color-accent, #6366f1);
  }

  .index-input {
    width: 3.25rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--color-border, #444);
    border-radius: 3px;
    background: var(--color-input, #1a1a1a);
    color: var(--color-text, #e0e0e0);
    font-size: 0.8125rem;
    text-align: center;
  }
  .index-input:focus {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 1px;
  }

  .element-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--color-text, #e0e0e0);
  }

  .style-select {
    width: 100%;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--color-border, #444);
    border-radius: 3px;
    background: var(--color-input, #1a1a1a);
    color: var(--color-text, #e0e0e0);
    font-size: 0.75rem;
  }
  .style-select:focus {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 1px;
  }

  .hint {
    margin: 0;
    color: var(--color-text-dim, #888);
    font-style: italic;
  }
</style>
