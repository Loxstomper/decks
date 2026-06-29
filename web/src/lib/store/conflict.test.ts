/**
 * conflict.test.ts — Turn-taking decision + line-diff tests (P8-6).
 *
 * Pins the dirty-guard state machine (decideExternalChange) and the line diff
 * that powers the conflict prompt's "view diff". Pure, node-env friendly.
 */

import { describe, it, expect } from 'vitest';
import { decideExternalChange, lineDiff } from './conflict';

describe('decideExternalChange', () => {
  it('echo: incoming equals current in-memory source (our own save bouncing back)', () => {
    const d = decideExternalChange({ current: 'A', saved: 'A', incoming: 'A' });
    expect(d).toEqual({ kind: 'echo' });
  });

  it('echo: incoming equals current even when our baseline lagged behind', () => {
    // We had saved=B locally but the source is A (==incoming) — no divergence.
    const d = decideExternalChange({ current: 'A', saved: 'B', incoming: 'A' });
    expect(d).toEqual({ kind: 'echo' });
  });

  it('adopt: clean (current===saved) and incoming differs', () => {
    const d = decideExternalChange({ current: 'A', saved: 'A', incoming: 'B' });
    expect(d).toEqual({ kind: 'adopt', html: 'B' });
  });

  it('conflict: dirty (current!==saved) and incoming differs from current', () => {
    const d = decideExternalChange({ current: 'MINE', saved: 'BASE', incoming: 'THEIRS' });
    expect(d).toEqual({ kind: 'conflict', html: 'THEIRS' });
  });

  it('conflict takes precedence over adopt when dirty', () => {
    // Even though incoming==saved baseline, the user has unsaved edits (current
    // diverged), so adopting would clobber them → conflict.
    const d = decideExternalChange({ current: 'MINE', saved: 'BASE', incoming: 'BASE' });
    expect(d.kind).toBe('conflict');
  });
});

describe('lineDiff', () => {
  it('marks all lines equal for identical text', () => {
    const d = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(d.every((l) => l.tag === 'eq')).toBe(true);
    expect(d.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('detects an added line', () => {
    const d = lineDiff('a\nc', 'a\nb\nc');
    expect(d).toContainEqual({ tag: 'add', text: 'b' });
    // The shared lines remain equal.
    expect(d.filter((l) => l.tag === 'eq').map((l) => l.text)).toEqual(['a', 'c']);
  });

  it('detects a removed line', () => {
    const d = lineDiff('a\nb\nc', 'a\nc');
    expect(d).toContainEqual({ tag: 'del', text: 'b' });
  });

  it('detects a changed line as a delete + add pair', () => {
    const d = lineDiff('hello', 'world');
    expect(d).toContainEqual({ tag: 'del', text: 'hello' });
    expect(d).toContainEqual({ tag: 'add', text: 'world' });
  });

  it('reconstructs both sides: eq+del == mine, eq+add == theirs', () => {
    const mine = 'one\ntwo\nthree';
    const theirs = 'one\nTWO\nthree\nfour';
    const d = lineDiff(mine, theirs);
    const reMine = d.filter((l) => l.tag !== 'add').map((l) => l.text).join('\n');
    const reTheirs = d.filter((l) => l.tag !== 'del').map((l) => l.text).join('\n');
    expect(reMine).toBe(mine);
    expect(reTheirs).toBe(theirs);
  });
});
