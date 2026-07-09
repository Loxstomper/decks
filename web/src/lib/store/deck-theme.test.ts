/**
 * deck-theme.test.ts — Per-slide theming commands (P10-3 / P10-4, spec theming-and-styles).
 *
 * Covers the two deckStore commands that theme an individual slide <section>:
 *   • applySlideTheme(eid, name|null)  — named bundled theme: writes data-theme
 *     + the managed data-background-color (colour from /api/themes/backgrounds);
 *     null clears both.
 *   • applySlideColorVars(eid, {...})  — free-form inline --r-* overrides layered
 *     over a named bundle; per-key null clears just that one var.
 *
 * Each test asserts: SET writes the expected attributes, CLEAR removes them, and
 * a SET+CLEAR round-trip is byte-stable (returns to the canonical baseline).
 * Both commands are one undo entry + one autosave (commitCommand path).
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
  dracula: '#282a36',
};

// ────────────────────────────────────────────────────────────────────────────
// Fetch mock: handles deck GET/PUT and the themes/backgrounds GET.
// ────────────────────────────────────────────────────────────────────────────

function makeFetch(initialHtml: string) {
  const disk = { html: initialHtml };
  const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes('/api/themes/backgrounds')) {
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

describe('deckStore.applySlideTheme — named bundled theme (P10-3)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('writes data-theme AND the managed data-background-color', async () => {
    const { store, mockFetch } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'black');

    expect(store.source).toContain('data-theme="black"');
    expect(store.source).toContain('data-background-color="#191919"');
    // One undo entry + one autosave (PUT).
    expect(store.canUndo).toBe(true);
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put).toBeTruthy();
  });

  it('caches /api/themes/backgrounds (fetched at most once across calls)', async () => {
    const { store, mockFetch } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'black');
    await store.applySlideTheme('s1', 'dracula');

    const bgCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/themes/backgrounds'),
    );
    expect(bgCalls).toHaveLength(1);
    expect(store.source).toContain('data-theme="dracula"');
    expect(store.source).toContain('data-background-color="#282a36"');
  });

  it('clearing (null) removes both data-theme and data-background-color', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'black');
    await store.applySlideTheme('s1', null);

    expect(store.source).not.toContain('data-theme');
    expect(store.source).not.toContain('data-background-color');
  });

  it('SET + CLEAR round-trips byte-for-byte to the baseline', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'white');
    await store.applySlideTheme('s1', null);

    expect(store.source).toBe(BASE);
  });

  it('is undoable (undo restores the pre-command bytes)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'black');
    await store.undo();

    expect(store.source).toBe(BASE);
  });

  it('unknown eid is a safe no-op', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('does-not-exist', 'black');

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});

describe('deckStore.applySlideColorVars — free-form inline overrides (P10-4)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('writes the inline --r-* vars and data-background-color', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideColorVars('s1', {
      heading: '#ff0000',
      text: '#00ff00',
      link: '#0000ff',
      backgroundColor: '#123456',
    });

    expect(store.source).toContain('--r-heading-color:#ff0000');
    expect(store.source).toContain('--r-main-color:#00ff00');
    expect(store.source).toContain('--r-link-color:#0000ff');
    expect(store.source).toContain('data-background-color="#123456"');
    expect(store.canUndo).toBe(true);
  });

  it('layers free-form vars over a named theme bundle', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideTheme('s1', 'black');
    await store.applySlideColorVars('s1', { heading: '#abcdef' });

    // Named bundle preserved...
    expect(store.source).toContain('data-theme="black"');
    // ...with the free-form override layered on top.
    expect(store.source).toContain('--r-heading-color:#abcdef');
  });

  it('clearing a single colour removes only that var', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideColorVars('s1', { heading: '#ff0000', text: '#00ff00' });
    await store.applySlideColorVars('s1', { heading: null });

    expect(store.source).not.toContain('--r-heading-color');
    expect(store.source).toContain('--r-main-color:#00ff00');
  });

  it('SET + CLEAR-all round-trips byte-for-byte to the baseline', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideColorVars('s1', {
      heading: '#ff0000',
      text: '#00ff00',
      link: '#0000ff',
      backgroundColor: '#123456',
    });
    await store.applySlideColorVars('s1', {
      heading: null,
      text: null,
      link: null,
      backgroundColor: null,
    });

    expect(store.source).toBe(BASE);
  });

  it('omitted keys leave existing vars untouched (partial delta)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideColorVars('s1', { heading: '#ff0000' });
    // Second call only touches link; heading must survive.
    await store.applySlideColorVars('s1', { link: '#0000ff' });

    expect(store.source).toContain('--r-heading-color:#ff0000');
    expect(store.source).toContain('--r-link-color:#0000ff');
  });

  it('is undoable (undo restores the pre-command bytes)', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideColorVars('s1', { heading: '#ff0000' });
    await store.undo();

    expect(store.source).toBe(BASE);
  });

  it('unknown eid is a safe no-op', async () => {
    const { store } = await freshStore(BASE);

    await store.applySlideColorVars('does-not-exist', { heading: '#ff0000' });

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});
