import { describe, it, expect } from 'vitest';
import { findEidIndex } from './eidIndex';

const SRC = `<section>
  <h1 data-eid="title-1">Hello</h1>
  <p data-eid='body-2'>World</p>
  <div data-free data-eid="box-3"></div>
</section>`;

describe('findEidIndex', () => {
  it('finds a double-quoted data-eid and returns the index of "data-eid"', () => {
    const i = findEidIndex(SRC, 'title-1');
    expect(i).not.toBeNull();
    expect(SRC.slice(i!, i! + 18)).toBe('data-eid="title-1"');
  });

  it('finds a single-quoted data-eid', () => {
    const i = findEidIndex(SRC, 'body-2');
    expect(i).not.toBeNull();
    expect(SRC.slice(i!, i! + 17)).toBe("data-eid='body-2'");
  });

  it('returns null for an absent eid (un-stamped / passthrough)', () => {
    expect(findEidIndex(SRC, 'nope')).toBeNull();
  });

  it('returns null for empty/blank/null eid', () => {
    expect(findEidIndex(SRC, '')).toBeNull();
    expect(findEidIndex(SRC, '   ')).toBeNull();
    expect(findEidIndex(SRC, null)).toBeNull();
    expect(findEidIndex(SRC, undefined)).toBeNull();
  });

  it('does not partial-match a different eid with a shared prefix', () => {
    const src = '<h1 data-eid="title-12">x</h1><h2 data-eid="title-1">y</h2>';
    const i = findEidIndex(src, 'title-1');
    expect(src.slice(i!, i! + 18)).toBe('data-eid="title-1"');
  });

  it('treats regex metacharacters in the eid literally', () => {
    const src = '<p data-eid="a.b*c">x</p>';
    expect(findEidIndex(src, 'a.b*c')).toBe(src.indexOf('data-eid'));
    expect(findEidIndex(src, 'axbxc')).toBeNull();
  });
});
