package assets_test

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Loxstomper/decks/internal/assets"
	"github.com/Loxstomper/decks/internal/deck"
)

// makeWorkspace creates a temp workspace with an empty decks/ directory and
// a scaffolded deck named "testdeck".
func makeWorkspace(t *testing.T) (root, deckName string) {
	t.Helper()
	root = t.TempDir()
	deckName = "testdeck"
	if err := os.MkdirAll(filepath.Join(root, "decks"), 0o755); err != nil {
		t.Fatalf("mkdir decks: %v", err)
	}
	if err := deck.New(root, deckName); err != nil {
		t.Fatalf("deck.New: %v", err)
	}
	return root, deckName
}

// ── SafeFilename ─────────────────────────────────────────────────────────────

func TestSafeFilename_StripsDirComponents(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"photo.jpg", "photo.jpg"},
		{"../escape.jpg", "escape.jpg"},
		{"a/b/c.png", "c.png"},
		{"/abs/path.gif", "path.gif"},
		{"hello world.png", "hello_world.png"},
		{"foo<bar>.png", "foo_bar_.png"},
		{"", "file"},
	}
	for _, tc := range cases {
		got := assets.SafeFilename(tc.input)
		if got != tc.want {
			t.Errorf("SafeFilename(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

// ── LocalizeBytes ─────────────────────────────────────────────────────────────

func TestLocalizeBytes_WritesFileAndReturnsRelSrc(t *testing.T) {
	root, deckName := makeWorkspace(t)

	data := []byte("fake PNG data")
	relSrc, err := assets.LocalizeBytes(root, deckName, data, "photo.png", "image/png")
	if err != nil {
		t.Fatalf("LocalizeBytes: %v", err)
	}

	// Relative src must start with assets/img/ for images.
	if !strings.HasPrefix(relSrc, "assets/img/") {
		t.Errorf("want assets/img/ prefix, got %q", relSrc)
	}

	// File must actually exist on disk.
	absPath := filepath.Join(root, "decks", deckName, relSrc)
	got, err := os.ReadFile(absPath)
	if err != nil {
		t.Fatalf("read localized file: %v", err)
	}
	if !bytes.Equal(data, got) {
		t.Errorf("file content mismatch")
	}
}

func TestLocalizeBytes_VideoSubdir(t *testing.T) {
	root, deckName := makeWorkspace(t)

	relSrc, err := assets.LocalizeBytes(root, deckName, []byte("video"), "clip.mp4", "video/mp4")
	if err != nil {
		t.Fatalf("LocalizeBytes video: %v", err)
	}
	if !strings.HasPrefix(relSrc, "assets/video/") {
		t.Errorf("want assets/video/ prefix, got %q", relSrc)
	}
}

func TestLocalizeBytes_IdempotentSameContent(t *testing.T) {
	root, deckName := makeWorkspace(t)
	data := []byte("same content")

	src1, err := assets.LocalizeBytes(root, deckName, data, "img.png", "image/png")
	if err != nil {
		t.Fatalf("first localize: %v", err)
	}
	src2, err := assets.LocalizeBytes(root, deckName, data, "img.png", "image/png")
	if err != nil {
		t.Fatalf("second localize: %v", err)
	}
	// Same content → same path, no duplicate files.
	if src1 != src2 {
		t.Errorf("expected same path for identical content; got %q and %q", src1, src2)
	}
}

func TestLocalizeBytes_DedupeDifferentContent(t *testing.T) {
	root, deckName := makeWorkspace(t)

	src1, err := assets.LocalizeBytes(root, deckName, []byte("content-A"), "img.png", "image/png")
	if err != nil {
		t.Fatalf("first localize: %v", err)
	}
	src2, err := assets.LocalizeBytes(root, deckName, []byte("content-B"), "img.png", "image/png")
	if err != nil {
		t.Fatalf("second localize: %v", err)
	}
	// Different content → distinct paths.
	if src1 == src2 {
		t.Errorf("expected different paths for different content; both got %q", src1)
	}
	// Both files must exist.
	for _, rel := range []string{src1, src2} {
		p := filepath.Join(root, "decks", deckName, rel)
		if _, err := os.Stat(p); err != nil {
			t.Errorf("file missing: %s: %v", rel, err)
		}
	}
}

// ── Traversal safety ─────────────────────────────────────────────────────────

func TestLocalizeBytes_TraversalSafe(t *testing.T) {
	root, deckName := makeWorkspace(t)
	// Craft a filename intended to escape assets/img/.
	data := []byte("attack")
	relSrc, err := assets.LocalizeBytes(root, deckName, data, "../../etc/passwd", "image/png")
	if err != nil {
		t.Fatalf("LocalizeBytes: %v", err)
	}
	// The result must stay within assets/img/.
	if strings.Contains(relSrc, "..") {
		t.Errorf("traversal in relSrc: %q", relSrc)
	}
	// The file must exist inside the deck, not outside.
	abs := filepath.Join(root, "decks", deckName, relSrc)
	deckAssets := filepath.Join(root, "decks", deckName, "assets")
	if !strings.HasPrefix(abs, deckAssets) {
		t.Errorf("file escaped assets dir: %s", abs)
	}
}

// ── LocalizeReader ────────────────────────────────────────────────────────────

func TestLocalizeReader_Works(t *testing.T) {
	root, deckName := makeWorkspace(t)
	data := []byte("gif data")
	relSrc, err := assets.LocalizeReader(root, deckName, bytes.NewReader(data), "anim.gif", "image/gif")
	if err != nil {
		t.Fatalf("LocalizeReader: %v", err)
	}
	if !strings.HasPrefix(relSrc, "assets/img/") {
		t.Errorf("unexpected prefix: %q", relSrc)
	}
}

// ── Shared library ────────────────────────────────────────────────────────────

func TestListShared_Empty(t *testing.T) {
	root, _ := makeWorkspace(t)
	entries, err := assets.ListShared(root)
	if err != nil {
		t.Fatalf("ListShared: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected empty, got %v", entries)
	}
}

func TestListShared_ReturnsFiles(t *testing.T) {
	root, _ := makeWorkspace(t)
	sharedDir := filepath.Join(root, "shared")
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir shared: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "logo.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "bg.jpg"), []byte("jpg"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	entries, err := assets.ListShared(root)
	if err != nil {
		t.Fatalf("ListShared: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("expected 2 entries, got %d: %v", len(entries), entries)
	}
	// All entries must have a relative src starting with "shared/".
	for _, e := range entries {
		if !strings.HasPrefix(e.RelSrc, "shared/") {
			t.Errorf("RelSrc %q does not start with shared/", e.RelSrc)
		}
	}
}

func TestCopyFromShared_CopiesIntoDeck(t *testing.T) {
	root, deckName := makeWorkspace(t)
	sharedDir := filepath.Join(root, "shared")
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir shared: %v", err)
	}
	imgData := []byte("shared image content")
	if err := os.WriteFile(filepath.Join(sharedDir, "hero.png"), imgData, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	relSrc, err := assets.CopyFromShared(root, deckName, "hero.png")
	if err != nil {
		t.Fatalf("CopyFromShared: %v", err)
	}

	// File must be inside the deck's assets, not a reference to shared/.
	abs := filepath.Join(root, "decks", deckName, relSrc)
	got, err := os.ReadFile(abs)
	if err != nil {
		t.Fatalf("read copied file: %v", err)
	}
	if !bytes.Equal(imgData, got) {
		t.Errorf("copied content mismatch")
	}

	// Cross-deck check: the file must NOT be in shared/ by reference.
	if strings.Contains(relSrc, "shared/") {
		t.Errorf("relSrc contains 'shared/' — deck references shared/ instead of owning copy: %q", relSrc)
	}
}

func TestCopyFromShared_NotFound(t *testing.T) {
	root, deckName := makeWorkspace(t)
	_, err := assets.CopyFromShared(root, deckName, "nonexistent.png")
	if err == nil {
		t.Error("expected error for nonexistent file, got nil")
	}
}
