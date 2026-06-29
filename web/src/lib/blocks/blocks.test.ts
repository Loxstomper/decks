/**
 * blocks.test.ts — Pure block-builder tests (P5-2/11/12/13).
 *
 * Coverage per builder:
 *  • correct markup (tags / attributes / structure),
 *  • valid model (classify lands in the expected class; nodes are dirty so they
 *    render canonically),
 *  • byte-stable round-trip: serialize(build()) re-parses and re-serializes to
 *    the SAME bytes (spec 12 #4 — inserted content round-trips like authored).
 *
 * Plus the registry contract (registration / idempotency / grouping) and the
 * insert-target resolver.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck } from '$lib/model';
import { classify } from '$lib/model/classify';
import type { ElementNode, SlideNode } from '$lib/model/types';

import { buildHeading, buildParagraph, buildList } from './text';
import { buildTable } from './table';
import { buildShape } from './shape';
import { buildEmbed } from './embed';
import {
  registerBlock,
  getInsertRegistry,
  getInsertRegistryByGroup,
  getBlockDef,
  clearRegistry,
} from './registry';
import { resolveInsertTarget } from './target';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Serialize a single built node (the builders return a model subtree). */
function render(node: SlideNode): string {
  return serializeDeck({ nodes: [node] });
}

/** Assert a built node round-trips byte-stably through parse → serialize. */
function expectRoundTrip(node: SlideNode): string {
  const once = render(node);
  const reparsed = parseDeck(once);
  const twice = serializeDeck(reparsed);
  expect(twice).toBe(once);
  return once;
}

/** Count elements by tag name in a subtree. */
function countTag(node: SlideNode, tag: string): number {
  let n = 0;
  const visit = (x: SlideNode): void => {
    if (x.type !== 'element') return;
    if (x.tagName.toLowerCase() === tag) n++;
    for (const c of x.children) visit(c);
  };
  visit(node);
  return n;
}

// ─── Text (P5-2) ──────────────────────────────────────────────────────────────

describe('text builders', () => {
  it('buildHeading: <h2> leaf with text, byte-stable round-trip', () => {
    const h = buildHeading('Hello');
    expect(h.tagName).toBe('h2');
    expect(classify(h)).toBe('leaf');
    expect(h.dirty).toBe(true);
    expect(expectRoundTrip(h)).toBe('<h2>Hello</h2>');
  });

  it('buildHeading: honours level', () => {
    expect(render(buildHeading('Title', 1))).toBe('<h1>Title</h1>');
    expect(render(buildHeading('Sub', 3))).toBe('<h3>Sub</h3>');
  });

  it('buildHeading: escapes special characters in text', () => {
    expect(render(buildHeading('A < B & C'))).toBe('<h2>A &lt; B &amp; C</h2>');
  });

  it('buildParagraph: <p> leaf', () => {
    const p = buildParagraph('Body');
    expect(p.tagName).toBe('p');
    expect(classify(p)).toBe('leaf');
    expect(expectRoundTrip(p)).toBe('<p>Body</p>');
  });

  it('buildList: bullet list with three items', () => {
    const ul = buildList();
    expect(ul.tagName).toBe('ul');
    expect(classify(ul)).toBe('leaf');
    expect(countTag(ul, 'li')).toBe(3);
    expectRoundTrip(ul);
  });

  it('buildList: ordered list uses <ol>', () => {
    const ol = buildList(['a', 'b'], true);
    expect(ol.tagName).toBe('ol');
    expect(render(ol)).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('buildList: always emits at least one item', () => {
    expect(countTag(buildList([]), 'li')).toBe(1);
  });
});

// ─── Table (P5-11) ────────────────────────────────────────────────────────────

describe('buildTable', () => {
  it('default: header + 2 body rows × 3 cols, valid leaf', () => {
    const t = buildTable();
    expect(t.tagName).toBe('table');
    expect(classify(t)).toBe('leaf');
    expect(countTag(t, 'thead')).toBe(1);
    expect(countTag(t, 'tbody')).toBe(1);
    expect(countTag(t, 'th')).toBe(3); // header cols
    expect(countTag(t, 'tr')).toBe(3); // 1 header + 2 body
    expect(countTag(t, 'td')).toBe(6); // 2 rows × 3 cols
    expectRoundTrip(t);
  });

  it('honours rows/cols and header:false', () => {
    const t = buildTable({ rows: 3, cols: 2, header: false });
    expect(countTag(t, 'thead')).toBe(0);
    expect(countTag(t, 'tr')).toBe(3);
    expect(countTag(t, 'td')).toBe(6);
  });

  it('clamps absurd / NaN sizes to a sane range', () => {
    const big = buildTable({ rows: 9999, cols: 0 });
    expect(countTag(big, 'tr')).toBeLessThanOrEqual(21); // header + ≤20 body
    expect(countTag(big, 'th')).toBe(1); // cols clamped up to ≥1
    const nan = buildTable({ rows: Number.NaN, cols: Number.NaN });
    expect(countTag(nan, 'td')).toBe(2 * 3); // falls back to defaults
  });
});

// ─── Shapes (P5-12) ───────────────────────────────────────────────────────────

describe('buildShape', () => {
  it('rect: free <svg> with default geometry, round-trips', () => {
    const s = buildShape('rect');
    expect(s.tagName).toBe('svg');
    // Free escape-hatch → classify === 'free' so Phase-4 resize applies.
    expect(classify(s)).toBe('free');
    expect(countTag(s, 'rect')).toBe(1);
    const out = expectRoundTrip(s);
    expect(out).toContain('data-free');
    expect(out).toContain('data-w="400"');
    expect(out).toContain('preserveAspectRatio="none"');
  });

  it('ellipse / line render their primitive', () => {
    expect(countTag(buildShape('ellipse'), 'ellipse')).toBe(1);
    expect(countTag(buildShape('line'), 'line')).toBe(1);
  });

  it('arrow: a line plus a polygon arrowhead', () => {
    const a = buildShape('arrow');
    expect(countTag(a, 'line')).toBe(1);
    expect(countTag(a, 'polygon')).toBe(1);
    expectRoundTrip(a);
  });

  it('linear shapes get a wide-and-short default box', () => {
    const out = render(buildShape('line'));
    expect(out).toContain('data-w="400"');
    expect(out).toContain('data-h="100"');
  });
});

// ─── Embed (P5-13) ────────────────────────────────────────────────────────────

describe('buildEmbed', () => {
  it('builds a free <iframe> with the given src, round-trips', () => {
    const e = buildEmbed('https://example.com/embed');
    expect(e.tagName).toBe('iframe');
    expect(classify(e)).toBe('free');
    const out = expectRoundTrip(e);
    expect(out).toContain('src="https://example.com/embed"');
    expect(out).toContain('allowfullscreen');
    expect(out).toContain('data-free');
  });

  it('empty url falls back to about:blank (still valid)', () => {
    expect(render(buildEmbed('')).includes('src="about:blank"')).toBe(true);
    expect(render(buildEmbed(undefined)).includes('src="about:blank"')).toBe(true);
  });

  it('encodes a url with special characters safely', () => {
    const out = render(buildEmbed('https://x.com/?a=1&b=2'));
    // & is entity-encoded in the attribute value; reparse must survive.
    expect(out).toContain('&amp;');
    expectRoundTrip(buildEmbed('https://x.com/?a=1&b=2'));
  });
});

// ─── Registry contract (P5-1) ─────────────────────────────────────────────────

describe('registry', () => {
  it('register + lookup + idempotent replace by id', () => {
    clearRegistry();
    const def = {
      id: 'x-test',
      label: 'Test',
      group: 'G',
      icon: 'M0 0h1',
      build: () => buildParagraph('t'),
    };
    registerBlock(def);
    expect(getInsertRegistry()).toHaveLength(1);
    expect(getBlockDef('x-test')?.label).toBe('Test');

    // Re-registering the same id REPLACES, never duplicates.
    registerBlock({ ...def, label: 'Test2' });
    expect(getInsertRegistry()).toHaveLength(1);
    expect(getBlockDef('x-test')?.label).toBe('Test2');
  });

  it('groups in first-seen order, blocks in registration order', () => {
    clearRegistry();
    registerBlock({ id: 'a', label: 'A', group: 'One', icon: '', build: () => buildParagraph() });
    registerBlock({ id: 'b', label: 'B', group: 'Two', icon: '', build: () => buildParagraph() });
    registerBlock({ id: 'c', label: 'C', group: 'One', icon: '', build: () => buildParagraph() });
    const grouped = getInsertRegistryByGroup();
    expect(grouped.map((g) => g.group)).toEqual(['One', 'Two']);
    expect(grouped[0].blocks.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('default registrations are present after importing the barrel', async () => {
    clearRegistry();
    // Importing the barrel runs `./defaults` registration side-effects.
    await import('./index');
    const ids = getInsertRegistry().map((d) => d.id);
    expect(ids).toContain('text-heading');
    expect(ids).toContain('table');
    expect(ids).toContain('shape-rect');
    expect(ids).toContain('embed-iframe');
  });
});

// ─── Insert-target resolution (P5-1) ──────────────────────────────────────────

describe('resolveInsertTarget', () => {
  // A slide with a stack container holding a heading and paragraph.
  const HTML = `<div class="reveal"><div class="slides"><section data-eid="s1">
    <div data-lay="stack" data-eid="c1">
      <h2 data-eid="h1">Title</h2>
      <p data-eid="p1">Body</p>
    </div>
  </section></div></div>`;

  function model() {
    return parseDeck(HTML);
  }

  it('flow + container selected → insert INTO it', () => {
    const t = resolveInsertTarget(model(), 'c1', 'flow');
    expect(t).toEqual({ mode: 'into', parentEid: 'c1' });
  });

  it('flow + leaf selected → insert AFTER it', () => {
    const t = resolveInsertTarget(model(), 'h1', 'flow');
    expect(t).toEqual({ mode: 'after', eid: 'h1' });
  });

  it('flow + nothing selected → insert into the slide section', () => {
    const t = resolveInsertTarget(model(), null, 'flow');
    expect(t).toEqual({ mode: 'into', parentEid: 's1' });
  });

  it('free placement always targets the slide section', () => {
    expect(resolveInsertTarget(model(), 'h1', 'free')).toEqual({ mode: 'into', parentEid: 's1' });
    expect(resolveInsertTarget(model(), 'c1', 'free')).toEqual({ mode: 'into', parentEid: 's1' });
    expect(resolveInsertTarget(model(), null, 'free')).toEqual({ mode: 'into', parentEid: 's1' });
  });

  it('returns null when there is no slide section to host the block', () => {
    const m = parseDeck('<p data-eid="p1">orphan</p>');
    expect(resolveInsertTarget(m, null, 'free')).toBeNull();
  });
});

// ─── End-to-end: builder → stamp → insert subtree is internally consistent ────

describe('built subtree is insert-ready', () => {
  it('every builder returns a dirty root so the serializer renders it canonically', () => {
    const nodes: ElementNode[] = [
      buildHeading('h'),
      buildParagraph('p'),
      buildList(),
      buildTable(),
      buildShape('rect'),
      buildEmbed('https://e'),
    ];
    for (const n of nodes) expect(n.dirty).toBe(true);
  });
});
