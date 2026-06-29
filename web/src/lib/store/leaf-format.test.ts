/**
 * leaf-format.test.ts — Block text + whole-leaf link store commands (P17-8/10).
 *
 * Covers (each: one undo entry + one autosave, byte-stable, unknown eid no-op):
 *   • applyTextAlign(eid, align|null)   — inline text-align on a text leaf;
 *   • indentList(eid, 'in'|'out')       — re-nest a ul/ol leaf, reversible;
 *   • applyLinkToLeaf(eid, href)        — wrap leaf in <a href>; reject javascript:;
 *   • removeLinkFromLeaf(eid)           — unwrap anchors.
 *
 * Mirrors alt-text.test.ts: fetch is stubbed; deck.svelte.ts $state runes are
 * transformed by the Svelte vite plugin in the vitest pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeck, stampEids, serializeDeck } from '$lib/model';

const SHELL = (slides: string): string =>
  `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">${slides}</div></div></body></html>`;

function canonical(html: string): string {
  const m = parseDeck(html);
  stampEids(m);
  return serializeDeck(m);
}

const BASE = canonical(
  SHELL(
    '<section data-eid="s1">' +
      '<p data-eid="p1">hello world</p>' +
      '<ul data-eid="l1"><li>a</li><li>b</li></ul>' +
      '</section>',
  ),
);

function makeFetch(initialHtml: string) {
  const disk = { html: initialHtml };
  const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes('/api/themes/backgrounds')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
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

describe('deckStore.applyTextAlign (P17-8)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('writes an inline text-align on the leaf and clears it', async () => {
    const { store } = await freshStore(BASE);
    await store.applyTextAlign('p1', 'center');
    expect(store.source).toContain('style="text-align: center"');

    await store.applyTextAlign('p1', null);
    expect(store.source).not.toContain('text-align');
    // Untouched siblings preserved.
    expect(store.source).toContain('<ul data-eid="l1">');
  });

  it('one command = one undo entry', async () => {
    const { store, mockFetch } = await freshStore(BASE);
    await store.applyTextAlign('p1', 'right');
    expect(store.canUndo).toBe(true);
    expect(mockFetch.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(true);
    await store.undo();
    expect(store.source).toBe(BASE);
  });

  it('unknown eid is a safe no-op', async () => {
    const { store } = await freshStore(BASE);
    await store.applyTextAlign('nope', 'center');
    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});

describe('deckStore.indentList (P17-8)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('indent then outdent restores the original bytes', async () => {
    const { store } = await freshStore(BASE);
    await store.indentList('l1', 'in');
    // The list is nested one level deeper under a new <li><ul>… wrapper.
    expect(store.source).toContain('<ul data-eid="l1"><li><ul>');
    await store.indentList('l1', 'out');
    expect(store.source).toBe(BASE);
  });

  it('outdent on a flat list does not churn (no undo entry)', async () => {
    const { store } = await freshStore(BASE);
    await store.indentList('l1', 'out');
    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});

describe('deckStore link-to-leaf commands (P17-10)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('applyLinkToLeaf wraps the leaf in <a href> and is reversible', async () => {
    const { store } = await freshStore(BASE);
    const ok = await store.applyLinkToLeaf('p1', 'https://example.com/');
    expect(ok).toBe(true);
    expect(store.source).toContain('<a href="https://example.com/">hello world</a>');

    await store.removeLinkFromLeaf('p1');
    expect(store.source).not.toContain('<a');
    expect(store.source).toContain('hello world');
  });

  it('rejects a javascript: href (returns false, no change)', async () => {
    const { store } = await freshStore(BASE);
    // eslint-disable-next-line no-script-url
    const ok = await store.applyLinkToLeaf('p1', 'javascript:alert(1)');
    expect(ok).toBe(false);
    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });

  it('allows an external http href (offline guard unaffected by navigation)', async () => {
    const { store } = await freshStore(BASE);
    const ok = await store.applyLinkToLeaf('p1', 'http://external.example/page');
    expect(ok).toBe(true);
    expect(store.source).toContain('href="http://external.example/page"');
  });
});
