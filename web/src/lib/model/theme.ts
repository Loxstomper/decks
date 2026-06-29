/**
 * theme.ts — Theme-props model for per-slide theming (P10 / spec 16).
 *
 * WHY THIS MODULE EXISTS:
 * =======================
 * reveal.js supports per-slide themes via `data-theme` on `<section>` elements,
 * and per-slide background colours via `data-background-color`. P10 also adds
 * inline CSS custom properties (--r-*) on the section's `style` attribute for
 * fine-grained overrides.
 *
 * This module is the single translation layer between those raw attributes and
 * the typed `ThemeProps` object the UI controls bind to. It follows the exact
 * same conventions as layout.ts (get/set snapshot, scoped dirty, partial delta).
 *
 * Cross-reference: THEME_NAMES must stay identical to `allowedTheme` in
 * internal/validate/validate.go (P10).  Both are independent re-implementations
 * of the same spec contract — deliberate duplication to catch drift in either.
 *
 * Design contract (shared with Lane A model helpers and Lane C UI):
 *   getThemeProps(el)         → typed snapshot for the UI to display
 *   setThemeProps(el, delta)  → write changed props back as data-* / style attrs
 *
 * Note: `data-theme` is only meaningful on `<section>` elements. The helpers do
 * not enforce the element-type restriction — callers should only call them on
 * section nodes. The Go validator enforces the restriction at save/validate time.
 */

import { getAttribute, setAttribute, removeAttribute } from './edit';
import type { ElementNode } from './types';

// ─── Bundled theme names (spec P10) ────────────────────────────────────────
//
// Cross-reference: keep identical to `allowedTheme` in
// internal/validate/validate.go.  Any divergence will cause the Go validator
// to disagree with the TS model on which names are valid.

/**
 * The set of bundled reveal.js theme names supported by slides-builder (P10).
 *
 * Mirrors `allowedTheme` in internal/validate/validate.go — keep in sync.
 */
export const THEME_NAMES: ReadonlySet<string> = new Set([
  'black',
  'white',
  'league',
  'beige',
  'night',
  'moon',
  'solarized',
  'solarized-dark',
  'dracula',
  'sky',
]);

/** Union type of the 10 bundled theme names. */
export type ThemeName =
  | 'black'
  | 'white'
  | 'league'
  | 'beige'
  | 'night'
  | 'moon'
  | 'solarized'
  | 'solarized-dark'
  | 'dracula'
  | 'sky';

// ─── Typed theme props snapshot ────────────────────────────────────────────

/**
 * Typed snapshot of all theme-related attributes on a `<section>` element.
 * `null` means the attribute/property is absent (default/unset).
 *
 * `inlineVars` is a `Record<string, string>` of CSS custom properties found in
 * the element's `style` attribute whose names begin with `--r-`. These are
 * reveal.js CSS variable overrides and round-trip verbatim.
 */
export interface ThemeProps {
  /** `data-theme` — bundled reveal.js theme name. Only meaningful on `<section>`. */
  theme: ThemeName | null;
  /**
   * `data-background-color` — reveal.js per-slide background colour (any CSS
   * colour string). Pass-through: no format validation is applied.
   */
  backgroundColor: string | null;
  /**
   * Inline CSS custom properties whose names start with `--r-` (reveal.js
   * variable overrides). Read from the section's `style` attribute and written
   * back into it. Other style declarations are preserved verbatim.
   */
  inlineVars: Record<string, string> | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Guard: is the string a valid ThemeName? */
export function isThemeName(v: string): v is ThemeName {
  return THEME_NAMES.has(v);
}

/**
 * Parse the inline `--r-*` CSS custom properties from a `style` attribute
 * string.  Non `--r-*` declarations are ignored and preserved on write.
 * Returns an empty object when no `--r-*` vars are present.
 */
function parseInlineRVars(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Split on ';', keeping declarations of the form "--r-name: value".
  for (const decl of style.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed.startsWith('--r-')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const propName = trimmed.slice(0, colonIdx).trim();
    const propValue = trimmed.slice(colonIdx + 1).trim();
    if (propName && propValue) {
      result[propName] = propValue;
    }
  }
  return result;
}

/**
 * Merge updated `--r-*` vars into an existing `style` attribute string.
 * Non `--r-*` declarations in the original style are preserved.
 * `--r-*` vars present in `updates` replace or insert; `--r-*` vars absent
 * from `updates` and already in the style are removed (explicit null not
 * needed — omitting a key from `updates` removes it).
 *
 * Returns the new style string (empty string if nothing remains).
 */
function mergeInlineRVars(
  existingStyle: string,
  updates: Record<string, string>,
): string {
  // Preserve non --r-* declarations.
  const kept: string[] = [];
  for (const decl of existingStyle.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed || trimmed.startsWith('--r-')) continue;
    kept.push(trimmed);
  }
  // Append updated --r-* vars in sorted order for byte-stability.
  for (const [k, v] of Object.entries(updates).sort(([a], [b]) => a.localeCompare(b))) {
    kept.push(`${k}:${v}`);
  }
  return kept.join(';');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Read all theme-related attributes from `el` into a typed snapshot.
 *
 * `el` should be a `<section>` element. `data-theme` is read and validated
 * against THEME_NAMES; unknown values coerce to `null` (same convention as
 * layout.ts for unknown enum values). `data-background-color` is read as a raw
 * string (pass-through; any value). `--r-*` vars are parsed from `style=`.
 */
export function getThemeProps(el: ElementNode): ThemeProps {
  const themeRaw = getAttribute(el, 'data-theme');
  const theme: ThemeName | null =
    themeRaw !== null && isThemeName(themeRaw) ? themeRaw : null;

  const backgroundColor = getAttribute(el, 'data-background-color');

  const styleRaw = getAttribute(el, 'style');
  const parsedVars = styleRaw !== null ? parseInlineRVars(styleRaw) : {};
  const inlineVars: Record<string, string> | null =
    Object.keys(parsedVars).length > 0 ? parsedVars : null;

  return { theme, backgroundColor, inlineVars };
}

/**
 * Write a partial `ThemeProps` delta back to `el` as attributes / style.
 *
 * Rules (identical convention to setLayoutProps):
 *   • `null` value → remove the attribute (absent = default).
 *   • Non-null value → set the attribute (marks element dirty via setAttribute).
 *   • Keys absent from `delta` → not touched (true partial update).
 *
 * `inlineVars`: when present in delta, replaces ALL `--r-*` vars in the style
 * attribute (non `--r-*` declarations are preserved).  `null` → remove all
 * `--r-*` vars from style.
 *
 * VALIDATION: an invalid theme name throws TypeError so callers catch mistakes
 * early (same pattern as setLayoutProps).
 */
export function setThemeProps(el: ElementNode, delta: Partial<ThemeProps>): void {
  if ('theme' in delta) {
    if (delta.theme !== null && delta.theme !== undefined && !isThemeName(delta.theme)) {
      throw new TypeError(`setThemeProps: invalid data-theme value "${delta.theme}"`);
    }
    if (delta.theme === null || delta.theme === undefined) {
      removeAttribute(el, 'data-theme');
    } else {
      setAttribute(el, 'data-theme', delta.theme);
    }
  }

  if ('backgroundColor' in delta) {
    if (delta.backgroundColor === null || delta.backgroundColor === undefined) {
      removeAttribute(el, 'data-background-color');
    } else {
      setAttribute(el, 'data-background-color', delta.backgroundColor);
    }
  }

  if ('inlineVars' in delta) {
    const existingStyle = getAttribute(el, 'style') ?? '';
    const updates: Record<string, string> = delta.inlineVars ?? {};
    const newStyle = mergeInlineRVars(existingStyle, updates);
    if (newStyle === '') {
      removeAttribute(el, 'style');
    } else {
      setAttribute(el, 'style', newStyle);
    }
  }
}
