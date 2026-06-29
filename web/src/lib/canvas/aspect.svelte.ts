/**
 * aspect.svelte.ts — Reactive aspect-ratio + reposition-offer store (P4-7).
 *
 * WHY THIS EXISTS (spec 05 "Aspect-ratio change behavior"):
 * =========================================================
 * The chosen aspect drives the LOGICAL canvas size, which the canvas (RevealFrame
 * width/height + coords.ts) must render at. That size is editor-wide shared state,
 * so it lives in one module-level `$state` store rather than being threaded as
 * props — the same pattern as gridStore/selectionStore.
 *
 * It ALSO owns the transient state of an in-progress aspect change: spec 05 says
 * structured content reflows automatically but FREE elements must be FLAGGED with
 * an offer to reposition (never silently moved). So `begin()` updates the aspect
 * IMMEDIATELY — the canvas iframe element and the overlay/coords adopt the new
 * logical size at once (RevealFrame's `width`/`height` are bound here) — while
 * collecting per-element reposition OFFERS that the UI (AspectRepositionOffer)
 * shows for accept/decline. reveal's CONTENT fully reflows structured layout once
 * the change is persisted (aspect-commands writes the new reveal width/height into
 * deck.html and the iframe reloads at that size). The model write + persistence is
 * delegated to aspect-commands.ts so the store stays pure reactive state (no
 * deckStore/model coupling → trivially testable).
 *
 * DATA FLOW (see integration_notes):
 *   picker → collectFreeRects(deckStore.model) → aspectStore.begin(newAspect, rects)
 *   offer UI reads aspectStore.offers/decisions → accept/decline
 *   confirm → persistAspectChange(aspectStore.newSize!, aspectStore.acceptedOffers())
 *           → aspectStore.finish()
 */

import {
  aspectToLogicalSize,
  computeRepositionOffers,
  DEFAULT_ASPECT,
  type LogicalSize,
  type RepositionMode,
  type RepositionOffer,
} from './aspect.ts';

/** Per-element decision in the offer dialog. */
export type OfferDecision = 'accept' | 'decline';

class AspectStore {
  /**
   * The current aspect descriptor (preset id like "16:9", or a custom "WxH" /
   * "W:H"). Drives `size`; the integrator seeds it from config/deck on load.
   */
  aspect = $state<string>(DEFAULT_ASPECT);

  /** Reposition strategy used when (re)computing offers. */
  mode = $state<RepositionMode>('proportional');

  /**
   * The live logical canvas size derived from `aspect`. Bind RevealFrame's
   * width/height to this (and pass to coords.ts) so the canvas renders at the
   * configured size and reflows structured content the instant `aspect` changes.
   */
  size = $derived<LogicalSize>(aspectToLogicalSize(this.aspect));

  /** Convenience getters for callers that want plain numbers. */
  get width(): number {
    return this.size.width;
  }
  get height(): number {
    return this.size.height;
  }

  // ── In-progress aspect change (offer dialog) ──────────────────────────────

  /** Canvas size BEFORE the in-progress change (for recomputing on mode switch). */
  oldSize = $state<LogicalSize | null>(null);
  /** Canvas size AFTER the in-progress change. */
  newSize = $state<LogicalSize | null>(null);
  /** One offer per affected free element; empty when no change is pending. */
  offers = $state<RepositionOffer[]>([]);
  /** Per-eid accept/decline decisions; default (absent) = accept. */
  decisions = $state<Record<string, OfferDecision>>({});

  /** Raw free rects captured at change start, kept so a mode switch recomputes. */
  #freeRectsAtStart: { eid: string; rect: import('./aspect.ts').FreeRect }[] = [];
  /** The aspect STRING before the in-progress change, so cancel() can restore it. */
  #aspectAtStart: string = DEFAULT_ASPECT;

  /** True while an aspect change is awaiting the user's reposition decisions. */
  get pending(): boolean {
    return this.offers.length > 0;
  }

  /**
   * Seed the aspect from persisted state (load time) WITHOUT opening an offer
   * dialog — there is no "old" canvas to migrate from on first load.
   */
  init(aspect: string): void {
    this.aspect = aspect;
  }

  /**
   * Begin an aspect change. Updates `aspect` immediately (so the canvas adopts the
   * new logical size) and computes a reposition offer for every free element. If there
   * are no free elements the change is purely structural — callers should still
   * persist the new size (no dialog needed); `pending` will be false.
   *
   * @param newAspect  The target aspect descriptor.
   * @param freeRects  Free elements + their current logical rects
   *                   (from collectFreeRects(deckStore.model)).
   */
  begin(newAspect: string, freeRects: { eid: string; rect: import('./aspect.ts').FreeRect }[]): void {
    const old = this.size;
    this.#aspectAtStart = this.aspect;
    this.aspect = newAspect; // size derives → structured reflow is immediate
    const next = this.size;

    this.oldSize = old;
    this.newSize = next;
    this.#freeRectsAtStart = freeRects;
    this.offers = computeRepositionOffers(freeRects, old, next, this.mode);
    // Default every offer to ACCEPT (the suggested reposition keeps free elements
    // on-canvas). The user can decline individually — spec 05 forbids SILENT moves,
    // and showing the dialog with a clear accept/decline IS the explicit consent.
    this.decisions = {};
  }

  /** Switch the reposition strategy and recompute suggested rects for the offers. */
  setMode(mode: RepositionMode): void {
    this.mode = mode;
    if (this.pending && this.oldSize && this.newSize) {
      this.offers = computeRepositionOffers(
        this.#freeRectsAtStart,
        this.oldSize,
        this.newSize,
        mode,
      );
    }
  }

  /** Record a per-element decision. */
  decide(eid: string, decision: OfferDecision): void {
    this.decisions = { ...this.decisions, [eid]: decision };
  }

  /** Accept all offers (clears any per-element declines). */
  acceptAll(): void {
    this.decisions = {};
  }

  /** Decline all offers — every free element keeps its old coordinates. */
  declineAll(): void {
    const all: Record<string, OfferDecision> = {};
    for (const o of this.offers) all[o.eid] = 'decline';
    this.decisions = all;
  }

  /** The decision for an eid (defaults to 'accept' when undecided). */
  decisionFor(eid: string): OfferDecision {
    return this.decisions[eid] ?? 'accept';
  }

  /** The subset of offers the user accepted — what aspect-commands should apply. */
  acceptedOffers(): RepositionOffer[] {
    return this.offers.filter((o) => this.decisionFor(o.eid) === 'accept');
  }

  /** Clear the in-progress change state once it has been persisted (or cancelled). */
  finish(): void {
    this.offers = [];
    this.decisions = {};
    this.oldSize = null;
    this.newSize = null;
    this.#freeRectsAtStart = [];
  }

  /**
   * Cancel an in-progress change: revert `aspect` to the value it had before
   * `begin()` (so the canvas snaps back and structured content re-reflows) and
   * drop the offers. Used when the user dismisses the dialog.
   */
  cancel(): void {
    this.aspect = this.#aspectAtStart;
    this.finish();
  }
}

/** Singleton — one editor, one aspect setting. */
export const aspectStore = new AspectStore();
