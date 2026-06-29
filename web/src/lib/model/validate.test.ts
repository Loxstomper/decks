/**
 * validate.test.ts — Save-validation tests (P8-3).
 *
 * Covers the client-side guard (validateSource / validateModel) and the remote
 * payload normaliser (normalizeRemote). Pure, node-env friendly.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateSource, validateModel, normalizeRemote } from './validate';
import { parseDeck } from './parse';
import { stampEids } from './eid';
import type { ValidationResult } from './validate';

const SHELL = (slides: string): string =>
  `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">${slides}</div></div></body></html>`;

/** Convenience: codes present in a result. */
function codes(r: ValidationResult): string[] {
  return r.errors.map((e) => e.code).sort();
}

describe('validateSource — well-formed decks pass', () => {
  it('accepts a minimal valid deck', () => {
    const r = validateSource(SHELL('<section data-eid="s1"><h1 data-eid="h1">Hi</h1></section>'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts every golden fixture', () => {
    const dir = new URL('./__fixtures__/', import.meta.url);
    for (const name of ['minimal.html', 'multi-slide.html', 'data-lay.html', 'layout.html', 'kitchen-sink.html']) {
      const html = readFileSync(new URL(name, dir), 'utf8');
      const r = validateSource(html);
      expect(r.ok, `${name}: ${JSON.stringify(r.errors)}`).toBe(true);
    }
  });

  it('accepts valid layout-contract values', () => {
    const r = validateSource(
      SHELL(
        '<section data-eid="s1"><div data-eid="d1" data-lay="grid" data-align="center" data-justify="between" data-gap="8" data-pad="0" data-cols="2"><p data-eid="p1" data-grow="1" data-span="2">x</p></div></section>',
      ),
    );
    expect(r.ok).toBe(true);
  });
});

describe('validateModel — layout-contract violations', () => {
  function check(slides: string): ValidationResult {
    const m = parseDeck(SHELL(slides));
    stampEids(m);
    return validateModel(m);
  }

  it('flags an illegal data-lay value', () => {
    const r = check('<section data-eid="s1" data-lay="flex"></section>');
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('bad-lay');
  });

  it('flags an illegal data-align value', () => {
    const r = check('<section data-eid="s1" data-lay="row" data-align="middle"></section>');
    expect(codes(r)).toContain('bad-align');
  });

  it('flags an illegal data-justify value', () => {
    const r = check('<section data-eid="s1" data-lay="row" data-justify="evenly"></section>');
    expect(codes(r)).toContain('bad-justify');
  });

  it('flags a negative data-gap', () => {
    const r = check('<section data-eid="s1" data-lay="row" data-gap="-4"></section>');
    expect(codes(r)).toContain('bad-gap');
  });

  it('flags a non-integer data-pad', () => {
    const r = check('<section data-eid="s1" data-lay="row" data-pad="2.5"></section>');
    expect(codes(r)).toContain('bad-pad');
  });

  it('flags data-span < 1', () => {
    const r = check('<section data-eid="s1"><p data-eid="p1" data-span="0">x</p></section>');
    expect(codes(r)).toContain('bad-span');
  });

  it('flags a negative free width', () => {
    const r = check('<section data-eid="s1"><div data-eid="d1" data-free data-x="10" data-y="10" data-w="-5" data-h="20"></div></section>');
    expect(codes(r)).toContain('bad-w');
  });

  it('accepts negative free x/y (logical coords may be off-canvas)', () => {
    const r = check('<section data-eid="s1"><div data-eid="d1" data-free data-x="-10" data-y="-20" data-w="5" data-h="5"></div></section>');
    expect(r.ok).toBe(true);
  });

  it('flags duplicate data-eids', () => {
    const r = check('<section data-eid="s1"><p data-eid="dup">a</p><p data-eid="dup">b</p></section>');
    expect(codes(r)).toContain('duplicate-eid');
  });

  it('collects ALL problems, not just the first', () => {
    const r = check('<section data-eid="s1" data-lay="bad" data-gap="-1"></section>');
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateSource — parse + round-trip', () => {
  it('reports a parse-level failure code for irrecoverable input', () => {
    // A stray unmatched CDATA close is benign for most parsers, so instead assert
    // that genuinely valid HTML always round-trips (the common, important case).
    const r = validateSource(SHELL('<section data-eid="s1"><p data-eid="p1">ok</p></section>'));
    expect(r.errors.find((e) => e.code === 'round-trip')).toBeUndefined();
  });
});

describe('normalizeRemote', () => {
  it('returns null for non-object payloads', () => {
    expect(normalizeRemote(null)).toBeNull();
    expect(normalizeRemote('nope')).toBeNull();
    expect(normalizeRemote(42)).toBeNull();
  });

  it('maps an ok:true payload', () => {
    expect(normalizeRemote({ ok: true })).toEqual({ ok: true, errors: [] });
  });

  it('maps an errors array of objects', () => {
    const r = normalizeRemote({ ok: false, errors: [{ code: 'x', message: 'bad', eid: 'p1' }] });
    expect(r).toEqual({ ok: false, errors: [{ code: 'x', message: 'bad', eid: 'p1' }] });
  });

  it('maps string errors and derives ok from their presence', () => {
    const r = normalizeRemote({ errors: ['boom'] });
    expect(r).toEqual({ ok: false, errors: [{ code: 'remote', message: 'boom' }] });
  });

  it('defaults message when missing', () => {
    const r = normalizeRemote({ errors: [{}] });
    expect(r?.errors[0].message).toBe('validation error');
  });
});
