/**
 * target.test.ts — resolveInsertTarget (P5-1) WHICH-slide + WHERE-within rules.
 *
 * The load-bearing invariant here: a block ALWAYS lands on the slide the canvas
 * is presenting (`viewedSlideEid`). The selection only refines where within that
 * slide, and only when the selection actually lives on the viewed slide. This is
 * the regression guard for "image uploaded while viewing slide 25 landed on
 * slide 1" — which happened because insertion was driven purely by the selection
 * and fell back to the first slide when nothing was selected.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck } from '$lib/model/parse';
import { resolveInsertTarget } from './target';

// Two slides. s1 holds a heading (leaf). s2 holds a heading (leaf) and a
// data-lay list (container) so we can exercise both the into/after branches.
const DECK = `<div class="reveal"><div class="slides">
<section data-eid="s1"><h2 data-eid="h1">One</h2></section>
<section data-eid="s2"><h2 data-eid="h2">Two</h2><ul data-eid="u2" data-lay="stack"><li data-eid="li2">y</li></ul></section>
</div></div>`;

const model = parseDeck(DECK);

describe('resolveInsertTarget — which slide (viewed slide is authoritative)', () => {
  it('lands on the viewed slide when nothing is selected', () => {
    expect(resolveInsertTarget(model, null, 'flow', 's2')).toEqual({ mode: 'into', parentEid: 's2' });
  });

  it('lands on the viewed slide even when the selection is on a DIFFERENT slide', () => {
    // Selection h1 lives on s1, but the canvas is presenting s2.
    expect(resolveInsertTarget(model, 'h1', 'flow', 's2')).toEqual({ mode: 'into', parentEid: 's2' });
  });

  it('free blocks always go INTO the viewed slide section', () => {
    expect(resolveInsertTarget(model, 'h1', 'free', 's2')).toEqual({ mode: 'into', parentEid: 's2' });
  });
});

describe('resolveInsertTarget — where within (selection on the viewed slide)', () => {
  it('inserts AFTER a selected leaf on the viewed slide', () => {
    expect(resolveInsertTarget(model, 'h2', 'flow', 's2')).toEqual({ mode: 'after', eid: 'h2' });
  });

  it('inserts INTO a selected container on the viewed slide', () => {
    expect(resolveInsertTarget(model, 'u2', 'flow', 's2')).toEqual({ mode: 'into', parentEid: 'u2' });
  });
});

describe('resolveInsertTarget — fallback when the viewed slide is unknown', () => {
  it('falls back to the selection slide when no viewed slide is passed', () => {
    expect(resolveInsertTarget(model, 'h2', 'flow', null)).toEqual({ mode: 'after', eid: 'h2' });
  });

  it('falls back to the first slide when nothing is selected and no viewed slide', () => {
    expect(resolveInsertTarget(model, null, 'flow', null)).toEqual({ mode: 'into', parentEid: 's1' });
  });
});
