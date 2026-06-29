/**
 * deck-chart.test.ts — Chart data command (P17-15).
 *
 * Covers deckStore.applyChartData(eid, type, dataJson), which rewrites a chart
 * canvas's `data-chart` (type) + `data-chart-data` (JSON config) markers:
 *   • sets both attributes + round-trips the JSON intact;
 *   • one undo entry + one autosave (commitCommand path), byte-stable;
 *   • invalid JSON / empty type / unknown eid are safe no-ops (never persist).
 *
 * deck.svelte.ts uses $state runes; the Svelte vite plugin transforms .svelte.ts
 * files in the vitest pipeline. fetch is stubbed so no real HTTP is made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeck, stampEids, serializeDeck, findByEid, getAttribute } from '$lib/model';

const SHELL = (slides: string): string =>
  `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">${slides}</div></div></body></html>`;

function canonical(html: string): string {
  const m = parseDeck(html);
  stampEids(m);
  return serializeDeck(m);
}

const CHART_JSON = '{"type":"bar","data":{"labels":["A","B"],"datasets":[{"data":[1,2]}]}}';

/** Baseline: a slide with a single chart canvas already eid-stamped. */
const BASE = canonical(
  SHELL(
    `<section data-eid="s1"><canvas data-eid="c1" data-chart="bar" width="600" height="400" data-chart-data='${CHART_JSON}'></canvas></section>`,
  ),
);

function makeFetch(initialHtml: string) {
  const disk = { html: initialHtml };
  const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
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

describe('deckStore.applyChartData (P17-15)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sets data-chart + data-chart-data and round-trips the JSON intact', async () => {
    const { store } = await freshStore(BASE);
    const NEXT = '{"type":"line","data":{"labels":["X"],"datasets":[{"data":[9]}]}}';

    await store.applyChartData('c1', 'line', NEXT);

    expect(store.source).toContain('data-chart="line"');
    // The attribute is entity-encoded on disk; re-parse + getAttribute decodes it
    // back to the literal JSON, which must parse and reflect the new data.
    const reparsed = parseDeck(store.source);
    const canvas = findByEid(reparsed, 'c1');
    expect(canvas).not.toBeNull();
    const literal = getAttribute(canvas!, 'data-chart-data');
    expect(literal).toBe(NEXT);
    expect(JSON.parse(literal!)).toMatchObject({ type: 'line' });
  });

  it('is one undo entry; undo restores the pre-command bytes', async () => {
    const { store, mockFetch } = await freshStore(BASE);

    await store.applyChartData('c1', 'pie', '{"type":"pie","data":{"labels":["A"],"datasets":[{"data":[3]}]}}');
    expect(store.canUndo).toBe(true);
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put).toBeTruthy();

    await store.undo();
    expect(store.source).toBe(BASE);
  });

  it('invalid JSON is a safe no-op (deck untouched, nothing to undo)', async () => {
    const { store } = await freshStore(BASE);

    await store.applyChartData('c1', 'bar', '{not valid json');

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });

  it('empty type is a safe no-op', async () => {
    const { store } = await freshStore(BASE);

    await store.applyChartData('c1', '   ', CHART_JSON);

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });

  it('unknown eid is a safe no-op', async () => {
    const { store } = await freshStore(BASE);

    await store.applyChartData('nope', 'bar', CHART_JSON);

    expect(store.source).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });
});
