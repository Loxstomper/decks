/**
 * model.test.ts — Golden round-trip + serializer determinism (P1-6, spec 12).
 *
 * These tests are LOAD-BEARING: they pin the idempotent round-trip / never-
 * destroy-the-unknown invariant (spec principle #4). The editor and Claude Code
 * both write `deck.html`; if a load/save cycle were not byte-stable they would
 * churn each other's files on every turn.
 *
 * Pure-string parser, so the default `node` vitest environment is sufficient
 * (no DOM / jsdom / happy-dom needed) — see types.ts for why we do NOT rely on
 * `DOMParser` re-serialization here.
 *
 * Coverage:
 *  1. Byte-stable round trip across the whole golden corpus (no edits).
 *  2. Idempotency: parse(serialize(parse(x))) serialize === serialize(parse(x)).
 *  3. Serializer determinism: repeated serialize identical.
 *  4. Canonical attribute order is independent of input order.
 *  5. Edge-case preservation: comments, entities, CDATA, raw <script>, unknown
 *     custom elements, mixed self-closing forms.
 *  6. Scoped edits: only the changed subtree reformats; siblings stay verbatim.
 *  7. Editing API: get/set/removeAttribute, entity round-trip, findByEid,
 *     getSlides, createElement/appendChild.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseDeck,
  serializeDeck,
  getAttribute,
  setAttribute,
  removeAttribute,
  hasAttribute,
  findByEid,
  getSlides,
  getElementsByTagName,
  createElement,
  createText,
  appendChild,
} from './index';

const FIXTURES = [
  'minimal.html',
  'multi-slide.html',
  'kitchen-sink.html',
  // P17-5: inline marks (strong/em/u/s/a[href,target,rel]/span[style]/br, nested)
  // inside <p>/<li>/<h1> — pins that allowlisted inline content round-trips
  // byte-identically via passthrough (it is preserved verbatim, never destroyed).
  'inline-marks.html',
] as const;

function loadFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
}

describe('golden round-trip (spec 12 — idempotent, never-destroy)', () => {
  for (const name of FIXTURES) {
    it(`${name}: serialize(parse(html)) is byte-identical with no edits`, () => {
      const html = loadFixture(name);
      const out = serializeDeck(parseDeck(html));
      expect(out).toBe(html);
    });

    it(`${name}: round trip is idempotent (parse∘serialize is a fixed point)`, () => {
      const html = loadFixture(name);
      const once = serializeDeck(parseDeck(html));
      const twice = serializeDeck(parseDeck(once));
      expect(twice).toBe(once);
      expect(twice).toBe(html);
    });

    it(`${name}: repeated serialize of the same model is identical (deterministic)`, () => {
      const model = parseDeck(loadFixture(name));
      expect(serializeDeck(model)).toBe(serializeDeck(model));
    });
  }
});

describe('edge-case preservation (never destroy the unknown)', () => {
  const html = loadFixture('kitchen-sink.html');

  it('preserves HTML comments verbatim, including fake tags inside them', () => {
    const out = serializeDeck(parseDeck(html));
    expect(out).toContain('<!-- Kitchen-sink deck:');
    expect(out).toContain('Comment with <fake tag> and an entity-ish &amp;');
  });

  it('does not re-encode existing entities', () => {
    const out = serializeDeck(parseDeck(html));
    expect(out).toContain('&lt;tag&gt; &amp; &quot;quotes&quot; &copy; 2026');
  });

  it('keeps raw <script>/<style> content unparsed and verbatim', () => {
    const out = serializeDeck(parseDeck(html));
    expect(out).toContain('"note": "raw <text> not parsed"');
    expect(out).toContain('content: "  spaces  &  ampersands ";');
  });

  it('preserves CDATA sections', () => {
    const out = serializeDeck(parseDeck(html));
    expect(out).toContain('<![CDATA[ arbitrary <markup> & data ]]>');
  });

  it('preserves unknown custom elements and their attributes', () => {
    const model = parseDeck(html);
    const widgets = getElementsByTagName(model, 'my-widget');
    expect(widgets).toHaveLength(1);
    expect(getAttribute(widgets[0], 'enabled')).toBe('');
    expect(getAttribute(widgets[0], 'data-config')).toBe('{"mode":"live","n":3}');
    expect(serializeDeck(model)).toContain(
      `<my-widget data-config='{"mode":"live","n":3}' enabled>`,
    );
  });

  it('preserves mixed self-closing and void-element forms', () => {
    const out = serializeDeck(parseDeck(html));
    expect(out).toContain('<br/> and unclosed-style <br> mix.');
  });

  it('preserves mixed attribute quote styles and boolean attributes when untouched', () => {
    const out = serializeDeck(parseDeck(html));
    expect(out).toContain(`<p data-x="1" data-y='2' data-flag>`);
  });
});

describe('serializer determinism — canonical attribute order', () => {
  it('is independent of input attribute order once an element is edited', () => {
    const a = parseDeck(`<root><el id="x" class="c" data-b="2" data-a="1" style="color:red" title="t" lang="en"></el></root>`);
    const b = parseDeck(`<root><el style="color:red" data-a="1" lang="en" data-b="2" class="c" title="t" id="x"></el></root>`);

    // Force canonical re-render of the edited element on each side.
    getElementsByTagName(a, 'el')[0].dirty = true;
    getElementsByTagName(b, 'el')[0].dirty = true;

    const sa = serializeDeck(a);
    const sb = serializeDeck(b);
    expect(sa).toBe(sb);
    // id, class, other(alpha), data-*(alpha grouped), style last.
    expect(sa).toContain(
      '<el id="x" class="c" lang="en" title="t" data-a="1" data-b="2" style="color:red"></el>',
    );
  });
});

describe('scoped edits — only the changed subtree reformats', () => {
  it('setAttribute encodes the literal, marks dirty, and leaves siblings verbatim', () => {
    const html = loadFixture('minimal.html');
    const model = parseDeck(html);
    const section = findByEid(model, 's1');
    expect(section).not.toBeNull();

    setAttribute(section!, 'class', 'fragment & more');
    expect(getAttribute(section!, 'class')).toBe('fragment & more');

    const out = serializeDeck(model);
    // The edited element is canonical (entity-encoded value, data-eid kept).
    expect(out).toContain('class="fragment &amp; more"');
    expect(out).toContain('data-eid="s1"');
    // Untouched parts are byte-identical to the original source.
    expect(out).toContain('<title>Minimal Deck</title>');
    expect(out).toContain('<script src="dist/reveal.js"></script>');
    expect(out).not.toBe(html);
  });

  it('removeAttribute drops the attribute and re-renders only that element', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    const s1 = findByEid(model, 's1');
    expect(hasAttribute(s1!, 'data-background-color')).toBe(true);
    removeAttribute(s1!, 'data-background-color');

    const out = serializeDeck(model);
    expect(out).not.toContain('data-background-color');
    // A different, untouched slide keeps its exact original bytes.
    expect(out).toContain('<section data-eid="s3" data-transition="zoom">');
  });

  it('re-serializing after an edit is still idempotent', () => {
    const model = parseDeck(loadFixture('minimal.html'));
    setAttribute(findByEid(model, 's1')!, 'data-x', '1');
    const once = serializeDeck(model);
    // Reloading the edited output and saving again must not churn.
    expect(serializeDeck(parseDeck(once))).toBe(once);
  });
});

describe('editing API', () => {
  it('getAttribute decodes entities; absent vs boolean are distinguished', () => {
    const model = parseDeck(loadFixture('kitchen-sink.html'));
    const h1 = getElementsByTagName(model, 'h1')[0];
    const p = getElementsByTagName(model, 'p')[0];
    expect(getAttribute(p, 'data-flag')).toBe(''); // boolean attr present
    expect(getAttribute(p, 'data-missing')).toBeNull(); // absent
    // Entity-bearing text is left in the model verbatim, decoded on read only.
    expect(h1.children.some((c) => c.type === 'text' && c.value.includes('&amp;'))).toBe(true);
  });

  it('finds every slide section (horizontal + vertical stacks)', () => {
    const model = parseDeck(loadFixture('multi-slide.html'));
    const slides = getSlides(model);
    // Direct children of .slides: s1, s2 (stack), s3 — not the nested s2a/s2b.
    expect(slides.map((s) => getAttribute(s, 'data-eid'))).toEqual(['s1', 's2', 's3']);
  });

  it('createElement + appendChild adds a new slide without disturbing existing ones', () => {
    const model = parseDeck(loadFixture('minimal.html'));
    const slidesDiv = getElementsByTagName(model, 'div').find(
      (d) => getAttribute(d, 'class') === 'slides',
    )!;
    const section = createElement('section', { 'data-eid': 's2' });
    const h2 = createElement('h2');
    h2.children.push(createText('New & shiny'));
    section.children.push(h2);
    appendChild(slidesDiv, section);

    const out = serializeDeck(model);
    expect(out).toContain('<section data-eid="s2">');
    expect(out).toContain('<h2>New &amp; shiny</h2>');
    // Original first slide remains byte-identical.
    expect(out).toContain('<section data-eid="s1">');
    expect(out).toContain('<h1>Hello, world</h1>');
    // And the whole thing still round-trips.
    expect(serializeDeck(parseDeck(out))).toBe(out);
  });
});
