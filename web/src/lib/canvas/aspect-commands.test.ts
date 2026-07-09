import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck } from '$lib/model';
import {
  applyLogicalSizeToInit,
  readLogicalSizeFromInit,
  collectFreeRects,
  applyAspectChangeToModel,
} from './aspect-commands.ts';
import { computeRepositionOffers } from './aspect.ts';

describe('applyLogicalSizeToInit', () => {
  it('replaces existing width/height in the init call', () => {
    const js = `Reveal.initialize({ width: 1920, height: 1080, hash: true });`;
    expect(applyLogicalSizeToInit(js, { width: 1440, height: 1080 })).toBe(
      `Reveal.initialize({ width: 1440, height: 1080, hash: true });`,
    );
  });

  it('injects width/height when absent, preserving other keys', () => {
    const js = `Reveal.initialize({ hash: true });`;
    const out = applyLogicalSizeToInit(js, { width: 1080, height: 1920 });
    expect(out).toContain('width: 1080');
    expect(out).toContain('height: 1920');
    expect(out).toContain('hash: true');
    expect(readLogicalSizeFromInit(out)).toEqual({ width: 1080, height: 1920 });
  });

  it('leaves text without a Reveal.initialize call unchanged', () => {
    const js = `console.log('no reveal here');`;
    expect(applyLogicalSizeToInit(js, { width: 1, height: 2 })).toBe(js);
  });

  it('round-trips through readLogicalSizeFromInit', () => {
    const js = applyLogicalSizeToInit(`Reveal.initialize({});`, { width: 1600, height: 900 });
    expect(readLogicalSizeFromInit(js)).toEqual({ width: 1600, height: 900 });
  });
});

describe('readLogicalSizeFromInit', () => {
  it('returns null when a dimension is missing', () => {
    expect(readLogicalSizeFromInit(`Reveal.initialize({ width: 1920 });`)).toBeNull();
    expect(readLogicalSizeFromInit(`Reveal.initialize({ hash: true });`)).toBeNull();
  });
});

const DECK_WITH_FREE = `<!DOCTYPE html>
<html><head></head><body>
<div class="reveal"><div class="slides">
<section data-eid="s1">
  <div data-free data-x="960" data-y="100" data-w="400" data-h="200" data-eid="f1">box</div>
  <div data-free data-x="0" data-y="0" data-eid="f2">pos-only</div>
  <h1 data-eid="h1">structured title</h1>
</section>
</div></div>
<script>Reveal.initialize({ width: 1920, height: 1080, hash: true });</script>
</body></html>`;

describe('collectFreeRects', () => {
  it('returns only free elements with their stored logical rects', () => {
    const model = parseDeck(DECK_WITH_FREE);
    const rects = collectFreeRects(model);
    expect(rects).toEqual([
      { eid: 'f1', rect: { x: 960, y: 100, w: 400, h: 200 } },
      { eid: 'f2', rect: { x: 0, y: 0 } },
    ]);
  });

  it('excludes structured elements (h1)', () => {
    const model = parseDeck(DECK_WITH_FREE);
    const eids = collectFreeRects(model).map((r) => r.eid);
    expect(eids).not.toContain('h1');
  });
});

describe('byte-stability of untouched content (spec principles-and-invariants #4)', () => {
  it('parse → serialize is identity for the fixture', () => {
    const model = parseDeck(DECK_WITH_FREE);
    expect(serializeDeck(model)).toBe(DECK_WITH_FREE);
  });
});

describe('applyAspectChangeToModel', () => {
  it('rewrites the reveal init size and accepted offers; declines untouched', () => {
    const model = parseDeck(DECK_WITH_FREE);
    const oldSize = { width: 1920, height: 1080 };
    const newSize = { width: 1440, height: 1080 };
    const offers = computeRepositionOffers(collectFreeRects(model), oldSize, newSize, 'proportional');
    // Accept f1 only; decline f2 (f2 stays at origin anyway).
    const accepted = offers.filter((o) => o.eid === 'f1');

    expect(applyAspectChangeToModel(model, newSize, accepted)).toBe(true);
    const out = serializeDeck(model);

    // Reveal init size updated (spec scaling-and-resolution source of truth).
    expect(out).toContain('width: 1440');
    expect(out).toContain('height: 1080');
    // f1 repositioned (x 960→720, w 400→300 at sx=0.75; y/h unchanged at sy=1).
    expect(out).toContain('data-x="720"');
    expect(out).toContain('data-w="300"');
    // Structured h1 untouched.
    expect(out).toContain('<h1 data-eid="h1">structured title</h1>');
  });

  it('returns false when nothing changes (same size, no offers)', () => {
    const model = parseDeck(DECK_WITH_FREE);
    expect(applyAspectChangeToModel(model, { width: 1920, height: 1080 }, [])).toBe(false);
  });
});
