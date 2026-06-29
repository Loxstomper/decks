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
import {
  serializeDeck,
  getAttribute,
  createElement,
  createText,
  appendChild,
  type ElementNode,
} from '$lib/model';
import { applyThumbnailLayout } from './thumbnail-layout';

/**
 * Serialize a single slide `<section>` to HTML. We wrap it in a throwaway
 * single-node model: `serializeDeck` emits untouched nodes byte-for-byte
 * (passthrough) and freshly-created/edited nodes canonically, so the thumbnail
 * always reflects the slide's CURRENT model state.
 */
export function serializeSection(section: ElementNode): string {
  return serializeDeck({ nodes: [section] });
}

// ── Chart placeholder (P17-16) ──────────────────────────────────────────────
//
// KNOWN THUMBNAIL-ONLY FIDELITY GAP (joins code highlighting + KaTeX math):
// thumbnails render script-free (sandbox="", no JS — see the file header), but a
// Chart.js chart is JS-driven: `<canvas data-chart>` is painted at runtime by the
// vendored chart plugin, which never runs here. So a chart would render as a blank
// box. Instead we SUBSTITUTE each chart canvas with a static, script-free SVG
// bar-chart placeholder of the same size, captioned with the chart type. This is
// purely a thumbnail approximation; the live canvas/editor + PDF export render the
// real chart. (Code blocks degrade to unhighlighted text; math to raw LaTeX — the
// same "static approximation, full fidelity at runtime" tradeoff.)

/** True when `el` is a chart canvas the editor owns (mirrors classify.ts). */
function isChartCanvas(el: ElementNode): boolean {
  return el.tagName.toLowerCase() === 'canvas' && getAttribute(el, 'data-chart') !== null;
}

/** Build a static SVG bar-chart placeholder div the size of the chart canvas. */
function buildChartPlaceholder(canvas: ElementNode): ElementNode {
  const w = getAttribute(canvas, 'width') ?? '600';
  const h = getAttribute(canvas, 'height') ?? '400';
  const type = (getAttribute(canvas, 'data-chart') ?? '').trim() || 'chart';

  const div = createElement('div', {
    class: 'sb-chart-placeholder',
    style: `width: ${w}px; height: ${h}px`,
  });

  // Three ascending bars on an L-axis — a recognisable, resource-free chart glyph.
  const svg = createElement('svg', {
    class: 'sb-chart-glyph',
    viewBox: '0 0 64 48',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '3',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  appendChild(svg, createElement('path', { d: 'M8 6v36h48' })); // axes
  appendChild(svg, createElement('path', { d: 'M18 42V30' })); // bar 1
  appendChild(svg, createElement('path', { d: 'M32 42V18' })); // bar 2
  appendChild(svg, createElement('path', { d: 'M46 42V24' })); // bar 3
  appendChild(div, svg);

  const label = createElement('span', { class: 'sb-chart-label' });
  appendChild(label, createText(`${type} chart`));
  appendChild(div, label);

  return div;
}

/**
 * Replace every `<canvas data-chart>` in the (already-cloned) subtree with a
 * static chart placeholder, in place. Operates ONLY on a clone (the caller passes
 * the applyThumbnailLayout output), so the live model is never mutated.
 */
export function substituteChartPlaceholders(node: ElementNode): void {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type !== 'element') continue;
    if (isChartCanvas(child)) {
      node.children[i] = buildChartPlaceholder(child);
    } else {
      substituteChartPlaceholders(child);
    }
  }
}

/** Options for buildThumbnailSrcdoc. */
export interface ThumbnailOptions {
  /** Reveal theme name (e.g. "black", "white", "moon"). Defaults to "black". */
  theme?: string;
}

/**
 * Build the `srcdoc` document for a slide thumbnail.
 *
 * @param deckName  the open deck's name (for the `/decks/<name>/` URLs)
 * @param section   the slide's `<section>` model node
 * @param opts      optional overrides (theme name, etc.)
 */
export function buildThumbnailSrcdoc(
  deckName: string,
  section: ElementNode,
  opts?: ThumbnailOptions,
): string {
  const base = `/decks/${encodeURIComponent(deckName)}/`;
  const theme = opts?.theme ?? 'black';
  // Resolve the numeric layout vocabulary (gap/pad/grid/grow/basis/span + free
  // x/y/w/h/rot) into inline styles BEFORE serializing, so the script-free
  // thumbnail renders the same static geometry the runtime slides-layout-init.js
  // produces on the live canvas. Operates on a clone — the model is untouched.
  const laidOut = applyThumbnailLayout(section);
  // P17-16: charts are JS-driven; swap each <canvas data-chart> for a static SVG
  // placeholder so the script-free thumbnail shows something meaningful.
  substituteChartPlaceholders(laidOut);
  const sectionHtml = serializeSection(laidOut);

  // Per-slide background color from data-background-color attribute.
  const bgColor = getAttribute(section, 'data-background-color');
  const bgColorRule = bgColor
    ? `background-color: ${bgColor} !important;`
    : '';

  // P16-4: data-background-image → CSS background-image (deck-relative path,
  // offline-first: external URLs are silently dropped).
  const bgImageRaw = getAttribute(section, 'data-background-image');
  const bgImageSafe = bgImageRaw && !/^https?:\/\//i.test(bgImageRaw) ? bgImageRaw : null;
  let bgImageInlineRule = '';
  let bgImageOpacityExtraRule = '';
  if (bgImageSafe) {
    const bgSize = getAttribute(section, 'data-background-size') ?? 'cover';
    const bgPos = getAttribute(section, 'data-background-position') ?? 'center';
    const bgRepeat = getAttribute(section, 'data-background-repeat') ?? 'no-repeat';
    const bgOpacity = getAttribute(section, 'data-background-opacity');
    if (bgOpacity !== null) {
      // Use a ::before pseudo-element so the opacity only affects the image
      // layer (not the slide's text/content above it), mirroring how
      // reveal.js achieves this via its .slide-background element.
      bgImageOpacityExtraRule = `
    .reveal .slides > section::before {
      content: ''; position: absolute; inset: 0;
      background-image: url('${bgImageSafe}');
      background-size: ${bgSize}; background-position: ${bgPos};
      background-repeat: ${bgRepeat}; opacity: ${bgOpacity};
      pointer-events: none; z-index: 0;
    }`;
    } else {
      bgImageInlineRule = `
      background-image: url('${bgImageSafe}') !important;
      background-size: ${bgSize} !important;
      background-position: ${bgPos} !important;
      background-repeat: ${bgRepeat} !important;`;
    }
  }

  // P16-4: data-background-gradient → CSS background shorthand.
  const bgGradient = getAttribute(section, 'data-background-gradient');
  const bgGradientRule = bgGradient
    ? `background: ${bgGradient} !important;`
    : '';

  // P16-4: data-background-video → neutral dark placeholder with a play glyph
  // (thumbnails are script-free; no video playback is possible here).
  const bgVideo = getAttribute(section, 'data-background-video');
  let bgVideoInlineRule = '';
  let bgVideoPlaceholderExtraRule = '';
  if (bgVideo) {
    bgVideoInlineRule = `background: #1a1a2e !important;`;
    // \25B6 is the ▶ BLACK RIGHT-POINTING TRIANGLE — a recognisable
    // play-button icon that requires no external resource.
    bgVideoPlaceholderExtraRule = `
    .reveal .slides > section::after {
      content: '\\25B6'; position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 80px; line-height: 1;
      color: rgba(255,255,255,0.45); pointer-events: none; z-index: 1;
    }`;
  }

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
       non-present sections by default). NOTE: deliberately does NOT set display
       here — reveal's "section { display:none }" rule has the same specificity,
       so we re-assert the section's REAL display per data-lay below (rather than
       forcing flex on everything, which would clobber grid/row). */
    .reveal .slides > section {
      position: absolute; top: 0; left: 0;
      width: ${LOGICAL_WIDTH}px; height: ${LOGICAL_HEIGHT}px;
      opacity: 1 !important; visibility: visible !important;
      transform: none !important; pointer-events: none;
      box-sizing: border-box; padding: 40px;
      ${bgColorRule}${bgImageInlineRule}${bgGradientRule}${bgVideoInlineRule}
    }
    /* Re-assert each top-level section's real display so it wins over reveal's
       display:none (no JS adds a .present class). For a section carrying data-lay
       this mirrors slides-layout.css; the attribute selectors raise specificity
       above reveal's "section" rule, which a bare [data-lay] rule cannot.
       A plain section (no data-lay) falls back to a vertically-centred column. */
    .reveal .slides > section[data-lay="stack"]  { display: flex; flex-direction: column; }
    .reveal .slides > section[data-lay="row"]    { display: flex; flex-direction: row; }
    .reveal .slides > section[data-lay="grid"]   { display: grid; }
    .reveal .slides > section[data-lay="layers"] { display: grid; }
    .reveal .slides > section:not([data-lay]) {
      display: flex; flex-direction: column; justify-content: center;
    }
    /* A vertical stack wrapper shows its first nested slide as the thumbnail. */
    .reveal .slides > section > section { position: static; height: auto; }
    .reveal .slides > section > section ~ section { display: none; }
    /* Show all fragment steps in the thumbnail (no JS to advance them). */
    .fragment { opacity: 1 !important; visibility: visible !important; }
    /* P17-16: static chart placeholder (charts are JS-driven; see header). */
    .sb-chart-placeholder {
      display: inline-flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px;
      max-width: 100%; box-sizing: border-box;
      border: 2px dashed rgba(128,128,128,0.45); border-radius: 8px;
      background: rgba(128,128,128,0.08);
      color: rgba(128,128,128,0.75);
    }
    .sb-chart-glyph { width: 96px; height: 72px; }
    .sb-chart-label {
      font-size: 28px; letter-spacing: 0.04em; text-transform: lowercase;
    }${bgImageOpacityExtraRule}${bgVideoPlaceholderExtraRule}
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
<link rel="stylesheet" href="assets/vendor/reveal/theme/${theme}.css">
<link rel="stylesheet" href="assets/vendor/slides-layout.css">
<link rel="stylesheet" href="assets/vendor/slides-slide-themes.css">
<link rel="stylesheet" href="assets/vendor/highlight/monokai.min.css">
<link rel="stylesheet" href="custom.css">
<style>${overrideCss}</style>
</head>
<body>
<div class="reveal"><div class="slides">${sectionHtml}</div></div>
</body>
</html>`;
}
