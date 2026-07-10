package provider_test

import (
	"testing"

	"github.com/Loxstomper/decks/internal/provider"
	"github.com/Loxstomper/decks/internal/provider/giphy"
	"github.com/Loxstomper/decks/internal/provider/unsplash"
)

// ── Registry ──────────────────────────────────────────────────────────────────

func TestRegistry_EnabledFiltersDisabled(t *testing.T) {
	var reg provider.Registry

	// No API keys → both providers disabled.
	reg.Register(unsplash.NewWithKey(""))
	reg.Register(giphy.NewWithKey(""))

	enabled := reg.Enabled()
	if len(enabled) != 0 {
		t.Errorf("expected 0 enabled providers (no keys), got %d", len(enabled))
	}
}

func TestRegistry_EnabledIncludesActive(t *testing.T) {
	var reg provider.Registry

	reg.Register(unsplash.NewWithKey("")) // disabled
	reg.Register(giphy.NewWithKey("fake-key"))

	enabled := reg.Enabled()
	if len(enabled) != 1 {
		t.Fatalf("expected 1 enabled provider, got %d", len(enabled))
	}
	if enabled[0].Name() != "giphy" {
		t.Errorf("expected giphy to be enabled, got %s", enabled[0].Name())
	}
}

func TestRegistry_GetByName(t *testing.T) {
	var reg provider.Registry
	reg.Register(unsplash.NewWithKey("k"))
	reg.Register(giphy.NewWithKey("k2"))

	p := reg.Get("unsplash")
	if p == nil || p.Name() != "unsplash" {
		t.Errorf("Get('unsplash') = %v", p)
	}
	if reg.Get("nonexistent") != nil {
		t.Error("expected nil for unknown provider")
	}
}

// ── Provider identity ─────────────────────────────────────────────────────────

func TestUnsplash_NameAndLabel(t *testing.T) {
	p := unsplash.NewWithKey("")
	if p.Name() != "unsplash" {
		t.Errorf("Name() = %q, want 'unsplash'", p.Name())
	}
	if p.Label() == "" {
		t.Error("Label() is empty")
	}
}

func TestGiphy_NameAndLabel(t *testing.T) {
	p := giphy.NewWithKey("")
	if p.Name() != "giphy" {
		t.Errorf("Name() = %q, want 'giphy'", p.Name())
	}
	if p.Label() == "" {
		t.Error("Label() is empty")
	}
}

// ── Enabled() reflects API key presence ──────────────────────────────────────

func TestUnsplash_DisabledWithoutKey(t *testing.T) {
	if unsplash.NewWithKey("").Enabled() {
		t.Error("Unsplash should be disabled without a key")
	}
}

func TestUnsplash_EnabledWithKey(t *testing.T) {
	if !unsplash.NewWithKey("some-key").Enabled() {
		t.Error("Unsplash should be enabled with a key")
	}
}

func TestGiphy_DisabledWithoutKey(t *testing.T) {
	if giphy.NewWithKey("").Enabled() {
		t.Error("Giphy should be disabled without a key")
	}
}

func TestGiphy_EnabledWithKey(t *testing.T) {
	if !giphy.NewWithKey("some-key").Enabled() {
		t.Error("Giphy should be enabled with a key")
	}
}

// ── Search returns ErrDisabled when no key ────────────────────────────────────

func TestUnsplash_SearchDisabledError(t *testing.T) {
	p := unsplash.NewWithKey("")
	_, _, err := p.Search("cats", 1)
	if err == nil {
		t.Error("expected error from Search on disabled provider")
	}
}

func TestGiphy_SearchDisabledError(t *testing.T) {
	p := giphy.NewWithKey("")
	_, _, err := p.Search("cats", 1)
	if err == nil {
		t.Error("expected error from Search on disabled provider")
	}
}

// ── Fetch returns ErrDisabled when no key ─────────────────────────────────────

func TestUnsplash_FetchDisabledError(t *testing.T) {
	p := unsplash.NewWithKey("")
	_, err := p.Fetch("abc123", "/tmp", "deck")
	if err == nil {
		t.Error("expected error from Fetch on disabled provider")
	}
}

func TestGiphy_FetchDisabledError(t *testing.T) {
	p := giphy.NewWithKey("")
	_, err := p.Fetch("abc123", "/tmp", "deck")
	if err == nil {
		t.Error("expected error from Fetch on disabled provider")
	}
}
