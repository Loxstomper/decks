<script lang="ts">
  /**
   * TransitionPanel.svelte — Slide transition control panel (P6-8 / spec 07).
   *
   * WHY TWO LEVELS:
   * Reveal supports two scopes of transition control:
   *   • Deck default  — stored on the `<div class="reveal">` element and applied
   *                     globally via Reveal.configure() at runtime (see transitions.ts).
   *   • Per-slide     — stored as `data-transition` / `data-transition-speed` directly
   *                     on the `<section>` element; overrides the deck default for
   *                     that one slide.
   *
   * The panel exposes both scopes in one compact UI: a "Deck default" section and,
   * when a slide is selected, a "This slide" section with an override toggle.
   *
   * CALLBACK PATTERN:
   * Callbacks are typed props so the panel is store-agnostic.  The integrator
   * wires them to deckStore.setSlideTransition / setDeckTransition.
   *
   * SVELTE 5 (runes): all state is derived from props + store; no local caching.
   *
   * PROPS:
   *   slideEid             — data-eid of the current slide, or null.
   *   onSetSlideTransition — (eid, type, speed?) => void
   *   onSetDeckTransition  — (type, speed?) => void
   */

  import { deckStore } from '$lib/store/deck.svelte';
  import { findByEid } from '$lib/model';
  import {
    getSlideTransition,
    getDeckTransition,
    TRANSITION_TYPES,
    TRANSITION_SPEEDS,
    type TransitionType,
    type TransitionSpeed,
  } from '$lib/motion';

  // ── Props ─────────────────────────────────────────────────────────────────

  interface Props {
    /** data-eid of the current slide section (null = no slide selected). */
    slideEid: string | null;
    /** Callback fired when the per-slide transition changes. */
    onSetSlideTransition: (eid: string, type: TransitionType | null, speed?: TransitionSpeed | null) => void;
    /** Callback fired when the deck-level default transition changes. */
    onSetDeckTransition: (type: TransitionType | null, speed?: TransitionSpeed | null) => void;
  }

  let { slideEid, onSetSlideTransition, onSetDeckTransition }: Props = $props();

  // ── Derived state ─────────────────────────────────────────────────────────

  /** Current slide's transition settings, or defaults when no slide selected. */
  const slideTransition = $derived((() => {
    if (!slideEid || !deckStore.model) return { transition: null, speed: null };
    const el = findByEid(deckStore.model, slideEid);
    if (!el) return { transition: null, speed: null };
    return getSlideTransition(el);
  })());

  /** Deck-level transition settings from the .reveal div. */
  const deckTransition = $derived(
    deckStore.model ? getDeckTransition(deckStore.model) : { transition: null, speed: null },
  );

  /**
   * True when the current slide has an explicit per-slide transition override
   * (i.e. data-transition is present on the section element).
   */
  const slideHasOverride = $derived(slideTransition.transition !== null);

  // ── Interaction handlers ──────────────────────────────────────────────────

  function handleDeckTypeChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    onSetDeckTransition((v || null) as TransitionType | null);
  }

  function handleDeckSpeedChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    onSetDeckTransition(deckTransition.transition, (v || null) as TransitionSpeed | null);
  }

  function handleSlideTypeChange(e: Event) {
    if (!slideEid) return;
    const v = (e.currentTarget as HTMLSelectElement).value;
    onSetSlideTransition(slideEid, (v || null) as TransitionType | null);
  }

  function handleSlideSpeedChange(e: Event) {
    if (!slideEid) return;
    const v = (e.currentTarget as HTMLSelectElement).value;
    onSetSlideTransition(slideEid, slideTransition.transition, (v || null) as TransitionSpeed | null);
  }

  /** Toggle the per-slide override: enable = set to deck default; disable = remove. */
  function toggleSlideOverride() {
    if (!slideEid) return;
    if (slideHasOverride) {
      // Remove the per-slide override so the slide uses the deck default.
      onSetSlideTransition(slideEid, null, null);
    } else {
      // Enable override with the same transition as the deck default (or 'slide').
      const base = deckTransition.transition ?? 'slide';
      onSetSlideTransition(slideEid, base);
    }
  }

  /** Human-readable label for the "none" option in the selector. */
  const TYPE_LABELS: Record<TransitionType, string> = {
    none: 'None (instant)',
    fade: 'Fade',
    slide: 'Slide',
    convex: 'Convex',
    concave: 'Concave',
    zoom: 'Zoom',
  };

  const SPEED_LABELS: Record<TransitionSpeed, string> = {
    default: 'Default',
    fast: 'Fast',
    slow: 'Slow',
  };
</script>

<section class="transition-panel" aria-label="Slide transitions">

  <!-- ── Deck-level default ─────────────────────────────────────────────── -->
  <fieldset class="group">
    <legend>Deck default</legend>
    <div class="row">
      <label for="deck-type">Transition</label>
      <select
        id="deck-type"
        value={deckTransition.transition ?? ''}
        onchange={handleDeckTypeChange}
      >
        <option value="">(Reveal default)</option>
        {#each TRANSITION_TYPES as type}
          <option value={type}>{TYPE_LABELS[type]}</option>
        {/each}
      </select>
    </div>
    <div class="row">
      <label for="deck-speed">Speed</label>
      <select
        id="deck-speed"
        value={deckTransition.speed ?? ''}
        onchange={handleDeckSpeedChange}
      >
        <option value="">(Reveal default)</option>
        {#each TRANSITION_SPEEDS as speed}
          <option value={speed}>{SPEED_LABELS[speed]}</option>
        {/each}
      </select>
    </div>
  </fieldset>

  <!-- ── Per-slide override ────────────────────────────────────────────── -->
  {#if slideEid}
    <fieldset class="group">
      <legend>This slide</legend>
      <div class="override-toggle-row">
        <label class="switch-label" for="slide-override">
          Override for this slide
        </label>
        <button
          id="slide-override"
          class="toggle-btn"
          class:active={slideHasOverride}
          onclick={toggleSlideOverride}
          aria-pressed={slideHasOverride}
          title={slideHasOverride ? 'Remove per-slide override' : 'Add per-slide transition override'}
        >
          {slideHasOverride ? 'On' : 'Off'}
        </button>
      </div>

      {#if slideHasOverride}
        <div class="row">
          <label for="slide-type">Transition</label>
          <select
            id="slide-type"
            value={slideTransition.transition ?? ''}
            onchange={handleSlideTypeChange}
          >
            {#each TRANSITION_TYPES as type}
              <option value={type}>{TYPE_LABELS[type]}</option>
            {/each}
          </select>
        </div>
        <div class="row">
          <label for="slide-speed">Speed</label>
          <select
            id="slide-speed"
            value={slideTransition.speed ?? ''}
            onchange={handleSlideSpeedChange}
          >
            <option value="">(deck default)</option>
            {#each TRANSITION_SPEEDS as speed}
              <option value={speed}>{SPEED_LABELS[speed]}</option>
            {/each}
          </select>
        </div>
      {:else}
        <p class="inherit-hint">Using deck default ({deckTransition.transition ?? 'Reveal default'}).</p>
      {/if}
    </fieldset>
  {:else}
    <p class="hint">Select a slide to set a per-slide transition override.</p>
  {/if}

</section>

<style>
  .transition-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text, #e0e0e0);
  }

  /* ── Fieldset group ────────────────────────────────────────────────── */
  .group {
    border: 1px solid var(--color-border, #333);
    border-radius: 6px;
    padding: 0.5rem 0.75rem 0.75rem;
    margin: 0;
  }

  .group legend {
    padding: 0 0.3rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Row: label + select ───────────────────────────────────────────── */
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  .row label {
    flex: 0 0 5rem;
    font-size: 0.8125rem;
    color: var(--color-text-dim, #aaa);
  }

  .row select {
    flex: 1;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--color-border, #444);
    border-radius: 4px;
    background: var(--color-input, #1a1a1a);
    color: var(--color-text, #e0e0e0);
    font-size: 0.8125rem;
  }
  .row select:focus {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 1px;
  }

  /* ── Override toggle ───────────────────────────────────────────────── */
  .override-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.4rem;
  }

  .switch-label {
    font-size: 0.8125rem;
    color: var(--color-text-dim, #aaa);
  }

  .toggle-btn {
    padding: 0.2rem 0.7rem;
    border: 1px solid var(--color-border, #444);
    border-radius: 12px;
    background: var(--color-surface, #2a2a2a);
    color: var(--color-text-dim, #888);
    cursor: pointer;
    font-size: 0.75rem;
    transition: background 0.15s, color 0.15s;
    min-width: 3rem;
  }
  .toggle-btn:hover {
    background: var(--color-surface-hover, #383838);
  }
  .toggle-btn.active {
    background: var(--color-accent, #6366f1);
    border-color: var(--color-accent, #6366f1);
    color: #fff;
  }

  /* ── Hint text ─────────────────────────────────────────────────────── */
  .hint,
  .inherit-hint {
    margin: 0.4rem 0 0;
    color: var(--color-text-dim, #888);
    font-style: italic;
  }
</style>
