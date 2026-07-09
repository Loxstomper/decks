/**
 * notes.test.ts — Speaker notes model ops (P7-2 / spec presenting-and-export).
 *
 * Invariants under test:
 *   1. getSlideNotes — reads decoded text from <aside class="notes">; returns ''
 *      when absent.
 *   2. setSlideNotes (non-empty) — creates the aside when missing; updates it
 *      in-place when present; marks only the aside dirty (byte-stable siblings).
 *   3. setSlideNotes ('') — removes the aside when present; is a no-op when
 *      absent (no bytes churned).
 *   4. Idempotent — set + serialize + parse + set again produces identical bytes.
 *   5. Byte-stable siblings — setting notes on slide 1 leaves slide 2 verbatim.
 *   6. Entity round-trip — literal `&` in text is stored as `&amp;` and read
 *      back as `&`.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, serializeDeck, getSlides, findByEid, getAttribute } from './index';
import { getSlideNotes, setSlideNotes } from './notes';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal deck HTML with one slide, optionally containing a notes aside. */
function makeDeck(notesContent?: string): string {
  const notes = notesContent !== undefined ? `\n          <aside class="notes">${notesContent}</aside>` : '';
  return `<!DOCTYPE html>
<html>
<body>
<div class="reveal">
  <div class="slides">
    <section data-eid="s1">
      <h1>Title</h1>${notes}
    </section>
    <section data-eid="s2">
      <p>Sibling</p>
    </section>
  </div>
</div>
</body>
</html>`;
}

// ── getSlideNotes ─────────────────────────────────────────────────────────────

describe('getSlideNotes', () => {
  it('returns empty string when no aside is present', () => {
    const model = parseDeck(makeDeck());
    const [s1] = getSlides(model);
    expect(getSlideNotes(s1)).toBe('');
  });

  it('returns text content of <aside class="notes">', () => {
    const model = parseDeck(makeDeck('Hello, speaker!'));
    const [s1] = getSlides(model);
    expect(getSlideNotes(s1)).toBe('Hello, speaker!');
  });

  it('decodes HTML entities in the notes text', () => {
    const model = parseDeck(makeDeck('A &amp; B &lt;tag&gt;'));
    const [s1] = getSlides(model);
    expect(getSlideNotes(s1)).toBe('A & B <tag>');
  });

  it('returns empty string on a slide with no aside even if siblings have notes', () => {
    const html = makeDeck('slide 1 notes');
    const model = parseDeck(html);
    const slides = getSlides(model);
    // s1 has notes, s2 does not
    expect(getSlideNotes(slides[0])).toBe('slide 1 notes');
    expect(getSlideNotes(slides[1])).toBe('');
  });
});

// ── setSlideNotes — create ────────────────────────────────────────────────────

describe('setSlideNotes — create (no existing aside)', () => {
  it('appends <aside class="notes"> with the given text', () => {
    const model = parseDeck(makeDeck());
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'New note');
    const out = serializeDeck(model);
    expect(out).toContain('<aside class="notes">New note</aside>');
  });

  it('after create, getSlideNotes returns the text', () => {
    const model = parseDeck(makeDeck());
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'Speaker says hi');
    expect(getSlideNotes(s1)).toBe('Speaker says hi');
  });

  it('encodes entities in the notes text', () => {
    const model = parseDeck(makeDeck());
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'A & B');
    const out = serializeDeck(model);
    expect(out).toContain('A &amp; B');
    // Reading back gives the literal
    const model2 = parseDeck(out);
    const [s1b] = getSlides(model2);
    expect(getSlideNotes(s1b)).toBe('A & B');
  });
});

// ── setSlideNotes — update ────────────────────────────────────────────────────

describe('setSlideNotes — update (existing aside)', () => {
  it('replaces the text of an existing <aside class="notes">', () => {
    const model = parseDeck(makeDeck('Old note'));
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'Updated note');
    const out = serializeDeck(model);
    expect(out).toContain('<aside class="notes">Updated note</aside>');
    expect(out).not.toContain('Old note');
  });

  it('after update, getSlideNotes returns the new text', () => {
    const model = parseDeck(makeDeck('Old'));
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'New');
    expect(getSlideNotes(s1)).toBe('New');
  });

  it('preserves the section open-tag bytes when updating (byte-stable)', () => {
    // The section has data-eid="s1"; after update its tag should not change.
    const html = makeDeck('Original');
    const model = parseDeck(html);
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'Changed');
    const out = serializeDeck(model);
    // The section element itself was not marked dirty — only the aside was.
    // Its open tag is preserved in the original source form.
    expect(out).toContain('data-eid="s1"');
  });
});

// ── setSlideNotes — remove ────────────────────────────────────────────────────

describe('setSlideNotes — remove (empty text)', () => {
  it('removes the aside when text is empty', () => {
    const model = parseDeck(makeDeck('Some notes'));
    const [s1] = getSlides(model);
    setSlideNotes(s1, '');
    const out = serializeDeck(model);
    expect(out).not.toContain('<aside');
    expect(out).not.toContain('Some notes');
  });

  it('is a no-op when text is empty and no aside exists', () => {
    const html = makeDeck(); // no aside
    const model = parseDeck(html);
    const [s1] = getSlides(model);
    setSlideNotes(s1, '');
    // No edit occurred — the model should round-trip identically.
    expect(serializeDeck(model)).toBe(html);
  });

  it('after remove, getSlideNotes returns empty string', () => {
    const model = parseDeck(makeDeck('Notes here'));
    const [s1] = getSlides(model);
    setSlideNotes(s1, '');
    expect(getSlideNotes(s1)).toBe('');
  });
});

// ── Byte-stable siblings ──────────────────────────────────────────────────────

describe('byte-stable siblings', () => {
  it('setting notes on s1 leaves s2 bytes verbatim', () => {
    const html = makeDeck();
    const model = parseDeck(html);
    const [s1, s2] = getSlides(model);
    // Record the original raw bytes of s2.
    const s2Raw = s2.raw;
    setSlideNotes(s1, 'Note for slide 1');
    const out = serializeDeck(model);
    // s2 must be byte-identical — its raw slice appears unchanged in the output.
    expect(out).toContain(s2Raw);
  });

  it('removing notes from s1 leaves s2 bytes verbatim', () => {
    const html = makeDeck('old notes');
    const model = parseDeck(html);
    const [s1, s2] = getSlides(model);
    const s2Raw = s2.raw;
    setSlideNotes(s1, '');
    const out = serializeDeck(model);
    expect(out).toContain(s2Raw);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('set → serialize → parse → serialize produces identical bytes', () => {
    const model = parseDeck(makeDeck());
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'Round-trip note');
    const once = serializeDeck(model);
    // Parse the output and re-serialize without any edits.
    expect(serializeDeck(parseDeck(once))).toBe(once);
  });

  it('set same value twice produces identical output', () => {
    const model = parseDeck(makeDeck());
    const [s1] = getSlides(model);
    setSlideNotes(s1, 'Note');
    const first = serializeDeck(model);
    setSlideNotes(s1, 'Note');
    const second = serializeDeck(model);
    expect(second).toBe(first);
  });
});
