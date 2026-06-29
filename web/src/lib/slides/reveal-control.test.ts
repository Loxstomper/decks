/**
 * reveal-control.test.ts — Unit tests for the reveal-control helpers (P6-1, P11-2).
 *
 * WHAT IS COVERED:
 * ================
 *   navigateToSlide(iframe, h, v)           — calls reveal.slide(h, v)
 *   navigateToSlide(iframe, h, v, onArrive) — calls onArrive() synchronously
 *                                             AFTER reveal.slide() (P11-2 ordering
 *                                             guarantee: the canvas is hidden until
 *                                             onArrive flips isLoading=false)
 *   getCurrentIndices(iframe)               — returns null/indices correctly
 *   onSlideChanged(iframe, cb)              — subscribes, primes, and unsubscribes
 *
 * WHY NODE-SAFE:
 * ==============
 * The module polls with requestAnimationFrame when reveal is not yet ready. In
 * every test below the fake iframe returns an already-ready Reveal stub, so
 * whenRevealReady() resolves on the FIRST synchronous tick() call and never
 * reaches the requestAnimationFrame branch. performance.now() is available in
 * Node 16+ without stubbing.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { navigateToSlide, getCurrentIndices, onSlideChanged } from './reveal-control';

// ── Node browser-API shim ────────────────────────────────────────────────────
//
// The module polls with requestAnimationFrame when reveal is not yet ready (e.g.
// for a null iframe). Node does not provide requestAnimationFrame so we stub it
// as a no-op — the callback is never invoked, meaning the poll never retries.
// This is correct for "null iframe" tests: the disposer still cancels correctly,
// and the callback is never called (which is what we assert).
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 0);
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ── Fake Reveal API ──────────────────────────────────────────────────────────

interface FakeReveal {
  isReady: () => boolean;
  slide: ReturnType<typeof vi.fn>;
  getIndices: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake <iframe>-like object whose `contentWindow.Reveal` is a ready
 * stub.  The stub's `getIndices` returns { h, v } by default.
 */
function makeFakeIframe(options: {
  h?: number;
  v?: number;
  ready?: boolean;
} = {}): HTMLIFrameElement {
  const { h = 0, v = 0, ready = true } = options;

  const reveal: FakeReveal = {
    isReady: () => ready,
    slide: vi.fn(),
    getIndices: vi.fn().mockReturnValue({ h, v }),
    on: vi.fn(),
    off: vi.fn(),
  };

  return {
    contentWindow: { Reveal: reveal } as unknown as Window,
  } as unknown as HTMLIFrameElement;
}

/** Extract the Reveal stub from a fake iframe. */
function getReveal(iframe: HTMLIFrameElement): FakeReveal {
  return (iframe.contentWindow as unknown as { Reveal: FakeReveal }).Reveal;
}

// ── navigateToSlide ──────────────────────────────────────────────────────────

describe('navigateToSlide', () => {
  it('calls reveal.slide(h, v) when reveal is ready', () => {
    const iframe = makeFakeIframe({ h: 0, v: 0 });
    navigateToSlide(iframe, 2, 1);
    expect(getReveal(iframe).slide).toHaveBeenCalledWith(2, 1);
  });

  it('defaults v to 0 when omitted', () => {
    const iframe = makeFakeIframe();
    navigateToSlide(iframe, 3);
    expect(getReveal(iframe).slide).toHaveBeenCalledWith(3, 0);
  });

  it('is a no-op when iframe is null (does not throw)', () => {
    expect(() => navigateToSlide(null, 1)).not.toThrow();
  });

  it('is a no-op when iframe is undefined (does not throw)', () => {
    expect(() => navigateToSlide(undefined, 1)).not.toThrow();
  });

  it('returns a disposer function that is callable without error', () => {
    const iframe = makeFakeIframe();
    const dispose = navigateToSlide(iframe, 0);
    expect(() => dispose()).not.toThrow();
  });
});

// ── navigateToSlide — P11-2: onArrive callback ──────────────────────────────

describe('navigateToSlide — onArrive (P11-2)', () => {
  it('calls onArrive() when provided', () => {
    const iframe = makeFakeIframe({ h: 1, v: 0 });
    const onArrive = vi.fn();
    navigateToSlide(iframe, 1, 0, onArrive);
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it('calls reveal.slide() BEFORE onArrive() — ordering guarantee for P11-2', () => {
    /**
     * P11-2 requires that isLoading is flipped to false AFTER the slide has
     * been commanded (to avoid a flash to slide 1). This test verifies the
     * call order by recording a sequence inside each spy.
     */
    const iframe = makeFakeIframe({ h: 2, v: 1 });
    const reveal = getReveal(iframe);
    const callOrder: string[] = [];

    reveal.slide.mockImplementation(() => callOrder.push('slide'));
    const onArrive = vi.fn(() => callOrder.push('onArrive'));

    navigateToSlide(iframe, 2, 1, onArrive);

    expect(callOrder).toEqual(['slide', 'onArrive']);
  });

  it('passes the correct (h, v) to reveal.slide() even when onArrive is provided', () => {
    const iframe = makeFakeIframe();
    const onArrive = vi.fn();
    navigateToSlide(iframe, 3, 2, onArrive);
    expect(getReveal(iframe).slide).toHaveBeenCalledWith(3, 2);
  });

  it('does NOT call onArrive when iframe is null', () => {
    const onArrive = vi.fn();
    navigateToSlide(null, 1, 0, onArrive);
    expect(onArrive).not.toHaveBeenCalled();
  });

  it('works with no onArrive argument (backward-compatible)', () => {
    const iframe = makeFakeIframe();
    // Verify slide() still fires correctly and nothing throws.
    expect(() => navigateToSlide(iframe, 2, 0)).not.toThrow();
    expect(getReveal(iframe).slide).toHaveBeenCalledWith(2, 0);
  });
});

// ── getCurrentIndices ────────────────────────────────────────────────────────

describe('getCurrentIndices', () => {
  it('returns null when iframe is null', () => {
    expect(getCurrentIndices(null)).toBeNull();
  });

  it('returns null when iframe is undefined', () => {
    expect(getCurrentIndices(undefined)).toBeNull();
  });

  it('returns the indices from reveal.getIndices() when reveal is ready', () => {
    const iframe = makeFakeIframe({ h: 2, v: 1 });
    expect(getCurrentIndices(iframe)).toEqual({ h: 2, v: 1 });
  });

  it('returns null when reveal is not yet ready (isReady() === false)', () => {
    const iframe = makeFakeIframe({ ready: false });
    expect(getCurrentIndices(iframe)).toBeNull();
  });

  it('returns { h: 0, v: 0 } for the first slide', () => {
    const iframe = makeFakeIframe({ h: 0, v: 0 });
    expect(getCurrentIndices(iframe)).toEqual({ h: 0, v: 0 });
  });
});

// ── onSlideChanged ───────────────────────────────────────────────────────────

describe('onSlideChanged', () => {
  it('registers a listener on the reveal event bus immediately', () => {
    const iframe = makeFakeIframe({ h: 0, v: 0 });
    const reveal = getReveal(iframe);
    const cb = vi.fn();

    onSlideChanged(iframe, cb);

    expect(reveal.on).toHaveBeenCalledWith('slidechanged', expect.any(Function));
  });

  it('calls the callback immediately with the current indices (prime on subscribe)', () => {
    const iframe = makeFakeIframe({ h: 1, v: 0 });
    const cb = vi.fn();

    onSlideChanged(iframe, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ h: 1, v: 0 });
  });

  it('calls the callback when the registered slidechanged handler fires', () => {
    const iframe = makeFakeIframe({ h: 0, v: 0 });
    const reveal = getReveal(iframe);
    const cb = vi.fn();

    onSlideChanged(iframe, cb);

    // Simulate reveal emitting a slidechanged event by calling the registered handler.
    // At this point getIndices() returns { h: 2, v: 0 }.
    reveal.getIndices.mockReturnValue({ h: 2, v: 0 });
    const [, handler] = reveal.on.mock.calls[0] as [string, () => void];
    handler();

    expect(cb).toHaveBeenCalledTimes(2); // once on subscribe + once on event
    expect(cb).toHaveBeenLastCalledWith({ h: 2, v: 0 });
  });

  it('unsubscribes from the reveal event bus when the disposer is called', () => {
    const iframe = makeFakeIframe({ h: 0, v: 0 });
    const reveal = getReveal(iframe);
    const cb = vi.fn();

    const unsubscribe = onSlideChanged(iframe, cb);
    unsubscribe();

    expect(reveal.off).toHaveBeenCalledWith('slidechanged', expect.any(Function));
  });

  it('is a no-op when iframe is null (does not throw)', () => {
    const cb = vi.fn();
    expect(() => {
      const unsub = onSlideChanged(null, cb);
      unsub();
    }).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});
