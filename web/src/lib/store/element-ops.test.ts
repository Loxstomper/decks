/**
 * element-ops.test.ts — Net-new element operations (P13-5/6/7).
 *
 * Coverage:
 *   Pure clone (cloneSubtreeStripEids):
 *     1. strips every data-eid (deep) while keeping data-id + other attrs.
 *     2. produces an INDEPENDENT copy (mutating the clone never touches the original).
 *
 *   deckStore element ops (integrated; fetch stubbed, $state runes via vite-svelte):
 *     3. duplicateElement: inserts a copy after the original with a FRESH unique
 *        eid, selects the clone, and is byte-stable (untouched slide verbatim).
 *     4. duplicateElement refuses a <section> (slide dup lives in the navigator).
 *     5. bringToFront / sendToBack reorder a free element last / first among siblings.
 *     6. copy + paste clones across slides with a fresh eid; original untouched.
 *     7. cut removes the original and pastes it elsewhere (across slides).
 *     8. paste into a CONTAINER target lands as its last child.
 *
 * Tests 3-8 mirror undo.test.ts: fresh singletons per test via vi.resetModules()
 * + a dynamic import, with a mock fetch backing an in-memory "disk".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeck, cloneSubtreeStripEids, getAttribute, walk, type ElementNode } from '$lib/model';

// Fully-stamped, valid deck so load() does not auto-save (stamp is a no-op) and
// validateSource passes on every serialized save. Single-line slides keep the
// byte-stability substring checks trivial.
const DECK = `<!doctype html>
<html>
<body>
<div class="reveal">
<div class="slides">
<section data-eid="s1"><div data-eid="lay1" data-lay="layers"><p data-eid="p1" data-id="k" data-free data-x="10" data-y="10">A</p><p data-eid="p2" data-free data-x="20" data-y="20">B</p><p data-eid="p3" data-free data-x="30" data-y="30">C</p></div></section>
<section data-eid="s2"><h2 data-eid="h1">Two</h2></section>
</div>
</div>
</body>
</html>`;

// Verbatim untouched-slide markup for byte-stability assertions.
const S2 = '<section data-eid="s2"><h2 data-eid="h1">Two</h2></section>';

/** All data-eids present in an HTML string, in document order. */
function eidsIn(html: string): string[] {
  return [...html.matchAll(/data-eid="([^"]+)"/g)].map((m) => m[1]);
}

// ─── 1-2: pure clone ─────────────────────────────────────────────────────────

describe('cloneSubtreeStripEids — pure', () => {
  function find(model: ReturnType<typeof parseDeck>, eid: string): ElementNode {
    let out: ElementNode | null = null;
    walk(model, (n) => {
      if (!out && n.type === 'element' && getAttribute(n, 'data-eid') === eid) out = n;
    });
    if (!out) throw new Error(`eid ${eid} not found`);
    return out;
  }

  it('strips data-eid deeply but keeps data-id and other attributes', () => {
    const model = parseDeck(DECK);
    const lay = find(model, 'lay1');
    const clone = cloneSubtreeStripEids(lay) as ElementNode;

    // No data-eid anywhere in the clone subtree.
    const eids: string[] = [];
    const collect = (n: ElementNode) => {
      if (getAttribute(n, 'data-eid') !== null) eids.push(getAttribute(n, 'data-eid')!);
      for (const c of n.children) if (c.type === 'element') collect(c);
    };
    collect(clone);
    expect(eids).toEqual([]);

    // data-id + other attrs preserved (first child <p> carried data-id="k").
    const firstP = clone.children.find((c) => c.type === 'element') as ElementNode;
    expect(getAttribute(firstP, 'data-id')).toBe('k');
    expect(getAttribute(firstP, 'data-free')).toBe('');
    expect(getAttribute(clone, 'data-lay')).toBe('layers');
  });

  it('is an independent copy (mutating the clone never touches the original)', () => {
    const model = parseDeck(DECK);
    const original = find(model, 'p1');
    const clone = cloneSubtreeStripEids(original) as ElementNode;

    // Mutate the clone's attributes + children array.
    clone.attributes.push({ name: 'data-x', value: '999' });
    clone.children = [];

    // Original is untouched.
    expect(getAttribute(original, 'data-x')).toBe('10');
    expect(original.children.length).toBeGreaterThan(0);
  });
});

// ─── 3-8: integrated deckStore element ops ───────────────────────────────────

describe('deckStore — duplicate / z-order / clipboard (P13-5/6/7)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function makeFetch(initialHtml: string) {
    const disk = { html: initialHtml };
    const mockFetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
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

  async function freshStore() {
    const { mockFetch, disk } = makeFetch(DECK);
    vi.stubGlobal('fetch', mockFetch);
    const { deckStore } = await import('./deck.svelte');
    const { selectionStore } = await import('$lib/canvas/selection.svelte');
    await deckStore.load('test-deck');
    // Fully-stamped fixture → no auto-save churn on load.
    expect(disk.html).toBe(DECK);
    mockFetch.mockClear();
    return { store: deckStore, selectionStore, disk };
  }

  it('duplicateElement inserts a fresh-eid copy after the original, byte-stable', async () => {
    const { store, selectionStore, disk } = await freshStore();

    const newEid = await store.duplicateElement('p1');
    expect(newEid).not.toBeNull();
    expect(newEid).not.toBe('p1');

    const eids = eidsIn(disk.html);
    // Fresh eid is unique (appears exactly once).
    expect(eids.filter((e) => e === newEid)).toHaveLength(1);
    // Clone lands immediately after p1.
    expect(eids.indexOf(newEid!)).toBe(eids.indexOf('p1') + 1);
    // Selection moved to the clone.
    expect(selectionStore.eid).toBe(newEid);
    // Untouched slide round-trips verbatim (spec principles-and-invariants #4).
    expect(disk.html).toContain(S2);
  });

  it('duplicateElement refuses a <section>', async () => {
    const { store, disk } = await freshStore();
    const before = disk.html;
    const res = await store.duplicateElement('s2');
    expect(res).toBeNull();
    expect(disk.html).toBe(before); // no save
  });

  it('bringToFront / sendToBack reorder a free element among siblings', async () => {
    const { store, disk } = await freshStore();

    await store.bringToFront('p1');
    let order = eidsIn(disk.html).filter((e) => ['p1', 'p2', 'p3'].includes(e));
    expect(order).toEqual(['p2', 'p3', 'p1']);

    await store.sendToBack('p1');
    order = eidsIn(disk.html).filter((e) => ['p1', 'p2', 'p3'].includes(e));
    expect(order).toEqual(['p1', 'p2', 'p3']);

    // Untouched slide stays verbatim.
    expect(disk.html).toContain(S2);
  });

  it('bringToFront is a no-op when already at the front', async () => {
    const { store, disk } = await freshStore();
    const before = disk.html;
    const changed = await store.bringToFront('p3'); // already last
    expect(changed).toBe(false);
    expect(disk.html).toBe(before);
  });

  it('copy + paste clones across slides with a fresh eid; original untouched', async () => {
    const { store, disk } = await freshStore();

    // Copy the heading living in slide 2…
    expect(store.copyElements(['h1'])).toBe(true);
    // …and paste it after p1 in slide 1 (across slides).
    const newEid = await store.pasteClipboard('p1');
    expect(newEid).not.toBeNull();
    expect(newEid).not.toBe('h1');

    const eids = eidsIn(disk.html);
    // New eid is unique and the original h1 still exists in slide 2.
    expect(eids.filter((e) => e === newEid)).toHaveLength(1);
    expect(eids).toContain('h1');
    // Clone landed after p1 (in slide 1).
    expect(eids.indexOf(newEid!)).toBe(eids.indexOf('p1') + 1);
    // The original heading markup in slide 2 is byte-stable.
    expect(disk.html).toContain(S2);
    // The pasted clone carries the copied heading's text.
    expect(disk.html).toContain('>Two</h2>');
  });

  it('cut removes the original then pastes it elsewhere', async () => {
    const { store, disk } = await freshStore();

    expect(await store.cutElements(['p2'])).toBe(true);
    // Original p2 is gone from the document.
    expect(eidsIn(disk.html)).not.toContain('p2');

    const newEid = await store.pasteClipboard('h1'); // paste after the heading in slide 2
    expect(newEid).not.toBeNull();
    const eids = eidsIn(disk.html);
    expect(eids.indexOf(newEid!)).toBe(eids.indexOf('h1') + 1);
    // The pasted clone carries p2's text "B".
    expect(disk.html).toContain('>B</p>');
  });

  it('paste into a container target lands as its last child', async () => {
    const { store, disk } = await freshStore();

    expect(store.copyElements(['h1'])).toBe(true);
    const newEid = await store.pasteClipboard('lay1'); // lay1 is a layers container
    expect(newEid).not.toBeNull();

    const eids = eidsIn(disk.html);
    // Clone is the LAST eid inside lay1 → after p3 and before slide 2's section.
    expect(eids.indexOf(newEid!)).toBe(eids.indexOf('p3') + 1);
    expect(eids.indexOf(newEid!)).toBeLessThan(eids.indexOf('s2'));
  });

  it('pasteClipboard is a no-op when the buffer is empty', async () => {
    const { store, disk } = await freshStore();
    const before = disk.html;
    const res = await store.pasteClipboard('p1');
    expect(res).toBeNull();
    expect(disk.html).toBe(before);
  });
});
