package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/Loxstomper/decks/internal/deck"
)

// resolveDeckArg turns a deck argument into a bare deck name relative to root.
//
// Phase 20 made the binary find its workspace from anywhere; this is what makes that pay
// off. A deck can now be named the way you'd name a file:
//
//	decks validate my-talk            a bare name (as before)
//	decks validate decks/my-talk      a path, from the workspace root
//	decks validate .                  from inside decks/my-talk/ (or any subdir of it)
//	decks validate ../other           from inside decks/my-talk/
//	decks validate /abs/ws/decks/x    an absolute path
//
// # Name or path?
//
// An argument is treated as a path only if it *looks* like one — it contains a separator,
// or is "." / "..". Otherwise it is a bare deck name. Without that rule the two forms are
// genuinely ambiguous: run `decks validate assets` from inside decks/my-talk/ and a
// path-first reading would silently resolve the *deck* my-talk (because decks/my-talk/assets
// lies inside it), when the user plainly asked for a deck called "assets".
//
// # Traversal
//
// Everything must land inside <root>/decks/, and the result is always a single path segment
// that satisfies deck.ValidName — the same guard the HTTP layer relies on to keep
// /decks/{name}/... inside the workspace. This function *narrows* to that guard; it never
// loosens it. A path that escapes decks/ is refused by name, not silently clamped.
//
// cwd is passed in rather than read, so the whole thing is pure and testable.
func resolveDeckArg(root, cwd, arg string) (string, error) {
	if arg == "" {
		return "", fmt.Errorf("deck name must not be empty")
	}
	decksRoot := filepath.Join(root, deck.DecksDir)

	if !looksLikePath(arg) {
		if isDir(filepath.Join(decksRoot, arg)) && deck.ValidName(arg) {
			return arg, nil
		}
		return "", notFound(decksRoot, arg)
	}

	abs := arg
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(cwd, abs)
	}
	abs = filepath.Clean(abs)

	rel, err := filepath.Rel(decksRoot, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside the workspace's %s/ directory (workspace: %s)",
			abs, deck.DecksDir, root)
	}
	if rel == "." {
		return "", fmt.Errorf("%s is the %s/ directory, not a deck — name one of the decks inside it",
			abs, deck.DecksDir)
	}

	// Any path inside a deck names that deck, so `.` works from decks/x/assets too.
	name := strings.Split(rel, string(filepath.Separator))[0]
	if !deck.ValidName(name) || !isDir(filepath.Join(decksRoot, name)) {
		return "", notFound(decksRoot, name)
	}
	return name, nil
}

// looksLikePath reports whether arg is written as a path rather than a bare deck name.
// The raw argument is inspected, not a cleaned one: `./my-talk` and `my-talk/` are paths
// the user typed as paths, even though filepath.Clean would reduce both to `my-talk`.
func looksLikePath(arg string) bool {
	return filepath.IsAbs(arg) ||
		strings.ContainsRune(arg, filepath.Separator) ||
		arg == "." || arg == ".."
}

func notFound(decksRoot, name string) error {
	return fmt.Errorf("deck %q not found at %s", name, filepath.Join(decksRoot, name))
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// mustWorkspaceAndDeck resolves the workspace and the deck named by arg, or exits
// non-zero.  The two are resolved together because a deck named by path also says where
// its workspace is.
//
// The cwd's workspace is tried first, and the deck's own path is only a *fallback*, for
// two reasons. It keeps the diagnostics honest: standing inside a workspace and naming
// `../../../etc` should say the path is outside decks/, not that some unrelated ancestor
// isn't a workspace. And it keeps the common case cheap. The fallback then covers what the
// cwd cannot answer — an absolute deck path from an unrelated directory, or from inside a
// *different* workspace, both of which fully determine the deck without a --dir.
//
// An explicit --dir / $DECKS_DIR pins the root outright, so no fallback applies: the deck
// must live in the workspace the user named.
func mustWorkspaceAndDeck(flagDir, arg string) (root, name string) {
	cwd, err := os.Getwd()
	if err != nil {
		fatalf("error: getwd: %v", err)
	}
	root, name, err = resolveWorkspaceAndDeck(flagDir, os.Getenv(EnvDir), cwd, arg)
	if err != nil {
		workspaceFatal(err) // renders *noWorkspaceError specially, anything else verbatim.
	}
	log.Printf("workspace: %s", root)
	return root, name
}

// resolveWorkspaceAndDeck is the pure core of mustWorkspaceAndDeck: it reads the
// filesystem but takes cwd and the environment as parameters, and returns errors instead
// of exiting.  See mustWorkspaceAndDeck for why the deck path is a fallback.
func resolveWorkspaceAndDeck(flagDir, envDir, cwd, arg string) (root, name string, err error) {
	root, rootErr := findRoot(cwd, flagDir, envDir)

	var deckErr error
	if rootErr == nil {
		if name, deckErr = resolveDeckArg(root, cwd, arg); deckErr == nil {
			return root, name, nil
		}
	}

	// An explicit --dir / $DECKS_DIR pins the root; never look elsewhere.
	if flagDir == "" && envDir == "" {
		if start := deckArgStartDir(cwd, arg); start != cwd {
			if alt, altErr := findRoot(start, "", ""); altErr == nil {
				if altName, altDeckErr := resolveDeckArg(alt, cwd, arg); altDeckErr == nil {
					return alt, altName, nil
				}
			}
		}
	}

	// The fallback found nothing better; report why the primary attempt failed.
	if rootErr != nil {
		return "", "", rootErr
	}
	return "", "", deckErr
}

// deckArgStartDir returns the directory the upward workspace search should start from,
// given a deck argument.
//
// If you name a deck by path, you have told us where it is, so the workspace is found from
// *there* rather than from the cwd. Without this, `decks validate ~/talks/decks/intro`
// from an unrelated directory fails at workspace resolution — before the argument naming
// the workspace is ever read — which is a confusing way to refuse a fully-qualified path.
//
// A bare name says nothing about location, so it falls back to the cwd. So does a path that
// leads nowhere, letting the normal not-found diagnostics happen instead of a walk from an
// imaginary directory. --dir / $DECKS_DIR still win: this only feeds the upward search.
func deckArgStartDir(cwd, arg string) string {
	if arg == "" || !looksLikePath(arg) {
		return cwd
	}
	abs := arg
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(cwd, abs)
	}
	abs = filepath.Clean(abs)

	if isDir(abs) {
		return abs
	}
	if parent := filepath.Dir(abs); isDir(parent) {
		return parent
	}
	return cwd
}
