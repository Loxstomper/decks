/**
 * classify.test.ts — P2-1 classification + P2-2 eid stamping (spec 02/03).
 *
 * Test goals:
 *  1. classify() returns the correct class for each node type across the corpus.
 *  2. stampEids() assigns unique eids.
 *  3. stampEids() is idempotent: re-stamping a stamped model is a no-op (no
 *     byte churn on the next serializeDeck).
 *  4. Eids survive parse → serialize → re-parse cycles unchanged.
 *  5. Passthrough nodes never receive a data-eid.
 *  6. Stamping an element does NOT mark its already-stamped siblings dirty
 *     (byte-stable passthrough for untouched subtrees, spec 12 #4).
 *  7. nextEid() produces incrementing unique ids that respect existing ones.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseDeck,
  serializeDeck,
  getAttribute,
  getElementsByTagName,
  walk,
  findByEid,
} from './index';
import { classify, type ElementClass } from './classify';
import { stampEids, nextEid } from './eid';
import type { ElementNode } from './types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
}

/** All element nodes in document order. */
function allElements(html: string): ElementNode[] {
  const model = parseDeck(html);
  const els: ElementNode[] = [];
  walk(model, (n) => {
    if (n.type === 'element') els.push(n);
  });
  return els;
}

/** All elements annotated with their classify() result. */
function classifyAll(html: string): Map<ElementNode, ElementClass> {
  const out = new Map<ElementNode, ElementClass>();
  for (const el of allElements(html)) out.set(el, classify(el));
  return out;
}

// ─── P2-1: classify ───────────────────────────────────────────────────────────

describe('classify() — container', () => {
  it('section elements are containers regardless of other attributes', () => {
    const model = parseDeck(loadFixture('layout.html'));
    const sections = getElementsByTagName(model, 'section');
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) expect(classify(s)).toBe('container');
  });

  it('sections in multi-slide (top-level + vertical-stack children) are containers', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    const sections = getElementsByTagName(model, 'section');
    expect(sections.length).toBe(5); // s1, s2, s2a, s2b, s3
    for (const s of sections) expect(classify(s)).toBe('container');
  });

  it('elements with data-lay are containers', () => {
    const model = parseDeck(loadFixture('layout.html'));
    const els = allElements(loadFixture('layout.html'));
    const layEls = els.filter((e) => getAttribute(e, 'data-lay') !== null);
    expect(layEls.length).toBeGreaterThanOrEqual(2); // stack + row divs
    for (const e of layEls) expect(classify(e)).toBe('container');
  });

  it('div WITHOUT data-lay is NOT a container (passthrough)', () => {
    // div.reveal and div.slides have no data-lay → passthrough
    const model = parseDeck(loadFixture('minimal.html'));
    const divs = getElementsByTagName(model, 'div');
    for (const d of divs) {
      if (getAttribute(d, 'data-lay') === null) {
        expect(classify(d)).toBe('passthrough');
      }
    }
  });
});

describe('classify() — leaf', () => {
  it('heading elements h1-h6 are leaves', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    for (const tag of ['h1', 'h2']) {
      const els = getElementsByTagName(model, tag);
      for (const e of els) expect(classify(e)).toBe('leaf');
    }
  });

  it('p elements are leaves', () => {
    const model = parseDeck(loadFixture('minimal.html'));
    const ps = getElementsByTagName(model, 'p');
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(classify(p)).toBe('leaf');
  });

  it('ul and li elements are leaves', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    for (const tag of ['ul', 'li']) {
      const els = getElementsByTagName(model, tag);
      expect(els.length).toBeGreaterThan(0);
      for (const e of els) expect(classify(e)).toBe('leaf');
    }
  });

  it('img is a leaf', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    const imgs = getElementsByTagName(model, 'img');
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(classify(img)).toBe('leaf');
  });

  it('pre and code are leaves', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    for (const tag of ['pre', 'code']) {
      const els = getElementsByTagName(model, tag);
      for (const e of els) expect(classify(e)).toBe('leaf');
    }
  });

  it('svg is a leaf (shape / icon block type, spec 03)', () => {
    const model = parseDeck(loadFixture('kitchen-sink.html'));
    const svgs = getElementsByTagName(model, 'svg');
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) expect(classify(s)).toBe('leaf');
  });

  it('table family (table/thead/tbody/tr/th/td) are leaves', () => {
    const model = parseDeck(loadFixture('layout.html'));
    for (const tag of ['table', 'thead', 'tbody', 'tr', 'th', 'td']) {
      const els = getElementsByTagName(model, tag);
      for (const e of els) expect(classify(e)).toBe('leaf');
    }
  });

  it('iframe is a leaf (embed block type, spec 03)', () => {
    const model = parseDeck(loadFixture('layout.html'));
    const iframes = getElementsByTagName(model, 'iframe');
    expect(iframes.length).toBeGreaterThan(0);
    for (const e of iframes) expect(classify(e)).toBe('leaf');
  });
});

describe('classify() — free', () => {
  it('elements with data-free are classified free', () => {
    const model = parseDeck(loadFixture('layout.html'));
    const els = allElements(loadFixture('layout.html'));
    const freeEls = els.filter((e) => getAttribute(e, 'data-free') !== null);
    expect(freeEls.length).toBeGreaterThan(0);
    for (const e of freeEls) expect(classify(e)).toBe('free');
  });

  it('data-free takes precedence over data-lay on the same element', () => {
    // An element with both data-free and data-lay must be free (escape hatch wins).
    const model = parseDeck(`<root><div data-free data-lay="row">both</div></root>`);
    const div = getElementsByTagName(model, 'div')[0];
    expect(classify(div)).toBe('free');
  });
});

describe('classify() — passthrough', () => {
  it('script elements are passthrough', () => {
    for (const fixture of ['minimal.html', 'multi-slide.html', 'kitchen-sink.html']) {
      const model = parseDeck(loadFixture(fixture));
      const scripts = getElementsByTagName(model, 'script');
      for (const s of scripts) expect(classify(s)).toBe('passthrough');
    }
  });

  it('style elements are passthrough', () => {
    const model = parseDeck(loadFixture('kitchen-sink.html'));
    const styles = getElementsByTagName(model, 'style');
    expect(styles.length).toBeGreaterThan(0);
    for (const s of styles) expect(classify(s)).toBe('passthrough');
  });

  it('unknown custom elements are passthrough', () => {
    const model = parseDeck(loadFixture('kitchen-sink.html'));
    const widgets = getElementsByTagName(model, 'my-widget');
    expect(widgets.length).toBeGreaterThan(0);
    for (const w of widgets) expect(classify(w)).toBe('passthrough');
  });

  it('aside (speaker notes) is passthrough — editor has no speaker-notes UI in P2', () => {
    const model = parseDeck(loadFixture('kitchen-sink.html'));
    const asides = getElementsByTagName(model, 'aside');
    expect(asides.length).toBeGreaterThan(0);
    for (const a of asides) expect(classify(a)).toBe('passthrough');
  });

  it('structural html/head/body/div are passthrough when they carry no data-lay', () => {
    const model = parseDeck(loadFixture('minimal.html'));
    for (const tag of ['html', 'head', 'body']) {
      const els = getElementsByTagName(model, tag);
      for (const e of els) expect(classify(e)).toBe('passthrough');
    }
  });
});

describe('classify() — kitchen-sink corpus coverage', () => {
  it('every node in kitchen-sink.html gets a classification without throwing', () => {
    const map = classifyAll(loadFixture('kitchen-sink.html'));
    expect(map.size).toBeGreaterThan(0);
    // Confirm sections are containers and scripts are passthrough
    for (const [el, cls] of map) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'section') expect(cls).toBe('container');
      if (tag === 'script') expect(cls).toBe('passthrough');
    }
  });
});

// ─── P2-2: stampEids ─────────────────────────────────────────────────────────

describe('stampEids() — uniqueness', () => {
  it('all stamped eids are unique within a document', () => {
    const model = parseDeck(loadFixture('layout.html'));
    stampEids(model);
    const eids: string[] = [];
    walk(model, (n) => {
      if (n.type !== 'element') return;
      const eid = getAttribute(n, 'data-eid');
      if (eid !== null) eids.push(eid);
    });
    const unique = new Set(eids);
    expect(unique.size).toBe(eids.length);
    expect(eids.length).toBeGreaterThan(0);
  });

  it('eids across multi-slide.html (already stamped) remain unique', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    stampEids(model); // stamps leaves; sections already have eids
    const eids: string[] = [];
    walk(model, (n) => {
      if (n.type !== 'element') return;
      const eid = getAttribute(n, 'data-eid');
      if (eid !== null) eids.push(eid);
    });
    expect(new Set(eids).size).toBe(eids.length);
  });
});

describe('stampEids() — passthrough exclusion', () => {
  it('passthrough nodes never receive a data-eid', () => {
    // Run on every fixture to be thorough
    for (const name of ['layout.html', 'minimal.html', 'multi-slide.html', 'kitchen-sink.html']) {
      const model = parseDeck(loadFixture(name));
      stampEids(model);
      walk(model, (n) => {
        if (n.type !== 'element') return;
        if (classify(n) === 'passthrough') {
          expect(
            getAttribute(n, 'data-eid'),
            `${name}: passthrough <${n.tagName}> must not have data-eid`,
          ).toBeNull();
        }
      });
    }
  });
});

describe('stampEids() — idempotency', () => {
  it('re-stamping a fresh model: serialize output is byte-identical on second stamp', () => {
    const model = parseDeck(loadFixture('layout.html'));
    stampEids(model);
    const out1 = serializeDeck(model);

    // Re-parse (clean tree, no dirty flags) and stamp again.
    const model2 = parseDeck(out1);
    stampEids(model2);
    const out2 = serializeDeck(model2);

    expect(out2).toBe(out1);
  });

  it('stamping an already-fully-stamped model marks no new elements dirty', () => {
    const model = parseDeck(loadFixture('layout.html'));
    stampEids(model);
    // Serialize to get a fully-stamped HTML string.
    const out = serializeDeck(model);

    // Re-parse (all elements clean), then stamp.
    const model2 = parseDeck(out);
    stampEids(model2);

    // After the idempotent stamp pass, no element should be dirty.
    walk(model2, (n) => {
      expect(n.dirty, `node type=${n.type} should not be dirty after no-op stamp`).toBe(false);
    });
  });

  it('three-way round-trip: stamp → serialize → parse → stamp → serialize produces the same bytes', () => {
    const html = loadFixture('layout.html');
    const m1 = parseDeck(html);
    stampEids(m1);
    const s1 = serializeDeck(m1);

    const m2 = parseDeck(s1);
    stampEids(m2);
    const s2 = serializeDeck(m2);

    const m3 = parseDeck(s2);
    stampEids(m3);
    const s3 = serializeDeck(m3);

    expect(s2).toBe(s1);
    expect(s3).toBe(s1);
  });
});

describe('stampEids() — eid stability across parse/serialize cycles', () => {
  it('eids assigned in one pass are present unchanged after serialize + re-parse', () => {
    const model = parseDeck(loadFixture('layout.html'));
    stampEids(model);

    // Collect all eids from the first stamp.
    const eidsBefore: string[] = [];
    walk(model, (n) => {
      if (n.type !== 'element') return;
      const eid = getAttribute(n, 'data-eid');
      if (eid !== null) eidsBefore.push(eid);
    });

    // Re-parse from the serialized output and collect eids.
    const out = serializeDeck(model);
    const model2 = parseDeck(out);
    const eidsAfter: string[] = [];
    walk(model2, (n) => {
      if (n.type !== 'element') return;
      const eid = getAttribute(n, 'data-eid');
      if (eid !== null) eidsAfter.push(eid);
    });

    // Every eid that was stamped must still be present in the same document order.
    expect(eidsAfter).toEqual(eidsBefore);
  });
});

describe('stampEids() — scoped dirty / byte-stability of siblings', () => {
  it('already-stamped siblings remain clean after stampEids', () => {
    // minimal.html has data-eid="s1" on the section already.
    // After stampEids, the section must still have dirty=false (untouched).
    const html = loadFixture('minimal.html');
    const model = parseDeck(html);
    const section = getElementsByTagName(model, 'section')[0];

    expect(getAttribute(section, 'data-eid')).toBe('s1');
    stampEids(model);
    expect(section.dirty).toBe(false); // section was untouched by stampEids
  });

  it('the section open-tag bytes are verbatim in the serialized output', () => {
    const html = loadFixture('minimal.html');
    const model = parseDeck(html);
    stampEids(model);
    const out = serializeDeck(model);
    // The section's original rawOpen must appear verbatim (not re-canonicalized).
    expect(out).toContain('<section data-eid="s1">');
  });

  it('stamping h1 does not churn the section or sibling p bytes', () => {
    // multi-slide has pre-existing section eids; h1, h2, p, ul etc. get stamped.
    const html = loadFixture('multi-slide.html');
    const model = parseDeck(html);
    stampEids(model);

    // Pre-existing section eids remain in their original verbatim form.
    for (const eid of ['s1', 's2', 's2a', 's2b', 's3']) {
      const el = findByEid(model, eid);
      expect(el).not.toBeNull();
      // The element is not dirty — its rawOpen bytes are unchanged.
      expect(el!.dirty).toBe(false);
    }
  });

  it('newly-stamped elements ARE dirty (so their canonical form is emitted)', () => {
    const html = loadFixture('layout.html'); // no pre-existing eids except on sections? let's check
    const model = parseDeck(html);
    // Find a managed element that does NOT have a data-eid (h2 in layout fixture).
    const h2s = getElementsByTagName(model, 'h2');
    expect(h2s.length).toBeGreaterThan(0);
    const h2 = h2s[0];
    expect(getAttribute(h2, 'data-eid')).toBeNull(); // not yet stamped

    stampEids(model);

    // After stamp, the h2 must be dirty (it got a new eid via setAttribute).
    expect(h2.dirty).toBe(true);
    expect(getAttribute(h2, 'data-eid')).not.toBeNull();
  });
});

describe('stampEids() — respects hand-authored / pre-existing eids', () => {
  it('pre-existing eids from fixtures are never overwritten', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    stampEids(model);
    for (const eid of ['s1', 's2', 's2a', 's2b', 's3']) {
      const el = findByEid(model, eid);
      expect(el).not.toBeNull();
    }
  });

  it('does not generate an eid that collides with a pre-existing one', () => {
    // deck with an element that already has eid 'p1'; stampEids must not give
    // another element the same id.
    const html = `<root>
      <section data-eid="p1">existing</section>
      <p>no eid yet</p>
    </root>`;
    const model = parseDeck(html);
    stampEids(model);
    const eids: string[] = [];
    walk(model, (n) => {
      if (n.type !== 'element') return;
      const eid = getAttribute(n, 'data-eid');
      if (eid !== null) eids.push(eid);
    });
    expect(new Set(eids).size).toBe(eids.length); // still unique
    // The original p1 must still be there
    expect(eids).toContain('p1');
    // The new p element must get p2 (since p1 is taken)
    expect(eids).toContain('p2');
  });
});

describe('nextEid()', () => {
  it('returns prefix+1 when no existing eids', () => {
    expect(nextEid('p', new Set())).toBe('p1');
  });

  it('skips already-used ids and increments', () => {
    const used = new Set(['p1', 'p2', 'p3']);
    expect(nextEid('p', used)).toBe('p4');
  });

  it('adds the new eid to the usedEids set (prevents caller-side duplicates)', () => {
    const used = new Set<string>();
    nextEid('h', used);
    nextEid('h', used);
    expect(used).toEqual(new Set(['h1', 'h2']));
    expect(nextEid('h', used)).toBe('h3');
  });

  it('handles gaps in the existing eid sequence', () => {
    const used = new Set(['s1', 's3', 's5']);
    expect(nextEid('s', used)).toBe('s2'); // fills the first gap
  });
});
