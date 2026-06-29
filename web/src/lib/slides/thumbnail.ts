/**
 * thumbnail.ts — Build an offline, static thumbnail document for one slide
 * (P6-2 / spec 06 "Thumbnails: rendered from the live model").
 *
 * APPROACH (chosen for robustness + offline correctness):
 * =======================================================
 * Each thumbnail is a SANDBOXED iframe whose `srcdoc` is a self-contained HTML
 * document that:
 *   1. links the deck's OWN stylesheets by root-relative URL
 *      (`/decks/<name>/assets/vendor/reveal/reveal.css`, the theme, the
 *      slides-layout vocabulary, the highlight theme, and `custom.css`), and
 *   2. embeds the single slide's serialized `<section>` markup inside the
 *      `.reveal > .slides` scaffold, then
 *   3. statically lays that one section out at the logical 1920×1080 canvas and
 *      lets the parent scale it down with CSS `transform`.
 *
 * WHY NOT a full reveal.js instance per thumbnail: spinning up reveal (scripts +
 * its scaling/animation engine) for every slide is heavy and would need
 * `allow-scripts`. We only need a *static* visual approximation, so the
 * thumbnail iframe runs NO scripts (`sandbox=""`). reveal's runtime normally
 * positions/scales `.slides` via JavaScript; with no JS we neutralise that with a
 * small override stylesheet that pins the section to the full logical canvas and
 * forces it visible. The result inherits the deck's real theme (fonts, colours,
 * backgrounds) and the slides-layout flex/grid vocabulary, so it visually
 * approximates the slide.
 *
 * OFFLINE (spec 12): every URL is root-relative to `/decks/<name>/…`, which the
 * Go backend serves from the deck's own `assets/` (vendored, zero external
 * URLs). The `<base href>` makes relative asset references inside slide content
 * (e.g. `assets/img.png`) resolve against the deck directory too. A srcdoc
 * document is same-origin with the editor, so these subresource loads succeed
 * even though the iframe itself is sandboxed to an opaque origin.
 *
 * Pure string builder → unit-testable; the Svelte component just renders it.
 */

import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '$lib/coords';
import { serializeDeck, type ElementNode } from '$lib/model';

/**
 * Serialize a single slide `<section>` to HTML. We wrap it in a throwaway
 * single-node model: `serializeDeck` emits untouched nodes byte-for-byte
 * (passthrough) and freshly-created/edited nodes canonically, so the thumbnail
 * always reflects the slide's CURRENT model state.
 */
export function serializeSection(section: ElementNode): string {
  return serializeDeck({ nodes: [section] });
}

/**
 * Build the `srcdoc` document for a slide thumbnail.
 *
 * @param deckName  the open deck's name (for the `/decks/<name>/` URLs)
 * @param section   the slide's `<section>` model node
 */
export function buildThumbnailSrcdoc(deckName: string, section: ElementNode): string {
  const base = `/decks/${encodeURIComponent(deckName)}/`;
  const sectionHtml = serializeSection(section);

  // Override stylesheet: reveal.js normally drives `.slides` positioning + the
  // visibility of the current section from JavaScript. With no JS we pin a single
  // section to the full logical canvas and force it visible/opaque so the static
  // render approximates how reveal would present it.
  const overrideCss = `
    html, body {
      margin: 0; padding: 0;
      width: ${LOGICAL_WIDTH}px; height: ${LOGICAL_HEIGHT}px;
      overflow: hidden;
      background: var(--r-background-color, #191919);
    }
    .reveal { width: ${LOGICAL_WIDTH}px; height: ${LOGICAL_HEIGHT}px; }
    /* Neutralise reveal's JS-driven transform/centring of the slides layer. */
    .reveal .slides {
      position: static; width: 100%; height: 100%;
      left: auto; top: auto; transform: none; text-align: center;
    }
    /* Pin THIS slide to the whole canvas and force it visible (reveal hides
       non-present sections by default). */
    .reveal .slides > section {
      position: absolute; top: 0; left: 0;
      width: ${LOGICAL_WIDTH}px; height: ${LOGICAL_HEIGHT}px;
      display: flex !important; flex-direction: column; justify-content: center;
      opacity: 1 !important; visibility: visible !important;
      transform: none !important; pointer-events: none;
      box-sizing: border-box; padding: 40px;
    }
    /* A vertical stack wrapper shows its first nested slide as the thumbnail. */
    .reveal .slides > section > section { position: static; height: auto; }
    .reveal .slides > section > section ~ section { display: none; }
  `;

  // NOTE: the override <link>/<style> order matters — overrides come AFTER the
  // deck stylesheets so they win without !important where possible.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="${base}">
<link rel="stylesheet" href="assets/vendor/reveal/reset.css">
<link rel="stylesheet" href="assets/vendor/reveal/reveal.css">
<link rel="stylesheet" href="assets/vendor/reveal/theme/black.css">
<link rel="stylesheet" href="assets/vendor/slides-layout.css">
<link rel="stylesheet" href="assets/vendor/highlight/monokai.min.css">
<link rel="stylesheet" href="custom.css">
<style>${overrideCss}</style>
</head>
<body>
<div class="reveal"><div class="slides">${sectionHtml}</div></div>
</body>
</html>`;
}
