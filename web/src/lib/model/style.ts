/**
 * style.ts — Per-element inline `style` color helper (P9-8 / spec 09).
 *
 * WHY THIS EXISTS (spec 09 "Text appearance"):
 * ============================================
 * The editor owns LAYOUT, not styling — with ONE deliberate exception: a
 * whole-element text colour control. It writes an inline `style="color: …"` on
 * the selected text leaf (heading / paragraph / list / leaf). This is the lone
 * appearance property the editor writes; everything else stays in custom.css.
 *
 * Scope is whole-element (no sub-string runs). We read/write the `color`
 * declaration WITHIN the existing `style` attribute, preserving any other
 * declarations the user (or Claude Code) authored, and keeping the colour's
 * position stable so repeated edits round-trip byte-for-byte (spec 12 #4).
 *
 * Mutations go through edit.ts (setAttribute/removeAttribute) so the element is
 * marked dirty and the value is entity-encoded like any other attribute.
 */

import { getAttribute, setAttribute, removeAttribute } from './edit';
import type { ElementNode } from './types';

interface Decl {
  prop: string;
  value: string;
}

/** Split a `style` attribute literal into property/value declarations. */
function parseStyle(style: string): Decl[] {
  return style
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((d) => {
      const i = d.indexOf(':');
      if (i < 0) return { prop: d.trim(), value: '' };
      return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    });
}

/** Reserialize declarations back into a canonical `prop: value; …` string. */
function serializeStyle(decls: Decl[]): string {
  return decls.map((d) => (d.value ? `${d.prop}: ${d.value}` : d.prop)).join('; ');
}

/**
 * Read the inline `color` declaration on `el`, or null when there is no inline
 * style or no `color` property. Pure — used to seed the inspector control.
 */
export function getInlineColor(el: ElementNode): string | null {
  const style = getAttribute(el, 'style');
  if (!style) return null;
  const decl = parseStyle(style).find((d) => d.prop.toLowerCase() === 'color');
  return decl ? decl.value : null;
}

/**
 * Set (or clear, when `color` is null/blank) the inline `color` declaration on
 * `el`, preserving every other declaration and the existing colour position.
 *
 * Removing the last declaration drops the now-empty `style` attribute entirely
 * so the element returns to its un-styled form (clean round-trip).
 */
export function setInlineColor(el: ElementNode, color: string | null): void {
  const style = getAttribute(el, 'style') ?? '';
  const decls = parseStyle(style);
  const idx = decls.findIndex((d) => d.prop.toLowerCase() === 'color');
  const next = color?.trim();
  if (next) {
    if (idx >= 0) decls[idx] = { prop: decls[idx].prop, value: next };
    else decls.push({ prop: 'color', value: next });
  } else if (idx >= 0) {
    decls.splice(idx, 1);
  }
  if (decls.length === 0) removeAttribute(el, 'style');
  else setAttribute(el, 'style', serializeStyle(decls));
}
