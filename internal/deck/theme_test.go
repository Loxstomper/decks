package deck

import (
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
