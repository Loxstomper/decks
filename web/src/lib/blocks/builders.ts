/**
 * builders.ts — Pure factory functions for insertable block elements (P5-4, P5-9, P5-10).
 *
 * WHY PURE: These functions have zero side-effects and no imports from the store
 * or fetch layer.  They produce dirty ElementNode trees ready to pass to
 * deckStore.insertBlock() (or any model mutation).  Pure = fully unit-testable
 * without DOM or fetch mocks.
 *
 * All returned nodes are dirty=true so serializeDeck emits canonical markup for
 * them (spec 12 §4 — byte-stable passthrough only applies to untouched nodes).
 */

import { createElement, createText, appendChild } from '$lib/model';
import type { ElementNode } from '$lib/model';

// ── Image block (P5-4, P5-5, P5-7, P5-8) ────────────────────────────────────

/**
 * Build an <img> leaf element.
 *
 * `src` MUST be a relative deck-asset path ("assets/photo.jpg") — never an
 * external URL.  This is enforced by callers (upload/localize pipeline) so the
 * deck stays self-contained and offline-first (spec 08, 12).
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
