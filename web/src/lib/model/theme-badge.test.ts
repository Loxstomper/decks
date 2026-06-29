/**
 * theme-badge.test.ts — Unit tests for hasThemeOverride (P10-6).
 *
 * Verifies all three signal types:
 *   1. data-theme present → true
 *   2. data-background-color present → true
 *   3. --r-* var in style → true
 *   4. None of the above → false
 *   5. style with non --r-* declarations only → false
 *   6. Multiple overrides present → true (short-circuits on first match)
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, findByEid } from './index';
import { hasThemeOverride } from './theme-badge';

// ── Helper ────────────────────────────────────────────────────────────────────

function sectionEl(attrs = '', style = '') {
  const html = `<!DOCTYPE html>
<html><body>
<div class="reveal"><div class="slides">
  <section data-eid="s1"${attrs ? ' ' + attrs : ''}${style ? ` style="${style}"` : ''}>
    <h2 data-eid="t1">Title</h2>
  </section>
</div></div>
</body></html>`;
  const model = parseDeck(html);
  const el = findByEid(model, 's1');
  if (!el) throw new Error('section not found');
  return el;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('hasThemeOverride()', () => {
  it('returns false for a plain section with no theme attrs', () => {
    expect(hasThemeOverride(sectionEl())).toBe(false);
  });

  it('returns true when data-theme is set', () => {
    expect(hasThemeOverride(sectionEl('data-theme="moon"'))).toBe(true);
  });

  it('returns true when data-background-color is set', () => {
    expect(hasThemeOverride(sectionEl('data-background-color="#1a1a2e"'))).toBe(true);
  });

  it('returns true when style contains --r-* var', () => {
    expect(hasThemeOverride(sectionEl('', '--r-heading-color:#ff0'))).toBe(true);
  });

  it('returns false when style contains only non --r-* declarations', () => {
    expect(hasThemeOverride(sectionEl('', 'color:red;font-size:2rem'))).toBe(false);
  });

  it('returns true when both data-theme and --r-* vars are present', () => {
    expect(
      hasThemeOverride(sectionEl('data-theme="sky"', '--r-main-color:#fff')),
    ).toBe(true);
  });

  it('returns true when data-background-color AND --r-* vars are present', () => {
    expect(
      hasThemeOverride(sectionEl('data-background-color="#000"', '--r-link-color:blue')),
    ).toBe(true);
  });

  it('returns false on a section with only non-theme attrs (data-visibility, etc.)', () => {
    expect(hasThemeOverride(sectionEl('data-visibility="hidden"'))).toBe(false);
  });
});
