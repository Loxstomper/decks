// Package deck manages reveal.js deck folders under the workspace decks/ dir.
//
// # Offline-first vendoring
//
// reveal.js 5.1.0 dist files are embedded in the binary (go:embed vendor/reveal).
// Every new deck receives a private copy under assets/vendor/reveal/ so the deck
// is fully self-contained and renders with zero network access.  The workspace-level
// copy at shared/vendor/reveal/ serves as a human-readable reference; it is kept in
// sync by EnsureSharedVendor (called from both "slides new" and "slides vendor").
package deck

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// revealVendor holds the minimal reveal.js 5.1.0 distribution:
//   - dist/reveal.js    — core runtime
//   - dist/reveal.css   — core styles
//   - dist/reset.css    — CSS reset bundled by reveal
//   - dist/theme/black.css — default dark theme
//
// The "vendor/reveal" subtree mirrors the reveal npm package dist/ layout.
// Paths within the embed FS are relative to this file (internal/deck/).
//
//go:embed vendor/reveal
var revealVendor embed.FS

// layoutVendor holds the slides-builder layout vocabulary files:
//   - vendor/slides-layout.css     — CSS for enum data-* attributes (spec 03)
//   - vendor/slides-layout-init.js — applies numeric data-* to inline styles
//
// These are shipped alongside reveal so decks render layout offline (spec 12).
//
//go:embed vendor/slides-layout.css vendor/slides-layout-init.js
var layoutVendor embed.FS

// revealVersion is the pinned reveal.js version embedded in the binary.
// Update this constant whenever vendor/ is refreshed.
const revealVersion = "5.1.0"

// deckHTML is the minimal valid reveal.js template used by New.
// All resource paths are RELATIVE so the deck renders without any network
// access (spec 12 – offline-first).  The path structure mirrors the deck
// folder layout: assets/vendor/reveal/ next to deck.html.
const deckHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{DECK_NAME}}</title>
  <!-- reveal.js vendored locally – no network required (spec 12 offline-first) -->
  <link rel="stylesheet" href="assets/vendor/reveal/reset.css" />
  <link rel="stylesheet" href="assets/vendor/reveal/reveal.css" />
  <link rel="stylesheet" href="assets/vendor/reveal/theme/black.css" />
  <!-- slides-builder layout vocabulary – enum data-* → flex/grid (spec 03) -->
  <link rel="stylesheet" href="assets/vendor/slides-layout.css" />
  <link rel="stylesheet" href="custom.css" />
</head>
<body>
  <div class="reveal">
    <div class="slides">

      <section>
        <h1>{{DECK_NAME}}</h1>
        <p>Your first slide.</p>
      </section>

      <section>
        <h2>Slide 2</h2>
        <p>Edit <code>deck.html</code> to add content.</p>
      </section>

    </div>
  </div>

  <!-- Numeric data-* → inline styles companion (data-gap, data-pad, free coords) -->
  <script src="assets/vendor/slides-layout-init.js"></script>
  <script src="assets/vendor/reveal/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      controls: true,
      progress: true,
      slideNumber: false,
      transition: 'slide'
    });
  </script>
</body>
</html>
`

// customCSS is the default per-deck stylesheet.
const customCSS = `/* Per-deck CSS custom properties and overrides.
   Use CSS variables to theme your presentation, e.g.:
   :root { --r-main-color: #e0e0e0; }
*/
`

// DecksDir is the workspace-relative path for decks.
const DecksDir = "decks"

// sharedVendorDir is the workspace-relative path where reveal vendor files
// are mirrored for human inspection.  Each deck carries its own private copy;
// shared/ is a reference, not a runtime dependency.
const sharedVendorDir = "shared/vendor/reveal"

// List returns the names of all deck folders in root/decks/.
func List(root string) ([]string, error) {
	dir := filepath.Join(root, DecksDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}

	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names, nil
}

// Read returns the contents of decks/<name>/deck.html under root.
func Read(root, name string) ([]byte, error) {
	if err := validateName(name); err != nil {
		return nil, err
	}
	path := filepath.Join(root, DecksDir, name, "deck.html")
	return os.ReadFile(path)
}

// Write atomically writes content to decks/<name>/deck.html under root.
// It writes a temp file next to the target and os.Rename()s it to ensure
// a byte-identical round-trip (P0-11).
func Write(root, name string, content []byte) error {
	if err := validateName(name); err != nil {
		return err
	}
	dir := filepath.Join(root, DecksDir, name)
	target := filepath.Join(dir, "deck.html")

	// Write to a temp file in the same directory so Rename is atomic on
	// POSIX filesystems (same mount point).
	tmp, err := os.CreateTemp(dir, ".deck.html.tmp.*")
	if err != nil {
		return fmt.Errorf("deck write: create temp: %w", err)
	}
	tmpName := tmp.Name()

	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("deck write: write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("deck write: close temp: %w", err)
	}
	if err := os.Rename(tmpName, target); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("deck write: rename: %w", err)
	}
	log.Printf("deck: wrote %s", target)
	return nil
}

// New scaffolds decks/<name>/{deck.html,custom.css,assets/} under root and
// copies the embedded reveal.js vendor files into
// decks/<name>/assets/vendor/reveal/ so the deck is self-contained and
// renders offline.
//
// It also calls EnsureSharedVendor to keep the workspace-level reference copy
// at shared/vendor/reveal/ in sync.
func New(root, name string) error {
	if err := validateName(name); err != nil {
		return err
	}
	dir := filepath.Join(root, DecksDir, name)
	assetsDir := filepath.Join(dir, "assets")

	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		return fmt.Errorf("deck new: mkdir assets: %w", err)
	}

	html := []byte(strings.ReplaceAll(deckHTML, "{{DECK_NAME}}", name))
	if err := os.WriteFile(filepath.Join(dir, "deck.html"), html, 0o644); err != nil {
		return fmt.Errorf("deck new: write deck.html: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "custom.css"), []byte(customCSS), 0o644); err != nil {
		return fmt.Errorf("deck new: write custom.css: %w", err)
	}

	// Vendor reveal into the deck so it is self-contained (spec 12).
	if err := Vendor(root, name); err != nil {
		return fmt.Errorf("deck new: vendor reveal: %w", err)
	}

	log.Printf("deck: scaffolded %s", dir)
	return nil
}

// Vendor copies the embedded reveal.js distribution and slides-builder layout
// files into an existing deck at decks/<name>/assets/vendor/, replacing any
// prior version.  It also refreshes the workspace-level reference.
//
// This is the backing implementation of the `slides vendor <name>` CLI command.
func Vendor(root, name string) error {
	if err := validateName(name); err != nil {
		return err
	}
	vendorDir := filepath.Join(root, DecksDir, name, "assets", "vendor")

	// Reveal.js subtree → assets/vendor/reveal/
	if err := copyEmbeddedReveal(filepath.Join(vendorDir, "reveal")); err != nil {
		return fmt.Errorf("vendor: copy reveal to deck: %w", err)
	}
	log.Printf("deck: vendored reveal.js %s → %s/reveal", revealVersion, vendorDir)

	// Layout vocabulary files → assets/vendor/slides-layout.{css,js}
	if err := copyEmbeddedLayout(vendorDir); err != nil {
		return fmt.Errorf("vendor: copy layout to deck: %w", err)
	}
	log.Printf("deck: vendored slides-layout → %s", vendorDir)

	if err := EnsureSharedVendor(root); err != nil {
		// Non-fatal: shared/ is a reference copy, not required for deck rendering.
		log.Printf("deck: warning: could not refresh shared vendor: %v", err)
	}
	return nil
}

// copyEmbeddedLayout copies slides-layout.css and slides-layout-init.js from
// the embedded layoutVendor FS into destDir (flat, no subdirectory).
func copyEmbeddedLayout(destDir string) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("copyEmbeddedLayout: mkdir: %w", err)
	}
	for _, name := range []string{"slides-layout.css", "slides-layout-init.js"} {
		src, err := layoutVendor.Open("vendor/" + name)
		if err != nil {
			return fmt.Errorf("copyEmbeddedLayout: open %s: %w", name, err)
		}
		dest := filepath.Join(destDir, name)
		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			src.Close()
			return fmt.Errorf("copyEmbeddedLayout: create %s: %w", dest, err)
		}
		if _, err := io.Copy(out, src); err != nil {
			src.Close()
			out.Close()
			return fmt.Errorf("copyEmbeddedLayout: copy %s: %w", name, err)
		}
		src.Close()
		out.Close()
	}
	return nil
}

// EnsureSharedVendor writes the embedded reveal.js files and layout vocabulary
// to shared/vendor/ in the workspace.  This is a workspace-level reference
// copy for human inspection; decks use their own private copies.
func EnsureSharedVendor(root string) error {
	// reveal → shared/vendor/reveal/
	revealDest := filepath.Join(root, sharedVendorDir)
	if err := copyEmbeddedReveal(revealDest); err != nil {
		return fmt.Errorf("shared vendor (reveal): %w", err)
	}
	// layout files → shared/vendor/ (flat, alongside the reveal/ subtree)
	sharedLayoutDir := filepath.Dir(revealDest) // parent of shared/vendor/reveal/
	if err := copyEmbeddedLayout(sharedLayoutDir); err != nil {
		return fmt.Errorf("shared vendor (layout): %w", err)
	}
	log.Printf("deck: refreshed shared vendor at %s", filepath.Dir(revealDest))
	return nil
}

// copyEmbeddedReveal walks the embedded vendor/reveal FS and writes every
// file to destDir, preserving the subdirectory structure.
// Destination directories are created as needed; existing files are overwritten.
func copyEmbeddedReveal(destDir string) error {
	// The embed FS root is "vendor/reveal"; strip that prefix when constructing
	// destination paths so the layout at destDir matches dist/ of the npm package.
	const srcRoot = "vendor/reveal"

	return fs.WalkDir(revealVendor, srcRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Compute the relative path inside the vendor tree.
		rel := strings.TrimPrefix(path, srcRoot)
		rel = strings.TrimPrefix(rel, "/") // remove leading slash if present

		dest := filepath.Join(destDir, rel)

		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}

		// Open source from embed FS.
		src, err := revealVendor.Open(path)
		if err != nil {
			return fmt.Errorf("open embedded %s: %w", path, err)
		}
		defer src.Close()

		// Ensure parent directory exists (WalkDir visits parent before child,
		// but be defensive).
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", filepath.Dir(dest), err)
		}

		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return fmt.Errorf("create %s: %w", dest, err)
		}
		defer out.Close()

		if _, err := io.Copy(out, src); err != nil {
			return fmt.Errorf("copy to %s: %w", dest, err)
		}
		return nil
	})
}

// DeckPath returns the absolute path to a deck folder.
func DeckPath(root, name string) string {
	return filepath.Join(root, DecksDir, name)
}

// validateName checks that name is a simple identifier (no path traversal).
func validateName(name string) error {
	if name == "" {
		return fmt.Errorf("deck name must not be empty")
	}
	if filepath.Base(name) != name || name == "." || name == ".." {
		return fmt.Errorf("deck name %q is invalid (must be a simple folder name)", name)
	}
	return nil
}

// ValidName reports whether name is a safe single-segment deck folder name
// (no path separators, no "." / ".."). It is the exported, boolean-returning
// counterpart of validateName, used by the HTTP layer to guard the
// /decks/{name}/... static route against path traversal.
func ValidName(name string) bool {
	return validateName(name) == nil
}
