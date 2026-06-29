/**
 * eid.test.ts — Click → nearest selectable leaf resolution (P2-3).
 *
 * Headless: builds minimal ElementLike chains (real HTMLElements satisfy the
 * same interface) and asserts the climb-to-nearest-leaf-with-eid rule.
 */

import { describe, it, expect } from 'vitest';
import { resolveSelectable, isLeafTag, isTextLeafTag, type ElementLike } from './eid';

/** Tiny builder for a fake DOM-ish node implementing ElementLike. */
function node(
  tagName: string,
  attrs: Record<string, string> = {},
  parent: ElementLike | null = null,
): ElementLike {
  return {
    tagName,
    parentElement: parent,
    getAttribute: (name: string) => attrs[name] ?? null,
  };
}

describe('isLeafTag / isTextLeafTag', () => {
  it('classifies text leaves', () => {
    expect(isLeafTag('H1')).toBe(true);
    expect(isTextLeafTag('H1')).toBe(true);
    expect(isTextLeafTag('p')).toBe(true);
  });

  it('classifies non-text leaves as selectable but not editable', () => {
    expect(isLeafTag('IMG')).toBe(true);
    expect(isTextLeafTag('IMG')).toBe(false);
  });

  it('does not treat structural tags as leaves', () => {
    expect(isLeafTag('section')).toBe(false);
    expect(isLeafTag('div')).toBe(false);
  });
});

describe('resolveSelectable', () => {
  it('climbs from an inner click to the nearest leaf carrying an eid', () => {
    // section[s1] > h1[t1] > (text span with no eid, clicked)
    const section = node('SECTION', { 'data-eid': 's1' });
    const h1 = node('H1', { 'data-eid': 't1' }, section);
    const span = node('SPAN', {}, h1); // inline run, no eid
    expect(resolveSelectable(span)).toEqual({ eid: 't1', editable: true, tag: 'h1' });
  });

  it('selects the leaf itself when clicked directly', () => {
    const p = node('P', { 'data-eid': 'p9' });
    expect(resolveSelectable(p)).toEqual({ eid: 'p9', editable: true, tag: 'p' });
  });

  it('marks non-text leaves (img) as not editable', () => {
    const img = node('IMG', { 'data-eid': 'i1' });
    expect(resolveSelectable(img)).toEqual({ eid: 'i1', editable: false, tag: 'img' });
  });

  it('returns null for empty space — a container-only chain (deselect)', () => {
    // div.slides > section[s1] (a container with an eid, but NOT a leaf tag)
    const slides = node('DIV', { class: 'slides' });
    const section = node('SECTION', { 'data-eid': 's1' }, slides);
    expect(resolveSelectable(section)).toBeNull();
  });

  it('skips a leaf tag that lacks an eid and keeps climbing', () => {
    // h1[t1] > span (leaf tag, no eid) → resolves to h1, not the span
    const h1 = node('H1', { 'data-eid': 't1' });
    const span = node('SPAN', {}, h1);
    expect(resolveSelectable(span)?.eid).toBe('t1');
  });

  it('returns null for a null target', () => {
    expect(resolveSelectable(null)).toBeNull();
  });
});
