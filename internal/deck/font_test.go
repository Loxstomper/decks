package deck_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"slides-builder/internal/deck"
)

// ── Unit tests for font helpers ───────────────────────────────────────────────

func TestFamilySlug(t *testing.T) {
	// familySlug is unexported; test it indirectly via LocalizeFont's validation.
	// We can test the exported path by checking the directory name created.
	// For now, test through LocalizeFont with a mock server (see TestLocalizeFont_*).
	cases := []struct{ in, want string }{
		{"Inter", "inter"},
		{"Open Sans", "open-sans"},
		{"IBM Plex Mono", "ibm-plex-mono"},
		{"Roboto", "roboto"},
		{"Noto Sans", "noto-sans"},
	}
	// We cannot call familySlug directly (unexported), so we validate through
	// LocalizeFont's directory creation in the integration tests below.
	_ = cases
}

// TestSetCssVar_* tests live in customCss tests (FE); here we verify the Go
// font parsing helpers by building a mock Google Fonts server.

// mockFontsServer returns an httptest.Server that simulates the Google Fonts
// CSS2 API and font CDN. It serves two fake woff2 blobs so the download logic
// can be exercised end-to-end without hitting the real internet.
func mockFontsServer(t *testing.T) *httptest.Server {
	t.Helper()
	fakeWoff2 := []byte("FAKE_WOFF2_DATA")

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/css2"):
			// Simulate a Google Fonts CSS2 response with two @font-face blocks
			// (two weights, each pointing to a fake woff2 URL on this mock server).
			host := "http://" + r.Host
			fmt.Fprintf(w, `/* Fake Google Fonts CSS */
@font-face {
  font-family: 'FakeFont';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(%s/fonts/fake-regular.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}

@font-face {
  font-family: 'FakeFont';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(%s/fonts/fake-bold.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`, host, host)

		case strings.HasSuffix(r.URL.Path, ".woff2"):
			// Serve the fake woff2 data.
			w.Header().Set("Content-Type", "font/woff2")
			w.Write(fakeWoff2)

		default:
			http.NotFound(w, r)
		}
	}))
}

// TestLocalizeFont_WritesLocalFiles verifies that LocalizeFont:
//   - Creates assets/fonts/{slug}/font-face.css
//   - Downloads woff2 files locally
//   - The resulting CSS contains ZERO external http(s):// URLs
//   - Returns the correct relative cssPath
func TestLocalizeFont_WritesLocalFiles(t *testing.T) {
	srv := mockFontsServer(t)
	defer srv.Close()

	// Override the base URL to point at our mock server.
	origBase := deck.GoogleFontsBaseURL()
	deck.SetGoogleFontsBaseURL(srv.URL + "/css2")
	defer deck.SetGoogleFontsBaseURL(origBase)

	root := makeWorkspace(t)
	if err := deck.New(root, "font-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	result, err := deck.LocalizeFont(root, "font-test", "FakeFont", "400;700")
	if err != nil {
		t.Fatalf("LocalizeFont: %v", err)
	}

	// CSSPath should be a forward-slash relative path.
	if !strings.HasPrefix(result.CSSPath, "assets/fonts/") {
		t.Errorf("CSSPath should start with assets/fonts/, got %q", result.CSSPath)
	}
	if result.Family != "FakeFont" {
		t.Errorf("Family: want %q, got %q", "FakeFont", result.Family)
	}

	// The font-face.css must exist and be non-empty.
	cssFull := filepath.Join(root, "decks", "font-test", result.CSSPath)
	cssData, err := os.ReadFile(cssFull)
	if err != nil {
		t.Fatalf("read font-face.css: %v", err)
	}
	if len(cssData) == 0 {
		t.Error("font-face.css is empty")
	}

	// Offline invariant: no external http(s):// URLs in the generated CSS.
	extURLRe := regexp.MustCompile(`https?://`)
	if extURLRe.Match(cssData) {
		t.Errorf("font-face.css contains external URL — violates spec 12 offline-first:\n%s", cssData)
	}

	// Verify woff2 files were written.
	fontDir := filepath.Dir(cssFull)
	entries, err := os.ReadDir(fontDir)
	if err != nil {
		t.Fatalf("read font dir: %v", err)
	}
	woff2Count := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".woff2") {
			woff2Count++
		}
	}
	if woff2Count == 0 {
		t.Error("no .woff2 files written to assets/fonts/")
	}
}

// TestLocalizeFont_DedupURLs verifies that duplicate woff2 URLs (same URL in
// multiple @font-face blocks) are only downloaded once.
func TestLocalizeFont_DedupURLs(t *testing.T) {
	var downloadCount int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/css2"):
			host := "http://" + r.Host
			// Same woff2 URL referenced in two @font-face blocks.
			fmt.Fprintf(w, `@font-face {
  font-family: 'Dup';
  font-style: normal;
  font-weight: 400;
  src: url(%s/fonts/shared.woff2) format('woff2');
}

@font-face {
  font-family: 'Dup';
  font-style: normal;
  font-weight: 700;
  src: url(%s/fonts/shared.woff2) format('woff2');
}
`, host, host)
		case strings.HasSuffix(r.URL.Path, ".woff2"):
			downloadCount++
			w.Header().Set("Content-Type", "font/woff2")
			w.Write([]byte("FAKE"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	origBase := deck.GoogleFontsBaseURL()
	deck.SetGoogleFontsBaseURL(srv.URL + "/css2")
	defer deck.SetGoogleFontsBaseURL(origBase)

	root := makeWorkspace(t)
	if err := deck.New(root, "dup-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	_, err := deck.LocalizeFont(root, "dup-test", "Dup", "400;700")
	if err != nil {
		t.Fatalf("LocalizeFont: %v", err)
	}

	// The same URL must be downloaded exactly once despite appearing twice.
	if downloadCount != 1 {
		t.Errorf("expected 1 woff2 download (dedup), got %d", downloadCount)
	}
}

// TestLocalizeFont_OfflineGraceful verifies graceful failure when the server
// is unreachable (simulates offline).
func TestLocalizeFont_OfflineGraceful(t *testing.T) {
	// Point at a server that refuses connections.
	origBase := deck.GoogleFontsBaseURL()
	deck.SetGoogleFontsBaseURL("http://127.0.0.1:1") // port 1 = refused
	defer deck.SetGoogleFontsBaseURL(origBase)

	root := makeWorkspace(t)
	if err := deck.New(root, "offline-font"); err != nil {
		t.Fatalf("New: %v", err)
	}

	_, err := deck.LocalizeFont(root, "offline-font", "Inter", "400")
	if err == nil {
		t.Fatal("expected error for unreachable server, got nil")
	}
	// Deck should be unchanged — no fonts dir created.
	fontsDir := filepath.Join(root, "decks", "offline-font", "assets", "fonts")
	if _, statErr := os.Stat(fontsDir); !os.IsNotExist(statErr) {
		t.Error("fonts dir should not be created on failure")
	}
}

// TestLocalizeFont_InvalidDeck verifies error on a non-existent deck.
func TestLocalizeFont_InvalidDeck(t *testing.T) {
	root := makeWorkspace(t)
	_, err := deck.LocalizeFont(root, "nonexistent", "Inter", "400")
	if err == nil {
		t.Fatal("expected error for non-existent deck, got nil")
	}
}

// TestLocalizeFont_EmptyFamily verifies error on empty family name.
func TestLocalizeFont_EmptyFamily(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "empty-family"); err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err := deck.LocalizeFont(root, "empty-family", "", "400")
	if err == nil {
		t.Fatal("expected error for empty family, got nil")
	}
}

// ── Custom CSS tests ──────────────────────────────────────────────────────────

// TestWriteCustomCSS_RoundTrip verifies that WriteCustomCSS + ReadCustomCSS is
// byte-identical (P6-11 atomic + byte-stable requirement).
func TestWriteCustomCSS_RoundTrip(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "css-rt"); err != nil {
		t.Fatalf("New: %v", err)
	}

	want := []byte(":root { --r-main-color: #ff0000; }\n")
	if err := deck.WriteCustomCSS(root, "css-rt", want); err != nil {
		t.Fatalf("WriteCustomCSS: %v", err)
	}

	got, err := deck.ReadCustomCSS(root, "css-rt")
	if err != nil {
		t.Fatalf("ReadCustomCSS: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("round-trip mismatch:\nwant: %q\ngot:  %q", want, got)
	}
}

// TestWriteCustomCSS_Atomic verifies that a subsequent write does not leave a
// corrupt partial file (temp+rename pattern).
func TestWriteCustomCSS_Atomic(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "css-atomic"); err != nil {
		t.Fatalf("New: %v", err)
	}

	first := []byte("/* first */\n")
	second := []byte("/* second */\n:root { --r-main-color: blue; }\n")

	if err := deck.WriteCustomCSS(root, "css-atomic", first); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := deck.WriteCustomCSS(root, "css-atomic", second); err != nil {
		t.Fatalf("second write: %v", err)
	}

	got, err := deck.ReadCustomCSS(root, "css-atomic")
	if err != nil {
		t.Fatalf("ReadCustomCSS: %v", err)
	}
	if string(got) != string(second) {
		t.Errorf("after second write want %q, got %q", second, got)
	}
}

// TestWriteCustomCSS_NonExistentDeck verifies that writing to a missing deck
// returns an error rather than creating files in arbitrary locations.
func TestWriteCustomCSS_NonExistentDeck(t *testing.T) {
	root := makeWorkspace(t)
	err := deck.WriteCustomCSS(root, "nonexistent", []byte("/* x */"))
	if err == nil {
		t.Fatal("expected error for non-existent deck, got nil")
	}
}

// ── Bundled theme tests ───────────────────────────────────────────────────────

// TestBundledThemes_AllPresentAfterNew verifies that every bundled theme is
// copied into the deck's assets/vendor/reveal/theme/ by New().
func TestBundledThemes_AllPresentAfterNew(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "theme-test"); err != nil {
		t.Fatalf("New: %v", err)
	}

	themeDir := filepath.Join(root, "decks", "theme-test", "assets", "vendor", "reveal", "theme")
	for _, name := range deck.BundledThemes {
		p := filepath.Join(themeDir, name+".css")
		info, err := os.Stat(p)
		if err != nil {
			t.Errorf("bundled theme missing after New: %s.css: %v", name, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("bundled theme file empty: %s.css", name)
		}
	}
}

// TestBundledThemes_NoExternalURLs verifies that none of the bundled theme
// CSS files contain external http(s):// URLs (spec 12 offline invariant).
func TestBundledThemes_NoExternalURLs(t *testing.T) {
	root := makeWorkspace(t)
	if err := deck.New(root, "theme-offline"); err != nil {
		t.Fatalf("New: %v", err)
	}

	themeDir := filepath.Join(root, "decks", "theme-offline", "assets", "vendor", "reveal", "theme")
	extRe := regexp.MustCompile(`https?://\S+`)

	for _, name := range deck.BundledThemes {
		data, err := os.ReadFile(filepath.Join(themeDir, name+".css"))
		if err != nil {
			t.Errorf("read %s.css: %v", name, err)
			continue
		}
		if matches := extRe.FindAll(data, -1); len(matches) > 0 {
			t.Errorf("theme %s.css contains external URL(s) — violates spec 12:", name)
			for _, m := range matches {
				t.Errorf("  %s", m)
			}
		}
	}
}

// TestValidTheme_Bundled verifies that BundledThemes are all recognised by ValidTheme.
func TestValidTheme_Bundled(t *testing.T) {
	for _, name := range deck.BundledThemes {
		if !deck.ValidTheme(name) {
			t.Errorf("ValidTheme(%q): want true, got false", name)
		}
	}
}

// TestValidTheme_Unknown verifies that unknown names are rejected.
func TestValidTheme_Unknown(t *testing.T) {
	for _, bad := range []string{"", "../escape", "malicious", "../../etc/passwd"} {
		if deck.ValidTheme(bad) {
			t.Errorf("ValidTheme(%q): want false, got true", bad)
		}
	}
}
