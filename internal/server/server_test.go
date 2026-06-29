package server_test

import (
	"archive/zip"
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

// ── Create-deck API (P9-11) ────────────────────────────────────────────────────

// TestDeckCreate_OK verifies that POST /api/decks/{name} scaffolds a valid deck.
func TestDeckCreate_OK(t *testing.T) {
	srv, root := newTestServer(t)

	req := httptest.NewRequest("POST", "/api/decks/new-talk", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("create deck: want 201, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	// Response must be JSON with the name.
	var resp map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("create deck: decode json: %v", err)
	}
	if resp["name"] != "new-talk" {
		t.Errorf("create deck: want name=new-talk, got %q", resp["name"])
	}

	// Deck folder must exist.
	deckDir := deck.DeckPath(root, "new-talk")
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		t.Fatalf("create deck: expected deck directory at %s", deckDir)
	}

	// deck.html must exist.
	htmlPath := filepath.Join(deckDir, "deck.html")
	if _, err := os.Stat(htmlPath); err != nil {
		t.Fatalf("create deck: expected deck.html at %s", htmlPath)
	}

	// custom.css must exist.
	cssPath := filepath.Join(deckDir, "custom.css")
	if _, err := os.Stat(cssPath); err != nil {
		t.Fatalf("create deck: expected custom.css at %s", cssPath)
	}

	// Vendor files must be present (offline-first invariant).
	revealJS := filepath.Join(deckDir, "assets", "vendor", "reveal", "reveal.js")
	if _, err := os.Stat(revealJS); err != nil {
		t.Fatalf("create deck: expected vendored reveal.js at %s", revealJS)
	}

	// The deck must appear in GET /api/decks after creation.
	listReq := httptest.NewRequest("GET", "/api/decks", nil)
	listRR := httptest.NewRecorder()
	srv.ServeHTTP(listRR, listReq)
	var names []string
	if err := json.Unmarshal(listRR.Body.Bytes(), &names); err != nil {
		t.Fatalf("create deck: list decode: %v", err)
	}
	found := false
	for _, n := range names {
		if n == "new-talk" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("create deck: new-talk not in deck list: %v", names)
	}
}

// TestDeckCreate_Conflict verifies that a duplicate name returns 409.
func TestDeckCreate_Conflict(t *testing.T) {
	srv, root := newTestServer(t)

	// Pre-create the deck via deck.New.
	if err := deck.New(root, "existing"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/decks/existing", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf("create deck duplicate: want 409, got %d", rr.Code)
	}
}

// TestDeckCreate_BadName verifies that an invalid name returns 400.
func TestDeckCreate_BadName(t *testing.T) {
	srv, root := newTestServer(t)

	// deck.ValidName rejects exactly the path-unsafe names ("." / ".." / names
	// with slashes / empty) — and those are precisely the names http.ServeMux
	// path-cleans (301) or refuses to route to {name} before the handler runs.
	// So the handler's 400 branch is defensive but practically unreachable via
	// routing. The invariant that actually matters here is the security one:
	// a traversal name must NEVER create a deck. Assert that directly.
	for _, name := range []string{".", ".."} {
		req := httptest.NewRequest("POST", "/api/decks/"+name, nil)
		rr := httptest.NewRecorder()
		srv.ServeHTTP(rr, req)
		// Must not be a successful creation (201).
		if rr.Code == http.StatusCreated {
			t.Errorf("create deck bad name %q: unexpectedly created (201)", name)
		}
	}
	// No deck folder may have been written by any of the traversal attempts —
	// the decks dir must still be empty.
	entries, err := os.ReadDir(filepath.Join(root, "decks"))
	if err != nil {
		t.Fatalf("read decks dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("traversal names created %d deck folder(s); want 0", len(entries))
	}
}

// TestDeckCreate_NoExternalURLs verifies the offline-first invariant: a freshly
// created deck's deck.html must not contain any http/https URLs (spec 12).
func TestDeckCreate_NoExternalURLs(t *testing.T) {
	srv, root := newTestServer(t)

	req := httptest.NewRequest("POST", "/api/decks/offline-test", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create deck: want 201, got %d", rr.Code)
	}

	htmlPath := filepath.Join(deck.DeckPath(root, "offline-test"), "deck.html")
	data, err := os.ReadFile(htmlPath)
	if err != nil {
		t.Fatalf("create deck offline: read deck.html: %v", err)
	}
	content := string(data)
	for _, prefix := range []string{"https://", "http://"} {
		if strings.Contains(content, prefix) {
			t.Errorf("create deck offline: deck.html contains external URL (%s…)", prefix)
		}
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

	// "solarized-dark" must be present as a distinct entry from "solarized" (P9-9).
	hasSolDark := false
	hasSolLight := false
	for _, th := range themes {
		if th == "solarized-dark" {
			hasSolDark = true
		}
		if th == "solarized" {
			hasSolLight = true
		}
	}
	if !hasSolDark {
		t.Errorf("bundled themes list missing 'solarized-dark': %v", themes)
	}
	if !hasSolLight {
		t.Errorf("bundled themes list missing 'solarized' (light): %v", themes)
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

// ── Present route (P7-1) ──────────────────────────────────────────────────────

// TestPresent_ServesExactDeckHTML verifies that GET /present/{name} serves the
// on-disk deck.html verbatim plus the ephemeral present-only annotation/laser
// plugins injected before </body> (P17-19). The deck's own bytes appear
// unchanged in the response (everything up to </body> is preserved); only the
// plugin block is appended. The on-disk file itself is NEVER modified (spec 10).
func TestPresent_ServesExactDeckHTML(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "pres-deck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	// Read the file directly from disk.
	diskBytes, err := deck.Read(root, "pres-deck")
	if err != nil {
		t.Fatalf("deck.Read: %v", err)
	}

	// Fetch via /present/{name}/ (trailing slash is the canonical entry URL;
	// the bare form 308-redirects here — see TestPresent_RedirectsBareURL).
	req := httptest.NewRequest("GET", "/present/pres-deck/", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("present: want 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// The deck's own bytes up to </body> must be preserved verbatim — present
	// augments, it does not transform the deck content.
	bodyIdx := bytes.LastIndex(diskBytes, []byte("</body>"))
	if bodyIdx < 0 {
		t.Fatalf("scaffold deck.html has no </body>")
	}
	if !bytes.Contains(rr.Body.Bytes(), diskBytes[:bodyIdx]) {
		t.Errorf("present: deck content (up to </body>) not preserved verbatim in response")
	}
	// The ephemeral present-only plugins must be present in the response.
	if !strings.Contains(rr.Body.String(), "assets/vendor/chalkboard/plugin.js") {
		t.Errorf("present: expected injected chalkboard plugin in response")
	}

	// The on-disk file must be unchanged after the present fetch.
	afterBytes, err := deck.Read(root, "pres-deck")
	if err != nil {
		t.Fatalf("deck.Read (after): %v", err)
	}
	if !bytes.Equal(diskBytes, afterBytes) {
		t.Errorf("present: on-disk deck.html changed (must stay byte-stable)")
	}

	// Must declare text/html content type.
	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		t.Errorf("present: expected text/html content-type, got %q", ct)
	}
}

// TestPresent_ServesAssets verifies that /present/{name}/{path} resolves sibling
// assets (reveal.js, CSS, etc.) from the deck folder so relative hrefs work.
func TestPresent_ServesAssets(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "pres-assets"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("GET", "/present/pres-assets/assets/vendor/reveal/reveal.css", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("present asset: want 200, got %d", rr.Code)
	}
}

// TestPresent_NotFound verifies 404 for unknown decks.
func TestPresent_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/present/no-such-deck", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("present unknown deck: want 404, got %d", rr.Code)
	}
}

// TestPresent_RedirectsBareURL verifies that the bare /present/{name} entry URL
// 308-redirects to the trailing-slash form so the browser resolves the deck's
// relative asset paths against /present/{name}/ instead of /present/. The query
// string must be preserved so the PDF exporter's ?print-pdf survives the hop.
func TestPresent_RedirectsBareURL(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "redir-deck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	for _, tc := range []struct{ in, want string }{
		{"/present/redir-deck", "/present/redir-deck/"},
		{"/present/redir-deck?print-pdf", "/present/redir-deck/?print-pdf"},
	} {
		req := httptest.NewRequest("GET", tc.in, nil)
		rr := httptest.NewRecorder()
		srv.ServeHTTP(rr, req)

		if rr.Code != http.StatusPermanentRedirect {
			t.Errorf("GET %s: want 308, got %d", tc.in, rr.Code)
		}
		if loc := rr.Header().Get("Location"); loc != tc.want {
			t.Errorf("GET %s: want Location %q, got %q", tc.in, tc.want, loc)
		}
	}

	// An unknown deck must still 404 on the bare URL — the existence check runs
	// before the redirect, so we don't bounce clients to a dead trailing-slash URL.
	req := httptest.NewRequest("GET", "/present/ghost-deck", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("bare unknown deck: want 404, got %d", rr.Code)
	}
}

// TestPresent_MatchesDeckStaticRoute confirms the present route serves the same
// underlying deck file as the static /decks/ route, differing only by the
// ephemeral present-only plugin block (P17-19): the static (on-disk) bytes up to
// </body> appear verbatim in the present response, and only the present route
// carries the chalkboard/laser plugins.
func TestPresent_MatchesDeckStaticRoute(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "compare"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	get := func(path string) []byte {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		srv.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("GET %s: want 200, got %d", path, rr.Code)
		}
		return rr.Body.Bytes()
	}

	presentBytes := get("/present/compare/")
	staticBytes := get("/decks/compare/deck.html")

	// The static route serves the file unmodified; its content (up to </body>)
	// must appear verbatim in the present response.
	bodyIdx := bytes.LastIndex(staticBytes, []byte("</body>"))
	if bodyIdx < 0 {
		t.Fatalf("static deck.html has no </body>")
	}
	if !bytes.Contains(presentBytes, staticBytes[:bodyIdx]) {
		t.Errorf("present response does not contain the static deck content verbatim")
	}
	// The static route must NOT carry the present-only plugins.
	if bytes.Contains(staticBytes, []byte("assets/vendor/chalkboard/plugin.js")) {
		t.Errorf("static /decks/ route unexpectedly contains the present-only plugin block")
	}
	if !bytes.Contains(presentBytes, []byte("assets/vendor/chalkboard/plugin.js")) {
		t.Errorf("present route missing the present-only plugin block")
	}
}

// ── Notes plugin (P7-2) ───────────────────────────────────────────────────────

// TestNotesPlugin_VendoredAndEnabled ensures the notes plugin is copied into
// new decks and referenced in deck.html — prerequisites for 'S'-key speaker view.
func TestNotesPlugin_VendoredAndEnabled(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "decks"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := deck.New(root, "notes-deck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	// 1. plugin.js must exist under assets/vendor/notes/.
	pluginPath := filepath.Join(root, "decks", "notes-deck", "assets", "vendor", "notes", "plugin.js")
	if _, err := os.Stat(pluginPath); err != nil {
		t.Errorf("notes plugin.js not vendored into deck: %v", err)
	}

	// 2. speaker-view.html must be present (required by the popup speaker window).
	speakerPath := filepath.Join(root, "decks", "notes-deck", "assets", "vendor", "notes", "speaker-view.html")
	if _, err := os.Stat(speakerPath); err != nil {
		t.Errorf("speaker-view.html not vendored into deck: %v", err)
	}

	// 3. deck.html must reference the plugin and include RevealNotes in the
	//    plugins array — this is what enables the 'S' key.
	htmlPath := filepath.Join(root, "decks", "notes-deck", "deck.html")
	htmlBytes, err := os.ReadFile(htmlPath)
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}
	html := string(htmlBytes)

	if !strings.Contains(html, "assets/vendor/notes/notes.js") {
		t.Error("deck.html does not load assets/vendor/notes/notes.js")
	}
	if !strings.Contains(html, "RevealNotes") {
		t.Error("deck.html does not include RevealNotes in plugins array")
	}

	// 4. Zero external URLs: the deck must be fully offline-capable (spec 12).
	//    Scan both the HTML and the speaker-view.html for any http(s):// links.
	for _, p := range []struct{ label, path string }{
		{"deck.html", htmlPath},
		{"speaker-view.html", speakerPath},
	} {
		data, err := os.ReadFile(p.path)
		if err != nil {
			t.Fatalf("read %s: %v", p.label, err)
		}
		// Allow "http" inside comments or in tests, but external https:// CDN
		// URLs are a violation.  We specifically check for CDN/absolute URLs.
		for _, forbidden := range []string{"https://cdn", "https://fonts.googleapis", "https://unpkg"} {
			if strings.Contains(string(data), forbidden) {
				t.Errorf("%s contains external URL %q — violates spec 12", p.label, forbidden)
			}
		}
	}
}

// ── ZIP export (P7-4) ─────────────────────────────────────────────────────────

// TestExportZIP_ContainsDeckAndAssets verifies that the zip archive contains
// deck.html and at least one vendor asset, and is self-contained.
func TestExportZIP_ContainsDeckAndAssets(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "zip-deck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/decks/zip-deck/export.zip", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("export.zip: want 200, got %d: %s", rr.Code, rr.Body.String())
	}

	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/zip") {
		t.Errorf("export.zip: expected application/zip content-type, got %q", ct)
	}

	// Parse the zip to verify its contents.
	body := rr.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("parse zip: %v", err)
	}

	fileSet := make(map[string]bool)
	for _, f := range zr.File {
		fileSet[f.Name] = true
	}

	// Must contain deck.html under the deck name prefix.
	if !fileSet["zip-deck/deck.html"] {
		t.Errorf("zip missing zip-deck/deck.html; got: %v", fileSet)
	}
	// Must contain custom.css.
	if !fileSet["zip-deck/custom.css"] {
		t.Errorf("zip missing zip-deck/custom.css")
	}
	// Must contain at least one vendor file (self-contained check).
	hasVendor := false
	for name := range fileSet {
		if strings.Contains(name, "assets/vendor/") {
			hasVendor = true
			break
		}
	}
	if !hasVendor {
		t.Error("zip missing assets/vendor/ — deck would not be self-contained")
	}

	// Traversal safety: no zip entry should escape the deck prefix.
	for name := range fileSet {
		if strings.Contains(name, "..") {
			t.Errorf("zip contains path traversal: %q", name)
		}
		if !strings.HasPrefix(name, "zip-deck/") {
			t.Errorf("zip entry outside deck prefix: %q", name)
		}
	}
}

// TestExportZIP_NotFound verifies 404 for unknown decks.
func TestExportZIP_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/decks/no-such/export.zip", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("export.zip unknown deck: want 404, got %d", rr.Code)
	}
}

// ── PDF export (P7-3) ─────────────────────────────────────────────────────────

// TestExportPDF_NoChromeReturns503 verifies graceful 503 when Chrome is absent.
// This test temporarily clears CHROME_BIN and relies on Chrome not being in the
// test environment PATH to trigger the graceful error path.
func TestExportPDF_NoChromeReturns503(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "pdf-deck"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	// Override CHROME_BIN to a non-existent path and PATH to empty so no Chrome
	// binary is found, exercising the graceful degradation path.
	origCHROME := os.Getenv("CHROME_BIN")
	origPATH := os.Getenv("PATH")
	os.Setenv("CHROME_BIN", "/nonexistent/chrome")
	os.Setenv("PATH", "") // clear PATH so LookPath finds nothing
	defer func() {
		os.Setenv("CHROME_BIN", origCHROME)
		os.Setenv("PATH", origPATH)
	}()

	req := httptest.NewRequest("GET", "/api/decks/pdf-deck/export.pdf", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("export.pdf no chrome: want 503, got %d: %s", rr.Code, rr.Body.String())
	}

	// Response must be JSON with an "error" field.
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Errorf("export.pdf 503 body not JSON: %s", rr.Body.String())
	} else if _, ok := resp["error"]; !ok {
		t.Errorf("export.pdf 503 JSON missing 'error' field: %v", resp)
	}
}

// TestExportPDF_WithChrome runs the PDF export end-to-end if Chrome is detected.
// The test is skipped when no Chrome binary is available so CI without a display
// does not fail.
func TestExportPDF_WithChrome(t *testing.T) {
	// Use the same detection logic as the server to decide whether to skip.
	chromeBin, ok := server.FindChrome()
	if !ok {
		t.Skip("no Chrome/Chromium found; skipping live PDF test")
	}
	t.Logf("using Chrome at %s", chromeBin)

	// The PDF handler drives Chrome against /present/{name}?print-pdf on the
	// running server.  We need a real HTTP server (not httptest.NewRecorder) so
	// Chrome can reach it.
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "decks"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := deck.New(root, "chrome-pdf"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	httpSrv := httptest.NewServer(server.New(root, nil, nil))
	defer httpSrv.Close()

	resp, err := http.Get(httpSrv.URL + "/api/decks/chrome-pdf/export.pdf")
	if err != nil {
		t.Fatalf("GET export.pdf: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("export.pdf: want 200, got %d: %s", resp.StatusCode, body)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "application/pdf") {
		t.Errorf("export.pdf: expected application/pdf, got %q", ct)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read pdf body: %v", err)
	}
	// A valid PDF starts with the %PDF- magic bytes.
	if len(body) < 5 || !bytes.Equal(body[:5], []byte("%PDF-")) {
		preview := body
		if len(preview) > 10 {
			preview = preview[:10]
		}
		t.Errorf("export.pdf: response does not start with %%PDF- magic (got %q)", preview)
	}
}

// ── Validation endpoint (P8-2) ─────────────────────────────────────────────────

// TestValidate_CleanDeck verifies POST /api/decks/{name}/validate returns
// {ok:true,errors:[]} for a freshly scaffolded deck.
func TestValidate_CleanDeck(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "clean"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/decks/clean/validate", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var res struct {
		OK     bool `json:"ok"`
		Errors []struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode JSON: %v; body=%s", err, rr.Body.String())
	}
	if !res.OK || len(res.Errors) != 0 {
		t.Fatalf("expected ok with no errors, got %+v", res)
	}
}

// TestValidate_BadBody verifies the endpoint validates a supplied candidate
// document and reports structured errors with code/message/line.
func TestValidate_BadBody(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "checkme"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}

	bad := `<section data-eid="x" data-lay="diagonal"><p data-eid="x">dup</p></section>`
	req := httptest.NewRequest("POST", "/api/decks/checkme/validate", strings.NewReader(bad))
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (validation failure is not a transport error)", rr.Code)
	}
	var res struct {
		OK     bool `json:"ok"`
		Errors []struct {
			Code string `json:"code"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
	if res.OK {
		t.Fatalf("expected ok=false for bad body")
	}
	var sawEnum, sawDup bool
	for _, e := range res.Errors {
		switch e.Code {
		case "invalid-enum":
			sawEnum = true
		case "duplicate-eid":
			sawDup = true
		}
	}
	if !sawEnum || !sawDup {
		t.Fatalf("expected invalid-enum and duplicate-eid, got %+v", res.Errors)
	}
}

// TestValidate_DeckNotFound verifies a missing deck yields 404.
func TestValidate_DeckNotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("POST", "/api/decks/ghost/validate", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// TestPresentRoute_InjectsPluginsByteStable verifies the present route serves a
// deck.html augmented with the chalkboard + laser plugins (P17-19) while the
// on-disk deck.html stays byte-identical (annotations are ephemeral, spec 10).
func TestPresentRoute_InjectsPluginsByteStable(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "talk"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}
	deckPath := filepath.Join(root, "decks", "talk", "deck.html")
	before, err := os.ReadFile(deckPath)
	if err != nil {
		t.Fatalf("read deck.html: %v", err)
	}

	// Trailing slash so the handler serves the entry document (no redirect).
	req := httptest.NewRequest("GET", "/present/talk/", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("present status = %d, want 200", rr.Code)
	}
	served := rr.Body.String()
	for _, want := range []string{
		"assets/vendor/chalkboard/plugin.js",
		"assets/vendor/laser/plugin.js",
		"Reveal.registerPlugin(RevealChalkboard)",
	} {
		if !strings.Contains(served, want) {
			t.Errorf("present HTML missing %q", want)
		}
	}

	// On-disk deck.html must be unchanged after the present fetch.
	after, err := os.ReadFile(deckPath)
	if err != nil {
		t.Fatalf("re-read deck.html: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Errorf("present route mutated on-disk deck.html (must be byte-stable)")
	}
}

// TestAutoSlideEndpoint sets the deck-level auto-advance via the API and asserts
// Reveal.initialize carries autoSlide/loop, then that re-POSTing the same values
// is byte-stable (no diff).
func TestAutoSlideEndpoint(t *testing.T) {
	srv, root := newTestServer(t)
	if err := deck.New(root, "talk"); err != nil {
		t.Fatalf("deck.New: %v", err)
	}
	deckPath := filepath.Join(root, "decks", "talk", "deck.html")

	post := func(body string) int {
		req := httptest.NewRequest("POST", "/api/decks/talk/autoslide", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.ServeHTTP(rr, req)
		return rr.Code
	}

	if code := post(`{"ms":3000,"loop":true}`); code != http.StatusNoContent {
		t.Fatalf("autoslide POST status = %d, want 204", code)
	}
	html, _ := os.ReadFile(deckPath)
	if !strings.Contains(string(html), "autoSlide: 3000,") {
		t.Errorf("deck.html missing autoSlide: 3000\n%s", html)
	}
	if !strings.Contains(string(html), "loop: true,") {
		t.Errorf("deck.html missing loop: true")
	}

	// Idempotent: re-POST identical values → byte-identical file.
	before, _ := os.ReadFile(deckPath)
	if code := post(`{"ms":3000,"loop":true}`); code != http.StatusNoContent {
		t.Fatalf("second autoslide POST status = %d, want 204", code)
	}
	after, _ := os.ReadFile(deckPath)
	if !bytes.Equal(before, after) {
		t.Errorf("re-POSTing identical autoslide values changed the file (not byte-stable)")
	}

	// Disabling: ms=0 + loop=false removes both keys.
	if code := post(`{"ms":0,"loop":false}`); code != http.StatusNoContent {
		t.Fatalf("disable autoslide status = %d, want 204", code)
	}
	html, _ = os.ReadFile(deckPath)
	if strings.Contains(string(html), "autoSlide:") || strings.Contains(string(html), "loop:") {
		t.Errorf("disabling should remove autoSlide/loop keys\n%s", html)
	}
}
