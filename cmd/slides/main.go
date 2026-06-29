// slides-builder CLI entrypoint.
//
// Usage:
//
//	slides [serve]           start the HTTP server (default action)
//	slides new <name>        scaffold a new deck
//	slides vendor <name>     (re)vendor reveal.js into an existing deck
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"slides-builder/internal/config"
	"slides-builder/internal/deck"
	"slides-builder/internal/server"
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
	default:
		fatalf("unknown command %q\nUsage:\n  slides [serve]\n  slides new <name>\n  slides vendor <name>", args[0])
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

	srv := server.New(root, w, staticFS)

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
