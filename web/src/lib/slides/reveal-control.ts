/**
 * reveal-control.ts — Drive the canvas's reveal.js instance from the navigator
 * (P6-1 / P6-5 jump-to-slide + current-slide reflection).
 *
 * WHY THIS EXISTS:
 * ================
 * The navigator filmstrip jumps the canvas to a clicked slide and highlights the
 * slide reveal is currently showing. reveal exposes an imperative API on the
 * iframe's `window` (`Reveal.slide(h, v)`, `Reveal.getIndices()`, and an event
 * bus via `Reveal.on('slidechanged', …)`). Because the iframe is served from our
 * own origin with `allow-same-origin` (see RevealFrame.svelte), we can reach
 * `iframe.contentWindow.Reveal` directly.
 *
 * READINESS:
 * ==========
 * After an iframe (re)load, reveal initialises asynchronously — `Reveal` may not
 * exist yet, or may exist but not be `isReady()`. Rather than depend on a single
 * load event (which can fire before init completes), we poll briefly with
 * requestAnimationFrame until reveal is ready, then run the callback. Every
 * helper degrades to a safe no-op when reveal is unavailable, so a stale call
 * after a reload never throws into the UI.
 *
 * This module is intentionally framework-free (no Svelte) so it can be unit
 * tested with a fake iframe/Reveal stub.
 */

/** Minimal shape of the bits of the reveal.js API we use. */
interface RevealApi {
  isReady?: () => boolean;
  slide: (h: number, v?: number) => void;
  getIndices: () => { h: number; v: number };
  on: (type: string, handler: (event: unknown) => void) => void;
  off: (type: string, handler: (event: unknown) => void) => void;
}

/** Read the reveal instance off an iframe's window, or null if not present. */
function getReveal(iframe: HTMLIFrameElement | null | undefined): RevealApi | null {
  if (!iframe) return null;
  try {
    // contentWindow access is same-origin (allow-same-origin sandbox); guarded in
    // case the iframe is mid-navigation (cross-origin about:blank throws).
    const win = iframe.contentWindow as (Window & { Reveal?: RevealApi }) | null;
    return win?.Reveal ?? null;
  } catch {
    return null;
  }
}

/** True once reveal exists AND has finished initialising on this iframe. */
function isRevealReady(iframe: HTMLIFrameElement | null | undefined): boolean {
  const reveal = getReveal(iframe);
  if (!reveal) return false;
  // Older builds may omit isReady(); presence of getIndices is a good fallback.
  return reveal.isReady ? reveal.isReady() : typeof reveal.getIndices === 'function';
}

/**
 * Run `cb(reveal)` once reveal is ready on `iframe`, polling for up to
 * `timeoutMs`. Returns a disposer that cancels the pending wait. If reveal never
 * becomes ready within the window the callback is simply never invoked (safe).
 */
function whenRevealReady(
  iframe: HTMLIFrameElement | null | undefined,
  cb: (reveal: RevealApi) => void,
  timeoutMs = 4000,
): () => void {
  let raf = 0;
  let cancelled = false;
  const start = performance.now();

  const tick = () => {
    if (cancelled) return;
    const reveal = getReveal(iframe);
    if (reveal && isRevealReady(iframe)) {
      cb(reveal);
      return;
    }
    if (performance.now() - start > timeoutMs) return; // give up quietly
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * Jump the canvas to slide (h, v). Waits for reveal readiness so a click fired
 * immediately after a reload still lands. Returns a disposer for the pending
 * wait (harmless to ignore once navigation has occurred).
 *
 * @param onArrive  Optional callback invoked synchronously right after
 *   `reveal.slide(h, v)` executes. Used by RevealFrame (P11-2) to flip
 *   `isLoading = false` only once the restored slide has actually been
 *   commanded — preventing a flash to slide 1 on same-deck reload.
 *   Existing callers that pass no `onArrive` are unaffected.
 */
export function navigateToSlide(
  iframe: HTMLIFrameElement | null | undefined,
  h: number,
  v = 0,
  onArrive?: () => void,
): () => void {
  return whenRevealReady(iframe, (reveal) => {
    reveal.slide(h, v);
    onArrive?.();
  });
}

/** Current (h, v) indices reveal is showing, or null when reveal is not ready. */
export function getCurrentIndices(
  iframe: HTMLIFrameElement | null | undefined,
): { h: number; v: number } | null {
  const reveal = getReveal(iframe);
  if (!reveal || !isRevealReady(iframe)) return null;
  try {
    return reveal.getIndices();
  } catch {
    return null;
  }
}

/**
 * Subscribe to reveal's slide-changed stream for this iframe. `cb` is invoked
 * with the current indices on every change AND once immediately on subscribe
 * (so the navigator highlights the right slide as soon as reveal is ready).
 * Returns an unsubscribe function that detaches the listener and cancels any
 * pending readiness wait.
 */
export function onSlideChanged(
  iframe: HTMLIFrameElement | null | undefined,
  cb: (indices: { h: number; v: number }) => void,
): () => void {
  let detach: (() => void) | null = null;

  const cancelWait = whenRevealReady(iframe, (reveal) => {
    const handler = () => {
      try {
        cb(reveal.getIndices());
      } catch {
        /* iframe torn down mid-event — ignore. */
      }
    };
    reveal.on('slidechanged', handler);
    detach = () => reveal.off('slidechanged', handler);
    handler(); // prime the initial highlight
  });

  return () => {
    cancelWait();
    if (detach) detach();
  };
}
