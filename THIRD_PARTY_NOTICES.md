# Third-party notices

`decks` is MIT licensed (see [`LICENSE`](LICENSE)). It also **redistributes** the third-party
software listed below, twice over:

1. Vendored into the binary via `go:embed` (under `internal/deck/vendor/`).
2. Copied onto disk, into `decks/<name>/assets/vendor/`, whenever you run `decks new` or
   `decks vendor`.

Each component's full license text travels with it: it sits beside the code in
`internal/deck/vendor/<component>/LICENSE`, and is copied into your deck's
`assets/vendor/<component>/LICENSE`. **A deck you distribute therefore already carries the
notices it needs.** Keep those files in place.

| Component | Version | License | Copyright |
|---|---|---|---|
| [reveal.js](https://github.com/hakimel/reveal.js) | 5.1.0 | MIT | © 2011–2024 Hakim El Hattab and reveal.js contributors |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.16.11 | MIT | © Khan Academy and contributors |
| [Chart.js](https://github.com/chartjs/Chart.js) | 4.4.1 | MIT | © Chart.js Contributors |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.9.0 | BSD-3-Clause | © 2006 Ivan Sagalaev |
| [reveal.js-plugins (chalkboard)](https://github.com/rajgoel/reveal.js-plugins) | 2.3.3 | MIT | © Asvin Goel |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | — | MIT | © 2009 Kazuhiko Arase |

reveal.js's own `math` and `notes` plugins live in their own directories
(`vendor/math/`, `vendor/notes/`) because they are vendored independently; both are covered by
reveal.js's MIT license, a copy of which sits in each.

## First-party code inside `vendor/`

Some directories mix vendored code with code that is part of `decks` and covered by the root
`LICENSE`. Concretely:

- `vendor/chart/` — `chart.umd.js` is Chart.js; **`plugin.js` is ours**.
- `vendor/qr/` — `qrcode.js` is qrcode-generator; **`plugin.js` is ours**.
- `vendor/laser/`, `vendor/layouts/`, `vendor/decks-layout.css`, `vendor/decks-layout-init.js`,
  `vendor/decks-slide-themes.css` — entirely ours.

## Trademarks

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## A note on MathJax

reveal.js's `math` plugin can load MathJax from a CDN, and the URLs are present in
`vendor/math/plugin.js`. `decks` never takes that path: scaffolded decks configure the plugin to
use the locally vendored KaTeX. No deck produced by `decks` makes a network request — that is
enforced by the offline guard in `decks validate`, which rejects any external `http(s)://`
resource URL in `deck.html`.
