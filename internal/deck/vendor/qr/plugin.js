/*!
 * slides-builder QR plugin (P19) — offline, self-authored.
 *
 * Renders a scannable QR code from a single declarative attribute on a <div>:
 *   <div data-qr="https://example.com"
 *        data-qr-ec="M"           error-correction level L|M|Q|H (default M)
 *        data-qr-fg="#000000"     module (foreground) colour
 *        data-qr-bg="#ffffff"     background colour
 *        data-qr-quiet="4"></div> quiet-zone width in modules (default 4)
 *
 * WHY a data-bound <div> (not a generated image asset): the payload stays
 * human/Claude-readable + editable in the source, the round-trip is byte-stable
 * (just attributes), and there is no asset-vs-attribute staleness. This mirrors
 * the Chart leaf's data-bound model (data-chart / data-chart-data).
 *
 * The matrix is produced by qrcode.js (Kazuhiko Arase, MIT, vendored alongside
 * and loaded first → exposes the global `qrcode`). We build the SVG OURSELVES
 * from getModuleCount()/isDark() so fg/bg/quiet-zone are honoured exactly — the
 * encoding inputs the editor stores as data-qr-* attributes (spec 03). SVG (not
 * <canvas>) so the code stays crisp under reveal's logical-canvas scaling, and
 * renders in the editor, the present route, and PDF (all run JS) — but NOT the
 * script-free navigator thumbnail, where the builder paints a placeholder
 * (documented thumbnail-only gap, joining Chart/code/KaTeX).
 *
 * Everything is local — zero external URLs (spec 12 offline-first).
 */
(function () {
  'use strict';

  // UTF-8 byte encoder. qrcode.js's default stringToBytes is Latin1 (c & 0xff),
  // which mangles any non-ASCII payload; install UTF-8 so unicode URLs/text
  // encode to a scannable code.
  function utf8Bytes(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0xd800 || code >= 0xe000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        // surrogate pair → astral code point
        i++;
        var cp = 0x10000 + (((code & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff));
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      }
    }
    return bytes;
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Build an SVG string for a made qr, merging horizontal dark runs per row. */
  function buildSvg(qr, fg, bg, quiet, label) {
    var count = qr.getModuleCount();
    var size = count + quiet * 2;
    var rects = '';
    for (var r = 0; r < count; r++) {
      var c = 0;
      while (c < count) {
        if (qr.isDark(r, c)) {
          var start = c;
          while (c < count && qr.isDark(r, c)) c++;
          rects +=
            '<rect x="' + (start + quiet) + '" y="' + (r + quiet) +
            '" width="' + (c - start) + '" height="1"/>';
        } else {
          c++;
        }
      }
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '"' +
      ' width="100%" height="100%" shape-rendering="crispEdges"' +
      ' preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + escapeXml(label) + '">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + escapeXml(bg) + '"/>' +
      '<g fill="' + escapeXml(fg) + '">' + rects + '</g>' +
      '</svg>'
    );
  }

  function render(el) {
    if (!window.qrcode) return; // qrcode.js not loaded — fail soft, offline.
    var data = el.getAttribute('data-qr');
    if (!data) {
      el.innerHTML = '';
      return;
    }
    var ec = (el.getAttribute('data-qr-ec') || 'M').toUpperCase();
    if (ec !== 'L' && ec !== 'M' && ec !== 'Q' && ec !== 'H') ec = 'M';
    var fg = el.getAttribute('data-qr-fg') || '#000000';
    var bg = el.getAttribute('data-qr-bg') || '#ffffff';
    var quiet = parseInt(el.getAttribute('data-qr-quiet'), 10);
    if (!isFinite(quiet) || quiet < 0) quiet = 4;

    // Skip a rebuild when nothing relevant changed (cheap revisit guard).
    var sig = data + '|' + ec + '|' + fg + '|' + bg + '|' + quiet;
    if (el._sbQrSig === sig && el.firstChild) return;

    try {
      window.qrcode.stringToBytes = utf8Bytes; // ensure UTF-8 (idempotent).
      var qr = window.qrcode(0, ec); // 0 = auto-select the smallest fitting type.
      qr.addData(data); // default 'Byte' mode.
      qr.make();
      el.innerHTML = buildSvg(qr, fg, bg, quiet, data);
      el._sbQrSig = sig;
    } catch (e) {
      // Never throw into the deck (e.g. payload too long for any version).
      console.warn('[slides-qr] render failed:', e);
      el.innerHTML = '';
      el._sbQrSig = undefined;
    }
  }

  function renderAll(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('div[data-qr]');
    for (var i = 0; i < nodes.length; i++) render(nodes[i]);
  }

  var RevealQR = {
    id: 'slidesQR',
    init: function (reveal) {
      renderAll(reveal.getRevealElement ? reveal.getRevealElement() : document);
      // Re-render on slide change so codes on revisited slides repaint cleanly.
      reveal.on('slidechanged', function (ev) {
        if (ev && ev.currentSlide) renderAll(ev.currentSlide);
      });
    },
  };

  if (typeof window !== 'undefined') {
    window.RevealQR = RevealQR;
  }
})();
