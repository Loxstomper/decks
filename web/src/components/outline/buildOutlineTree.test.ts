/**
 * buildOutlineTree.test.ts — Unit tests for the outline tree mapping (P3-3).
 *
 * Tests the pure `buildOutlineTree` / `buildOutlineNode` functions against the
 * existing model fixtures.  No Svelte runtime, no DOM, no Vitest browser mode
 * required — these run in the default Node.js environment because all our
 * model code is pure string manipulation.
 *
 * Fixture loading mirrors the pattern used by classify.test.ts and model.test.ts.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseDeck, stampEids } from '$lib/model';
import { buildOutlineTree, buildOutlineNode, collectExpandableEids } from './buildOutlineTree';
import type { OutlineNode } from './buildOutlineTree';

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadFixture(name: string): string {
  return readFileSync(
    new URL('../../lib/model/__fixtures__/' + name, import.meta.url),
    'utf8',
  );
}

/** Parse + stamp a fixture so all managed elements have data-eids. */
function fixture(name: string) {
  const model = parseDeck(loadFixture(name));
  stampEids(model);
  return model;
}

/** Recursively collect all OutlineNodes in document order. */
function allNodes(nodes: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...allNodes(n.children));
  }
  return out;
}

/** Find the first node with the given eid. */
function findByEid(nodes: OutlineNode[], eid: string): OutlineNode | undefined {
  return allNodes(nodes).find((n) => n.eid === eid);
}

/** Find all nodes with a given klass. */
function byKlass(nodes: OutlineNode[], klass: string): OutlineNode[] {
  return allNodes(nodes).filter((n) => n.klass === klass);
}

// ─── buildOutlineTree — null / empty model ────────────────────────────────────

describe('buildOutlineTree() — null / empty input', () => {
  it('returns [] for null model (no deck open)', () => {
    expect(buildOutlineTree(null)).toEqual([]);
  });

  it('returns [] for a model with no .slides div (broken deck)', () => {
    const model = parseDeck('<html><body><p>no slides</p></body></html>');
    expect(buildOutlineTree(model)).toEqual([]);
  });
});

// ─── buildOutlineTree — minimal.html ─────────────────────────────────────────

describe('buildOutlineTree() — minimal.html', () => {
  it('returns exactly one top-level slide node', () => {
    const tree = buildOutlineTree(fixture('minimal.html'));
    expect(tree).toHaveLength(1);
  });

  it('top-level node is the section with eid "s1"', () => {
    const tree = buildOutlineTree(fixture('minimal.html'));
    const s1 = tree[0];
    expect(s1.eid).toBe('s1');
    expect(s1.tag).toBe('section');
    expect(s1.klass).toBe('container');
  });

  it('section children include the h1 and p', () => {
    const tree = buildOutlineTree(fixture('minimal.html'));
    const childTags = tree[0].children.map((c) => c.tag);
    expect(childTags).toContain('h1');
    expect(childTags).toContain('p');
  });

  it('h1 has klass=leaf and its label contains the text "Hello"', () => {
    const tree = buildOutlineTree(fixture('minimal.html'));
    const h1 = tree[0].children.find((c) => c.tag === 'h1');
    expect(h1).toBeDefined();
    expect(h1!.klass).toBe('leaf');
    expect(h1!.label).toContain('Hello');
  });

  it('h1 and p both have non-null eids after stamp', () => {
    const tree = buildOutlineTree(fixture('minimal.html'));
    for (const child of tree[0].children) {
      expect(child.eid).not.toBeNull();
    }
  });

  it('all nodes in the tree have non-empty labels', () => {
    const tree = buildOutlineTree(fixture('minimal.html'));
    for (const node of allNodes(tree)) {
      expect(node.label.trim().length).toBeGreaterThan(0);
    }
  });
});

// ─── buildOutlineTree — multi-slide.html ─────────────────────────────────────

describe('buildOutlineTree() — multi-slide.html', () => {
  it('returns 3 top-level slide nodes (s1, s2, s3)', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    expect(tree).toHaveLength(3);
    expect(tree.map((n) => n.eid)).toEqual(['s1', 's2', 's3']);
  });

  it('s2 is a container (vertical-stack wrapper) with children s2a, s2b', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    const s2 = tree[1];
    expect(s2.eid).toBe('s2');
    expect(s2.klass).toBe('container');
    const childEids = s2.children.map((c) => c.eid);
    expect(childEids).toContain('s2a');
    expect(childEids).toContain('s2b');
  });

  it('s2a contains an h2 (leaf) and a ul (leaf)', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    const s2a = tree[1].children.find((c) => c.eid === 's2a')!;
    expect(s2a).toBeDefined();
    const childTags = s2a.children.map((c) => c.tag);
    expect(childTags).toContain('h2');
    expect(childTags).toContain('ul');
  });

  it('all top-level nodes are sections (containers)', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    for (const node of tree) {
      expect(node.tag).toBe('section');
      expect(node.klass).toBe('container');
    }
  });

  it('all section nodes have non-null eids (already stamped in fixture)', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    for (const node of tree) {
      expect(node.eid).not.toBeNull();
    }
  });

  it('img node in s3 has klass=leaf and its label contains the alt text', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    const imgs = byKlass(tree, 'leaf').filter((n) => n.tag === 'img');
    expect(imgs.length).toBeGreaterThan(0);
    // The img in multi-slide has alt="A diagram"
    const imgNode = imgs[0];
    expect(imgNode.label).toContain('A diagram');
  });
});

// ─── buildOutlineTree — layout.html ──────────────────────────────────────────

describe('buildOutlineTree() — layout.html', () => {
  it('returns 1 top-level slide (the single section)', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    expect(tree).toHaveLength(1);
    expect(tree[0].tag).toBe('section');
  });

  it('the section contains container nodes (stack, row) and leaf nodes', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const childKlasses = tree[0].children.map((c) => c.klass);
    expect(childKlasses).toContain('container'); // data-lay="stack" and data-lay="row"
    expect(childKlasses).toContain('leaf');       // table, svg, iframe, etc.
  });

  it('stack container has the correct klass and label contains "(stack)"', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const containers = byKlass(tree, 'container').filter((n) => n.tag !== 'section');
    const stackNode = containers.find((n) => n.label.includes('(stack)'));
    expect(stackNode).toBeDefined();
    expect(stackNode!.klass).toBe('container');
  });

  it('row container has label containing "(row)"', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const rowNode = byKlass(tree, 'container').find((n) => n.label.includes('(row)'));
    expect(rowNode).toBeDefined();
  });

  it('free element is classified as "free" and label includes "@"', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const freeNodes = byKlass(tree, 'free');
    expect(freeNodes.length).toBeGreaterThan(0);
    // Free label includes position coordinates
    expect(freeNodes[0].label).toContain('@');
  });

  it('passthrough nodes (my-plugin, aside) are present with klass=passthrough', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const passthroughs = byKlass(tree, 'passthrough');
    expect(passthroughs.length).toBeGreaterThan(0);
    const tags = passthroughs.map((n) => n.tag);
    expect(tags).toContain('aside');
    expect(tags).toContain('my-plugin');
  });

  it('passthrough nodes have null eid (never stamped)', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const passthroughs = byKlass(tree, 'passthrough');
    for (const node of passthroughs) {
      expect(node.eid).toBeNull();
    }
  });

  it('managed nodes (container, leaf, free) have non-null eids', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const managed = allNodes(tree).filter((n) => n.klass !== 'passthrough');
    for (const node of managed) {
      expect(node.eid, `managed ${node.tag} should have eid`).not.toBeNull();
    }
  });

  it('table node is a leaf', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const tables = byKlass(tree, 'leaf').filter((n) => n.tag === 'table');
    expect(tables.length).toBeGreaterThan(0);
  });

  it('svg node is a leaf', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const svgs = byKlass(tree, 'leaf').filter((n) => n.tag === 'svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('iframe node is a leaf', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const iframes = byKlass(tree, 'leaf').filter((n) => n.tag === 'iframe');
    expect(iframes.length).toBeGreaterThan(0);
  });
});

// ─── buildOutlineTree — kitchen-sink.html ────────────────────────────────────

describe('buildOutlineTree() — kitchen-sink.html', () => {
  it('returns 3 top-level slide nodes', () => {
    const tree = buildOutlineTree(fixture('kitchen-sink.html'));
    // kitchen-sink has 3 sections: t1, t2, t3
    expect(tree).toHaveLength(3);
  });

  it('all top-level nodes are sections with non-null eids', () => {
    const tree = buildOutlineTree(fixture('kitchen-sink.html'));
    for (const node of tree) {
      expect(node.tag).toBe('section');
      expect(node.eid).not.toBeNull();
    }
  });

  it('section t1 children include passthrough aside (speaker notes)', () => {
    const tree = buildOutlineTree(fixture('kitchen-sink.html'));
    // t1 has an h1, p, and aside (notes)
    const t1 = findByEid(tree, 't1');
    expect(t1).toBeDefined();
    const asides = t1!.children.filter((c) => c.tag === 'aside');
    expect(asides.length).toBeGreaterThan(0);
    expect(asides[0].klass).toBe('passthrough');
  });

  it('every node has a non-empty label', () => {
    const tree = buildOutlineTree(fixture('kitchen-sink.html'));
    for (const node of allNodes(tree)) {
      expect(node.label.trim().length, `label empty for ${node.tag}`).toBeGreaterThan(0);
    }
  });
});

// ─── buildOutlineNode — label content ────────────────────────────────────────

describe('buildOutlineNode() — label correctness', () => {
  it('heading label contains its text snippet', () => {
    const model = parseDeck(`
      <div class="reveal"><div class="slides">
        <section data-eid="s1">
          <h2 data-eid="h1">Quarterly Results</h2>
        </section>
      </div></div>`);
    const tree = buildOutlineTree(model);
    const h2 = findByEid(tree, 'h1');
    expect(h2).toBeDefined();
    expect(h2!.label).toContain('Quarterly Results');
  });

  it('section with data-background-color surfaces the colour in the label', () => {
    const model = parseDeck(`
      <div class="reveal"><div class="slides">
        <section data-eid="s1" data-background-color="#1a1a1a">
          <h1 data-eid="h1">Title</h1>
        </section>
      </div></div>`);
    const tree = buildOutlineTree(model);
    expect(tree[0].label).toContain('#1a1a1a');
  });

  it('img label contains alt text', () => {
    const model = parseDeck(`
      <div class="reveal"><div class="slides">
        <section data-eid="s1">
          <img data-eid="img1" src="x.svg" alt="A diagram" />
        </section>
      </div></div>`);
    const tree = buildOutlineTree(model);
    const imgNode = findByEid(tree, 'img1');
    expect(imgNode).toBeDefined();
    expect(imgNode!.label).toContain('A diagram');
  });

  it('label text is truncated at ~50 chars with ellipsis', () => {
    const longText = 'A'.repeat(100);
    const model = parseDeck(`
      <div class="reveal"><div class="slides">
        <section data-eid="s1">
          <p data-eid="p1">${longText}</p>
        </section>
      </div></div>`);
    const tree = buildOutlineTree(model);
    const p = findByEid(tree, 'p1');
    expect(p).toBeDefined();
    expect(p!.label.length).toBeLessThan(80); // well under the raw 100 char text
    expect(p!.label).toContain('…');
  });

  it('passthrough label is just the tag name', () => {
    const model = parseDeck(`
      <div class="reveal"><div class="slides">
        <section data-eid="s1">
          <aside class="notes">Speaker notes</aside>
        </section>
      </div></div>`);
    const tree = buildOutlineTree(model);
    const aside = tree[0].children.find((c) => c.tag === 'aside');
    expect(aside).toBeDefined();
    expect(aside!.klass).toBe('passthrough');
    expect(aside!.label).toBe('aside');
  });

  it('free element label includes @ symbol with coordinates', () => {
    const model = parseDeck(`
      <div class="reveal"><div class="slides">
        <section data-eid="s1">
          <div data-eid="fr1" data-free data-x="100" data-y="200">text</div>
        </section>
      </div></div>`);
    const tree = buildOutlineTree(model);
    const fr = findByEid(tree, 'fr1');
    expect(fr).toBeDefined();
    expect(fr!.klass).toBe('free');
    expect(fr!.label).toContain('@');
    expect(fr!.label).toContain('100');
    expect(fr!.label).toContain('200');
  });
});

// ─── collectExpandableEids ────────────────────────────────────────────────────

describe('collectExpandableEids()', () => {
  it('returns eids of all nodes with children', () => {
    const tree = buildOutlineTree(fixture('multi-slide.html'));
    const expandable = collectExpandableEids(tree);
    // s1 (has children), s2 (has children s2a/s2b), s2a, s2b, s3 (has h2/img)
    // All sections have children; we at least expect s1, s2, s2a, s2b, s3.
    expect(expandable).toContain('s1');
    expect(expandable).toContain('s2');
    expect(expandable).toContain('s2a');
    expect(expandable).toContain('s2b');
    expect(expandable).toContain('s3');
  });

  it('excludes passthrough nodes (they have no eid)', () => {
    const tree = buildOutlineTree(fixture('layout.html'));
    const expandable = collectExpandableEids(tree);
    // All should be non-null strings (passthrough nodes have null eid → excluded)
    for (const eid of expandable) {
      expect(eid).not.toBeNull();
      expect(typeof eid).toBe('string');
    }
  });

  it('returns [] for an empty tree', () => {
    expect(collectExpandableEids([])).toEqual([]);
  });

  it('returns [] when no nodes have children', () => {
    const leafOnly: OutlineNode[] = [
      { eid: 'p1', tag: 'p', klass: 'leaf', label: 'p #p1: hello', children: [] },
    ];
    expect(collectExpandableEids(leafOnly)).toEqual([]);
  });
});
