/**
 * diff.test.ts — Pure model-diff tests (P8-7).
 *
 * Verifies diffModels() correctly classifies added / removed / changed managed
 * elements by data-eid between two parsed models — the core of "highlight what
 * Claude changed" (spec 11). All pure, node-env friendly.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck } from './parse';
import { stampEids } from './eid';
import { diffModels, isEmptyDiff } from './diff';
import type { DeckModel } from './types';

/** Parse + stamp (the deck store always works with stamped models). */
function model(html: string): DeckModel {
  const m = parseDeck(html);
  stampEids(m);
  return m;
}

const SHELL = (slides: string): string =>
  `<!DOCTYPE html><html><body><div class="reveal"><div class="slides">${slides}</div></div></body></html>`;

describe('diffModels', () => {
  it('reports no changes for an identical model', () => {
    const html = SHELL('<section data-eid="s1"><h1 data-eid="h1">Title</h1></section>');
    const d = diffModels(model(html), model(html));
    expect(isEmptyDiff(d)).toBe(true);
    expect(d).toEqual({ added: [], removed: [], changed: [] });
  });

  it('detects a changed text leaf without flagging its ancestors', () => {
    const before = model(
      SHELL('<section data-eid="s1"><h1 data-eid="h1">Old</h1></section>'),
    );
    const after = model(
      SHELL('<section data-eid="s1"><h1 data-eid="h1">New</h1></section>'),
    );
    const d = diffModels(before, after);
    // Only the leaf whose text changed is flagged — NOT the enclosing section.
    expect(d.changed).toEqual(['h1']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('detects an attribute change on an element', () => {
    const before = model(SHELL('<section data-eid="s1" data-lay="row"></section>'));
    const after = model(SHELL('<section data-eid="s1" data-lay="stack"></section>'));
    expect(diffModels(before, after).changed).toEqual(['s1']);
  });

  it('treats attribute REORDER as no change (canonical signature)', () => {
    const before = model(SHELL('<section data-eid="s1" data-lay="row" data-gap="8"></section>'));
    const after = model(SHELL('<section data-eid="s1" data-gap="8" data-lay="row"></section>'));
    expect(isEmptyDiff(diffModels(before, after))).toBe(true);
  });

  it('ignores whitespace / indentation-only differences', () => {
    const before = model(SHELL('<section data-eid="s1"><p data-eid="p1">Hi</p></section>'));
    const after = model(
      SHELL('<section data-eid="s1">\n    <p data-eid="p1">Hi</p>\n  </section>'),
    );
    expect(isEmptyDiff(diffModels(before, after))).toBe(true);
  });

  it('detects an added element', () => {
    const before = model(SHELL('<section data-eid="s1"><h1 data-eid="h1">T</h1></section>'));
    const after = model(
      SHELL('<section data-eid="s1"><h1 data-eid="h1">T</h1><p data-eid="p1">new</p></section>'),
    );
    const d = diffModels(before, after);
    expect(d.added).toEqual(['p1']);
    // The section's child arrangement changed → it is also flagged as changed.
    expect(d.changed).toContain('s1');
    expect(d.removed).toEqual([]);
  });

  it('detects a removed element', () => {
    const before = model(
      SHELL('<section data-eid="s1"><h1 data-eid="h1">T</h1><p data-eid="p1">x</p></section>'),
    );
    const after = model(SHELL('<section data-eid="s1"><h1 data-eid="h1">T</h1></section>'));
    const d = diffModels(before, after);
    expect(d.removed).toEqual(['p1']);
    expect(d.added).toEqual([]);
    expect(d.changed).toContain('s1');
  });

  it('treats a null previous model as all-added', () => {
    const after = model(SHELL('<section data-eid="s1"><h1 data-eid="h1">T</h1></section>'));
    const d = diffModels(null, after);
    expect(d.added.sort()).toEqual(['h1', 's1']);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('treats a null next model as all-removed', () => {
    const before = model(SHELL('<section data-eid="s1"></section>'));
    expect(diffModels(before, null).removed).toEqual(['s1']);
  });

  it('returns sorted, deterministic arrays', () => {
    const before = model(SHELL('<section data-eid="s1"></section>'));
    const after = model(
      SHELL('<section data-eid="s1"></section><section data-eid="s2"></section><section data-eid="s0"></section>'),
    );
    const d = diffModels(before, after);
    expect(d.added).toEqual(['s0', 's2']); // sorted
  });

  it('bubbles a passthrough (eid-less) child change up to the managed ancestor', () => {
    // <span> has no managed eid; its text change must surface on the section.
    const before = model(SHELL('<section data-eid="s1"><span>a</span></section>'));
    const after = model(SHELL('<section data-eid="s1"><span>b</span></section>'));
    expect(diffModels(before, after).changed).toEqual(['s1']);
  });
});
