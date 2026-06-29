/**
 * inline-marks.test.ts — Range mark commands over a jsdom Document (P17-6/9).
 *
 * The module mutates a live DOM; we exercise it against a jsdom `contenteditable`
 * root, placing a Range over text and asserting innerHTML after toggle/link ops.
 * The end-of-pipeline canonicalisation is the sanitizer's job (inline.test.ts);
 * here we only assert that the DOM we produce MEANS the right thing and that
 * toggle is idempotent (bold a word → `<strong>`; toggle again → clean).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  toggleMark,
  wrapRange,
  linkRange,
  unlinkRange,
  setRangeLink,
  coveringMark,
  normalizeAdjacent,
  applySpanStyle,
  rangeToOffsets,
  offsetsToRange,
} from './inline-marks';

let dom: JSDOM;
let doc: Document;
let root: HTMLElement;

beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  doc = dom.window.document;
  root = doc.createElement('p');
  doc.body.appendChild(root);
});

/** Select the substring [from,to) of the FIRST text node under `node`. */
function selectChars(node: Node, from: number, to: number): Range {
  // Find the text node containing `from`, walking text nodes in order.
  const range = doc.createRange();
  let acc = 0;
  let startSet = false;
  let endSet = false;
  const walk = (n: Node): void => {
    if (n.nodeType === 3) {
      const len = n.nodeValue!.length;
      // Strict `<` so a `from` landing on a node boundary anchors at the START
      // of the next text node (offset 0) rather than the END of this one.
      if (!startSet && from < acc + len) {
        range.setStart(n, from - acc);
        startSet = true;
      }
      // First (not last) node that contains `to`, so an end on a boundary stays
      // at the END of this node rather than drifting to the next node's start.
      if (startSet && !endSet && to <= acc + len) {
        range.setEnd(n, to - acc);
        endSet = true;
      }
      acc += len;
      return;
    }
    for (const c of Array.from(n.childNodes)) walk(c);
  };
  walk(node);
  return range;
}

describe('toggleMark — bold a word', () => {
  it('wraps just the selected word in <strong>', () => {
    root.textContent = 'one two three';
    const range = selectChars(root, 4, 7); // "two"
    toggleMark(range, 'strong', root);
    expect(root.innerHTML).toBe('one <strong>two</strong> three');
  });

  it('is idempotent: toggling the same range off removes the mark cleanly', () => {
    root.textContent = 'one two three';
    let range = selectChars(root, 4, 7);
    toggleMark(range, 'strong', root);
    expect(root.innerHTML).toBe('one <strong>two</strong> three');

    // Re-select "two" (now inside <strong>) and toggle off.
    range = selectChars(root, 4, 7);
    toggleMark(range, 'strong', root);
    expect(root.innerHTML).toBe('one two three');
  });

  it('unwraps only a sub-range of a larger mark (splits the mark)', () => {
    root.innerHTML = '<strong>abcdef</strong>';
    const range = selectChars(root, 2, 4); // "cd" inside the strong
    toggleMark(range, 'strong', root);
    expect(root.innerHTML).toBe('<strong>ab</strong>cd<strong>ef</strong>');
  });
});

describe('wrapRange — partial / crossing selections', () => {
  it('wraps a selection that crosses an existing mark boundary', () => {
    root.innerHTML = 'a <em>bc</em> d';
    // Select from inside "a " across into "bc": chars 1..5 => " bc"+... compute
    // text is "a bc d" → indices: a(0) ' '(1) b(2) c(3) ' '(4) d(5)
    const range = selectChars(root, 1, 4); // " bc"
    const el = wrapRange(range, 'strong');
    expect(el.tagName.toLowerCase()).toBe('strong');
    // The em is preserved inside the new strong; text content is intact.
    expect(root.textContent).toBe('a bc d');
    expect(root.querySelector('strong')).not.toBeNull();
    expect(root.querySelector('em')).not.toBeNull();
  });

  it('merges adjacent same-tag siblings', () => {
    root.innerHTML = '<strong>a</strong>bc';
    const range = selectChars(root, 1, 3); // "bc"
    wrapRange(range, 'strong');
    // The new <strong>bc</strong> folds into the preceding <strong>a</strong>.
    expect(root.innerHTML).toBe('<strong>abc</strong>');
  });
});

describe('normalizeAdjacent', () => {
  it('does not merge marks with differing attributes', () => {
    root.innerHTML = '<a href="x">a</a><a href="y">b</a>';
    const first = root.querySelector('a') as HTMLElement;
    normalizeAdjacent(first, 'a');
    expect(root.querySelectorAll('a').length).toBe(2);
  });
});

describe('link commands (P17-9)', () => {
  it('linkRange wraps the selection in <a href>', () => {
    root.textContent = 'see docs here';
    const range = selectChars(root, 4, 8); // "docs"
    const a = linkRange(range, 'https://example.com/');
    expect(a.tagName.toLowerCase()).toBe('a');
    expect(root.innerHTML).toBe('see <a href="https://example.com/">docs</a> here');
  });

  it('setRangeLink edits an existing covering anchor in place', () => {
    root.innerHTML = 'go <a href="http://old/">link</a> now';
    const range = selectChars(root, 3, 7); // "link" inside the anchor
    setRangeLink(range, root, 'http://new/');
    expect(root.querySelector('a')!.getAttribute('href')).toBe('http://new/');
    expect(root.querySelectorAll('a').length).toBe(1);
  });

  it('unlinkRange removes the covering anchor', () => {
    root.innerHTML = 'go <a href="http://x/">link</a> now';
    const range = selectChars(root, 3, 7);
    unlinkRange(range, root);
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toBe('go link now');
  });

  it('coveringMark detects the anchor ancestor of the range', () => {
    root.innerHTML = 'go <a href="http://x/">link</a>';
    const range = selectChars(root, 4, 6);
    expect(coveringMark(range, 'a', root)).not.toBeNull();
    expect(coveringMark(range, 'strong', root)).toBeNull();
  });
});

describe('font-size / colour run wrap (span)', () => {
  it('wraps the selection in a styled span', () => {
    root.textContent = 'big small';
    const range = selectChars(root, 0, 3); // "big"
    toggleMark(range, 'span', root, { style: 'font-size: 2em' });
    expect(root.innerHTML).toBe('<span style="font-size: 2em">big</span> small');
  });
});

describe('applySpanStyle — colour / font-size runs', () => {
  it('wraps a fresh styled span', () => {
    root.textContent = 'red text';
    const range = selectChars(root, 0, 3); // "red"
    applySpanStyle(range, root, 'color', '#e53e3e');
    expect(root.innerHTML).toBe('<span style="color: #e53e3e">red</span> text');
  });

  it('updates a fully-covering span in place rather than nesting', () => {
    root.innerHTML = '<span style="color: red">word</span>';
    const range = selectChars(root, 0, 4); // "word"
    applySpanStyle(range, root, 'color', 'blue');
    expect(root.querySelectorAll('span').length).toBe(1);
    expect(root.querySelector('span')!.getAttribute('style')).toContain('blue');
  });

  it('clearing the only style property unwraps the span', () => {
    root.innerHTML = '<span style="color: red">word</span>';
    const range = selectChars(root, 0, 4);
    applySpanStyle(range, root, 'color', null);
    expect(root.querySelector('span')).toBeNull();
    expect(root.textContent).toBe('word');
  });
});

describe('offset save / restore', () => {
  it('round-trips a selection through text-only offsets across a DOM rebuild', () => {
    root.innerHTML = 'one <strong>two</strong> three';
    const range = selectChars(root, 4, 7); // "two" (inside strong)
    const off = rangeToOffsets(root, range);
    expect(off).toEqual({ start: 4, end: 7 });

    // Rebuild the DOM with different node structure but identical text.
    root.innerHTML = 'one two three';
    const restored = offsetsToRange(root, off);
    expect(restored.toString()).toBe('two');
  });
});
