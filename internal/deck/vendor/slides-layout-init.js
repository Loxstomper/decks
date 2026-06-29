/* slides-layout-init.js — Applies numeric data-* layout attributes to CSS.
 *
 * Companion script for slides-layout.css (spec 03, offline-first spec 12).
 * Load this BEFORE Reveal.initialize() so layout is applied before reveal
 * measures slide dimensions.
 *
 * WHY A SCRIPT:
 *   CSS attr() currently cannot assign numeric values to gap, padding, or
 *   flex-grow in all browsers. This script reads the data-* source-of-truth
 *   attributes and writes them as inline styles, keeping data-* as the
 *   editor's canonical representation (spec 03 § "Why data-attributes").
 *   The model layer (layout.ts) reads data-* back for the properties panel
 *   and writes them via setAttribute — inline styles here are a rendering
 *   concern only and never become the source of truth.
 *
 * COVERAGE:
 *   Container numeric: data-gap → gap; data-pad → padding
 *   Grid:              data-cols → grid-template-columns; data-rows → grid-template-rows
 *   Child:             data-grow → flex-grow; data-basis → flex-basis; data-span → grid-column
 *   Free coords:       data-x → left; data-y → top; data-w → width; data-h → height;
 *                      data-rot → transform:rotate(Ndeg)
 *
 * All numeric attributes are in LOGICAL PIXELS (spec 05 §"Coordinate system").
 * The reveal.js viewport transform handles scaling from logical to screen coords.
 */
(function slidesLayoutInit() {
  'use strict';

  /**
   * Apply numeric data-* layout attributes of a single element to inline styles.
   * Safe to call multiple times — setting the same style value is idempotent.
   *
   * @param {Element} el
   */
  function applyToElement(el) {
    // ── Container: gap (flex-gap / grid-gap, logical px) ──────────────────────
    var gap = el.getAttribute('data-gap');
    if (gap !== null) el.style.gap = gap + 'px';

    // ── Container: padding (logical px) ───────────────────────────────────────
    var pad = el.getAttribute('data-pad');
    if (pad !== null) el.style.padding = pad + 'px';

    // ── Grid: columns (integer → repeat(N,1fr) or raw template string) ────────
    var cols = el.getAttribute('data-cols');
    if (cols !== null) {
      el.style.gridTemplateColumns = /^\d+$/.test(cols)
        ? 'repeat(' + cols + ', 1fr)'
        : cols;
    }

    // ── Grid: rows (integer → repeat(N,1fr) or raw template string) ───────────
    var rows = el.getAttribute('data-rows');
    if (rows !== null) {
      el.style.gridTemplateRows = /^\d+$/.test(rows)
        ? 'repeat(' + rows + ', 1fr)'
        : rows;
    }

    // ── Child: flex-grow factor ────────────────────────────────────────────────
    var grow = el.getAttribute('data-grow');
    if (grow !== null) el.style.flexGrow = grow;

    // ── Child: flex-basis (plain integer → px, otherwise raw value e.g. "50%") ─
    var basis = el.getAttribute('data-basis');
    if (basis !== null) {
      el.style.flexBasis = /^\d+$/.test(basis) ? basis + 'px' : basis;
    }

    // ── Child: grid-column span (and grid-row span, same value for square spans)
    var span = el.getAttribute('data-span');
    if (span !== null) el.style.gridColumn = 'span ' + span;

    // ── Free element: absolute positioning in logical coords ───────────────────
    if (el.hasAttribute('data-free')) {
      var x = el.getAttribute('data-x');
      var y = el.getAttribute('data-y');
      var w = el.getAttribute('data-w');
      var h = el.getAttribute('data-h');
      var rot = el.getAttribute('data-rot');
      if (x !== null)   el.style.left   = x + 'px';
      if (y !== null)   el.style.top    = y + 'px';
      if (w !== null)   el.style.width  = w + 'px';
      if (h !== null)   el.style.height = h + 'px';
      // data-rot is in degrees; combine with any existing transform if needed.
      if (rot !== null) el.style.transform = 'rotate(' + rot + 'deg)';
    }
  }

  /**
   * Apply layout attributes to every element in the document that carries any
   * of the numeric data-* layout attributes.
   */
  function applyAll() {
    var sel = '[data-lay],[data-free],[data-grow],[data-basis],[data-span]';
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) applyToElement(els[i]);
  }

  // ── Initial application ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    // Script loaded after DOM is ready (e.g. deferred or async).
    applyAll();
  }

  // ── Observe dynamic content (reveal.js plugins, fragments, etc.) ───────────
  // Re-apply when reveal inserts new nodes so fragments and plugin-injected
  // elements are also styled correctly.
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var mi = 0; mi < mutations.length; mi++) {
        var added = mutations[mi].addedNodes;
        for (var ni = 0; ni < added.length; ni++) {
          var node = added[ni];
          if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;
          applyToElement(node);
          var children = node.querySelectorAll(
            '[data-lay],[data-free],[data-grow],[data-basis],[data-span]'
          );
          for (var ci = 0; ci < children.length; ci++) applyToElement(children[ci]);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
