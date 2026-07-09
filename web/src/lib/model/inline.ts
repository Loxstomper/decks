/**
 * inline.ts — Canonical inline-HTML serializer + sanitizer (P17-1 / P17-2).
 *
 * WHY THIS EXISTS (spec canvas-interaction rich text, spec principles-and-invariants security + byte-stability):
 * ======================================================================
 * When the user edits a text leaf in place (contenteditable), the browser hands
 * us `innerHTML` full of junk: `<div>`/`<font>` wrappers, `&nbsp;`, style soup,
 * arbitrary classes, pasted `<script>`/`on*` handlers, `javascript:` hrefs, and
 * external resource URLs. None of that may reach the model (spec principles-and-invariants #5 security;
 * X-1 offline-first). This module is the ONE gate that turns any such fragment
 * into a fixed, deterministic ALLOWLIST of inline marks:
 *
 *     strong · em · u · s · a[href,target,rel] · span[style: color,font-size] · br
 *
 * Normalisation rules (P17-1 / constraint #4):
 *   • b   → strong,  i → em,  font → span         (legacy tag mapping)
 *   • div / p / unknown / disallowed element       → UNWRAP (keep text, drop tag)
 *   • script / style                               → DROP entirely (content too)
 *   • &nbsp; (and other entity soup)               → normalised via decode→encode
 *   • a[href] with javascript:/vbscript:/data:     → anchor UNWRAPPED (href neutralised)
 *   • span[style] keeps ONLY `color` + `font-size`; an empty span is unwrapped
 *   • on* handlers, class, id, any other attribute → stripped (allowlist only)
 *
 * BYTE-STABILITY (spec principles-and-invariants #4): instead of hand-rolling a second HTML emitter we
 * REUSE the model's own parser + serializer. We parse the fragment with the
 * existing source-preserving {@link parseDeck}, rewrite the node tree into the
 * allowlist using the canonical {@link createElement}/{@link createText} helpers
 * (which mark nodes dirty and carry no `raw`), then emit with {@link serializeDeck}.
 * So the inline serializer's output is *defined* by the model serializer — there
 * is no separate canonicalisation to drift out of sync. Attribute order, quoting,
 * and entity encoding are therefore identical to every other edited element.
 *
 * PURE + DOM-FREE: like the rest of the model core (see types.ts) this never
 * touches `DOMParser`, so it is unit-testable in the plain `node` vitest env and
 * runs identically in the browser. The contenteditable controller feeds us the
 * `innerHTML` string; we never need a live DOM.
 */

import { parseDeck } from './parse';
import { serializeDeck } from './serialize';
import { createElement, createText } from './edit';
import { decodeEntities } from './entities';
import type { ElementNode, SlideNode } from './types';

/**
 * Tags recognised as inline marks anywhere in the model (classify.ts uses this
 * to treat them as managed inline content WITHIN leaves — never a new leaf, never
 * passthrough, never `data-eid`-stamped). Superset of the canonical OUTPUT set:
 * it also covers the legacy tags we normalise away (`b`, `i`, `font`) so an
 * already-authored deck containing them is still recognised as inline.
 */
export const INLINE_MARK_TAGS: ReadonlySet<string> = new Set([
  'strong', 'em', 'u', 's', 'a', 'span', 'br',
  // legacy / mapped-away forms (still inline content, normalised on edit)
  'b', 'i', 'font',
]);

/** True when `tag` (any case) is an inline mark (allowlisted or legacy). */
export function isInlineMarkTag(tag: string): boolean {
  return INLINE_MARK_TAGS.has(tag.toLowerCase());
}

/** Legacy tag → canonical allowlist tag (b→strong, i→em, font→span). */
const TAG_CANONICAL: Record<string, string> = {
  b: 'strong',
  i: 'em',
  font: 'span',
};

/** The canonical OUTPUT allowlist — what a serialized mark is ever emitted as. */
const CANONICAL_TAGS = new Set(['strong', 'em', 'u', 's', 'a', 'span', 'br']);

/** Marks that take NO attributes (everything on them is stripped). */
const BARE_TAGS = new Set(['strong', 'em', 'u', 's', 'br']);

/** Style declarations a `<span style>` may keep (everything else is dropped). */
const ALLOWED_STYLE_PROPS = new Set(['color', 'font-size']);

/**
 * True when `href` is safe to keep on an `<a>`: relative paths, in-page
 * fragments, and the http(s)/mailto/tel navigation schemes are allowed (external
 * <a> NAVIGATION is fine — spec principles-and-invariants only forbids external RESOURCE loads). Script
 * URLs (javascript:, vbscript:) and `data:` URLs are rejected.
 *
 * Exposed for Lane C (link UI) so the "insert link" affordance can validate a
 * typed URL with the exact same rule the sanitizer enforces.
 */
export function isSafeHref(href: string): boolean {
  const raw = href.trim();
  if (raw === '') return false;
  if (raw.startsWith('#')) return true;
  // A scheme is letters/digits/+/-/. up to the first ':' BEFORE any '/', '?', '#'.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
  if (!schemeMatch) return true; // no scheme → relative or protocol-relative (//host)
  const scheme = schemeMatch[1].toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
}

/** Filter a span's `style` to the allowed properties, returning a canonical
 *  `prop: value; …` string (matching style.ts), or '' when nothing survives. */
function sanitizeStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (value !== '' && ALLOWED_STYLE_PROPS.has(prop)) kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

/** Decoded literal `name=value` attributes the canonical mark should carry, or
 *  `null` to signal "unwrap this mark" (no safe attributes left). */
function sanitizeMarkAttrs(tag: string, el: ElementNode): Record<string, string> | null {
  if (BARE_TAGS.has(tag)) return {}; // strong/em/u/s/br carry nothing

  // Decode entities here; createElement re-encodes, so values cross as literals.
  const get = (name: string): string | null => {
    const a = el.attributes.find((x) => x.name.toLowerCase() === name);
    if (!a) return null;
    return a.value === null ? '' : decodeEntities(a.value);
  };

  if (tag === 'a') {
    const href = get('href');
    if (href === null || !isSafeHref(href)) return null; // no safe href → unwrap
    const out: Record<string, string> = { href };
    const target = get('target');
    const rel = get('rel');
    if (target !== null) out.target = target;
    if (rel !== null) out.rel = rel;
    return out;
  }

  if (tag === 'span') {
    const style = get('style');
    const clean = style ? sanitizeStyle(style) : '';
    if (clean === '') return null; // a span with no allowed style is pointless → unwrap
    return { style: clean };
  }

  return {};
}

/** Build a canonical, dirty inline mark node (a `<br>` is void). */
function makeMark(tag: string, attrs: Record<string, string>): ElementNode {
  const el = createElement(tag, attrs);
  if (tag === 'br') el.isVoid = true;
  return el;
}

/** Rewrite one parsed node into zero-or-more canonical allowlisted nodes. */
function normalizeNode(node: SlideNode): SlideNode[] {
  // Text: re-encode through the canonical path so &nbsp; → space and all entity
  // soup is normalised identically to setText().
  if (node.type === 'text') {
    return [createText(decodeEntities(node.value))];
  }
  // Comments / CDATA / doctype have no place in inline content — drop them.
  if (node.type !== 'element') return [];

  const tag = node.tagName.toLowerCase();

  // script/style: never survive (content dropped too) — the security invariant.
  if (tag === 'script' || tag === 'style') return [];

  const canonical = TAG_CANONICAL[tag] ?? tag;
  if (CANONICAL_TAGS.has(canonical)) {
    const attrs = sanitizeMarkAttrs(canonical, node);
    if (attrs !== null) {
      const mark = makeMark(canonical, attrs);
      if (canonical !== 'br') mark.children = normalizeChildren(node.children);
      return [mark];
    }
    // attrs === null → unwrap (keep the text, drop the now-meaningless tag).
  }

  // Anything else (div, p, headings, unknown, img, …) → unwrap to its content.
  return normalizeChildren(node.children);
}

/** Normalise a child list, flattening the per-node results. */
function normalizeChildren(children: SlideNode[]): SlideNode[] {
  const out: SlideNode[] = [];
  for (const child of children) out.push(...normalizeNode(child));
  return out;
}

/**
 * Parse a raw contenteditable/clipboard HTML fragment and rewrite it into a list
 * of canonical, ALLOWLISTED, dirty model nodes ready to become a leaf's children
 * (P17-3 writeback). All returned nodes are `dirty` so the owning leaf
 * re-serializes them canonically while keeping its own tag bytes.
 */
export function parseInlineNodes(rawHtml: string): SlideNode[] {
  const { nodes } = parseDeck(rawHtml);
  return normalizeChildren(nodes);
}

/**
 * Sanitize + canonicalize a raw inline-HTML fragment to the allowlist, returning
 * an HTML string. Pure and deterministic: `serializeInlineHtml(x)` is the model
 * serializer's emission of `parseInlineNodes(x)`, so it is byte-identical to how
 * the same content serializes once written into a leaf.
 *
 * Used directly by the paste handler (sanitize before insert) and by tests.
 */
export function serializeInlineHtml(rawHtml: string): string {
  return serializeDeck({ nodes: parseInlineNodes(rawHtml) });
}
