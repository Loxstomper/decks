// slides-builder CLI entrypoint.
//
// Usage:
//
//	slides [serve]           start the HTTP server (default action)
//	slides new <name>        scaffold a new deck
//	slides vendor <name>     (re)vendor reveal.js into an existing deck
//	slides upgrade <name>    re-vendor + migrate reveal config (Phase 15)
//	slides add-slide <deck>  append a starter <section> to a deck (P8-1)
//	slides validate <deck>   check a deck against the spec rules (P8-2)
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"slides-builder/internal/config"
	"slides-builder/internal/deck"
	"slides-builder/internal/provider"
	"slides-builder/internal/provider/giphy"
	"slides-builder/internal/provider/unsplash"
	"slides-builder/internal/server"
	"slides-builder/internal/validate"
	"slides-builder/internal/watch"
	slideweb "slides-builder/web"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	args := os.Args[1:]

	switch {
	case len(args) == 0 || (len(args) == 1 && args[0] == "serve"):
		runServe()
	case len(args) >= 1 && args[0] == "new":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides new <name>")
		}
		runNew(args[1])
	case len(args) >= 1 && args[0] == "vendor":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides vendor <name>")
		}
		runVendor(args[1])
	case len(args) >= 1 && args[0] == "upgrade":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides upgrade <name>")
		}
		runUpgrade(args[1])
	case len(args) >= 1 && args[0] == "add-slide":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides add-slide <deck>")
		}
		runAddSlide(args[1])
	case len(args) >= 1 && args[0] == "validate":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides validate <deck>")
		}
		runValidate(args[1])
	default:
		fatalf("unknown command %q\nUsage:\n  slides [serve]\n  slides new <name>\n  slides vendor <name>\n  slides upgrade <name>\n  slides add-slide <deck>\n  slides validate <deck>", args[0])
	}
}

// runServe starts the HTTP server.
func runServe() {
	root := workspaceRoot()

	cfg, err := config.Load(filepath.Join(root, "config.toml"))
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if err := scaffoldWorkspace(root); err != nil {
		log.Fatalf("workspace: %v", err)
	}

	w, err := watch.New()
	if err != nil {
		log.Fatalf("watcher: %v", err)
	}
	defer w.Close()

	// Watch any existing decks on startup.
	if names, err := deck.List(root); err == nil {
		for _, name := range names {
			path := deck.DeckPath(root, name)
			if err := w.Watch(name, path); err != nil {
				log.Printf("watch: could not watch %q: %v", name, err)
			}
		}
	}

	staticFS, err := slideweb.DistFS()
	if err != nil {
		log.Fatalf("embed: %v", err)
	}

	// Image-acquisition providers (spec 08). Each reads its API key from the
	// environment at construction (secrets-from-env-only, spec 12/13); a provider
	// with no key reports Enabled()==false and is omitted from GET /api/providers,
	// so the picker degrades gracefully when keys are absent.
	reg := &provider.Registry{}
	reg.Register(unsplash.New())
	reg.Register(giphy.New())

	srv := server.NewWithProviders(root, w, staticFS, reg)

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("slides-builder: listening on http://localhost%s (workspace: %s)", addr, root)
	if err := http.ListenAndServe(addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// runNew scaffolds a new deck and starts watching it.
func runNew(name string) {
	root := workspaceRoot()

	if err := scaffoldWorkspace(root); err != nil {
		log.Fatalf("workspace: %v", err)
	}

	if err := deck.New(root, name); err != nil {
		log.Fatalf("deck new: %v", err)
	}
	fmt.Printf("Created deck %q at %s\n", name, filepath.Join(root, deck.DecksDir, name))
}

// runVendor (re)vendors the embedded reveal.js distribution into an existing
// deck's assets/vendor/reveal/ directory.  Use this if vendor files were
// deleted or to upgrade after a binary update.
func runVendor(name string) {
	root := workspaceRoot()

	if err := scaffoldWorkspace(root); err != nil {
		log.Fatalf("workspace: %v", err)
	}

	// Verify the deck exists before attempting to vendor.
	deckDir := deck.DeckPath(root, name)
	if _, err := os.Stat(deckDir); os.IsNotExist(err) {
		fatalf("deck %q not found at %s", name, deckDir)
	}

	if err := deck.Vendor(root, name); err != nil {
		log.Fatalf("vendor: %v", err)
	}
	fmt.Printf("Vendored reveal.js into deck %q at %s\n", name,
		filepath.Join(deckDir, "assets", "vendor", "reveal"))
}

// runUpgrade migrates an existing deck to the current vendored assets and the
// Phase 15 coordinate-identity reveal config: it re-vendors (updated CSS/JS) and
// rewrites deck.html's Reveal.initialize to add center:false + margin:0 if
// absent.  The rewrite is byte-stable / idempotent when the keys already exist.
func runUpgrade(name string) {
	root := workspaceRoot()

	if err := scaffoldWorkspace(root); err != nil {
		log.Fatalf("workspace: %v", err)
	}

	deckDir := deck.DeckPath(root, name)
	if _, err := os.Stat(deckDir); os.IsNotExist(err) {
		fatalf("deck %q not found at %s", name, deckDir)
	}

	if err := deck.Upgrade(root, name); err != nil {
		log.Fatalf("upgrade: %v", err)
	}
	fmt.Printf("Upgraded deck %q at %s\n", name, filepath.Join(deckDir, "deck.html"))
}

// runAddSlide appends a starter <section> to an existing deck (P8-1, spec 11).
func runAddSlide(name string) {
	root := workspaceRoot()

	deckDir := deck.DeckPath(root, name)
	if _, err := os.Stat(deckDir); os.IsNotExist(err) {
		fatalf("deck %q not found at %s", name, deckDir)
	}

	if err := deck.AddSlide(root, name); err != nil {
		log.Fatalf("add-slide: %v", err)
	}
	fmt.Printf("Added a slide to deck %q (%s)\n", name, filepath.Join(deckDir, "deck.html"))
}

// runValidate validates a deck against the spec rules (P8-2, spec 11/12) and
// prints readable diagnostics.  It exits NON-ZERO when the deck is malformed so
// CI / Claude Code can gate on the result; zero when the deck is clean.
func runValidate(name string) {
	root := workspaceRoot()

	deckDir := deck.DeckPath(root, name)
	if _, err := os.Stat(deckDir); os.IsNotExist(err) {
		fatalf("deck %q not found at %s", name, deckDir)
	}

	res, err := validate.Deck(deckDir)
	if err != nil {
		log.Fatalf("validate: %v", err)
	}

	if res.OK {
		fmt.Printf("ok: deck %q is valid (%d issues)\n", name, 0)
		return
	}

	// Human-readable diagnostics on stderr, one per line, with line/eid context.
	fmt.Fprintf(os.Stderr, "deck %q has %d validation error(s):\n", name, len(res.Errors))
	for _, e := range res.Errors {
		loc := ""
		if e.Line > 0 {
			loc = fmt.Sprintf(" (line %d)", e.Line)
		}
		eid := ""
		if e.EID != "" {
			eid = fmt.Sprintf(" [eid=%s]", e.EID)
		}
		fmt.Fprintf(os.Stderr, "  %s: %s%s%s\n", e.Code, e.Message, loc, eid)
	}
	os.Exit(1)
}

// workspaceRoot returns the directory where the binary is run (cwd).
func workspaceRoot() string {
	root, err := os.Getwd()
	if err != nil {
		log.Fatalf("getwd: %v", err)
	}
	return root
}

// scaffoldWorkspace creates the standard workspace directories if absent.
func scaffoldWorkspace(root string) error {
	dirs := []string{"decks", "templates", "shared", "themes"}
	for _, d := range dirs {
		path := filepath.Join(root, d)
		if err := os.MkdirAll(path, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", d, err)
		}
	}
	log.Printf("workspace: directories verified at %s", root)
	return nil
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
