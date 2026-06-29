/**
 * layout-presets.test.ts — deckStore layout-preset commands (P14-3 / P14-4).
 *
 * Integrated (fetch stubbed, $state runes via vite-svelte), mirroring
 * element-ops.test.ts: fresh singletons per test via vi.resetModules() + a
 * dynamic import, with a mock fetch backing an in-memory "disk".
 *
 * Coverage:
 *   • addSlideFromLayout: inserts the preset (structure + prompts) with fresh
 *     unique eids, selects it, persists as ONE save, leaves siblings byte-stable.
 *   • changeSlideLayout: moves all content into the new content slot, persists as
 *     ONE save, and is UNDOABLE + byte-stable (the snapshot restores prior bytes).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fully-stamped, valid deck so load() does not auto-save and every serialized
// save round-trips through validateSource cleanly.
const DECK = `<!doctype html>
<html>
<body>
<div class="reveal">
<div class="slides">
<section data-eid="s1"><div data-eid="c1" data-lay="stack"><h2 data-eid="h1">One</h2><p data-eid="p1">body</p></div></section>
<section data-eid="s2"><h2 data-eid="h2">Two</h2></section>
</div>
</div>
</body>
</html>`;

const S2 = '<section data-eid="s2"><h2 data-eid="h2">Two</h2></section>';

const PRESET_TITLE_BODY = `<section data-layout="title-body">
  <div data-lay="stack" data-gap="32" data-slot="content">
    <h2>Click to add title</h2>
    <p>Click to add body text</p>
  </div>
</section>`;

function allEids(html: string): string[] {
  return [...html.matchAll(/data-eid="([^"]+)"/g)].map((m) => m[1]);
}

describe('deckStore — layout presets (P14-3 / P14-4)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function makeFetch(initialHtml: string) {
    const disk = { html: initialHtml };
    let puts = 0;
    const mockFetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        puts++;
        disk.html = opts.body as string;
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(disk.html),
      } as unknown as Response);
    });
    return { mockFetch, disk, puts: () => puts };
  }

  async function freshStore() {
    const { mockFetch, disk, puts } = makeFetch(DECK);
    vi.stubGlobal('fetch', mockFetch);
    const { deckStore } = await import('./deck.svelte');
    const { selectionStore } = await import('$lib/canvas/selection.svelte');
    await deckStore.load('test-deck');
    expect(disk.html).toBe(DECK); // stamped fixture → no load-time churn
    mockFetch.mockClear();
    const base = puts();
    return { store: deckStore, selectionStore, disk, putsSince: () => puts() - base };
  }

  it('addSlideFromLayout inserts the preset with fresh eids, selects it, one save', async () => {
    const { store, selectionStore, disk, putsSince } = await freshStore();

    const newEid = await store.addSlideFromLayout(PRESET_TITLE_BODY, 's1');
    expect(newEid).not.toBeNull();
    expect(selectionStore.eid).toBe(newEid);
    expect(putsSince()).toBe(1); // exactly one autosave

    // Preset structure + prompts landed, with unique eids.
    expect(disk.html).toContain('data-layout="title-body"');
    expect(disk.html).toContain('Click to add body text');
    const eids = allEids(disk.html);
    expect(new Set(eids).size).toBe(eids.length);
    // Inserted between s1 and s2.
    const at = disk.html.indexOf('data-layout="title-body"');
    expect(at).toBeGreaterThan(disk.html.indexOf('data-eid="s1"'));
    expect(at).toBeLessThan(disk.html.indexOf(S2));
    // Untouched sibling verbatim.
    expect(disk.html).toContain(S2);
  });

  it('changeSlideLayout re-flows content and is undoable byte-stable, one save', async () => {
    const { store, disk, putsSince } = await freshStore();
    const before = disk.html;

    const eid = await store.changeSlideLayout('s1', PRESET_TITLE_BODY);
    expect(eid).toBe('s1'); // identity preserved
    expect(putsSince()).toBe(1); // exactly one autosave

    // New layout applied; the authored content survived and moved into the slot.
    expect(disk.html).toContain('data-layout="title-body"');
    expect(disk.html).toContain('data-eid="h1"');
    expect(disk.html).toContain('data-eid="p1"');
    const slotStart = disk.html.indexOf('data-slot="content"');
    const slotRegion = disk.html.slice(slotStart, disk.html.indexOf('</section>', slotStart));
    expect(slotRegion).toContain('data-eid="h1"');
    expect(slotRegion).toContain('data-eid="p1"');
    // Untouched sibling verbatim.
    expect(disk.html).toContain(S2);

    // Undo restores the prior bytes EXACTLY.
    expect(store.canUndo).toBe(true);
    await store.undo();
    expect(disk.html).toBe(before);
  });
});
