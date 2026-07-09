/**
 * theme.ts — Theme-props model for per-slide theming (P10 / spec theming-and-styles).
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
   * `data-background-image` — reveal.js per-slide background image. Usually a
   * local relative asset path (offline-first); pass-through string.
   */
  backgroundImage: string | null;
  /** `data-background-size` — CSS background-size (e.g. "cover", "contain", "100px"). */
  backgroundSize: string | null;
  /** `data-background-position` — CSS background-position (e.g. "center", "top left"). */
  backgroundPosition: string | null;
  /** `data-background-repeat` — CSS background-repeat (e.g. "no-repeat", "repeat"). */
  backgroundRepeat: string | null;
  /** `data-background-opacity` — reveal.js background opacity (0–1, string). */
  backgroundOpacity: string | null;
  /** `data-background-gradient` — CSS gradient string for the slide background. */
  backgroundGradient: string | null;
  /**
   * `data-background-video` — reveal.js per-slide background video. Usually a
   * local relative asset path (offline-first); may be a comma-separated list.
   */
  backgroundVideo: string | null;
  /** `data-background-video-loop` — reveal.js video loop flag (string, e.g. "true"). */
  backgroundVideoLoop: string | null;
  /** `data-background-video-muted` — reveal.js video muted flag (string, e.g. "true"). */
  backgroundVideoMuted: string | null;
  /**
   * Inline CSS custom properties whose names start with `--r-` (reveal.js
   * variable overrides). Read from the section's `style` attribute and written
   * back into it. Other style declarations are preserved verbatim.
   */
  inlineVars: Record<string, string> | null;
}

/**
 * Map of pass-through background `ThemeProps` keys to their reveal.js
 * `data-background-*` attribute names. These are all plain-string accessors:
 * `null` clears, any non-null value is written verbatim (no format validation —
 * reveal.js renders them natively in 5.x). Kept as a single table so get/set
 * stay byte-stable and trivially in sync.
 *
 * NOTE: `data-background-color` is handled here too (alongside its legacy
 * dedicated handling) so the whole background set round-trips uniformly.
 */
const BACKGROUND_ATTRS: ReadonlyArray<readonly [keyof ThemeProps, string]> = [
  ['backgroundColor', 'data-background-color'],
  ['backgroundImage', 'data-background-image'],
  ['backgroundSize', 'data-background-size'],
  ['backgroundPosition', 'data-background-position'],
  ['backgroundRepeat', 'data-background-repeat'],
  ['backgroundOpacity', 'data-background-opacity'],
  ['backgroundGradient', 'data-background-gradient'],
  ['backgroundVideo', 'data-background-video'],
  ['backgroundVideoLoop', 'data-background-video-loop'],
  ['backgroundVideoMuted', 'data-background-video-muted'],
];

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

  const styleRaw = getAttribute(el, 'style');
  const parsedVars = styleRaw !== null ? parseInlineRVars(styleRaw) : {};
  const inlineVars: Record<string, string> | null =
    Object.keys(parsedVars).length > 0 ? parsedVars : null;

  // Read the full data-background-* set (color/image/size/.../video flags) as
  // pass-through strings; absent → null.
  const bg: Record<string, string | null> = {};
  for (const [key, attr] of BACKGROUND_ATTRS) {
    bg[key as string] = getAttribute(el, attr);
  }

  return {
    theme,
    backgroundColor: bg.backgroundColor,
    backgroundImage: bg.backgroundImage,
    backgroundSize: bg.backgroundSize,
    backgroundPosition: bg.backgroundPosition,
    backgroundRepeat: bg.backgroundRepeat,
    backgroundOpacity: bg.backgroundOpacity,
    backgroundGradient: bg.backgroundGradient,
    backgroundVideo: bg.backgroundVideo,
    backgroundVideoLoop: bg.backgroundVideoLoop,
    backgroundVideoMuted: bg.backgroundVideoMuted,
    inlineVars,
  };
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

  // Pass-through data-background-* set (color/image/size/position/repeat/
  // opacity/gradient/video + video flags). null/undefined clears, any value is
  // written verbatim. Keys absent from delta are untouched (true partial update).
  for (const [key, attr] of BACKGROUND_ATTRS) {
    if (key in delta) {
      const value = delta[key] as string | null | undefined;
      if (value === null || value === undefined) {
        removeAttribute(el, attr);
      } else {
        setAttribute(el, attr, value);
      }
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
