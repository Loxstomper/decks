/**
 * theme.test.ts — Unit tests for the theme-props model (P10 / spec 16).
 *
 * Test goals:
 *   1. THEME_NAMES contains exactly the 10 bundled theme names (cross-check
 *      against the Go allowedTheme set).
 *   2. getThemeProps() returns typed props from data-* attrs and style — correct
 *      values, null for absent attrs, unknown theme values coerce to null.
 *   3. setThemeProps() get/set round-trip: write then read back produces the same
 *      value (byte-stability / no spurious mutations).
 *   4. setThemeProps() with null removes the attribute.
 *   5. inlineVars: --r-* vars are parsed, merged, and non --r-* style
 *      declarations are preserved verbatim.
 *   6. Invalid theme name throws TypeError.
 */

import { describe, it, expect } from 'vitest';
import { parseDeck, getAttribute, findByEid } from './index';
import {
  THEME_NAMES,
  isThemeName,
  getThemeProps,
  setThemeProps,
  type ThemeName,
} from './theme';

// ─── Helpers ───────────────────────────────────────────────────────────────

const SECTION_HTML = (attrs = '', style = '') => `<!DOCTYPE html>
<html><body>
<div class="reveal"><div class="slides">
  <section data-eid="s1"${attrs ? ' ' + attrs : ''}${style ? ` style="${style}"` : ''}>
    <h2 data-eid="t1">Slide</h2>
  </section>
</div></div>
</body></html>`;

function parseSectionEl(attrs = '', style = '') {
  const model = parseDeck(SECTION_HTML(attrs, style));
  const el = findByEid(model, 's1');
  if (!el) throw new Error('section not found');
  return el;
}

// ─── 1. THEME_NAMES ────────────────────────────────────────────────────────

describe('THEME_NAMES', () => {
  it('contains exactly the 10 bundled theme names', () => {
    const expected = [
      'black', 'white', 'league', 'beige', 'night',
      'moon', 'solarized', 'solarized-dark', 'dracula', 'sky',
    ];
    expect(THEME_NAMES.size).toBe(10);
    for (const name of expected) {
      expect(THEME_NAMES.has(name)).toBe(true);
    }
  });

  it('isThemeName() returns true for valid names and false for others', () => {
    expect(isThemeName('black')).toBe(true);
    expect(isThemeName('solarized-dark')).toBe(true);
    expect(isThemeName('dracula')).toBe(true);
    expect(isThemeName('bogus')).toBe(false);
    expect(isThemeName('')).toBe(false);
    expect(isThemeName('BLACK')).toBe(false); // case-sensitive
  });
});

// ─── 2. getThemeProps ──────────────────────────────────────────────────────

describe('getThemeProps()', () => {
  it('returns null for all props on a plain section (no attrs)', () => {
    const el = parseSectionEl();
    const props = getThemeProps(el);
    expect(props.theme).toBeNull();
    expect(props.backgroundColor).toBeNull();
    expect(props.inlineVars).toBeNull();
  });

  it('reads a valid data-theme', () => {
    const el = parseSectionEl('data-theme="solarized-dark"');
    const props = getThemeProps(el);
    expect(props.theme).toBe('solarized-dark');
  });

  it('coerces an unknown data-theme to null', () => {
    const el = parseSectionEl('data-theme="bogus"');
    const props = getThemeProps(el);
    expect(props.theme).toBeNull();
  });

  it('reads data-background-color as a raw string', () => {
    const el = parseSectionEl('data-background-color="#ff0000"');
    const props = getThemeProps(el);
    expect(props.backgroundColor).toBe('#ff0000');
  });

  it('reads --r-* vars from the style attribute', () => {
    const el = parseSectionEl('', '--r-background-color:#0a0a0a;--r-main-color:#eee');
    const props = getThemeProps(el);
    expect(props.inlineVars).not.toBeNull();
    expect(props.inlineVars!['--r-background-color']).toBe('#0a0a0a');
    expect(props.inlineVars!['--r-main-color']).toBe('#eee');
  });

  it('returns null inlineVars when style has no --r-* vars', () => {
    const el = parseSectionEl('', 'color:red');
    const props = getThemeProps(el);
    expect(props.inlineVars).toBeNull();
  });
});

// ─── 3 & 4. setThemeProps round-trip ──────────────────────────────────────

describe('setThemeProps() round-trip', () => {
  it('set then get data-theme round-trips correctly', () => {
    const el = parseSectionEl();
    setThemeProps(el, { theme: 'moon' });
    expect(getAttribute(el, 'data-theme')).toBe('moon');
    const props = getThemeProps(el);
    expect(props.theme).toBe('moon');
  });

  it('set null removes data-theme', () => {
    const el = parseSectionEl('data-theme="black"');
    expect(getAttribute(el, 'data-theme')).toBe('black');
    setThemeProps(el, { theme: null });
    expect(getAttribute(el, 'data-theme')).toBeNull();
    expect(getThemeProps(el).theme).toBeNull();
  });

  it('set then get data-background-color round-trips correctly', () => {
    const el = parseSectionEl();
    setThemeProps(el, { backgroundColor: 'rgb(10,20,30)' });
    expect(getAttribute(el, 'data-background-color')).toBe('rgb(10,20,30)');
    const props = getThemeProps(el);
    expect(props.backgroundColor).toBe('rgb(10,20,30)');
  });

  it('set null removes data-background-color', () => {
    const el = parseSectionEl('data-background-color="#abc"');
    setThemeProps(el, { backgroundColor: null });
    expect(getAttribute(el, 'data-background-color')).toBeNull();
  });

  it('partial delta does not touch unspecified props', () => {
    const el = parseSectionEl('data-theme="sky" data-background-color="#fff"');
    setThemeProps(el, { theme: 'night' });
    // backgroundColor must be unchanged
    expect(getAttribute(el, 'data-background-color')).toBe('#fff');
    expect(getAttribute(el, 'data-theme')).toBe('night');
  });

  it('all bundled theme names survive a round-trip', () => {
    for (const name of THEME_NAMES) {
      const el = parseSectionEl();
      setThemeProps(el, { theme: name as ThemeName });
      expect(getThemeProps(el).theme).toBe(name);
    }
  });
});

// ─── 5. inlineVars (--r-*) ────────────────────────────────────────────────

describe('setThemeProps() inlineVars', () => {
  it('writes --r-* vars into style attribute', () => {
    const el = parseSectionEl();
    setThemeProps(el, { inlineVars: { '--r-background-color': '#000', '--r-main-color': '#fff' } });
    const style = getAttribute(el, 'style');
    expect(style).toContain('--r-background-color:#000');
    expect(style).toContain('--r-main-color:#fff');
  });

  it('preserves non --r-* style declarations when merging vars', () => {
    const el = parseSectionEl('', 'color:red');
    setThemeProps(el, { inlineVars: { '--r-link-color': 'blue' } });
    const style = getAttribute(el, 'style') ?? '';
    expect(style).toContain('color:red');
    expect(style).toContain('--r-link-color:blue');
  });

  it('setting inlineVars to null removes all --r-* vars but preserves others', () => {
    const el = parseSectionEl('', 'color:red;--r-background-color:#000');
    setThemeProps(el, { inlineVars: null });
    const style = getAttribute(el, 'style') ?? '';
    expect(style).toContain('color:red');
    expect(style).not.toContain('--r-background-color');
  });

  it('round-trip: get then set then get inlineVars is byte-stable', () => {
    const el = parseSectionEl('', '--r-background-color:#0a0a0a;--r-main-color:#eee');
    const props1 = getThemeProps(el);
    setThemeProps(el, { inlineVars: props1.inlineVars ?? {} });
    const props2 = getThemeProps(el);
    expect(props2.inlineVars).toEqual(props1.inlineVars);
  });
});

// ─── 6. Invalid theme name throws ─────────────────────────────────────────

describe('setThemeProps() validation', () => {
  it('throws TypeError for an unknown theme name', () => {
    const el = parseSectionEl();
    expect(() => setThemeProps(el, { theme: 'bogus' as ThemeName })).toThrow(TypeError);
  });

  it('does not throw for any bundled theme name', () => {
    for (const name of THEME_NAMES) {
      const el = parseSectionEl();
      expect(() => setThemeProps(el, { theme: name as ThemeName })).not.toThrow();
    }
  });
});
