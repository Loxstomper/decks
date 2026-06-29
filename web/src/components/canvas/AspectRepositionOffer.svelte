<script lang="ts">
  /**
   * AspectRepositionOffer.svelte — Reposition offer dialog for an aspect change
   * (P4-7, spec 05 "Free elements are flagged, with an offer to reposition/rescale").
   *
   * WHY THIS EXISTS:
   * ================
   * Changing the aspect ratio reflows structured content automatically, but FREE
   * elements are pinned to coordinates that assumed the OLD canvas. Spec 05 forbids
   * SILENTLY moving them — we must FLAG them and OFFER a reposition. This panel is
   * that affordance: it lists every affected free element, shows old → suggested
   * coordinates, lets the user accept/decline per element or all at once, choose the
   * rescale strategy, then confirm (persist) or cancel (revert the canvas size).
   *
   * It reads/writes aspectStore (reactive offer state) and delegates the actual
   * model write + persistence to persistAspectChange (aspect-commands). It renders
   * NOTHING when no aspect change is pending, so the integrator can mount it
   * unconditionally next to the canvas.
   */

  import { aspectStore } from '$lib/canvas/aspect.svelte.ts';
  import { persistAspectChange } from '$lib/canvas/aspect-commands.ts';
  import type { RepositionMode } from '$lib/canvas/aspect.ts';

  /** Format a free rect compactly for display (omit absent size). */
  function fmt(r: { x: number; y: number; w?: number; h?: number }): string {
    const pos = `${r.x}, ${r.y}`;
    return r.w !== undefined && r.h !== undefined ? `${pos} · ${r.w}×${r.h}` : pos;
  }

  let busy = $state(false);

  async function confirm(): Promise<void> {
    if (busy || !aspectStore.newSize) return;
    busy = true;
    try {
      // Persist the new canvas size + the ACCEPTED offers as one undo entry.
      await persistAspectChange(aspectStore.newSize, aspectStore.acceptedOffers());
      aspectStore.finish();
    } finally {
      busy = false;
    }
  }

  function cancel(): void {
    if (busy) return;
    // Revert the canvas to its previous aspect/size and drop the offers.
    aspectStore.cancel();
  }

  function setMode(mode: RepositionMode): void {
    aspectStore.setMode(mode);
  }
</script>

{#if aspectStore.pending}
  <div class="aspect-offer" role="dialog" aria-label="Reposition free elements">
    <header class="aspect-offer-head">
      <h2>Aspect ratio changed</h2>
      <p>
        {aspectStore.offers.length} free element{aspectStore.offers.length === 1 ? '' : 's'}
        {aspectStore.offers.length === 1 ? 'is' : 'are'} pinned to the old canvas. Choose how to
        handle each — structured content has already reflowed.
      </p>
    </header>

    <div class="aspect-offer-modes" role="radiogroup" aria-label="Rescale strategy">
      <button
        type="button"
        class:active={aspectStore.mode === 'proportional'}
        aria-pressed={aspectStore.mode === 'proportional'}
        onclick={() => setMode('proportional')}
      >
        Proportional
      </button>
      <button
        type="button"
        class:active={aspectStore.mode === 'uniform'}
        aria-pressed={aspectStore.mode === 'uniform'}
        onclick={() => setMode('uniform')}
      >
        Uniform
      </button>
    </div>

    <div class="aspect-offer-bulk">
      <button type="button" onclick={() => aspectStore.acceptAll()}>Accept all</button>
      <button type="button" onclick={() => aspectStore.declineAll()}>Decline all</button>
    </div>

    <ul class="aspect-offer-list">
      {#each aspectStore.offers as offer (offer.eid)}
        <li class="aspect-offer-item">
          <span class="aspect-offer-eid">{offer.eid}</span>
          <span class="aspect-offer-coords">
            <span class="from">{fmt(offer.current)}</span>
            <span class="arrow">→</span>
            <span class="to">{fmt(offer.suggested)}</span>
          </span>
          <span class="aspect-offer-decide">
            <label>
              <input
                type="radio"
                name="decide-{offer.eid}"
                checked={aspectStore.decisionFor(offer.eid) === 'accept'}
                onchange={() => aspectStore.decide(offer.eid, 'accept')}
              />
              Accept
            </label>
            <label>
              <input
                type="radio"
                name="decide-{offer.eid}"
                checked={aspectStore.decisionFor(offer.eid) === 'decline'}
                onchange={() => aspectStore.decide(offer.eid, 'decline')}
              />
              Keep
            </label>
          </span>
        </li>
      {/each}
    </ul>

    <footer class="aspect-offer-foot">
      <button type="button" onclick={cancel} disabled={busy}>Cancel</button>
      <button type="button" class="primary" onclick={confirm} disabled={busy}>
        {busy ? 'Applying…' : 'Apply'}
      </button>
    </footer>
  </div>
{/if}

<style>
  .aspect-offer {
    position: absolute;
    top: 1rem;
    right: 1rem;
    z-index: 20;
    width: 22rem;
    max-height: calc(100% - 2rem);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: #1b1b1f;
    color: #e7e7ea;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    font-size: 0.8125rem;
  }

  .aspect-offer-head h2 {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .aspect-offer-head p {
    margin: 0;
    color: rgba(231, 231, 234, 0.7);
    line-height: 1.35;
  }

  .aspect-offer-modes,
  .aspect-offer-bulk {
    display: flex;
    gap: 0.5rem;
  }

  .aspect-offer-modes button,
  .aspect-offer-bulk button,
  .aspect-offer-foot button {
    padding: 0.3rem 0.6rem;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0.3rem;
    cursor: pointer;
    font-size: 0.8125rem;
  }
  .aspect-offer-modes button.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }

  .aspect-offer-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .aspect-offer-item {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 0.5rem;
    padding: 0.4rem 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.3rem;
  }
  .aspect-offer-eid {
    font-family: ui-monospace, monospace;
    font-weight: 600;
    color: #93c5fd;
  }
  .aspect-offer-coords {
    grid-column: 1 / -1;
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    font-family: ui-monospace, monospace;
    color: rgba(231, 231, 234, 0.85);
  }
  .aspect-offer-coords .from {
    color: rgba(231, 231, 234, 0.55);
  }
  .aspect-offer-coords .arrow {
    color: rgba(231, 231, 234, 0.4);
  }
  .aspect-offer-decide {
    grid-row: 1;
    grid-column: 2;
    display: flex;
    gap: 0.6rem;
    white-space: nowrap;
  }
  .aspect-offer-decide label {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    cursor: pointer;
  }

  .aspect-offer-foot {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .aspect-offer-foot button.primary {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }
  .aspect-offer-foot button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
