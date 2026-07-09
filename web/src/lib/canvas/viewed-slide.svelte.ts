/**
 * viewed-slide.svelte.ts — the slide reveal is currently PRESENTING on the
 * canvas, as reveal's (h, v) indices.
 *
 * WHY THIS EXISTS:
 * ================
 * "Current slide" and "the selection" are NOT the same thing. You can navigate
 * the canvas to slide 25 (via the navigator or arrow keys) without selecting any
 * element on it. Before this store, both the insert seam and the motion panels
 * derived "current slide" purely from the selection, falling back to the FIRST
 * slide when nothing was selected — so an image uploaded while viewing slide 25
 * landed on slide 1.
 *
 * This module-level singleton holds the presented slide's indices, written from
 * ONE `onSlideChanged` subscription in the shell (App.svelte) and read wherever
 * "the slide you're looking at" is needed — the insert path (target.ts) and the
 * navigator highlight. Indices (not an eid) are stored because they survive model
 * edits; callers map them to an eid against the live model via
 * {@link indicesToEid}.
 *
 * `-1` means "unknown" (reveal not ready yet / no canvas mounted).
 */
class ViewedSlideStore {
  h = $state(-1);
  v = $state(-1);

  /** Record the indices reveal is now presenting. */
  set(h: number, v: number): void {
    this.h = h;
    this.v = v;
  }

  /** Forget the viewed slide (e.g. when the canvas unmounts). */
  reset(): void {
    this.h = -1;
    this.v = -1;
  }
}

export const viewedSlide = new ViewedSlideStore();
