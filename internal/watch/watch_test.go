package watch_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"slides-builder/internal/watch"
)

func TestWatcher_ReceivesChangeEvent(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "deck.html")
	if err := os.WriteFile(testFile, []byte("initial"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	w, err := watch.New()
	if err != nil {
		t.Fatalf("watch.New: %v", err)
	}
	defer w.Close()

	if err := w.Watch("test-deck", dir); err != nil {
		t.Fatalf("Watch: %v", err)
	}

	ch := w.Subscribe()
	defer w.Unsubscribe(ch)

	// Trigger a file write event.
	if err := os.WriteFile(testFile, []byte("modified"), 0o644); err != nil {
		t.Fatalf("write modified: %v", err)
	}

	select {
	case ev := <-ch:
		if ev.Type != "changed" {
			t.Errorf("event type: want changed, got %q", ev.Type)
		}
		if ev.Deck == "" {
			t.Error("event.Deck should not be empty")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for watcher event")
	}
}

func TestWatcher_Unsubscribe(t *testing.T) {
	w, err := watch.New()
	if err != nil {
		t.Fatalf("watch.New: %v", err)
	}
	defer w.Close()

	ch := w.Subscribe()
	w.Unsubscribe(ch)

	// After Unsubscribe the channel should be closed, so range over it should terminate.
	count := 0
	for range ch {
		count++
	}
	// Just verify we got here without deadlock.
}
