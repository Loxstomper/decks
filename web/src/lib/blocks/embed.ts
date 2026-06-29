/**
 * blocks/embed.ts — Embed / iframe builder (P5-13 / spec 03 "Embed / iframe").
 *
 * Inserts an `<iframe>` embed (YouTube / Maps / etc.). Like shapes, the embed is
 * a FREE element (data-free + 16:9 default rect) so it is immediately
 * positionable/resizable on the canvas.
 *
 * OFFLINE CAVEAT (spec 08 / spec 12):
 *   Embeds are the ONE documented exception to "zero external URLs in deck.html"
 *   — an iframe is inherently a live reference and cannot be localized like an
 *   image. This is acceptable: the embed needs network *at present time*, but the
 *   EDITOR and the deck *file* stay self-contained (we store only the URL the
 *   user supplied; we never inject scripts or CDN tags). Everything else in the
 *   deck still works fully offline.
 *
 * The URL is supplied by the palette (an `InsertField`); the builder only
 * assembles markup, so it stays pure and testable.
 */

import { createElement } from '$lib/model/edit';
import type { ElementNode } from '$lib/model/types';

/** A neutral placeholder so an empty insert still yields a valid, visible box. */
const PLACEHOLDER_SRC = 'about:blank';

/** 16:9 default box, centred on the 1920×1080 logical canvas (spec 05). */
const DEFAULT_W = 960;
const DEFAULT_H = 540;

/**
 * Build a free-positioned `<iframe>` embed pointing at `url`.
 *
 * `allowfullscreen` lets video embeds present fullscreen; `loading="lazy"` keeps
 * an offline/slow deck responsive. The element is sized by the free-layout CSS
 * (data-w/h → inline width/height), so no width/height attrs are needed.
 */
export function buildEmbed(url?: string): ElementNode {
  const src = url && url.trim() !== '' ? url.trim() : PLACEHOLDER_SRC;
  const x = (1920 - DEFAULT_W) / 2;
  const y = (1080 - DEFAULT_H) / 2;
  return createElement('iframe', {
    src,
    allowfullscreen: null, // boolean attribute
    loading: 'lazy',
    style: 'border:0',
    'data-free': null,
    'data-x': String(x),
    'data-y': String(y),
    'data-w': String(DEFAULT_W),
    'data-h': String(DEFAULT_H),
  });
}
