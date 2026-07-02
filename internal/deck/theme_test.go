package deck

import (
	"bytes"
	"strings"
	"testing"
)

// TestGenerateSlideThemesCSS_AllThemesNonEmpty verifies every bundled theme
// yields a non-empty scoped block in the generated per-slide theme stylesheet.
func TestGenerateSlideThemesCSS_AllThemesNonEmpty(t *testing.T) {
	css := string(GenerateSlideThemesCSS())
	for _, name := range BundledThemes {
		sel := `.reveal section[data-theme="` + name + `"] {`
		i := strings.Index(css, sel)
		if i < 0 {
			t.Errorf("theme %q: missing scoped block %q", name, sel)
			continue
		}
		// Block body must contain at least one --r-* var declaration.
		end := strings.Index(css[i:], "}")
		if end < 0 {
			t.Errorf("theme %q: unterminated block", name)
			continue
		}
		body := css[i : i+end]
		if !strings.Contains(body, "--r-") {
			t.Errorf("theme %q: block has no --r-* declarations", name)
		}
	}
}

// TestGenerateSlideThemesCSS_SolarizedDarkColors checks the solarized-dark block
// re-binds its text/heading colours derived from the embedded theme CSS.
func TestGenerateSlideThemesCSS_SolarizedDarkColors(t *testing.T) {
	css := string(GenerateSlideThemesCSS())
	sel := `.reveal section[data-theme="solarized-dark"] {`
	i := strings.Index(css, sel)
	if i < 0 {
		t.Fatalf("missing solarized-dark block")
	}
	end := strings.Index(css[i:], "}")
	block := css[i : i+end]
	for _, want := range []string{"#839496", "#93a1a1"} {
		if !strings.Contains(block, want) {
			t.Errorf("solarized-dark block missing %q\nblock:\n%s", want, block)
		}
	}
	// Background colour must NOT be scoped per section.
	if strings.Contains(block, "--r-background-color") {
		t.Errorf("solarized-dark block should not scope --r-background-color\nblock:\n%s", block)
	}
}

// TestGenerateSlideThemesCSS_AssertsColorAtSectionScope verifies P18-1: every
// theme block re-asserts `color`, heading and link colours ON the section, not
// only the --r-* var rebindings. reveal sets body color on the .reveal ANCESTOR
// and `color` inherits as a computed value, so without these explicit rules a
// per-slide override would restyle headings/links but never the body text.
func TestGenerateSlideThemesCSS_AssertsColorAtSectionScope(t *testing.T) {
	css := string(GenerateSlideThemesCSS())
	for _, name := range BundledThemes {
		sel := `.reveal section[data-theme="` + name + `"]`
		for _, want := range []string{
			sel + " {\n  color: var(--r-main-color);\n}",
			sel + " :is(h1, h2, h3, h4, h5, h6) {\n  color: var(--r-heading-color);\n}",
			sel + " a {\n  color: var(--r-link-color);\n}",
		} {
			if !strings.Contains(css, want) {
				t.Errorf("theme %q: generated CSS missing color assertion:\n%s", name, want)
			}
		}
	}
}

// TestGenerateSlideThemesCSS_Deterministic verifies the generated stylesheet is
// byte-identical across calls (sorted keys + stable rule order), so vendoring a
// deck twice never produces a spurious diff.
func TestGenerateSlideThemesCSS_Deterministic(t *testing.T) {
	a := GenerateSlideThemesCSS()
	b := GenerateSlideThemesCSS()
	if !bytes.Equal(a, b) {
		t.Errorf("GenerateSlideThemesCSS not deterministic across calls")
	}
}

// TestThemeBackgrounds verifies background colours are parsed from theme CSS.
func TestThemeBackgrounds(t *testing.T) {
	bg := ThemeBackgrounds()
	if got := bg["solarized-dark"]; got != "#002b36" {
		t.Errorf("ThemeBackgrounds[solarized-dark] = %q, want %q", got, "#002b36")
	}
	for _, name := range BundledThemes {
		if _, ok := bg[name]; !ok {
			t.Errorf("ThemeBackgrounds missing %q", name)
		}
	}
}

// TestInjectSlideThemesLink_PreP10Deck verifies P18-2: a deck whose <head>
// links slides-layout.css but not slides-slide-themes.css gets the link added
// exactly once, ordered right after the layout link; re-running is a no-op.
func TestInjectSlideThemesLink_PreP10Deck(t *testing.T) {
	const head = `<head>
  <link rel="stylesheet" href="assets/vendor/slides-layout.css" />
  <link rel="stylesheet" href="custom.css" />
</head>`
	out, changed := injectSlideThemesLink(head)
	if !changed {
		t.Fatalf("expected the link to be injected")
	}
	if n := strings.Count(out, "slides-slide-themes.css"); n != 1 {
		t.Fatalf("expected exactly one slide-themes link, got %d:\n%s", n, out)
	}
	// Ordering: layout link → slide-themes link → custom.css link.
	li := strings.Index(out, "slides-layout.css")
	si := strings.Index(out, "slides-slide-themes.css")
	ci := strings.Index(out, "custom.css")
	if !(li < si && si < ci) {
		t.Errorf("link ordering wrong (layout=%d themes=%d custom=%d):\n%s", li, si, ci, out)
	}
	// Idempotent: a second pass changes nothing.
	out2, changed2 := injectSlideThemesLink(out)
	if changed2 || out2 != out {
		t.Errorf("injectSlideThemesLink not idempotent")
	}
}

// TestInjectSlideThemesLink_ScaffoldUnchanged verifies a current scaffold (which
// already links the stylesheet) is left byte-stable.
func TestInjectSlideThemesLink_ScaffoldUnchanged(t *testing.T) {
	const head = `<head>
  <link rel="stylesheet" href="assets/vendor/slides-layout.css" />
  <link rel="stylesheet" href="assets/vendor/slides-slide-themes.css" />
  <link rel="stylesheet" href="custom.css" />
</head>`
	out, changed := injectSlideThemesLink(head)
	if changed || out != head {
		t.Errorf("expected no change for an already-linked deck")
	}
}

// TestInjectQrPlugin_PreP19Deck (P19 migration): a deck scaffolded before the QR
// feature gains the QR <script> tags AND RevealQR in the plugins array, exactly
// once each, matching the scaffold's ordering/spacing; idempotent thereafter.
func TestInjectQrPlugin_PreP19Deck(t *testing.T) {
	const html = `<body>
  <script src="assets/vendor/chart/chart.umd.js"></script>
  <script src="assets/vendor/chart/plugin.js"></script>
  <script>
    Reveal.initialize({
      width: 1920,
      plugins: [ RevealHighlight, RevealMath.KaTeX, RevealNotes, RevealChart ]
    });
  </script>
</body>`
	out, changed := injectQrPlugin(html)
	if !changed {
		t.Fatalf("expected QR wiring to be injected")
	}
	if n := strings.Count(out, "assets/vendor/qr/qrcode.js"); n != 1 {
		t.Fatalf("expected exactly one qrcode.js script, got %d:\n%s", n, out)
	}
	if n := strings.Count(out, "assets/vendor/qr/plugin.js"); n != 1 {
		t.Fatalf("expected exactly one qr plugin.js script, got %d:\n%s", n, out)
	}
	if !strings.Contains(out, "RevealChart, RevealQR ]") {
		t.Errorf("RevealQR not appended with scaffold spacing:\n%s", out)
	}
	// QR scripts must sit AFTER the chart scripts and BEFORE the inline init.
	qi := strings.Index(out, "assets/vendor/qr/qrcode.js")
	ci := strings.Index(out, "assets/vendor/chart/plugin.js")
	ii := strings.Index(out, "Reveal.initialize")
	if !(ci < qi && qi < ii) {
		t.Errorf("QR scripts mis-ordered (chart=%d qr=%d init=%d):\n%s", ci, qi, ii, out)
	}
	// Idempotent: a second pass changes nothing.
	out2, changed2 := injectQrPlugin(out)
	if changed2 || out2 != out {
		t.Errorf("injectQrPlugin not idempotent")
	}
}

// TestInjectQrPlugin_HandAuthoredInitBlock (P19 migration regression): a deck
// whose inline <script> carries setup code BEFORE Reveal.initialize (custom demo
// wiring, mermaid config) must still get the QR scripts placed before that block.
// The earlier adjacency-only anchor skipped the scripts here while still appending
// RevealQR — leaving init to throw on the undefined global and blanking the deck.
func TestInjectQrPlugin_HandAuthoredInitBlock(t *testing.T) {
	const html = `<body>
  <script src="assets/vendor/reveal/reveal.js"></script>
  <script src="assets/mermaid.min.js"></script>
  <script>
    // --- Demo wiring ---
    const HARNESS = "http://127.0.0.1:8080";
    Reveal.initialize({
      width: 1920,
      plugins: [ RevealHighlight, RevealNotes ]
    });
  </script>
</body>`
	out, changed := injectQrPlugin(html)
	if !changed {
		t.Fatalf("expected QR wiring to be injected into a hand-authored init block")
	}
	if n := strings.Count(out, "assets/vendor/qr/qrcode.js"); n != 1 {
		t.Fatalf("expected exactly one qrcode.js script, got %d:\n%s", n, out)
	}
	if !strings.Contains(out, "RevealNotes, RevealQR ]") {
		t.Errorf("RevealQR not appended:\n%s", out)
	}
	// Scripts must land BEFORE the inline block that names RevealQR.
	qi := strings.Index(out, "assets/vendor/qr/plugin.js")
	ii := strings.Index(out, "Reveal.initialize")
	if !(qi >= 0 && qi < ii) {
		t.Errorf("QR scripts not placed before Reveal.initialize (qr=%d init=%d):\n%s", qi, ii, out)
	}
	if out2, changed2 := injectQrPlugin(out); changed2 || out2 != out {
		t.Errorf("injectQrPlugin not idempotent on a hand-authored block")
	}
}

// TestInjectQrPlugin_RepairsHalfWiredDeck (P19 migration regression): a deck left
// in the broken half-state — RevealQR already in the plugins array but the QR
// <script> tags never written — is repaired by adding just the scripts, so a
// buggy earlier upgrade self-heals on the next run.
func TestInjectQrPlugin_RepairsHalfWiredDeck(t *testing.T) {
	const html = `<body>
  <script src="assets/vendor/reveal/reveal.js"></script>
  <script>
    const HARNESS = "x";
    Reveal.initialize({
      plugins: [ RevealHighlight, RevealNotes, RevealQR ]
    });
  </script>
</body>`
	out, changed := injectQrPlugin(html)
	if !changed {
		t.Fatalf("expected the missing QR scripts to be injected")
	}
	if n := strings.Count(out, "assets/vendor/qr/qrcode.js"); n != 1 {
		t.Fatalf("expected exactly one qrcode.js script, got %d:\n%s", n, out)
	}
	// RevealQR was already present — must not be duplicated.
	if n := strings.Count(out, "RevealQR"); n != 1 {
		t.Fatalf("expected RevealQR to stay single, got %d:\n%s", n, out)
	}
	if out2, changed2 := injectQrPlugin(out); changed2 || out2 != out {
		t.Errorf("injectQrPlugin not idempotent after repair")
	}
}

// TestInjectQrPlugin_NoInitBlock verifies a deck with no Reveal.initialize (nothing
// to anchor against) is left untouched — never half-wired with a dangling RevealQR.
func TestInjectQrPlugin_NoInitBlock(t *testing.T) {
	const html = `<body>
  <div class="reveal"><div class="slides"></div></div>
</body>`
	out, changed := injectQrPlugin(html)
	if changed || out != html {
		t.Errorf("expected no change when there is no init block to anchor against:\n%s", out)
	}
}

// TestInjectQrPlugin_ScaffoldUnchanged verifies a current scaffold (already wired
// for QR) is left byte-stable.
func TestInjectQrPlugin_ScaffoldUnchanged(t *testing.T) {
	const html = `<body>
  <script src="assets/vendor/qr/qrcode.js"></script>
  <script src="assets/vendor/qr/plugin.js"></script>
  <script>
    Reveal.initialize({
      plugins: [ RevealHighlight, RevealMath.KaTeX, RevealNotes, RevealChart, RevealQR ]
    });
  </script>
</body>`
	out, changed := injectQrPlugin(html)
	if changed || out != html {
		t.Errorf("expected no change for an already-wired deck")
	}
}

// TestGenerateSlideThemesCSS_NoExternalURLs guards the offline-first contract:
// the generated stylesheet must contain zero http(s) URLs (spec 12).
func TestGenerateSlideThemesCSS_NoExternalURLs(t *testing.T) {
	css := string(GenerateSlideThemesCSS())
	for _, bad := range []string{"http://", "https://", "//fonts", "url(http"} {
		if strings.Contains(css, bad) {
			t.Errorf("generated CSS contains external reference %q", bad)
		}
	}
}
