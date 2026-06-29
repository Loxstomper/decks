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
