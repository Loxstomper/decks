/*!
 * slides-builder chart plugin (P17-14/15) — offline, self-authored.
 *
 * WHY self-authored instead of the rajgoel reveal.js-plugins chart plugin:
 * that plugin reads chart data as CSV from the <canvas> innerHTML plus a
 * comment-embedded options blob. slides-builder keeps chart data as a single
 * JSON attribute `data-chart-data` on the canvas, because:
 *   - it is one declarative, byte-stable attribute the document model and the
 *     `slides validate` contract can reason about (no innerHTML/CSV soup);
 *   - the inspector JSON editor writes/reads exactly that attribute;
 *   - it is trivially Claude-authorable.
 *
 * The attribute is a JSON Chart.js config: { "type": "bar", "data": {...},
 * "options": {...} }.  Chart.js itself (chart.umd.js) is vendored alongside and
 * loaded before this plugin, exposing the global `Chart`.  Everything is local —
 * zero external URLs (spec 12 offline-first).
 */
(function () {
  'use strict';

  function render(canvas) {
    if (!window.Chart) return; // chart.umd.js not loaded — fail soft, offline.
    var raw = canvas.getAttribute('data-chart-data');
    if (!raw) return;
    var cfg;
    try {
      cfg = JSON.parse(raw);
    } catch (e) {
      // Malformed JSON: never throw into the deck; leave the canvas blank.
      console.warn('[slides-chart] invalid data-chart-data JSON:', e);
      return;
    }
    if (!cfg || typeof cfg !== 'object') return;
    // Idempotent: destroy a prior instance before re-rendering (slide revisits).
    if (canvas._sbChart) {
      try { canvas._sbChart.destroy(); } catch (e) { /* ignore */ }
    }
    // Default to non-animated + responsive-off so the chart is stable inside
    // reveal's fixed logical canvas and renders identically in PDF export.
    cfg.options = cfg.options || {};
    if (cfg.options.animation === undefined) cfg.options.animation = false;
    if (cfg.options.responsive === undefined) cfg.options.responsive = false;
    try {
      canvas._sbChart = new window.Chart(canvas.getContext('2d'), cfg);
    } catch (e) {
      console.warn('[slides-chart] render failed:', e);
    }
  }

  function renderAll(root) {
    var scope = root || document;
    var canvases = scope.querySelectorAll('canvas[data-chart]');
    for (var i = 0; i < canvases.length; i++) render(canvases[i]);
  }

  var RevealChart = {
    id: 'slidesChart',
    init: function (reveal) {
      renderAll(reveal.getRevealElement ? reveal.getRevealElement() : document);
      // Re-render on slide change so charts on revisited slides repaint cleanly.
      reveal.on('slidechanged', function (ev) {
        if (ev && ev.currentSlide) renderAll(ev.currentSlide);
      });
    },
  };

  if (typeof window !== 'undefined') {
    window.RevealChart = RevealChart;
  }
})();
