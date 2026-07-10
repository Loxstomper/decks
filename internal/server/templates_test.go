package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Loxstomper/decks/internal/deck"
)

// TestTemplateList_BuiltinsOnly verifies GET /api/templates returns the bundled
// layout presets when the workspace templates/ dir is empty/absent.
func TestTemplateList_BuiltinsOnly(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest("GET", "/api/templates", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got []deck.LayoutPreset
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	want := deck.BundledLayouts()
	if len(got) != len(want) {
		t.Fatalf("got %d templates, want %d built-ins", len(got), len(want))
	}
	have := make(map[string]bool, len(got))
	for _, p := range got {
		have[p.Name] = true
	}
	for _, p := range want {
		if !have[p.Name] {
			t.Errorf("missing built-in %q", p.Name)
		}
	}
}

// TestTemplateList_UserSnippet verifies a dropped-in templates/foo.html surfaces
// alongside the built-ins.
func TestTemplateList_UserSnippet(t *testing.T) {
	srv, root := newTestServer(t)

	tplDir := filepath.Join(root, "templates")
	if err := os.MkdirAll(tplDir, 0o755); err != nil {
		t.Fatalf("mkdir templates: %v", err)
	}
	const snippet = `<section data-layout="foo"><div data-lay="stack" data-slot="content"><h1>Hi</h1></div></section>`
	if err := os.WriteFile(filepath.Join(tplDir, "foo.html"), []byte(snippet), 0o644); err != nil {
		t.Fatalf("write snippet: %v", err)
	}
	// A non-.html file and a subdir must be ignored.
	if err := os.WriteFile(filepath.Join(tplDir, "ignore.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatalf("write txt: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(tplDir, "sub"), 0o755); err != nil {
		t.Fatalf("mkdir sub: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/templates", nil)
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got []deck.LayoutPreset
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	byName := make(map[string]deck.LayoutPreset, len(got))
	for _, p := range got {
		byName[p.Name] = p
	}

	// Built-ins still present.
	if _, ok := byName["title"]; !ok {
		t.Error("built-in 'title' missing after user snippet added")
	}
	// User snippet present with its file content as HTML.
	foo, ok := byName["foo"]
	if !ok {
		t.Fatal("user snippet 'foo' not listed")
	}
	if foo.HTML != snippet {
		t.Errorf("foo.HTML = %q, want %q", foo.HTML, snippet)
	}
	if foo.Label != "foo" {
		t.Errorf("foo.Label = %q, want %q", foo.Label, "foo")
	}
	if _, ok := byName["ignore"]; ok {
		t.Error("non-.html file should not be listed")
	}
	if _, ok := byName["sub"]; ok {
		t.Error("subdirectory should not be listed")
	}
}
