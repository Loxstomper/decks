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

// highlightVendor holds the reveal.js highlight plugin (P5-9, spec 12):
//   - vendor/highlight/plugin.js       — UMD bundle (includes highlight.js)
//   - vendor/highlight/monokai.min.css — Monokai colour theme
//
// Bundled so code blocks in decks are syntax-highlighted without CDN.
//
//go:embed vendor/highlight
var highlightVendor embed.FS

// mathVendor holds the reveal.js math/KaTeX plugin and KaTeX runtime (P5-10):
//   - vendor/math/plugin.js                    — UMD bundle (RevealMath.KaTeX)
//   - vendor/katex/dist/katex.min.js           — KaTeX renderer
//   - vendor/katex/dist/katex.min.css          — KaTeX styles
//   - vendor/katex/dist/contrib/auto-render.min.js — auto-render extension
//   - vendor/katex/dist/fonts/*.woff2          — KaTeX maths fonts
//
// Bundled so LaTeX math expressions render offline (spec 12 – zero CDN URLs).
//
//go:embed vendor/math vendor/katex
var mathVendor embed.FS

// notesVendor holds the reveal.js speaker-notes plugin (P7-2):
//   - vendor/notes/plugin.js       — UMD bundle that exports RevealNotes
//   - vendor/notes/notes.js        — core notes logic (loaded by plugin.js)
//   - vendor/notes/speaker-view.html — the popup speaker window document
//
// Pressing 'S' during a presentation opens the speaker window with notes,
// next-slide preview, and a timer.  All assets are local (zero external URLs,
// spec 12 offline-first).
//
//go:embed vendor/notes
var notesVendor embed.FS

// revealVersion is the pinned reveal.js version embedded in the binary.
// Update this constant whenever vendor/ is refreshed.
const revealVersion = "5.1.0"

// deckHTML is the minimal valid reveal.js template used by New.
// All resource paths are RELATIVE so the deck renders without any network
// access (spec 12 – offline-first).  The path structure mirrors the deck
// folder layout: assets/vendor/reveal/ next to deck.html.
//
// Plugins enabled (all served from assets/vendor/ — zero CDN):
//   - RevealHighlight  syntax-highlights <code> blocks (P5-9)
//   - RevealMath.KaTeX renders LaTeX math via $ … $ and $$ … $$ (P5-10)
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
  <!-- Highlight.js Monokai theme – loaded before plugin to avoid FOUC (P5-9) -->
  <link rel="stylesheet" href="assets/vendor/highlight/monokai.min.css" />
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
  <!-- Highlight plugin – syntax highlights <code class="language-*"> blocks (P5-9) -->
  <script src="assets/vendor/highlight/plugin.js"></script>
  <!-- Math/KaTeX plugin – renders LaTeX inside $ … $ and $$ … $$ (P5-10) -->
  <script src="assets/vendor/math/plugin.js"></script>
  <!-- Notes plugin – press 'S' to open the speaker window (P7-2, offline-local) -->
  <script src="assets/vendor/notes/plugin.js"></script>
  <script>
    Reveal.initialize({
      // Logical canvas matches the editor (spec 05): reveal scales this 1920x1080
      // space to any screen at present time, so editor overlays and the rendered
      // deck share one coordinate system (WYSIWYG). Aspect changes rewrite these.
      width: 1920,
      height: 1080,
      hash: true,
      controls: true,
      progress: true,
      slideNumber: false,
      transition: 'slide',
      // KaTeX: point at local assets so math renders offline (spec 12, P5-10).
      // The math plugin constructs URLs as: local + '/dist/katex.min.{css,js}'
      // and local + '/dist/contrib/auto-render.min.js'.
      katex: { local: 'assets/vendor/katex' },
      plugins: [ RevealHighlight, RevealMath.KaTeX, RevealNotes ]
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

// BundledThemes is the ordered list of reveal.js themes vendored into the binary
// (internal/deck/vendor/reveal/theme/*.css). Black is always first (default).
// The FE theme picker uses this list; Vendor() copies all of them into each deck.
var BundledThemes = []string{
	"black",
	"white",
	"league",
	"beige",
	"night",
	"moon",
	"solarized",
	"dracula",
	"sky",
}

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

// Vendor copies the embedded reveal.js distribution, slides-builder layout
// files, and plugin vendor files (highlight.js, math/KaTeX) into an existing
// deck at decks/<name>/assets/vendor/, replacing any prior version.  It also
// refreshes the workspace-level reference.
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

	// Highlight plugin → assets/vendor/highlight/ (P5-9, spec 12 offline-first)
	if err := copyEmbeddedFS(highlightVendor, "vendor/highlight", filepath.Join(vendorDir, "highlight")); err != nil {
		return fmt.Errorf("vendor: copy highlight plugin: %w", err)
	}
	log.Printf("deck: vendored highlight plugin → %s/highlight", vendorDir)

	// Math/KaTeX plugin → assets/vendor/math/ + assets/vendor/katex/ (P5-10)
	if err := copyEmbeddedFS(mathVendor, "vendor/math", filepath.Join(vendorDir, "math")); err != nil {
		return fmt.Errorf("vendor: copy math plugin: %w", err)
	}
	if err := copyEmbeddedFS(mathVendor, "vendor/katex", filepath.Join(vendorDir, "katex")); err != nil {
		return fmt.Errorf("vendor: copy katex: %w", err)
	}
	log.Printf("deck: vendored math/KaTeX → %s/math, %s/katex", vendorDir, vendorDir)

	// Notes plugin → assets/vendor/notes/ (P7-2, speaker view via 'S' key)
	// Includes plugin.js (RevealNotes UMD), notes.js (core), speaker-view.html
	// (popup window). All local so speaker view works offline (spec 12).
	if err := copyEmbeddedFS(notesVendor, "vendor/notes", filepath.Join(vendorDir, "notes")); err != nil {
		return fmt.Errorf("vendor: copy notes plugin: %w", err)
	}
	log.Printf("deck: vendored notes plugin → %s/notes", vendorDir)

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

// copyEmbeddedFS is a generic helper that walks an embed.FS rooted at srcRoot
// and copies all files to destDir, preserving the sub-directory structure.
// Existing destination files are overwritten.
func copyEmbeddedFS(fsys embed.FS, srcRoot, destDir string) error {
	return fs.WalkDir(fsys, srcRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel := strings.TrimPrefix(path, srcRoot)
		rel = strings.TrimPrefix(rel, "/")
		dest := filepath.Join(destDir, rel)

		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}

		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", filepath.Dir(dest), err)
		}

		src, err := fsys.Open(path)
		if err != nil {
			return fmt.Errorf("open embedded %s: %w", path, err)
		}
		defer src.Close()

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

// copyEmbeddedReveal copies the embedded vendor/reveal subtree to destDir.
// It is a thin wrapper around copyEmbeddedFS kept for call-site clarity.
func copyEmbeddedReveal(destDir string) error {
	return copyEmbeddedFS(revealVendor, "vendor/reveal", destDir)
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

// ReadCustomCSS returns the contents of decks/<name>/custom.css under root.
func ReadCustomCSS(root, name string) ([]byte, error) {
	if err := validateName(name); err != nil {
		return nil, err
	}
	path := filepath.Join(root, DecksDir, name, "custom.css")
	return os.ReadFile(path)
}

// WriteCustomCSS atomically writes content to decks/<name>/custom.css under root.
// Uses the same temp-file + os.Rename pattern as Write (P6-11 byte-stable, atomic).
func WriteCustomCSS(root, name string, content []byte) error {
	if err := validateName(name); err != nil {
		return err
	}
	dir := filepath.Join(root, DecksDir, name)
	target := filepath.Join(dir, "custom.css")

	// Validate deck folder exists before writing to avoid silent creation outside
	// of a properly scaffolded deck.
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return fmt.Errorf("deck %q not found", name)
	}

	// Atomic write: temp file in the same directory → os.Rename (POSIX atomic).
	tmp, err := os.CreateTemp(dir, ".custom.css.tmp.*")
	if err != nil {
		return fmt.Errorf("custom css write: create temp: %w", err)
	}
	tmpName := tmp.Name()

	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("custom css write: write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("custom css write: close temp: %w", err)
	}
	if err := os.Rename(tmpName, target); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("custom css write: rename: %w", err)
	}
	log.Printf("deck: wrote %s", target)
	return nil
}

// ValidTheme reports whether themeName is one of the bundled reveal themes.
// The HTTP layer uses this to guard the theme endpoint against path traversal.
func ValidTheme(themeName string) bool {
	for _, t := range BundledThemes {
		if t == themeName {
			return true
		}
	}
	return false
}
