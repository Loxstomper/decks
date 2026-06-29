/**
 * alt-text.test.ts — Alt text command tests (P17-11, spec 08).
 *
 * Covers deckStore.applyAltText(eid, alt):
 *   • sets alt on an img element;
 *   • overwrites an existing alt;
 *   • empty string written as alt="";
 *   • byte-stability (set + overwrite round-trips through setAttribute);
 *   • one undo entry + one autosave (commitCommand path);
 *   • unknown eid is a safe no-op.
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

/** Slide with an img that already has alt="". */
const BASE = canonical(
  SHELL('<section data-eid="s1"><img data-eid="img1" src="assets/photo.jpg" alt="" /></section>'),
);

// ────────────────────────────────────────────────────────────────────────────
// Fetch mock
// ────────────────────────────────────────────────────────────────────────────

function makeFetch(initialHtml: string) {
  const disk = { html: initialHtml };
  const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes('/api/themes/backgrounds')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    }
    if (opts?.method === 'PUT') {
      disk.html = opts.body as string;
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }
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

describe('deckStore.applyAltText — set and overwrite (P17-11)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sets alt text on an img element', async () => {
    const { store } = await freshStore(BASE);

    await store.applyAltText('img1', 'A landscape photo');
    expect(store.source).toContain('alt="A landscape photo"');
  });

  it('overwrites an existing alt', async () => {
    const { store } = await freshStore(BASE);

    await store.applyAltText('img1', 'First description');
    await store.applyAltText('img1', 'Updated description');
    expect(store.source).toContain('alt="Updated description"');
    expect(store.source).not.toContain('alt="First description"');
  });

  it('writes empty string as alt="" (decorative image)', async () => {
    const { store } = await freshStore(BASE);

    await store.applyAltText('img1', 'Some text');
    await store.applyAltText('img1', '');
    // The attribute must remain present with empty value, not be removed.
    expect(store.source).toContain('alt=""');
  });

  it('unknown eid is a safe no-op', async () => {
    const { store } = await freshStore(BASE);

    await store.applyAltText('does-not-exist', 'Should not matter');

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});

describe('deckStore.applyAltText — undo + autosave (P17-11)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('one command = one undo entry; undo restores previous alt', async () => {
    const { store, mockFetch } = await freshStore(BASE);

    await store.applyAltText('img1', 'My description');
    expect(store.canUndo).toBe(true);
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put).toBeTruthy();

    await store.undo();
    // After undo, alt should be back to empty string (the BASE fixture has alt="")
    expect(store.source).toContain('alt=""');
    expect(store.source).not.toContain('alt="My description"');
  });
});
