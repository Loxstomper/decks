<script lang="ts">
  /**
   * AutoAnimatePanel.svelte — Auto-animate authoring control (P6-9 / spec 07).
   *
   * WHY THIS EXISTS:
   * Reveal's auto-animate is the "signature feature" of this editor: it tweens
   * elements between two consecutive slides automatically, driven by matching
   * `data-id` values.  Our stable `data-eid` architecture makes setup nearly
   * free — we just need a one-click affordance to:
   *   1. Set `data-auto-animate` on the current slide and its predecessor.
   *   2. Stamp `data-id` = `data-eid` on matched elements across the pair.
   *
   * WORKFLOW:
   *   • User selects a slide.
   *   • Clicks "Animate from previous slide" in this panel.
   *   • Both slides get `data-auto-animate`; elements get matching `data-id` values.
   *   • User then edits positions/sizes on either slide.
   *   • At presentation time, reveal tweens the deltas automatically.
   *
   * The panel also shows the current auto-animate state and lets the user disable
   * it (removing `data-auto-animate` while preserving `data-id` for quick re-enable).
   *
   * CALLBACK PATTERN:
   * Callbacks are typed props (no direct store import) for testability.
   *
   * PROPS:
   *   slideEid            — data-eid of the current slide section.
   *   onEnableAutoAnimate — (eid) => void
   *   onDisableAutoAnimate — (eid) => void
   */

  import { deckStore } from '$lib/store/deck.svelte';
  import { findByEid } from '$lib/model';
  import { hasAutoAnimate } from '$lib/motion';

  // ── Props ─────────────────────────────────────────────────────────────────

  interface Props {
    /** data-eid of the current slide section (null = no slide selected). */
    slideEid: string | null;
    /**
     * Enable auto-animate for this slide (sets data-auto-animate on both this
     * slide and its predecessor, and derives data-id pairings).
     */
    onEnableAutoAnimate: (eid: string) => void;
    /**
     * Disable auto-animate for this slide (removes data-auto-animate; data-id
     * values are preserved for quick re-enable).
     */
    onDisableAutoAnimate: (eid: string) => void;
  }

  let { slideEid, onEnableAutoAnimate, onDisableAutoAnimate }: Props = $props();

  // ── Derived state ─────────────────────────────────────────────────────────

  /** True when the current slide has data-auto-animate set. */
  const isEnabled = $derived((() => {
    if (!slideEid || !deckStore.model) return false;
    const el = findByEid(deckStore.model, slideEid);
    return el ? hasAutoAnimate(el) : false;
  })());

  /** True when the current slide is the first in its parent (no predecessor). */
  const isFirstSlide = $derived((() => {
    if (!slideEid || !deckStore.model) return true;
    // Find the slide and its parent, check if it has a previous sibling section.
    // We do a minimal walk to detect this without importing findPreviousSlide.
    const model = deckStore.model;
    // Build parent map.
    type N = import('$lib/model/types').SlideNode;
    const parentMap = new Map<import('$lib/model/types').ElementNode, import('$lib/model/types').ElementNode | null>();
    const walkForParent = (nodes: N[], parent: import('$lib/model/types').ElementNode | null) => {
      for (const n of nodes) {
        if (n.type === 'element') {
          parentMap.set(n, parent);
          walkForParent(n.children, n);
        }
      }
    };
    walkForParent(model.nodes, null);

    const target = findByEid(model, slideEid);
    if (!target) return true;
    const parent = parentMap.get(target);
    if (!parent) return true;

    // Check if target has a previous sibling section.
    let prevSection: import('$lib/model/types').ElementNode | null = null;
    for (const child of parent.children) {
      if (child.type !== 'element') continue;
      if (child === target) break;
      if (child.tagName.toLowerCase() === 'section') prevSection = child;
    }
    return prevSection === null;
  })());
</script>

<section class="auto-animate-panel" aria-label="Auto-animate">

  {#if !slideEid}
    <p class="hint">Select a slide to configure auto-animate.</p>

  {:else if isFirstSlide}
    <div class="state-row">
      <span class="state-icon">—</span>
      <div class="state-text">
        <strong>No previous slide</strong>
        <p>Auto-animate requires a previous slide to animate from. Add a slide before this one, or select a different slide.</p>
      </div>
    </div>

  {:else if isEnabled}
    <div class="state-row enabled">
      <span class="state-icon" aria-label="Active">✓</span>
      <div class="state-text">
        <strong>Animate from previous slide</strong>
        <p>Both this slide and its predecessor have <code>data-auto-animate</code>. Matched elements have been assigned <code>data-id</code> values for tweening.</p>
      </div>
    </div>
    <div class="actions">
      <button
        class="action-btn danger"
        onclick={() => onDisableAutoAnimate(slideEid!)}
        title="Remove data-auto-animate from this slide (data-id values are preserved)"
      >
        Disable auto-animate
      </button>
    </div>
    <div class="tip">
      <strong>Tip:</strong> Edit element positions or sizes on either slide. Reveal will tween the delta at presentation time.
    </div>

  {:else}
    <div class="state-row">
      <span class="state-icon dim" aria-label="Inactive">○</span>
      <div class="state-text">
        <strong>Auto-animate off</strong>
        <p>Enable to make reveal smoothly tween matching elements when transitioning from the previous slide.</p>
      </div>
    </div>
    <div class="actions">
      <button
        class="action-btn primary"
        onclick={() => onEnableAutoAnimate(slideEid!)}
        title="Set data-auto-animate on both this slide and its predecessor, then derive data-id from data-eid for matched elements"
      >
        Animate from previous slide
      </button>
    </div>
  {/if}

</section>

<style>
  .auto-animate-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text, #e0e0e0);
  }

  /* ── State row: icon + description ─────────────────────────────────── */
  .state-row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 0.5rem;
    border-radius: 6px;
    background: var(--color-surface, #2a2a2a);
    border: 1px solid var(--color-border, #333);
  }
  .state-row.enabled {
    border-color: var(--color-accent, #6366f1);
    background: color-mix(in srgb, var(--color-accent, #6366f1) 10%, transparent);
  }

  .state-icon {
    font-size: 1.1rem;
    line-height: 1;
    min-width: 1.25rem;
    text-align: center;
    padding-top: 0.1rem;
    color: var(--color-accent, #6366f1);
  }
  .state-icon.dim {
    color: var(--color-text-dim, #666);
  }

  .state-text {
    flex: 1;
  }
  .state-text strong {
    display: block;
    margin-bottom: 0.25rem;
    font-size: 0.8125rem;
  }
  .state-text p {
    margin: 0;
    color: var(--color-text-dim, #aaa);
    line-height: 1.4;
  }
  .state-text code {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    background: var(--color-input, #1a1a1a);
    padding: 0.1rem 0.25rem;
    border-radius: 3px;
  }

  /* ── Action buttons ─────────────────────────────────────────────────── */
  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .action-btn {
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8125rem;
    border: 1px solid transparent;
    transition: background 0.15s;
  }

  .action-btn.primary {
    background: var(--color-accent, #6366f1);
    color: #fff;
    border-color: var(--color-accent, #6366f1);
  }
  .action-btn.primary:hover {
    background: color-mix(in srgb, var(--color-accent, #6366f1) 80%, white);
  }

  .action-btn.danger {
    background: var(--color-surface, #2a2a2a);
    color: var(--color-danger, #f87171);
    border-color: var(--color-danger, #f87171);
  }
  .action-btn.danger:hover {
    background: color-mix(in srgb, var(--color-danger, #f87171) 15%, transparent);
  }

  /* ── Tip ────────────────────────────────────────────────────────────── */
  .tip {
    font-size: 0.75rem;
    color: var(--color-text-dim, #888);
    padding: 0.4rem 0.5rem;
    border-left: 2px solid var(--color-accent, #6366f1);
    line-height: 1.4;
  }

  .hint {
    margin: 0;
    color: var(--color-text-dim, #888);
    font-style: italic;
  }
</style>
