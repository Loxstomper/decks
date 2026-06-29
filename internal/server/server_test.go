package server_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"slides-builder/internal/assets"
	"slides-builder/internal/deck"
	"slides-builder/internal/provider"
	"slides-builder/internal/provider/giphy"
	"slides-builder/internal/provider/unsplash"
	"slides-builder/internal/server"
)

// newTestServer creates a Server backed by a temp workspace (no watcher, no static FS).
func newTestServer(t *testing.T) (*server.Server, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "decks"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	srv := server.New(root, nil, nil)
	return srv, root
}

// newTestServerWithProviders creates a Server with a pre-configured registry.
func newTestServerWithProviders(t *testing.T, reg *provider.Registry) (*server.Server, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "decks"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	srv := server.NewWithProviders(root, nil, nil, reg)
	return srv, root
}

// multipartBody builds a multipart/form-data body with a single "file" field.
func multipartBody(t *testing.T, filename, contentType string, data []byte) (body *bytes.Buffer, ct string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename)}
	h["Content-Type"] = []string{contentType}
	fw, err := w.CreatePart(h)
	if err != nil {
		t.Fatalf("create multipart part: %v", err)
	}
	fw.Write(data)
	w.Close()
	return &buf, w.FormDataContentType()
}

// ── Existing tests (unchanged) ────────────────────────────────────────────────

func TestHealth(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("health: want 200, got %d", rr.Code)
	}
}

func TestDeckList_Empty(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/decks", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("deck list: want 200, got %d", rr.Code)
	}
	var names []string
	if err := json.Unmarshal(rr.Body.Bytes(), &names); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("expected empty list, got %v", names)
	}
}

func TestDeckList_WithDeck(t *testing.T) {
	srv, root := newTestServer(t)

	if err := deck.New(root, "my-talk"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/decks", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	var names []string
	if err := json.Unmarshal(rr.Body.Bytes(), &names); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	if len(names) != 1 || names[0] != "my-talk" {
		t.Errorf("deck list: want [my-talk], got %v", names)
	}
}

func TestDeckRead_Found(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "sample"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/decks/sample", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("deck read: want 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
}

func TestDeckRead_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/decks/doesnotexist", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("deck read missing: want 404, got %d", rr.Code)
	}
}

func TestDeckWrite_RoundTrip(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "writable"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	// Read original.
	req := httptest.NewRequest("GET", "/api/decks/writable", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	original, err := io.ReadAll(rr.Body)
	if err != nil {
		t.Fatal(err)
	}

	// Write back the same bytes.
	req2 := httptest.NewRequest("PUT", "/api/decks/writable", bytes.NewReader(original))
	rr2 := httptest.NewRecorder()
	srv.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusNoContent {
		t.Fatalf("deck write: want 204, got %d", rr2.Code)
	}

	// Read again and compare.
	req3 := httptest.NewRequest("GET", "/api/decks/writable", nil)
	rr3 := httptest.NewRecorder()
	srv.ServeHTTP(rr3, req3)
	after, err := io.ReadAll(rr3.Body)
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(original, after) {
		t.Errorf("round-trip not byte-identical: original=%d bytes, after=%d bytes", len(original), len(after))
	}
}

// TestDeckStatic_ServesEntryAndAssets verifies the /decks/{name}/... static
// route the iframe relies on.
func TestDeckStatic_ServesEntryAndAssets(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "served"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	cases := []struct {
		path        string
		wantStatus  int
		wantCTHas   string
		wantBodyHas string
	}{
		{"/decks/served/deck.html", http.StatusOK, "text/html", `<div class="reveal">`},
		{"/decks/served/", http.StatusOK, "text/html", `<div class="reveal">`}, // root → deck.html
		{"/decks/served/assets/vendor/reveal/reveal.css", http.StatusOK, "text/css", ""},
	}
	for _, tc := range cases {
		req := httptest.NewRequest("GET", tc.path, nil)
		rr := httptest.NewRecorder()
		srv.ServeHTTP(rr, req)
		if rr.Code != tc.wantStatus {
			t.Errorf("%s: want status %d, got %d", tc.path, tc.wantStatus, rr.Code)
			continue
		}
		if ct := rr.Header().Get("Content-Type"); tc.wantCTHas != "" && !strings.Contains(ct, tc.wantCTHas) {
			t.Errorf("%s: Content-Type %q does not contain %q", tc.path, ct, tc.wantCTHas)
		}
		if tc.wantBodyHas != "" && !strings.Contains(rr.Body.String(), tc.wantBodyHas) {
			t.Errorf("%s: body missing %q", tc.path, tc.wantBodyHas)
		}
	}
}

// TestDeckStatic_PathTraversalBlocked ensures a crafted URL cannot escape the deck folder.
func TestDeckStatic_PathTraversalBlocked(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "guarded"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}
	// Plant a secret one level above the deck folder.
	if err := os.WriteFile(filepath.Join(root, "decks", "secret.txt"), []byte("top-secret"), 0o644); err != nil {
		t.Fatalf("write secret: %v", err)
	}

	for _, path := range []string{"/decks/guarded/../secret.txt", "/decks/guarded/..%2fsecret.txt"} {
		req := httptest.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		srv.ServeHTTP(rr, req)
		if rr.Code == http.StatusOK && strings.Contains(rr.Body.String(), "top-secret") {
			t.Errorf("%s: traversal succeeded — leaked secret", path)
		}
	}

	req := httptest.NewRequest("GET", "/decks/..%2f..%2f/deck.html", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code == http.StatusOK {
		t.Errorf("invalid deck name served with 200")
	}
}

// ── Asset upload (P5-3) ───────────────────────────────────────────────────────

func TestAssetUpload_ImageReturnsRelSrc(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "uploadtest"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	body, ct := multipartBody(t, "photo.jpg", "image/jpeg", []byte("fake jpeg data"))
	req := httptest.NewRequest("POST", "/api/decks/uploadtest/assets", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("asset upload: want 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		Src string `json:"src"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.HasPrefix(resp.Src, "assets/img/") {
		t.Errorf("expected assets/img/ prefix, got %q", resp.Src)
	}

	// Verify file exists on disk.
	absPath := filepath.Join(root, "decks", "uploadtest", resp.Src)
	if _, err := os.Stat(absPath); err != nil {
		t.Errorf("uploaded file missing on disk: %v", err)
	}
}

func TestAssetUpload_DeckNotFound(t *testing.T) {
	srv, _ := newTestServer(t)

	body, ct := multipartBody(t, "photo.jpg", "image/jpeg", []byte("data"))
	req := httptest.NewRequest("POST", "/api/decks/nonexistent/assets", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", rr.Code)
	}
}

func TestAssetUpload_TraversalSafe(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "traversal"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	// Attempt a traversal filename.
	body, ct := multipartBody(t, "../../etc/passwd", "image/png", []byte("attack"))
	req := httptest.NewRequest("POST", "/api/decks/traversal/assets", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200 (should sanitize filename), got %d", rr.Code)
	}
	var resp struct {
		Src string `json:"src"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	// Src must not contain ".." or point outside assets/.
	if strings.Contains(resp.Src, "..") {
		t.Errorf("traversal in src: %q", resp.Src)
	}
	// File must be inside the deck.
	abs := filepath.Join(root, "decks", "traversal", resp.Src)
	deckAssets := filepath.Join(root, "decks", "traversal", "assets")
	if !strings.HasPrefix(abs, deckAssets) {
		t.Errorf("file outside assets/: %s", abs)
	}
}

func TestAssetUpload_VideoSubdir(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "vidtest"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	body, ct := multipartBody(t, "clip.mp4", "video/mp4", []byte("fake mp4 data"))
	req := httptest.NewRequest("POST", "/api/decks/vidtest/assets", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Src string `json:"src"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if !strings.HasPrefix(resp.Src, "assets/video/") {
		t.Errorf("expected assets/video/ prefix for video, got %q", resp.Src)
	}
}

// ── Shared library (P5-5) ─────────────────────────────────────────────────────

func TestSharedList_Empty(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/shared", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var entries []assets.SharedEntry
	if err := json.Unmarshal(rr.Body.Bytes(), &entries); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected empty list, got %v", entries)
	}
}

func TestSharedList_WithFiles(t *testing.T) {
	srv, root := newTestServer(t)
	sharedDir := filepath.Join(root, "shared")
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	os.WriteFile(filepath.Join(sharedDir, "logo.png"), []byte("png"), 0o644)
	os.WriteFile(filepath.Join(sharedDir, "bg.jpg"), []byte("jpg"), 0o644)

	req := httptest.NewRequest("GET", "/api/shared", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	var entries []assets.SharedEntry
	json.Unmarshal(rr.Body.Bytes(), &entries)
	if len(entries) != 2 {
		t.Errorf("expected 2 entries, got %d", len(entries))
	}
}

func TestSharedCopy_CopiesIntoDeck(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "dest"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}
	sharedDir := filepath.Join(root, "shared")
	os.MkdirAll(sharedDir, 0o755)
	os.WriteFile(filepath.Join(sharedDir, "hero.png"), []byte("hero image data"), 0o644)

	req := httptest.NewRequest("POST", "/api/shared/hero.png/copy?deck=dest", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if src := resp["src"]; !strings.HasPrefix(src, "assets/") {
		t.Errorf("expected relative src in assets/, got %q", src)
	}
	// Must NOT be a reference to shared/.
	if strings.Contains(resp["src"], "shared/") {
		t.Errorf("src should not reference shared/: %q", resp["src"])
	}
}

func TestSharedCopy_MissingDeckParam(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("POST", "/api/shared/hero.png/copy", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("want 400 without deck param, got %d", rr.Code)
	}
}

// ── Provider API (P5-6) ───────────────────────────────────────────────────────

func TestProviderList_EmptyWhenNoKeys(t *testing.T) {
	var reg provider.Registry
	reg.Register(unsplash.NewWithKey(""))
	reg.Register(giphy.NewWithKey(""))

	srv, _ := newTestServerWithProviders(t, &reg)
	req := httptest.NewRequest("GET", "/api/providers", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var list []provider.ProviderInfo
	json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Errorf("expected empty list (no API keys), got %v", list)
	}
}

func TestProviderList_ShowsEnabledProviders(t *testing.T) {
	var reg provider.Registry
	reg.Register(unsplash.NewWithKey("fake-unsplash-key"))
	reg.Register(giphy.NewWithKey(""))

	srv, _ := newTestServerWithProviders(t, &reg)
	req := httptest.NewRequest("GET", "/api/providers", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	var list []provider.ProviderInfo
	json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("expected 1 enabled provider, got %d: %v", len(list), list)
	}
	if list[0].Name != "unsplash" {
		t.Errorf("expected unsplash, got %s", list[0].Name)
	}
}

func TestProviderSearch_UnknownProvider(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/providers/nonexistent/search?q=cats", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("want 404 for unknown provider, got %d", rr.Code)
	}
}

func TestProviderSearch_DisabledProvider(t *testing.T) {
	var reg provider.Registry
	reg.Register(unsplash.NewWithKey("")) // disabled

	srv, _ := newTestServerWithProviders(t, &reg)
	req := httptest.NewRequest("GET", "/api/providers/unsplash/search?q=cats", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("want 403 for disabled provider, got %d", rr.Code)
	}
}

func TestProviderFetch_UnknownProvider(t *testing.T) {
	srv, _ := newTestServer(t)
	body := strings.NewReader(`{"id":"abc","deck":"test"}`)
	req := httptest.NewRequest("POST", "/api/providers/nonexistent/fetch", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", rr.Code)
	}
}

func TestProviderFetch_DisabledProvider(t *testing.T) {
	var reg provider.Registry
	reg.Register(giphy.NewWithKey("")) // disabled

	srv, _ := newTestServerWithProviders(t, &reg)
	body := strings.NewReader(`{"id":"abc","deck":"test"}`)
	req := httptest.NewRequest("POST", "/api/providers/giphy/fetch", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("want 403, got %d", rr.Code)
	}
}

// ── Capabilities (P5-14) ──────────────────────────────────────────────────────

func TestCapabilities_ReturnsJSON(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/capabilities", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var caps map[string]bool
	if err := json.Unmarshal(rr.Body.Bytes(), &caps); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	// ffmpeg key must be present (value depends on environment).
	if _, ok := caps["ffmpeg"]; !ok {
		t.Error("capabilities missing 'ffmpeg' key")
	}
}

// ── Custom CSS endpoint tests (P6-11) ─────────────────────────────────────────

func TestCustomCSSWrite_OK(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "css-deck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	css := []byte(":root { --r-main-color: #ff0000; }\n")
	req := httptest.NewRequest("PUT", "/api/decks/css-deck/custom.css", bytes.NewReader(css))
	req.Header.Set("Content-Type", "text/css")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("PUT custom.css: want 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify the file was written correctly.
	got, err := deck.ReadCustomCSS(root, "css-deck")
	if err != nil {
		t.Fatalf("ReadCustomCSS: %v", err)
	}
	if !bytes.Equal(css, got) {
		t.Errorf("custom.css mismatch:\nwant: %q\ngot:  %q", css, got)
	}
}

func TestCustomCSSRead_OK(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "css-read"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	// Write some content first.
	want := []byte("/* test */\n:root { --r-main-color: blue; }\n")
	if err := deck.WriteCustomCSS(root, "css-read", want); err != nil {
		t.Fatalf("WriteCustomCSS: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/decks/css-read/custom.css", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET custom.css: want 200, got %d", rr.Code)
	}
	if !bytes.Equal(want, rr.Body.Bytes()) {
		t.Errorf("custom.css body mismatch:\nwant: %q\ngot:  %q", want, rr.Body.Bytes())
	}
}

func TestCustomCSSWrite_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest("PUT", "/api/decks/no-such/custom.css", strings.NewReader("/* x */"))
	req.Header.Set("Content-Type", "text/css")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("PUT custom.css nonexistent deck: want 404, got %d", rr.Code)
	}
}

func TestCustomCSS_RoundTrip(t *testing.T) {
	// Write then read via the HTTP API must be byte-identical (P6-11 byte-stable).
	srv, root := newTestServer(t)
	if err := deck.New(root, "css-rt"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	content := []byte(":root {\n  --r-background-color: #1a1a2e;\n  --r-main-color: #eee;\n}\n")

	req := httptest.NewRequest("PUT", "/api/decks/css-rt/custom.css", bytes.NewReader(content))
	req.Header.Set("Content-Type", "text/css")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("PUT: want 204, got %d", rr.Code)
	}

	req2 := httptest.NewRequest("GET", "/api/decks/css-rt/custom.css", nil)
	rr2 := httptest.NewRecorder()
	srv.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("GET: want 200, got %d", rr2.Code)
	}
	if !bytes.Equal(content, rr2.Body.Bytes()) {
		t.Errorf("round-trip mismatch:\nwant: %q\ngot:  %q", content, rr2.Body.Bytes())
	}
}

// ── Theme list endpoint tests (P6-10) ─────────────────────────────────────────

func TestThemeList_OK(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest("GET", "/api/themes", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /api/themes: want 200, got %d", rr.Code)
	}

	var themes []string
	if err := json.Unmarshal(rr.Body.Bytes(), &themes); err != nil {
		t.Fatalf("decode themes: %v", err)
	}
	if len(themes) == 0 {
		t.Error("expected at least one bundled theme, got empty list")
	}

	// "black" must always be present (default theme).
	hasBlack := false
	for _, t := range themes {
		if t == "black" {
			hasBlack = true
			break
		}
	}
	if !hasBlack {
		t.Errorf("bundled themes list missing 'black': %v", themes)
	}
}

// ── Font localization endpoint tests (P6-13) ───────────────────────────────────

// mockFontAPIServer starts a local HTTP server that simulates the Google Fonts
// CSS2 API + font CDN for server endpoint tests.
func mockFontAPIServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/css2"):
			host := "http://" + r.Host
			fmt.Fprintf(w, `@font-face {
  font-family: 'TestFont';
  font-style: normal;
  font-weight: 400;
  src: url(%s/fonts/test.woff2) format('woff2');
}
`, host)
		case strings.HasSuffix(r.URL.Path, ".woff2"):
			w.Header().Set("Content-Type", "font/woff2")
			w.Write([]byte("FAKE_WOFF2"))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestFontLocalize_OK(t *testing.T) {
	fontSrv := mockFontAPIServer(t)
	defer fontSrv.Close()

	origBase := deck.GoogleFontsBaseURL()
	deck.SetGoogleFontsBaseURL(fontSrv.URL + "/css2")
	defer deck.SetGoogleFontsBaseURL(origBase)

	srv, root := newTestServer(t)
	if err := deck.New(root, "fontdeck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	body := `{"family":"TestFont","weights":"400"}`
	req := httptest.NewRequest("POST", "/api/decks/fontdeck/fonts",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("POST /fonts: want 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var result struct {
		CSSPath string `json:"cssPath"`
		Family  string `json:"family"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode font result: %v", err)
	}
	if result.Family != "TestFont" {
		t.Errorf("family: want %q, got %q", "TestFont", result.Family)
	}
	if !strings.HasPrefix(result.CSSPath, "assets/fonts/") {
		t.Errorf("cssPath should start with assets/fonts/, got %q", result.CSSPath)
	}

	// Verify the generated CSS is free of external URLs (spec 12).
	cssFull := filepath.Join(root, "decks", "fontdeck", result.CSSPath)
	cssData, err := os.ReadFile(cssFull)
	if err != nil {
		t.Fatalf("read font-face.css: %v", err)
	}
	if bytes.Contains(cssData, []byte("http")) {
		t.Errorf("font-face.css contains external URL after localization — violates spec 12:\n%s", cssData)
	}
}

func TestFontLocalize_MissingFamily(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "fontmiss"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/decks/fontmiss/fonts",
		strings.NewReader(`{"weights":"400"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("missing family: want 400, got %d", rr.Code)
	}
}

func TestFontLocalize_Offline503(t *testing.T) {
	// Simulate offline by pointing at a refused port.
	origBase := deck.GoogleFontsBaseURL()
	deck.SetGoogleFontsBaseURL("http://127.0.0.1:1/css2")
	defer deck.SetGoogleFontsBaseURL(origBase)

	srv, root := newTestServer(t)
	if err := deck.New(root, "offline503"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/decks/offline503/fonts",
		strings.NewReader(`{"family":"Inter"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("offline font: want 503, got %d", rr.Code)
	}
}

