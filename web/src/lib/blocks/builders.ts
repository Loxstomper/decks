/**
 * builders.ts — Pure factory functions for insertable block elements (P5-4, P5-9, P5-10).
 *
 * WHY PURE: These functions have zero side-effects and no imports from the store
 * or fetch layer.  They produce dirty ElementNode trees ready to pass to
 * deckStore.insertBlock() (or any model mutation).  Pure = fully unit-testable
 * without DOM or fetch mocks.
 *
 * All returned nodes are dirty=true so serializeDeck emits canonical markup for
 * them (spec principles-and-invariants §4 — byte-stable passthrough only applies to untouched nodes).
 */

import { createElement, createText, appendChild } from '$lib/model';
import type { ElementNode } from '$lib/model';

// ── Image block (P5-4, P5-5, P5-7, P5-8) ────────────────────────────────────

/**
 * Build an <img> leaf element.
 *
 * `src` MUST be a relative deck-asset path ("assets/photo.jpg") — never an
 * external URL.  This is enforced by callers (upload/localize pipeline) so the
 * deck stays self-contained and offline-first (spec assets-and-media, principles-and-invariants).
 *
 * The optional `alt` text defaults to empty; screen-reader quality is the
 * integrator's concern, not the format's.
 */
export function buildImageBlock(src: string, alt = ''): ElementNode {
  // <img> is a void element — no children, selfClosing will be canonicalized by
  // the serializer.  We set it explicitly so future readers are not surprised.
  const img = createElement('img', { src, alt });
  // Explicitly mark as void so the serializer emits `<img ... />` not `<img ...></img>`.
  img.isVoid = true;
  return img;
}

// ── Code block (P5-9) ────────────────────────────────────────────────────────

/**
 * Build a reveal.js highlight code block:
 *   <pre><code class="language-{lang}" data-line-numbers[="range"]>
 *     {code}
 *   </code></pre>
 *
 * `lang`        — lowercase language identifier ("javascript", "python", …).
 *                 Used as the highlight.js language class.  Empty string →
 *                 "plaintext" so highlight.js does not error.
 *
 * `code`        — source text (will be entity-encoded by the serializer).
 *                 Empty string is valid; the user edits the source pane after
 *                 insertion.
 *
 * `lineNumbers` — controls the reveal highlight `data-line-numbers` attribute:
 *   • false    → attribute omitted (no line numbers)
 *   • true     → `data-line-numbers` (boolean — all lines numbered)
 *   • "1-3|5"  → `data-line-numbers="1-3|5"` (step-through specific ranges,
 *                  reveal's fragment-step line-highlight feature)
 *
 * WHY `pre > code` (not just `code`): highlight.js and reveal's highlight plugin
 * both require the `<pre><code>` nesting to identify code blocks; bare `<code>`
 * is treated as inline code.
 */
export function buildCodeBlock(
  lang: string,
  code = '',
  lineNumbers: boolean | string = false,
): ElementNode {
  const safeLang = lang.trim() || 'plaintext';

  // Build <code class="language-{lang}" [data-line-numbers[="range"]]>
  const attrs: Record<string, string | null> = {
    class: `language-${safeLang}`,
  };
  if (lineNumbers !== false) {
    // null value → boolean attribute (<code data-line-numbers>);
    // string    → <code data-line-numbers="1-3|5">
    attrs['data-line-numbers'] = lineNumbers === true ? null : lineNumbers;
  }
  const codeEl = createElement('code', attrs);
  if (code) {
    appendChild(codeEl, createText(code));
  }

  // Wrap in <pre>
  const pre = createElement('pre');
  appendChild(pre, codeEl);
  return pre;
}

// ── Math block (P5-10) ───────────────────────────────────────────────────────

/**
 * Build a KaTeX / MathJax display-math block:
 *   <div class="math-block">\[ {latex} \]</div>
 *
 * `latex` — raw LaTeX source (e.g. "e = mc^2").  The `\[...\]` display-math
 *   delimiters are added by this function; do NOT include them in `latex`.
 *
 * WHY `\[ ... \]` delimiters:
 *   The reveal.js math plugin (RevealMath.KaTeX / RevealMath.MathJax3) scans
 *   slide content and renders display-math wrapped in `\[...\]` (and inline-math
 *   in `\(...\)`).  Using `$$...$$` also works with most configurations, but
 *   `\[...\]` is the unambiguous LaTeX standard that is always enabled.
 *
 * WHY class "math-block":
 *   A stable hook for CSS (center, padding) and for the editor to recognise the
 *   node as a math leaf in future classify() extensions.  The reveal plugin does
 *   not require any specific class — it processes delimiters anywhere in a slide.
 *
 * Requires Lane GO to vendor the reveal math plugin (KaTeX, offline) and
 * enable it in the deck template.  The block is inert without it but does not
 * break the deck (degrades to raw LaTeX text).
 */
export function buildMathBlock(latex: string): ElementNode {
  const div = createElement('div', { class: 'math-block' });
  // Surround with display-math delimiters.  encodeText (called by createText)
  // preserves backslashes — they are not special in HTML text content.
  appendChild(div, createText(`\\[ ${latex} \\]`));
  return div;
}

// ── Chart block (P17-15) ───────────────────────────────────────────────────

/** Default canvas dimensions (logical px). Charts run with reveal's responsive
 *  sizing OFF (see the vendored plugin), so the canvas needs an explicit size. */
export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 400;

/**
 * Build a Chart.js canvas block:
 *   <canvas width="600" height="400"
 *           data-chart="{type}"
 *           data-chart-data='{"type":"{type}","data":{…},"options":{…}}'></canvas>
 *
 * `type`     — the Chart.js chart type ("bar", "line", "pie", …). Stamped on the
 *              `data-chart` attribute (the marker the vendored plugin scans for)
 *              AND expected to match the `type` field inside `dataJson`. The
 *              panel keeps the two in sync; this builder writes both verbatim.
 *
 * `dataJson` — a JSON string holding a Chart.js config object
 *              `{type, data, options?}`. Written VERBATIM (no re-stringify) so the
 *              attribute is byte-stable and round-trips exactly what the editor
 *              produced. Callers MUST pass valid JSON (the panel/inspector
 *              validate before calling).
 *
 * WHY a sized <canvas> (not a wrapper): the vendored chart plugin
 * (internal/deck/vendor/chart/plugin.js) renders with `responsive:false`, so the
 * canvas must carry intrinsic width/height. <canvas> is NOT a void element; we
 * leave it childless (a fallback text child is allowed but unnecessary).
 *
 * OFFLINE-FIRST (spec principles-and-invariants): emits zero external URLs — Chart.js + the plugin are
 * vendored into the deck by the scaffold (Lane GO / P17-14).
 */
export function buildChartBlock(type: string, dataJson: string): ElementNode {
  const safeType = type.trim() || 'bar';
  return createElement('canvas', {
    width: String(CHART_WIDTH),
    height: String(CHART_HEIGHT),
    'data-chart': safeType,
    'data-chart-data': dataJson,
  });
}

// ── QR code block (P19) ──────────────────────────────────────────────────────

/** Default rendered size of a QR block (logical px, square). The free-layout CSS
 *  sizes the div from data-w/h (→ inline width/height); the SVG fills it. */
export const QR_DEFAULT_SIZE = 280;

/** QR generation/encoding defaults (mirrored by the vendored plugin's fallbacks). */
export const QR_DEFAULTS = { ec: 'M', fg: '#000000', bg: '#ffffff', quiet: 4 } as const;

/**
 * Build the `aria-label` for a QR block from its payload. The encoded value is
 * otherwise opaque to assistive tech, so we surface it (spec layout-vocabulary "QR code").
 * Shared with the store's edit command so insert + edit stay consistent.
 */
export function qrAriaLabel(payload: string): string {
  return `QR code: ${payload}`;
}

/**
 * Build a QR code leaf as a FREE (absolutely-positioned) block, centred on the
 * logical canvas:
 *   <div data-qr="{payload}" data-qr-ec="M" data-qr-fg="#000000"
 *        data-qr-bg="#ffffff" data-qr-quiet="4"
 *        aria-label="QR code: {payload}"
 *        data-free data-x="820" data-y="400" data-w="280" data-h="280"></div>
 *
 * WHY FREE (not a flow leaf like chart): a QR is a small fixed-size graphic the
 * user positions on the slide — like a shape/image/embed. As a flow child it lands
 * wherever the layout puts it (e.g. appended after a title layout's content slot,
 * it overflows off the bottom edge) and can't be dragged. Free placement gives it
 * known on-canvas coords + drag/resize from the first insert. The block registry
 * pairs this with `placement: 'free'` so the insert seam drops it into the slide
 * section, not a content slot (see blocks/qr.ts).
 *
 * The div is EMPTY on disk (byte-stable round-trip); the vendored QR plugin
 * (internal/deck/vendor/qr/plugin.js) renders an inline SVG into it at runtime
 * from the data-qr* attributes. The free-layout CSS sizes the div from data-w/h.
 *
 * `fg`/`bg`/`quiet` are functional inputs to QR generation stored as data-qr-*
 * attributes (not CSS) — the renderer must read them to draw scannable modules
 * (spec layout-vocabulary "QR code").
 *
 * OFFLINE-FIRST (spec principles-and-invariants): emits zero external URLs — the QR generator + plugin
 * are vendored into the deck by the scaffold (P19-1). The block is inert (empty
 * div) without them but never breaks the deck.
 */
export function buildQrBlock(
  payload: string,
  opts: { ec?: string; fg?: string; bg?: string; quiet?: number } = {},
): ElementNode {
  const x = (1920 - QR_DEFAULT_SIZE) / 2;
  const y = (1080 - QR_DEFAULT_SIZE) / 2;
  return createElement('div', {
    'data-qr': payload,
    'data-qr-ec': opts.ec ?? QR_DEFAULTS.ec,
    'data-qr-fg': opts.fg ?? QR_DEFAULTS.fg,
    'data-qr-bg': opts.bg ?? QR_DEFAULTS.bg,
    'data-qr-quiet': String(opts.quiet ?? QR_DEFAULTS.quiet),
    'aria-label': qrAriaLabel(payload),
    // Free positioning (draggable/resizable): centred on the logical canvas. The
    // free-layout CSS turns data-w/h into the div's inline width/height.
    'data-free': null,
    'data-x': String(x),
    'data-y': String(y),
    'data-w': String(QR_DEFAULT_SIZE),
    'data-h': String(QR_DEFAULT_SIZE),
  });
}
