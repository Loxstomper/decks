package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"slides-builder/internal/deck"
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
