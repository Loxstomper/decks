/**
 * deck-background.test.ts — Unified slide background command (P16-1/2, spec theming-and-styles).
 *
 * Covers deckStore.applySlideBackground(eid, delta), the single command that
 * writes the reveal.js `data-background-*` set on a slide <section>:
 *   • set/clear each background TYPE (color, image, gradient, video) and the
 *     modifiers (size/position/repeat/opacity, video loop/muted);
 *   • TYPE exclusivity — setting image/gradient/video clears the competing types
 *     (color may coexist as an underlay);
 *   • byte-stability (SET + CLEAR round-trips to the canonical baseline);
 *   • one undo entry + one autosave (commitCommand path);
 *   • applySlideTheme still sets/clears the managed bg color via the consolidated
 *     buildBackgroundProps path.
 *
 * deck.svelte.ts uses $state runes; the Svelte vite plugin transforms .svelte.ts
 * files in the vitest pipeline. fetch is stubbed so no real HTTP is made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeck, stampEids, serializeDeck } from '$lib/model';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const SHELL = (slides: string): string =>
  `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">${slides}</div></div></body></html>`;

/** Canonicalise so the on-disk baseline matches serializeDeck output exactly. */
function canonical(html: string): string {
  const m = parseDeck(html);
  stampEids(m);
  return serializeDeck(m);
}

/** Already-eid-stamped baseline: load() adopts it without a re-stamp save. */
const BASE = canonical(
  SHELL('<section data-eid="s1"><h1 data-eid="h1">Hi</h1></section>'),
);

/** Background colours returned by the mocked /api/themes/backgrounds. */
const BACKGROUNDS: Record<string, string> = {
  black: '#191919',
  white: '#ffffff',
};

// ────────────────────────────────────────────────────────────────────────────
// Fetch mock: handles deck GET/PUT and the themes/backgrounds GET.
// ────────────────────────────────────────────────────────────────────────────

function makeFetch(initialHtml: string) {
  const disk = { html: initialHtml };
  const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes('/api/themes/backgrounds')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(BACKGROUNDS),
      } as unknown as Response);
    }
    if (opts?.method === 'PUT') {
      disk.html = opts.body as string;
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }
    // GET deck (load / SSE re-read)
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(disk.html),
    } as unknown as Response);
  });
  return { mockFetch, disk };
}

async function freshStore(s0: string) {
  const { mockFetch, disk } = makeFetch(s0);
  vi.stubGlobal('fetch', mockFetch);
  const { deckStore } = await import('./deck.svelte');
  await deckStore.load('test-deck');
  mockFetch.mockClear();
  return { store: deckStore, mockFetch, disk };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('deckStore.applySlideBackground — set/clear each type (P16-1)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sets and clears a solid color', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', { color: '#123456' });
    expect(store.source).toContain('data-background-color="#123456"');

    await store.applySlideBackground('s1', { color: null });
    expect(store.source).not.toContain('data-background-color');
  });

  it('sets and clears an image (with modifiers)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', {
      image: 'assets/photo.jpg',
      size: 'cover',
      position: 'center',
      repeat: 'no-repeat',
      opacity: '0.5',
    });
    expect(store.source).toContain('data-background-image="assets/photo.jpg"');
    expect(store.source).toContain('data-background-size="cover"');
    expect(store.source).toContain('data-background-position="center"');
    expect(store.source).toContain('data-background-repeat="no-repeat"');
    expect(store.source).toContain('data-background-opacity="0.5"');

    await store.applySlideBackground('s1', {
      image: null,
      size: null,
      position: null,
      repeat: null,
      opacity: null,
    });
    expect(store.source).not.toContain('data-background-image');
    expect(store.source).not.toContain('data-background-size');
    expect(store.source).not.toContain('data-background-position');
    expect(store.source).not.toContain('data-background-repeat');
    expect(store.source).not.toContain('data-background-opacity');
  });

  it('sets and clears a gradient', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', {
      gradient: 'linear-gradient(to bottom, red, blue)',
    });
    expect(store.source).toContain(
      'data-background-gradient="linear-gradient(to bottom, red, blue)"',
    );

    await store.applySlideBackground('s1', { gradient: null });
    expect(store.source).not.toContain('data-background-gradient');
  });

  it('sets and clears a video (with flags)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', {
      video: 'assets/clip.mp4',
      videoLoop: 'true',
      videoMuted: 'true',
    });
    expect(store.source).toContain('data-background-video="assets/clip.mp4"');
    expect(store.source).toContain('data-background-video-loop="true"');
    expect(store.source).toContain('data-background-video-muted="true"');

    await store.applySlideBackground('s1', {
      video: null,
      videoLoop: null,
      videoMuted: null,
    });
    expect(store.source).not.toContain('data-background-video');
  });
});

describe('deckStore.applySlideBackground — type exclusivity (P16-1)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('setting image clears gradient + video (and video flags)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', {
      video: 'assets/clip.mp4',
      videoLoop: 'true',
      videoMuted: 'true',
    });
    await store.applySlideBackground('s1', {
      gradient: 'linear-gradient(red, blue)',
    });
    // gradient replaced the video.
    expect(store.source).not.toContain('data-background-video');
    expect(store.source).toContain('data-background-gradient');

    await store.applySlideBackground('s1', { image: 'assets/photo.jpg' });
    expect(store.source).toContain('data-background-image="assets/photo.jpg"');
    expect(store.source).not.toContain('data-background-gradient');
    expect(store.source).not.toContain('data-background-video');
  });

  it('setting gradient clears image + video', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', { image: 'assets/photo.jpg' });
    await store.applySlideBackground('s1', { gradient: 'linear-gradient(red, blue)' });

    expect(store.source).toContain('data-background-gradient');
    expect(store.source).not.toContain('data-background-image');
  });

  it('setting video clears image + gradient', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', { image: 'assets/photo.jpg' });
    await store.applySlideBackground('s1', { video: 'assets/clip.mp4' });

    expect(store.source).toContain('data-background-video="assets/clip.mp4"');
    expect(store.source).not.toContain('data-background-image');
  });

  it('color coexists with an image (underlay survives)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', { color: '#000000' });
    await store.applySlideBackground('s1', { image: 'assets/photo.jpg' });

    // Setting the image must NOT clear the underlying solid colour.
    expect(store.source).toContain('data-background-color="#000000"');
    expect(store.source).toContain('data-background-image="assets/photo.jpg"');
  });
});

describe('deckStore.applySlideBackground — byte-stability + undo (P16-1)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('SET + CLEAR round-trips byte-for-byte to the baseline', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('s1', {
      color: '#123456',
      image: 'assets/photo.jpg',
      size: 'cover',
    });
    await store.applySlideBackground('s1', {
      color: null,
      image: null,
      size: null,
    });

    expect(store.source).toBe(BASE);
  });

  it('one command = one undo entry; undo restores the pre-command bytes', async () => {
    const { store, mockFetch } = await freshStore(BASE);

    await store.applySlideBackground('s1', { image: 'assets/photo.jpg' });
    expect(store.canUndo).toBe(true);
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put).toBeTruthy();

    await store.undo();
    expect(store.source).toBe(BASE);
  });

  it('unknown eid is a safe no-op', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideBackground('does-not-exist', { color: '#fff' });

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});

describe('deckStore.applySlideTheme — consolidated bg-color write (P10/P16)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('still sets data-theme AND the managed bg color via the shared path', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'black');

    expect(store.source).toContain('data-theme="black"');
    expect(store.source).toContain('data-background-color="#191919"');
  });

  it('clearing (null) removes both theme and bg color; byte-stable', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'white');
    await store.applySlideTheme('s1', null);

    expect(store.source).not.toContain('data-theme');
    expect(store.source).not.toContain('data-background-color');
    expect(store.source).toBe(BASE);
  });
});
