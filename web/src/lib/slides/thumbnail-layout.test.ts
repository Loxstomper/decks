/**
 * thumbnail-layout.test.ts — P12-4.
 *
 * Verifies the pure static port of the numeric layout vocabulary mirrors
 * `decks-layout-init.js` exactly: every numeric data-* mapping, nested
 * elements, merging into an existing inline style, raw-vs-numeric cols/basis,
 * and free coordinates — all without mutating the input model.
 */

import { describe, it, expect } from 'vitest';
import { applyThumbnailLayout } from './thumbnail-layout';
import { getAttribute } from '../model/edit';
import type { ElementNode, NodeAttr, SlideNode } from '../model/types';

/** Build a minimal canonical ElementNode for tests. */
function el(
  tagName: string,
  attrs: Record<string, string | null> = {},
  children: SlideNode[] = [],
): ElementNode {
  const attributes: NodeAttr[] = Object.entries(attrs).map(([name, value]) => ({
    name,
    value,
  }));
  return {
    type: 'element',
    tagName,
    attributes,
    children,
    rawOpen: '',
    rawClose: '',
    selfClosing: false,
    isVoid: false,
    rawText: false,
    raw: '',
    dirty: false,
  };
}

/** Read the resolved inline style off an element. */
const style = (e: ElementNode): string => getAttribute(e, 'style') ?? '';

/** Split a style literal into a prop→value map for order-independent asserts. */
function styleMap(e: ElementNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of style(e).split(';')) {
    const t = d.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

describe('applyThumbnailLayout — container numerics', () => {
  it('maps data-gap → gap:Npx', () => {
    const out = applyThumbnailLayout(el('section', { 'data-gap': '16' }));
    expect(styleMap(out).gap).toBe('16px');
  });

  it('maps data-pad → padding:Npx', () => {
    const out = applyThumbnailLayout(el('section', { 'data-pad': '24' }));
    expect(styleMap(out).padding).toBe('24px');
  });
});

describe('applyThumbnailLayout — grid templates', () => {
  it('numeric data-cols → repeat(N, 1fr)', () => {
    const out = applyThumbnailLayout(el('div', { 'data-cols': '3' }));
    expect(styleMap(out)['grid-template-columns']).toBe('repeat(3, 1fr)');
  });

  it('raw data-cols → verbatim template string', () => {
    const out = applyThumbnailLayout(el('div', { 'data-cols': '2fr 1fr' }));
    expect(styleMap(out)['grid-template-columns']).toBe('2fr 1fr');
  });

  it('numeric data-rows → repeat(N, 1fr)', () => {
    const out = applyThumbnailLayout(el('div', { 'data-rows': '2' }));
    expect(styleMap(out)['grid-template-rows']).toBe('repeat(2, 1fr)');
  });

  it('raw data-rows → verbatim template string', () => {
    const out = applyThumbnailLayout(el('div', { 'data-rows': 'auto 1fr' }));
    expect(styleMap(out)['grid-template-rows']).toBe('auto 1fr');
  });
});

describe('applyThumbnailLayout — child numerics', () => {
  it('maps data-grow → flex-grow (unitless)', () => {
    const out = applyThumbnailLayout(el('div', { 'data-grow': '2' }));
    expect(styleMap(out)['flex-grow']).toBe('2');
  });

  it('numeric data-basis → flex-basis:Npx', () => {
    const out = applyThumbnailLayout(el('div', { 'data-basis': '120' }));
    expect(styleMap(out)['flex-basis']).toBe('120px');
  });

  it('raw data-basis (percentage) → verbatim', () => {
    const out = applyThumbnailLayout(el('div', { 'data-basis': '50%' }));
    expect(styleMap(out)['flex-basis']).toBe('50%');
  });

  it('maps data-span → grid-column: span N', () => {
    const out = applyThumbnailLayout(el('div', { 'data-span': '2' }));
    expect(styleMap(out)['grid-column']).toBe('span 2');
  });
});

describe('applyThumbnailLayout — free coordinates', () => {
  it('maps x/y/w/h/rot only when data-free is present', () => {
    const out = applyThumbnailLayout(
      el('div', {
        'data-free': '',
        'data-x': '10',
        'data-y': '20',
        'data-w': '300',
        'data-h': '150',
        'data-rot': '45',
      }),
    );
    const m = styleMap(out);
    expect(m.left).toBe('10px');
    expect(m.top).toBe('20px');
    expect(m.width).toBe('300px');
    expect(m.height).toBe('150px');
    expect(m.transform).toBe('rotate(45deg)');
  });

  it('ignores free coords when data-free is absent', () => {
    const out = applyThumbnailLayout(el('div', { 'data-x': '10', 'data-y': '20' }));
    const m = styleMap(out);
    expect(m.left).toBeUndefined();
    expect(m.top).toBeUndefined();
  });

  it('applies only the free coords that are present', () => {
    const out = applyThumbnailLayout(
      el('div', { 'data-free': '', 'data-x': '5', 'data-rot': '90' }),
    );
    const m = styleMap(out);
    expect(m.left).toBe('5px');
    expect(m.transform).toBe('rotate(90deg)');
    expect(m.top).toBeUndefined();
    expect(m.width).toBeUndefined();
  });
});

describe('applyThumbnailLayout — merge with existing style', () => {
  it('preserves prior declarations and appends layout ones', () => {
    const out = applyThumbnailLayout(
      el('section', { style: 'color: red; background: blue', 'data-gap': '8' }),
    );
    const m = styleMap(out);
    expect(m.color).toBe('red');
    expect(m.background).toBe('blue');
    expect(m.gap).toBe('8px');
  });

  it('a layout prop overrides a same-named existing declaration in place', () => {
    const out = applyThumbnailLayout(
      el('div', { style: 'padding: 1px; color: green', 'data-pad': '40' }),
    );
    const m = styleMap(out);
    expect(m.padding).toBe('40px');
    expect(m.color).toBe('green');
    // overridden in place, not duplicated
    expect(style(out).match(/padding/g)?.length).toBe(1);
  });

  it('leaves an element with no layout attrs and no style untouched', () => {
    const out = applyThumbnailLayout(el('p', {}));
    expect(getAttribute(out, 'style')).toBeNull();
  });
});

describe('applyThumbnailLayout — recursion + purity', () => {
  it('applies styles to nested descendants', () => {
    const child = el('div', { 'data-grow': '1', 'data-basis': '200' });
    const grandchild = el('span', { 'data-span': '3' });
    child.children = [grandchild];
    const root = el('section', { 'data-gap': '12' }, [child]);

    const out = applyThumbnailLayout(root);
    expect(styleMap(out).gap).toBe('12px');

    const outChild = out.children[0] as ElementNode;
    expect(styleMap(outChild)['flex-grow']).toBe('1');
    expect(styleMap(outChild)['flex-basis']).toBe('200px');

    const outGrand = outChild.children[0] as ElementNode;
    expect(styleMap(outGrand)['grid-column']).toBe('span 3');
  });

  it('never mutates the input model (operates on a clone)', () => {
    const input = el('section', { 'data-gap': '16' });
    const before = JSON.stringify(input);
    const out = applyThumbnailLayout(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(getAttribute(input, 'style')).toBeNull();
    expect(out).not.toBe(input);
  });

  it('strips data-eid on the clone (eids irrelevant in thumbnails)', () => {
    const out = applyThumbnailLayout(
      el('section', { 'data-eid': 'abc', 'data-gap': '4' }),
    );
    expect(getAttribute(out, 'data-eid')).toBeNull();
    expect(styleMap(out).gap).toBe('4px');
  });
});

describe('applyThumbnailLayout — zero values', () => {
  it('emits 0px for data-gap="0" (attribute present, value 0)', () => {
    const out = applyThumbnailLayout(el('section', { 'data-gap': '0' }));
    expect(styleMap(out).gap).toBe('0px');
  });
});
