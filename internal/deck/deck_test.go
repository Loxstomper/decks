package deck_test

import (
	"bytes"
	"os"
	"path/filepath"
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
