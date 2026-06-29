// Package provider defines the image/media acquisition interface (spec 08 / P5-6).
//
// Every provider follows the same contract:
//  1. Search returns paginated results (thumbnail URL, ID, metadata).
//  2. Fetch downloads the chosen item and LOCALIZES it into the deck's assets/
//     directory, returning a relative src that works offline.
//
// Providers are optional and degrade gracefully when unconfigured (no API key
// → Enabled()=false → omitted from the /api/providers list).
//
// The Registry tracks all registered providers.  Server code calls
// Registry.Enabled() to list active providers and Registry.Get(name) to
// dispatch search/fetch requests.
package provider

import "fmt"

// Result is a single item returned by a provider search.
type Result struct {
	// ID is the provider-specific opaque identifier used in Fetch.
	ID string `json:"id"`
	// ThumbURL is a small preview image URL (may be an external CDN URL —
	// only shown in the picker UI, never saved into the deck).
	ThumbURL string `json:"thumb_url"`
	// Description is an optional human-readable caption/alt text.
	Description string `json:"description,omitempty"`
	// Width and Height are the intrinsic dimensions of the full-res asset.
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
}

// Provider is the acquire-and-localize interface every media source implements.
//
// All methods are safe to call on a disabled provider, but Search and Fetch
// will return an error.  Callers should check Enabled() first and the HTTP
// handlers enforce it.
type Provider interface {
	// Name returns the stable URL-safe identifier, e.g. "unsplash".
	// It must be unique within the registry and match the {name} path segment.
	Name() string

	// Label is the human-readable display name, e.g. "Unsplash".
	Label() string

	// Enabled reports whether the provider is operational.  Returns false when
	// a required API key is missing or any other precondition is unmet.
	Enabled() bool

	// Search queries the provider for assets matching query (page ≥ 1).
	// Returns results and the total number of pages available.
	Search(query string, page int) (results []Result, totalPages int, err error)

	// Fetch downloads the asset identified by id and localizes it into
	// decks/<deckName>/assets/ under root.  Returns a relative src path
	// (e.g. "assets/img/abc123.jpg") ready for use in an <img src="…">.
	Fetch(id, root, deckName string) (relSrc string, err error)
}

// ProviderInfo is the JSON shape returned by GET /api/providers.
type ProviderInfo struct {
	Name  string `json:"name"`
	Label string `json:"label"`
}

// Registry holds all registered providers and dispatches requests to them.
type Registry struct {
	all []Provider
}

// Register adds p to the registry.  Providers are registered at startup before
// any request is served; the registry is not safe for concurrent mutation.
func (r *Registry) Register(p Provider) {
	r.all = append(r.all, p)
}

// Enabled returns only the providers that are currently active (Enabled()==true).
// The result is a new slice safe to iterate without holding a lock.
func (r *Registry) Enabled() []Provider {
	out := make([]Provider, 0, len(r.all))
	for _, p := range r.all {
		if p.Enabled() {
			out = append(out, p)
		}
	}
	return out
}

// Get returns the provider registered under name, or nil if unknown.
func (r *Registry) Get(name string) Provider {
	for _, p := range r.all {
		if p.Name() == name {
			return p
		}
	}
	return nil
}

// ErrDisabled is returned by Search/Fetch when the provider is not enabled
// (API key absent, etc.).
func ErrDisabled(name string) error {
	return fmt.Errorf("provider %q is not enabled (missing API key?)", name)
}
