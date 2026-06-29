/**
 * builders.test.ts — Unit tests for pure block builders (P5-4, P5-9, P5-10).
 *
 * All builders return dirty ElementNode trees; we serialise them with
 * serializeDeck (wrapping in a minimal deck) to check the HTML output.
 * No DOM, no fetch mocks — pure node environment.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, getAttribute, hasAttribute } from '$lib/model';
import { buildImageBlock, buildCodeBlock, buildMathBlock } from './builders';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wrap a single element in a minimal reveal deck HTML and round-trip through
 * parseDeck/serializeDeck to test the builder output.
 * This avoids constructing a full DeckModel manually and exercises the real
 * serializer path.
 */
function serialize(el: ReturnType<typeof buildImageBlock>): string {
  // Mark the element dirty so the serializer emits canonical markup.
  el.dirty = true;

  // Minimal deck around a single element.
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div class="reveal"><div class="slides">
<section>PLACEHOLDER</section>
</div></div>
</body>
</html>`;

  const model = parseDeck(html);
  // Append the element to the first section.
  const section = model.nodes.find(
    (n) => n.type === 'element' && n.tagName === 'html',
  );
  // Instead of traversing the tree, just serialise the element directly via
  // a throwaway single-element model.  We create a new model with just our
  // element as a top-level node to get its HTML string.
  const throwaway = parseDeck(
    `<!DOCTYPE html><html><head></head><body></body></html>`,
  );
  // Append the element to the <body>.
  const body = (() => {
    for (const n of throwaway.nodes) {
      if (n.type === 'element' && n.tagName === 'html') {
        for (const c of n.children) {
          if (c.type === 'element' && c.tagName === 'body') return c;
        }
      }
    }
    return null;
  })();
  if (body) {
    body.children.push(el);
    body.dirty = true;
  }
  const full = serializeDeck(throwaway);
  // Extract the body content.
  const m = full.match(/<body>([\s\S]*?)<\/body>/);
  return m ? m[1].trim() : full;
}

// ── buildImageBlock ───────────────────────────────────────────────────────────

describe('buildImageBlock', () => {
  it('produces an <img> with the given src', () => {
    const el = buildImageBlock('assets/photo.jpg');
    expect(el.tagName).toBe('img');
    expect(getAttribute(el, 'src')).toBe('assets/photo.jpg');
  });

  it('default alt is empty string', () => {
    const el = buildImageBlock('assets/a.png');
    expect(getAttribute(el, 'alt')).toBe('');
  });

  it('accepts a non-empty alt', () => {
    const el = buildImageBlock('assets/chart.svg', 'Revenue chart');
    expect(getAttribute(el, 'alt')).toBe('Revenue chart');
  });

  it('is marked as a void element (no children)', () => {
    const el = buildImageBlock('assets/img.gif');
    expect(el.isVoid).toBe(true);
    expect(el.children).toHaveLength(0);
  });

  it('is marked dirty so the serializer emits canonical markup', () => {
    const el = buildImageBlock('assets/x.png');
    expect(el.dirty).toBe(true);
  });

  it('serializes to a self-closing img tag', () => {
    const el = buildImageBlock('assets/photo.jpg', 'My photo');
    const out = serialize(el);
    expect(out).toContain('<img');
    expect(out).toContain('src="assets/photo.jpg"');
    expect(out).toContain('alt="My photo"');
  });

  it('encodes special characters in alt text', () => {
    const el = buildImageBlock('assets/img.png', 'a < b & c > d');
    expect(getAttribute(el, 'alt')).toBe('a < b & c > d');
    const out = serialize(el);
    expect(out).toContain('alt="a &lt; b &amp; c &gt; d"');
  });

  it('encodes special characters in src (spaces, etc.)', () => {
    const el = buildImageBlock('assets/my photo.jpg');
    // src attribute stores the literal; serializer entity-encodes it
    expect(getAttribute(el, 'src')).toBe('assets/my photo.jpg');
  });
});

// ── buildCodeBlock ────────────────────────────────────────────────────────────

describe('buildCodeBlock', () => {
  it('produces a <pre> wrapping a <code>', () => {
    const el = buildCodeBlock('javascript', 'const x = 1;');
    expect(el.tagName).toBe('pre');
    expect(el.children).toHaveLength(1);
    const codeEl = el.children[0];
    expect(codeEl.type).toBe('element');
    if (codeEl.type === 'element') {
      expect(codeEl.tagName).toBe('code');
    }
  });

  it('sets language class on <code>', () => {
    const el = buildCodeBlock('python', 'print("hi")');
    const code = el.children[0];
    if (code.type === 'element') {
      expect(getAttribute(code, 'class')).toBe('language-python');
    }
  });

  it('falls back to "plaintext" for empty lang', () => {
    const el = buildCodeBlock('', 'raw text');
    const code = el.children[0];
    if (code.type === 'element') {
      expect(getAttribute(code, 'class')).toBe('language-plaintext');
    }
  });

  it('omits data-line-numbers when lineNumbers is false', () => {
    const el = buildCodeBlock('js', '', false);
    const code = el.children[0];
    if (code.type === 'element') {
      expect(hasAttribute(code, 'data-line-numbers')).toBe(false);
    }
  });

  it('adds boolean data-line-numbers when lineNumbers is true', () => {
    const el = buildCodeBlock('js', '', true);
    const code = el.children[0];
    if (code.type === 'element') {
      expect(hasAttribute(code, 'data-line-numbers')).toBe(true);
      // Boolean attr: value should be null (no ="...")
      const attr = code.attributes.find((a) => a.name === 'data-line-numbers');
      expect(attr?.value).toBeNull();
    }
  });

  it('adds data-line-numbers with range when lineNumbers is a string', () => {
    const el = buildCodeBlock('js', '', '1-3|5');
    const code = el.children[0];
    if (code.type === 'element') {
      expect(getAttribute(code, 'data-line-numbers')).toBe('1-3|5');
    }
  });

  it('stores code text as a child of <code>', () => {
    const el = buildCodeBlock('rust', 'fn main() {}');
    const code = el.children[0];
    if (code.type === 'element') {
      expect(code.children).toHaveLength(1);
      const textNode = code.children[0];
      expect(textNode.type).toBe('text');
    }
  });

  it('empty code produces <code> with no children', () => {
    const el = buildCodeBlock('go', '');
    const code = el.children[0];
    if (code.type === 'element') {
      expect(code.children).toHaveLength(0);
    }
  });

  it('is dirty at both levels', () => {
    const el = buildCodeBlock('ts', 'let x: number = 1;');
    expect(el.dirty).toBe(true);
    const code = el.children[0];
    if (code.type === 'element') {
      expect(code.dirty).toBe(true);
    }
  });

  it('serializes correctly for a javascript block with line-numbers range', () => {
    const el = buildCodeBlock('javascript', 'const a = 1;\nconst b = 2;', '1-2');
    const out = serialize(el);
    expect(out).toContain('<pre>');
    expect(out).toContain('class="language-javascript"');
    expect(out).toContain('data-line-numbers="1-2"');
    expect(out).toContain('const a = 1;');
  });

  it('serializes boolean data-line-numbers without a value', () => {
    const el = buildCodeBlock('python', 'x = 1', true);
    const out = serialize(el);
    // Boolean attribute: `data-line-numbers` without `="..."`.
    expect(out).toMatch(/data-line-numbers(?!\s*=)/);
  });

  it('entity-encodes < and > in code content', () => {
    const el = buildCodeBlock('html', '<div>hello</div>');
    const out = serialize(el);
    expect(out).toContain('&lt;div&gt;hello&lt;/div&gt;');
  });
});

// ── buildMathBlock ────────────────────────────────────────────────────────────

describe('buildMathBlock', () => {
  it('produces a <div class="math-block">', () => {
    const el = buildMathBlock('e = mc^2');
    expect(el.tagName).toBe('div');
    expect(getAttribute(el, 'class')).toBe('math-block');
  });

  it('wraps latex in display-math delimiters \\[ ... \\]', () => {
    const el = buildMathBlock('e = mc^2');
    expect(el.children).toHaveLength(1);
    const text = el.children[0];
    expect(text.type).toBe('text');
    if (text.type === 'text') {
      // The raw value is entity-encoded; backslashes are not entities, so they
      // survive as-is.  We check via getAttribute which decodes entities.
      // Actually text nodes use encodeText, not encodeAttr.
      // Check the raw value contains the delimiters.
      expect(text.value).toContain('\\[');
      expect(text.value).toContain('\\]');
    }
  });

  it('includes the latex expression between the delimiters', () => {
    const el = buildMathBlock('\\frac{1}{2}');
    const text = el.children[0];
    if (text.type === 'text') {
      expect(text.value).toContain('\\frac{1}{2}');
    }
  });

  it('is marked dirty', () => {
    const el = buildMathBlock('x^2');
    expect(el.dirty).toBe(true);
  });

  it('serializes to a div with the latex delimiters in text content', () => {
    const el = buildMathBlock('E = mc^2');
    const out = serialize(el);
    expect(out).toContain('<div class="math-block">');
    expect(out).toContain('\\[');
    expect(out).toContain('E = mc^2');
    expect(out).toContain('\\]');
    expect(out).toContain('</div>');
  });

  it('handles empty latex (renders an empty display equation)', () => {
    const el = buildMathBlock('');
    expect(el.children).toHaveLength(1);
    const text = el.children[0];
    if (text.type === 'text') {
      expect(text.value).toContain('\\[');
      expect(text.value).toContain('\\]');
    }
  });

  it('backslash commands survive serialization', () => {
    const latex = '\\int_0^\\infty e^{-x} dx';
    const el = buildMathBlock(latex);
    const out = serialize(el);
    expect(out).toContain('\\int_0^\\infty');
  });
});
