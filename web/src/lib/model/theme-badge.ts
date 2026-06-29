/**
 * theme-badge.ts — hasThemeOverride helper (P10-6).
 *
 * Extracted as a pure function so it can be unit-tested independently of Svelte
 * and used by both Navigator.svelte (badge rendering) and any future consumer.
 *
 * A slide `<section>` has a theme override when ANY of the following is true:
 *   1. `data-theme` attribute is present (a named bundled theme override).
 *   2. `data-background-color` attribute is present (managed background colour).
 *   3. The `style` attribute contains at least one `--r-*` CSS custom property
 *      (inline reveal.js variable overrides).
 *
 * The function is intentionally dependency-free (uses only getAttribute from
 * edit.ts) so it can be used in vitest unit tests without Svelte setup.
 */

import { getAttribute } from './edit';
import type { ElementNode } from './types';

/**
 * Returns true when the `<section>` element has any per-slide theme override:
 * a named `data-theme`, a managed `data-background-color`, or inline `--r-*`
 * CSS custom properties in its `style` attribute.
 *
 * Pass the live model `ElementNode` (the `section` field from `SlideTreeNode`).
 * Safe to call on any ElementNode — returns false if called on a non-section
 * (no section-specific attrs will match).
 */
export function hasThemeOverride(section: ElementNode): boolean {
  // 1. Named bundled theme (data-theme).
  if (getAttribute(section, 'data-theme') !== null) return true;

  // 2. Managed background colour (data-background-color).
  if (getAttribute(section, 'data-background-color') !== null) return true;

  // 3. Inline --r-* CSS custom properties in style attribute.
  const style = getAttribute(section, 'style');
  if (style !== null && /--r-/.test(style)) return true;

  return false;
}
