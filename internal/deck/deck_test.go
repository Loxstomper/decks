package deck_test

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"slides-builder/internal/deck"
)

// makeWorkspace creates a temp workspace with an empty decks/ directory.
func makeWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "decks"), 0o755); err != nil {
		t.Fatalf("mkdir decks: %v", err)
	}
	return root
}

func TestNew_CreatesExpectedFiles(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "my-talk"); err != nil {
		t.Fatalf("New: %v", err)
	}

	deckDir := filepath.Join(root, "decks", "my-talk")
	for _, want := range []string{"deck.html", "custom.css"} {
		if _, err := os.Stat(filepath.Join(deckDir, want)); err != nil {
			t.Errorf("expected file %s to exist: %v", want, err)
		}
	}
	assetsDir := filepath.Join(deckDir, "assets")
	if info, err := os.Stat(assetsDir); err != nil || !info.IsDir() {
		t.Errorf("expected assets/ directory to exist")
	}

	// Verify deck.html is non-empty and contains reveal.initialize.
	html, err := os.ReadFile(filepath.Join(deckDir, "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}
	if !bytes.Contains(html, []byte("Reveal.initialize")) {
		t.Error("deck.html does not contain Reveal.initialize()")
	}
	if !bytes.Contains(html, []byte("my-talk")) {
		t.Error("deck.html does not contain the deck name")
	}
}

func TestNew_InvalidName_ReturnsError(t *testing.T) {
	root := makeWorkspace(t)
	for _, bad := range []string{"", "../escape", "a/b"} {
		if err := deck.New(root, bad); err == nil {
			t.Errorf("New(%q): expected error, got nil", bad)
		}
	}
}

func TestList_ReturnsDeckNames(t *testing.T) {
	root := makeWorkspace(t)

	// No decks yet.
	names, err := deck.List(root)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("expected empty list, got %v", names)
	}

	// Scaffold two decks.
	if err := deck.New(root, "alpha"); err != nil {
		t.Fatal(err)
	}
	if err := deck.New(root, "beta"); err != nil {
		t.Fatal(err)
	}

	names, err = deck.List(root)
	if err != nil {
		t.Fatalf("List after new: %v", err)
	}
	if len(names) != 2 {
		t.Errorf("expected 2 decks, got %v", names)
	}
}

// TestWrite_RoundTrip verifies that a read→write→read cycle is byte-identical (P0-11).
func TestWrite_RoundTrip(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "roundtrip"); err != nil {
		t.Fatalf("New: %v", err)
	}

	original, err := deck.Read(root, "roundtrip")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}

	if err := deck.Write(root, "roundtrip", original); err != nil {
		t.Fatalf("Write: %v", err)
	}

	after, err := deck.Read(root, "roundtrip")
	if err != nil {
		t.Fatalf("Read after Write: %v", err)
	}

	if !bytes.Equal(original, after) {
		t.Errorf("round-trip not byte-identical:\noriginal (%d bytes):\n%s\nafter (%d bytes):\n%s",
			len(original), original, len(after), after)
	}
}

// TestWrite_AtomicContent verifies that modified content is written correctly.
func TestWrite_AtomicContent(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "atomic"); err != nil {
		t.Fatalf("New: %v", err)
	}

	want := []byte("<html><body>hello world</body></html>")
	if err := deck.Write(root, "atomic", want); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := deck.Read(root, "atomic")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !bytes.Equal(want, got) {
		t.Errorf("write content mismatch: want %q, got %q", want, got)
	}
}

func TestRead_NotFound(t *testing.T) {
	root := makeWorkspace(t)
	_, err := deck.Read(root, "nonexistent")
	if err == nil {
		t.Fatal("expected error reading nonexistent deck, got nil")
	}
}

// ── Offline-first / vendor tests ──────────────────────────────────────────────

// TestNew_VendorFilesPresent verifies that slides new copies all required
// reveal.js vendor files into assets/vendor/reveal/ (spec 12 – offline-first).
func TestNew_VendorFilesPresent(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "offline-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	vendorDir := filepath.Join(root, "decks", "offline-test", "assets", "vendor", "reveal")

	requiredFiles := []string{
		"reveal.js",
		"reveal.css",
		"reset.css",
		filepath.Join("theme", "black.css"),
	}
	for _, rel := range requiredFiles {
		p := filepath.Join(vendorDir, rel)
		info, err := os.Stat(p)
		if err != nil {
			t.Errorf("vendor file missing: %s: %v", rel, err)
			continue
		}
		// Sanity: file should be non-empty.
		if info.Size() == 0 {
			t.Errorf("vendor file is empty: %s", rel)
		}
	}
}

// TestNew_QrPluginVendored (P19) asserts the QR generator + plugin are vendored
// into a fresh deck and linked relatively, and that the scaffold registers the
// RevealQR plugin — so <div data-qr> blocks render offline.
func TestNew_QrPluginVendored(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "qr-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	qrDir := filepath.Join(root, "decks", "qr-test", "assets", "vendor", "qr")
	for _, rel := range []string{"qrcode.js", "plugin.js"} {
		info, err := os.Stat(filepath.Join(qrDir, rel))
		if err != nil {
			t.Errorf("vendored QR file missing: %s: %v", rel, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("vendored QR file is empty: %s", rel)
		}
	}

	html, err := os.ReadFile(filepath.Join(root, "decks", "qr-test", "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}
	for _, want := range []string{
		"assets/vendor/qr/qrcode.js",
		"assets/vendor/qr/plugin.js",
		"RevealQR",
	} {
		if !bytes.Contains(html, []byte(want)) {
			t.Errorf("deck.html missing expected QR reference %q", want)
		}
	}
}

// TestNew_DeckHTMLUsesRelativeRevealPaths asserts that the scaffolded deck.html
// references reveal.js assets via relative paths (assets/vendor/reveal/…) rather
// than absolute CDN URLs — required for offline-first rendering (spec 12).
func TestNew_DeckHTMLUsesRelativeRevealPaths(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "rel-paths"); err != nil {
		t.Fatalf("New: %v", err)
	}

	html, err := os.ReadFile(filepath.Join(root, "decks", "rel-paths", "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}

	// Invariant X-1 (offline guard): deck.html must NOT contain any external URLs.
	// This is checked first so the error message is clear.
	externalURL := regexp.MustCompile(`https?://`)
	if externalURL.Match(html) {
		t.Errorf("deck.html contains an external http(s):// URL — violates offline-first invariant (spec 12).\n"+
			"Offending snippet: %s",
			findMatchContext(html, externalURL))
	}

	// Verify the expected relative paths ARE present.
	wantRefs := []string{
		"assets/vendor/reveal/reset.css",
		"assets/vendor/reveal/reveal.css",
		"assets/vendor/reveal/theme/black.css",
		"assets/vendor/reveal/reveal.js",
	}
	for _, ref := range wantRefs {
		if !bytes.Contains(html, []byte(ref)) {
			t.Errorf("deck.html missing expected relative path %q", ref)
		}
	}
}

// TestNew_OfflineGuard_NoExternalURLs is an explicit cross-cutting test for
// invariant X-1: the generated deck.html must contain zero http(s):// URLs.
func TestNew_OfflineGuard_NoExternalURLs(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "guard-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	html, err := os.ReadFile(filepath.Join(root, "decks", "guard-test", "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}

	re := regexp.MustCompile(`https?://\S+`)
	if matches := re.FindAll(html, -1); len(matches) > 0 {
		t.Errorf("deck.html contains %d external URL(s) — violates offline-first (spec 12, X-1):", len(matches))
		for _, m := range matches {
			t.Errorf("  %s", m)
		}
	}
}

// TestSolarizedDark_VendoredAndOffline verifies that the solarized-dark reveal
// theme (P9-9) is (a) vendored into a new deck and (b) contains zero external
// http(s):// URLs (offline-first invariant, spec 12 X-1).
func TestSolarizedDark_VendoredAndOffline(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "sd-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	themeFile := filepath.Join(root, "decks", "sd-test", "assets", "vendor", "reveal", "theme", "solarized-dark.css")
	css, err := os.ReadFile(themeFile)
	if err != nil {
		t.Fatalf("solarized-dark.css not vendored into deck: %v", err)
	}
	if len(css) == 0 {
		t.Error("solarized-dark.css is empty")
	}

	// Offline guard: the theme CSS must contain no external URLs.
	re := regexp.MustCompile(`https?://\S+`)
	if matches := re.FindAll(css, -1); len(matches) > 0 {
		t.Errorf("solarized-dark.css contains %d external URL(s) — violates offline-first (spec 12):", len(matches))
		for _, m := range matches {
			t.Errorf("  %s", m)
		}
	}

	// It must be listed in BundledThemes as a distinct entry from "solarized".
	foundDark := false
	foundLight := false
	for _, th := range deck.BundledThemes {
		if th == "solarized-dark" {
			foundDark = true
		}
		if th == "solarized" {
			foundLight = true
		}
	}
	if !foundDark {
		t.Error("BundledThemes missing 'solarized-dark'")
	}
	if !foundLight {
		t.Error("BundledThemes missing 'solarized' (light)")
	}
}

// TestVendor_RevendorExistingDeck verifies that Vendor() restores deleted
// vendor files in an existing deck (the `slides vendor <name>` use-case).
func TestVendor_RevendorExistingDeck(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "revendor"); err != nil {
		t.Fatalf("New: %v", err)
	}

	// Delete the vendor directory to simulate removal.
	vendorDir := filepath.Join(root, "decks", "revendor", "assets", "vendor", "reveal")
	if err := os.RemoveAll(vendorDir); err != nil {
		t.Fatalf("RemoveAll: %v", err)
	}
	if _, err := os.Stat(vendorDir); !os.IsNotExist(err) {
		t.Fatal("expected vendor dir to be gone after RemoveAll")
	}

	// Re-vendor.
	if err := deck.Vendor(root, "revendor"); err != nil {
		t.Fatalf("Vendor: %v", err)
	}

	// All files must be restored.
	for _, rel := range []string{"reveal.js", "reveal.css", "reset.css", filepath.Join("theme", "black.css")} {
		p := filepath.Join(vendorDir, rel)
		if _, err := os.Stat(p); err != nil {
			t.Errorf("after Vendor(): file missing: %s: %v", rel, err)
		}
	}
}

// TestEnsureSharedVendor verifies the workspace-level shared/vendor/reveal/ copy.
func TestEnsureSharedVendor(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.EnsureSharedVendor(root); err != nil {
		t.Fatalf("EnsureSharedVendor: %v", err)
	}

	sharedDir := filepath.Join(root, "shared", "vendor", "reveal")
	for _, rel := range []string{"reveal.js", "reveal.css", "reset.css", filepath.Join("theme", "black.css")} {
		p := filepath.Join(sharedDir, rel)
		if _, err := os.Stat(p); err != nil {
			t.Errorf("shared vendor file missing: %s: %v", rel, err)
		}
	}
}

// ── Layout CSS / P3-1 vendor tests ───────────────────────────────────────────

// TestNew_LayoutCSSPresent verifies that slides new copies slides-layout.css
// and slides-layout-init.js into assets/vendor/ (spec 03, spec 12 offline-first).
func TestNew_LayoutCSSPresent(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "layout-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	vendorDir := filepath.Join(root, "decks", "layout-test", "assets", "vendor")
	for _, f := range []string{"slides-layout.css", "slides-layout-init.js"} {
		p := filepath.Join(vendorDir, f)
		info, err := os.Stat(p)
		if err != nil {
			t.Errorf("layout vendor file missing: %s: %v", f, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("layout vendor file is empty: %s", f)
		}
	}
}

// TestNew_DeckHTMLLinksLayoutCSS asserts that the scaffolded deck.html references
// slides-layout.css via a relative path (offline-first, spec 12).
func TestNew_DeckHTMLLinksLayoutCSS(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "layout-link"); err != nil {
		t.Fatalf("New: %v", err)
	}

	html, err := os.ReadFile(filepath.Join(root, "decks", "layout-link", "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}

	// The deck must reference the layout CSS and init script via relative paths.
	for _, want := range []string{
		"assets/vendor/slides-layout.css",
		"assets/vendor/slides-layout-init.js",
	} {
		if !bytes.Contains(html, []byte(want)) {
			t.Errorf("deck.html missing expected relative path %q", want)
		}
	}

	// The offline invariant still holds: no external http(s):// URLs.
	re := regexp.MustCompile(`https?://`)
	if re.Match(html) {
		t.Errorf("deck.html contains an external URL after adding layout CSS — violates spec 12:\n%s",
			findMatchContext(html, re))
	}
}

// TestVendor_LayoutCSSRevendored verifies that Vendor() restores deleted layout
// files in an existing deck (the `slides vendor <name>` use-case, P3-1).
func TestVendor_LayoutCSSRevendored(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "layout-revendor"); err != nil {
		t.Fatalf("New: %v", err)
	}

	// Delete the layout files to simulate removal.
	vendorDir := filepath.Join(root, "decks", "layout-revendor", "assets", "vendor")
	for _, f := range []string{"slides-layout.css", "slides-layout-init.js"} {
		if err := os.Remove(filepath.Join(vendorDir, f)); err != nil {
			t.Fatalf("remove %s: %v", f, err)
		}
	}

	// Re-vendor.
	if err := deck.Vendor(root, "layout-revendor"); err != nil {
		t.Fatalf("Vendor: %v", err)
	}

	// Layout files must be restored.
	for _, f := range []string{"slides-layout.css", "slides-layout-init.js"} {
		p := filepath.Join(vendorDir, f)
		if _, err := os.Stat(p); err != nil {
			t.Errorf("after Vendor(): layout file missing: %s: %v", f, err)
		}
	}
}

// TestLayoutCSS_NoExternalURLs is an invariant guard: the bundled layout CSS
// must contain zero http(s):// URLs (spec 12 offline-first, X-1).
func TestLayoutCSS_NoExternalURLs(t *testing.T) {
	root := makeWorkspace(t)

	if err := deck.New(root, "layout-offline"); err != nil {
		t.Fatalf("New: %v", err)
	}

	vendorDir := filepath.Join(root, "decks", "layout-offline", "assets", "vendor")
	re := regexp.MustCompile(`https?://\S+`)

	for _, f := range []string{"slides-layout.css", "slides-layout-init.js"} {
		content, err := os.ReadFile(filepath.Join(vendorDir, f))
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		if matches := re.FindAll(content, -1); len(matches) > 0 {
			t.Errorf("%s contains external URL(s) — violates spec 12:", f)
			for _, m := range matches {
				t.Errorf("  %s", m)
			}
		}
	}
}

// ── Highlight + KaTeX plugin vendor tests (P5-9, P5-10) ─────────────────────

// TestNew_HighlightPluginPresent verifies that slides new copies the highlight
// plugin files into assets/vendor/highlight/ (P5-9, spec 12 offline-first).
func TestNew_HighlightPluginPresent(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "hltest"); err != nil {
		t.Fatalf("New: %v", err)
	}

	hlDir := filepath.Join(root, "decks", "hltest", "assets", "vendor", "highlight")
	for _, f := range []string{"plugin.js", "monokai.min.css"} {
		p := filepath.Join(hlDir, f)
		info, err := os.Stat(p)
		if err != nil {
			t.Errorf("highlight vendor file missing: %s: %v", f, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("highlight vendor file empty: %s", f)
		}
	}
}

// TestNew_KaTeXPluginPresent verifies that slides new copies the math/KaTeX
// plugin and fonts into assets/vendor/math/ and assets/vendor/katex/ (P5-10).
func TestNew_KaTeXPluginPresent(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "katextest"); err != nil {
		t.Fatalf("New: %v", err)
	}

	vendorDir := filepath.Join(root, "decks", "katextest", "assets", "vendor")
	required := []string{
		filepath.Join("math", "plugin.js"),
		filepath.Join("katex", "dist", "katex.min.js"),
		filepath.Join("katex", "dist", "katex.min.css"),
		filepath.Join("katex", "dist", "contrib", "auto-render.min.js"),
	}
	for _, rel := range required {
		p := filepath.Join(vendorDir, rel)
		info, err := os.Stat(p)
		if err != nil {
			t.Errorf("KaTeX vendor file missing: %s: %v", rel, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("KaTeX vendor file empty: %s", rel)
		}
	}

	// At least one woff2 font must be present.
	fontsDir := filepath.Join(vendorDir, "katex", "dist", "fonts")
	entries, err := os.ReadDir(fontsDir)
	if err != nil {
		t.Fatalf("katex fonts dir missing: %v", err)
	}
	woff2Count := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".woff2") {
			woff2Count++
		}
	}
	if woff2Count == 0 {
		t.Error("no .woff2 font files in katex/dist/fonts/")
	}
}

// TestNew_DeckHTMLLinksHighlightAndKaTeX asserts that the scaffolded deck.html
// references the highlight and math plugins via relative paths (offline-first,
// spec 12) and enables them in Reveal.initialize.
func TestNew_DeckHTMLLinksHighlightAndKaTeX(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "plugin-link"); err != nil {
		t.Fatalf("New: %v", err)
	}

	html, err := os.ReadFile(filepath.Join(root, "decks", "plugin-link", "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}

	// The offline invariant must still hold (no external http URLs).
	re := regexp.MustCompile(`https?://`)
	if re.Match(html) {
		t.Errorf("deck.html contains an external URL — violates spec 12 offline-first:\n%s",
			findMatchContext(html, re))
	}

	// Required local paths.
	wantRefs := []string{
		"assets/vendor/highlight/plugin.js",
		"assets/vendor/highlight/monokai.min.css",
		"assets/vendor/math/plugin.js",
		"assets/vendor/katex",
		"RevealHighlight",
		"RevealMath.KaTeX",
	}
	for _, ref := range wantRefs {
		if !bytes.Contains(html, []byte(ref)) {
			t.Errorf("deck.html missing expected reference %q", ref)
		}
	}
}

// TestVendor_RevendorsPlugins verifies that Vendor() restores deleted plugin
// files in an existing deck (the `slides vendor <name>` use-case).
func TestVendor_RevendorsPlugins(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "plugin-revendor"); err != nil {
		t.Fatalf("New: %v", err)
	}

	// Remove plugin directories to simulate deletion.
	vendorDir := filepath.Join(root, "decks", "plugin-revendor", "assets", "vendor")
	for _, dir := range []string{"highlight", "math", "katex"} {
		if err := os.RemoveAll(filepath.Join(vendorDir, dir)); err != nil {
			t.Fatalf("RemoveAll %s: %v", dir, err)
		}
	}

	// Re-vendor.
	if err := deck.Vendor(root, "plugin-revendor"); err != nil {
		t.Fatalf("Vendor: %v", err)
	}

	// Check plugin files are restored.
	restored := []string{
		filepath.Join("highlight", "plugin.js"),
		filepath.Join("highlight", "monokai.min.css"),
		filepath.Join("math", "plugin.js"),
		filepath.Join("katex", "dist", "katex.min.js"),
	}
	for _, rel := range restored {
		p := filepath.Join(vendorDir, rel)
		if _, err := os.Stat(p); err != nil {
			t.Errorf("after Vendor(): plugin file missing: %s: %v", rel, err)
		}
	}
}

// TestNew_OfflineGuard_NoExternalURLs_WithPlugins re-runs the global offline
// guard after adding plugins to confirm the template has no CDN URLs.
func TestNew_OfflineGuard_NoExternalURLs_WithPlugins(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "offline-plugin-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	html, err := os.ReadFile(filepath.Join(root, "decks", "offline-plugin-test", "deck.html"))
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}

	re := regexp.MustCompile(`https?://\S+`)
	if matches := re.FindAll(html, -1); len(matches) > 0 {
		t.Errorf("deck.html (with plugins) contains %d external URL(s):", len(matches))
		for _, m := range matches {
			t.Errorf("  %s", m)
		}
	}
}

// findMatchContext returns a short excerpt around the first regex match for
// diagnostic purposes in test failure messages.
func findMatchContext(data []byte, re *regexp.Regexp) []byte {
	loc := re.FindIndex(data)
	if loc == nil {
		return nil
	}
	start := loc[0]
	if start > 40 {
		start -= 40
	} else {
		start = 0
	}
	end := loc[1] + 80
	if end > len(data) {
		end = len(data)
	}
	return data[start:end]
}
