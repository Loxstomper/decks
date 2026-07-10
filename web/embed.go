// Package web exposes the embedded Svelte frontend build.
// The //go:embed directive must live next to the web/dist directory.
package web

import (
	"embed"
	"errors"
	"io/fs"
)

//go:embed all:dist
var distEmbed embed.FS

// ErrNotBuilt reports that web/dist holds no frontend build output.
//
// WHY this check exists: dist/ is gitignored, but dist/.gitkeep is committed so
// that //go:embed all:dist has a file to match on a fresh clone. Without it the
// package would not compile at all. The cost is that `go build` on a fresh clone
// *succeeds* and yields a binary whose editor is silently absent — /health and
// the deck routes answer normally while / serves nothing. Failing here converts
// that into one actionable message.
//
// Only the serve path calls DistFS, so `decks new`, `validate`, and the rest of
// the CLI keep working in a binary built without a frontend.
var ErrNotBuilt = errors.New(
	"the frontend was not built into this binary: web/dist holds only the go:embed placeholder.\n" +
		"  Build it, then rebuild the binary:\n" +
		"      cd web && npm install && npm run build\n" +
		"      go build -o bin/decks ./cmd/decks\n" +
		"  (`go install` cannot do this — it never runs the frontend build. Prefer a\n" +
		"  release binary from https://github.com/Loxstomper/decks/releases)")

// DistFS returns a sub-filesystem rooted at the dist/ directory.
// Serve this directly so paths like "/index.html" map correctly.
// It returns ErrNotBuilt when the frontend build output is absent.
func DistFS() (fs.FS, error) {
	sub, err := fs.Sub(distEmbed, "dist")
	if err != nil {
		return nil, err
	}
	// index.html is vite's entrypoint; its absence means dist holds only .gitkeep.
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, ErrNotBuilt
	}
	return sub, nil
}
