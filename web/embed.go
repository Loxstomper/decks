// Package web exposes the embedded Svelte frontend build.
// The //go:embed directive must live next to the web/dist directory.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distEmbed embed.FS

// DistFS returns a sub-filesystem rooted at the dist/ directory.
// Serve this directly so paths like "/index.html" map correctly.
func DistFS() (fs.FS, error) {
	return fs.Sub(distEmbed, "dist")
}
