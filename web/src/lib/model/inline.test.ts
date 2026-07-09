/**
 * inline.test.ts — Inline serializer + sanitizer (P17-1 / P17-2).
 *
 * Pure-string, no DOM (node vitest env), like the rest of the model core.
 *
 * Coverage:
 *   1. Canonical allowlisted HTML is a fixed point (round-trip byte-stable).
 *   2. Hostile HTML → only the allowlist survives (script, on* handlers,
 *      javascript:/data: hrefs, external resource img/style — all stripped).
 *   3. Legacy mapping: <b>→<strong>, <i>→<em>, <font>→<span> (or unwrapped).
 *   4. Junk normalisation: <div>/<p>/unknown unwrap; &nbsp;→space; style soup
 *      filtered to color + font-size; empty span unwrapped.
 *   5. External <a href> NAVIGATION is allowed (only external RESOURCE loads are
 *      forbidden); javascript: hrefs are neutralised by unwrapping the anchor.
 *   6. isSafeHref guard.
 */

import { describe, it, expect } from 'vitest';
import { serializeInlineHtml, isSafeHref } from './inline';

describe('serializeInlineHtml — canonical round-trip (byte-stable fixed point)', () => {
  const CANONICAL = [
    'Plain ',
    '<strong>bold</strong> ',
    '<em>italic</em> ',
    '<u>under</u> ',
    '<s>strike</s> ',
    '<a href="https://example.com" rel="noopener" target="_blank">link</a> ',
    '<a href="#frag">jump</a> ',
    '<span style="color: red; font-size: 2em">styled</span>',
    '<br>',
    'tail &amp; end',
  ].join('');

  it('emits already-canonical allowlisted HTML unchanged', () => {
    expect(serializeInlineHtml(CANONICAL)).toBe(CANONICAL);
  });

  it('is idempotent (serialize∘serialize is a fixed point)', () => {
    const once = serializeInlineHtml(CANONICAL);
    expect(serializeInlineHtml(once)).toBe(once);
  });

  it('orders <a> attributes canonically (href, rel, target — alphabetical)', () => {
    expect(serializeInlineHtml('<a target="_blank" rel="x" href="https://a.com">L</a>')).toBe(
      '<a href="https://a.com" rel="x" target="_blank">L</a>',
    );
  });
});

describe('serializeInlineHtml — sanitization (security invariant, spec principles-and-invariants)', () => {
  it('drops <script> entirely, including its content', () => {
    expect(serializeInlineHtml('a<script>alert(1)</script>b')).toBe('ab');
  });

  it('strips on* handlers and class/id (allowlist attributes only)', () => {
    expect(serializeInlineHtml('<strong onclick="x()" class="c" id="i">hi</strong>')).toBe(
      '<strong>hi</strong>',
    );
  });

  it('neutralises a javascript: href by unwrapping the anchor (keeps text)', () => {
    expect(serializeInlineHtml('<a href="javascript:alert(1)">click</a>')).toBe('click');
  });

  it('neutralises a data: href by unwrapping the anchor', () => {
    expect(serializeInlineHtml('<a href="data:text/html,<x>">click</a>')).toBe('click');
  });

  it('strips external resource elements (<img>, <style>) but keeps text', () => {
    expect(serializeInlineHtml('before<img src="https://evil.com/x.png">after')).toBe(
      'beforeafter',
    );
    expect(serializeInlineHtml('x<style>body{color:red}</style>y')).toBe('xy');
  });
});

describe('serializeInlineHtml — normalisation (P17-1 / constraint #4)', () => {
  it('maps <b>→<strong> and <i>→<em>', () => {
    expect(serializeInlineHtml('<b>x</b> <i>y</i>')).toBe('<strong>x</strong> <em>y</em>');
  });

  it('maps <font> to a <span> (unwrapped when no allowed style)', () => {
    // <font color> is not a style attribute → no allowed style → span unwrapped.
    expect(serializeInlineHtml('<font color="red">x</font>')).toBe('x');
  });

  it('unwraps <div>/<p>/unknown wrappers, keeping inner content', () => {
    expect(serializeInlineHtml('<div>a<p>b</p><blink>c</blink></div>')).toBe('abc');
  });

  it('normalises the &nbsp; entity to its literal (NBSP) character', () => {
    // The entity is decoded to the literal non-breaking space (U+00A0) and is no
    // longer emitted as an entity — entity soup is collapsed to canonical text.
    expect(serializeInlineHtml('a&nbsp;b')).toBe('a\u00A0b');
  });

  it('keeps nested marks', () => {
    expect(serializeInlineHtml('<strong>a <em>b</em> c</strong>')).toBe(
      '<strong>a <em>b</em> c</strong>',
    );
  });

  it('filters span style to color + font-size, dropping the rest', () => {
    expect(
      serializeInlineHtml('<span style="color: red; background: blue; font-size: 1em">x</span>'),
    ).toBe('<span style="color: red; font-size: 1em">x</span>');
  });

  it('unwraps a span whose style has no allowed declarations', () => {
    expect(serializeInlineHtml('<span style="background: blue">x</span>')).toBe('x');
    expect(serializeInlineHtml('<span class="hl">x</span>')).toBe('x');
  });

  it('allows external <a href> navigation (only external RESOURCE loads are forbidden)', () => {
    expect(serializeInlineHtml('<a href="https://example.com">e</a>')).toBe(
      '<a href="https://example.com">e</a>',
    );
  });
});

describe('isSafeHref', () => {
  it('accepts relative, fragment, http(s), mailto, tel', () => {
    for (const h of [
      'page.html',
      '/abs/path',
      '#frag',
      'http://a.com',
      'https://a.com/x?y#z',
      'mailto:hi@a.com',
      'tel:+123',
      '//cdn.example.com/x', // protocol-relative navigation
    ]) {
      expect(isSafeHref(h), h).toBe(true);
    }
  });

  it('rejects script and data URLs and the empty string', () => {
    for (const h of ['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', '', '   ']) {
      expect(isSafeHref(h), h).toBe(false);
    }
  });
});
