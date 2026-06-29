// Package deck manages reveal.js deck folders under the workspace decks/ dir.
package deck

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// deckHTML is the minimal valid reveal.js template used by New.
const deckHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{DECK_NAME}}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reset.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/black.css" />
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

  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
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

// New scaffolds decks/<name>/{deck.html,custom.css,assets/} under root.
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
	log.Printf("deck: scaffolded %s", dir)
	return nil
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
