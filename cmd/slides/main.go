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
//	slides install-skill     (re)install the Claude Code authoring skill (P21-2)
//
// A global --dir <path> (before the subcommand) or $SLIDES_DIR selects the workspace;
// otherwise it is found by walking up from the cwd.  See root.go and spec
// project-structure, "Workspace resolution".
package main

import (
	"errors"
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
	"slides-builder/internal/skill"
	"slides-builder/internal/validate"
	"slides-builder/internal/watch"
	slideweb "slides-builder/web"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	for _, a := range os.Args[1:] {
		if a == "-h" || a == "--help" || a == "help" {
			fmt.Println(usage)
			return
		}
	}

	dir, args, err := parseGlobalFlags(os.Args[1:])
	if err != nil {
		fatalf("error: %v\n\n%s", err, usage)
	}

	switch {
	case len(args) == 0 || (len(args) == 1 && args[0] == "serve"):
		runServe(dir)
	case args[0] == "new":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides new <name>")
		}
		runNew(dir, args[1])
	case args[0] == "vendor":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides vendor <name>")
		}
		runVendor(dir, args[1])
	case args[0] == "upgrade":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides upgrade <name>")
		}
		runUpgrade(dir, args[1])
	case args[0] == "add-slide":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides add-slide <deck>")
		}
		runAddSlide(dir, args[1])
	case args[0] == "validate":
		if len(args) < 2 || args[1] == "" {
			fatalf("usage: slides validate <deck>")
		}
		runValidate(dir, args[1])
	case args[0] == "install-skill":
		runInstallSkill(dir)
	default:
		fatalf("unknown command %q\n\n%s", args[0], usage)
	}
}

// resolve resolves the workspace root from the cwd, honouring --dir and $SLIDES_DIR.
func resolve(flagDir string) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	return findRoot(cwd, flagDir, os.Getenv(EnvDir))
}

// mustWorkspace resolves an *existing* workspace or exits non-zero.  Used by every
// command except `new`: they operate on decks that already exist, so a missing
// workspace is a user error, never an invitation to create one.
//
// The resolved root is always reported.  The upward search can legitimately surprise —
// a stray ~/decks/ makes all of $HOME a workspace — and a visible root makes that
// diagnosable instead of silent (spec project-structure).
func mustWorkspace(flagDir string) string {
	root, err := resolve(flagDir)
	if err != nil {
		var nw *noWorkspaceError
		if errors.As(err, &nw) {
			fatalf("error: %s is not a slides workspace (no %s/).\n"+
				"  slides new <name>     initialize one here\n"+
				"  slides --dir <path>   use an existing one",
				nw.Dir, deck.DecksDir)
		}
		fatalf("error: %v", err)
	}
	log.Printf("workspace: %s", root)
	return root
}

// runServe starts the HTTP server.
func runServe(flagDir string) {
	root := mustWorkspace(flagDir)

	cfg, err := config.Load(filepath.Join(root, "config.toml"))
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if err := ensureAuxDirs(root); err != nil {
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

	// Image-acquisition providers (spec assets-and-media). Each reads its API key from the
	// environment at construction (secrets-from-env-only, spec principles-and-invariants/project-structure); a provider
	// with no key reports Enabled()==false and is omitted from GET /api/providers,
	// so the picker degrades gracefully when keys are absent.
	reg := &provider.Registry{}
	reg.Register(unsplash.New())
	reg.Register(giphy.New())

	srv := server.NewWithProviders(root, w, staticFS, reg)

	// The root was already reported by mustWorkspace, immediately above.
	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("slides-builder: listening on http://localhost%s", addr)
	if err := http.ListenAndServe(addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// runNew scaffolds a new deck.  It is the one *initializing* command: when no workspace
// encloses the cwd (or the explicit --dir is not yet a workspace), that directory becomes
// one.  When a workspace is found, the deck lands there — so `slides new intro` from
// inside decks/my-talk/ creates decks/intro beside it, not a nested workspace.
func runNew(flagDir, name string) {
	root, err := resolve(flagDir)
	if err != nil {
		var nw *noWorkspaceError
		if !errors.As(err, &nw) {
			fatalf("error: %v", err) // a hard error: --dir missing, or not a directory.
		}
		root = nw.Dir
		if err := initWorkspace(root); err != nil {
			log.Fatalf("workspace: %v", err)
		}
		fmt.Printf("Initialized slides workspace at %s\n", root)

		// Install the authoring skill on workspace init only — never silently on
		// every run (spec claude-code-integration). `slides install-skill` refreshes it.
		res, err := skill.Install(root)
		if err != nil {
			log.Fatalf("install-skill: %v", err)
		}
		fmt.Printf("Installed the %s skill (%d files) at %s\n", skill.Name, res.Total, res.Dir)
	}
	log.Printf("workspace: %s", root)

	if err := ensureAuxDirs(root); err != nil {
		log.Fatalf("workspace: %v", err)
	}
	if err := deck.New(root, name); err != nil {
		log.Fatalf("deck new: %v", err)
	}
	fmt.Printf("Created deck %q at %s\n", name, deck.DeckPath(root, name))
}

// runVendor (re)vendors the embedded reveal.js distribution into an existing
// deck's assets/vendor/reveal/ directory.  Use this if vendor files were
// deleted or to upgrade after a binary update.
func runVendor(flagDir, name string) {
	root := mustWorkspace(flagDir)

	if err := ensureAuxDirs(root); err != nil {
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
func runUpgrade(flagDir, name string) {
	root := mustWorkspace(flagDir)

	if err := ensureAuxDirs(root); err != nil {
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

// runAddSlide appends a starter <section> to an existing deck (P8-1, spec claude-code-integration).
func runAddSlide(flagDir, name string) {
	root := mustWorkspace(flagDir)

	deckDir := deck.DeckPath(root, name)
	if _, err := os.Stat(deckDir); os.IsNotExist(err) {
		fatalf("deck %q not found at %s", name, deckDir)
	}

	if err := deck.AddSlide(root, name); err != nil {
		log.Fatalf("add-slide: %v", err)
	}
	fmt.Printf("Added a slide to deck %q (%s)\n", name, filepath.Join(deckDir, "deck.html"))
}

// runValidate validates a deck against the spec rules (P8-2, spec claude-code-integration/principles-and-invariants) and
// prints readable diagnostics.  It exits NON-ZERO when the deck is malformed so
// CI / Claude Code can gate on the result; zero when the deck is clean.
func runValidate(flagDir, name string) {
	root := mustWorkspace(flagDir)

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

// runInstallSkill (re)installs the embedded Claude Code authoring skill into the
// resolved workspace's .claude/skills/ (P21-2, spec claude-code-integration).
//
// This is the explicit refresh command: after upgrading the binary, run it so the skill
// Claude Code reads matches the contract this binary's `validate` enforces.  It is a
// byte-for-byte no-op when the installed copy is already current, so a decks repo that
// commits the skill sees no spurious diff.
func runInstallSkill(flagDir string) {
	root := mustWorkspace(flagDir)

	res, err := skill.Install(root)
	if err != nil {
		log.Fatalf("install-skill: %v", err)
	}
	if !res.Changed() {
		fmt.Printf("ok: the %s skill is already current at %s (%d files)\n", skill.Name, res.Dir, res.Total)
		return
	}
	fmt.Printf("Installed the %s skill at %s:\n", skill.Name, res.Dir)
	for _, f := range res.Written {
		fmt.Printf("  updated %s\n", f)
	}
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
