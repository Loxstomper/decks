package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"slides-builder/internal/deck"
)

// EnvDir is the environment variable naming the workspace root (spec project-structure,
// "Workspace resolution").  It lets a wrapper script or a Claude Code hook pin the
// workspace without threading --dir through every invocation.
const EnvDir = "SLIDES_DIR"

const usage = `Usage:
  slides [--dir <path>] [serve]        start the editor (default action)
  slides [--dir <path>] new <name>     create a deck; initializes a workspace if there is none
  slides [--dir <path>] vendor <name>  (re)vendor reveal.js into an existing deck
  slides [--dir <path>] upgrade <name> re-vendor + migrate an existing deck's reveal config
  slides [--dir <path>] add-slide <deck>  append a starter <section>
  slides [--dir <path>] validate <deck>   check a deck against the spec rules
  slides [--dir <path>] install-skill  (re)install the Claude Code authoring skill

Workspace resolution (in precedence order):
  --dir <path>   an existing directory; never created
  $` + EnvDir + `     same semantics
  upward search  the nearest ancestor of the cwd containing ` + deck.DecksDir + `/

Every command except "new" requires an existing workspace and exits non-zero without one.`

// noWorkspaceError reports that a directory was resolved but is not a workspace: it
// holds no decks/ marker.  Dir is the directory that would have become the root — the
// explicit --dir/$SLIDES_DIR path, or the cwd the upward search started from.
//
// This is the signal that separates the one initializing command from the rest:
// `slides new` recovers from it (Dir becomes a fresh workspace), every other command
// treats it as fatal.  Distinguishing it from a hard error matters — a mistyped --dir
// must never be silently created (spec project-structure, "Never scaffold an unproven root").
type noWorkspaceError struct{ Dir string }

func (e *noWorkspaceError) Error() string {
	return fmt.Sprintf("%s is not a slides workspace (no %s/)", e.Dir, deck.DecksDir)
}

// findRoot resolves the workspace root, in the precedence order fixed by spec
// project-structure: flagDir (--dir) › envDir ($SLIDES_DIR) › the nearest ancestor of
// startDir containing decks/.
//
// It is pure with respect to the filesystem — it only reads (Stat), never creates.
// Creating the workspace directories is only safe *after* a root is established;
// doing it during resolution is what would litter empty decks/ into an unrelated
// directory after a mistyped cd.
//
// Errors are of two kinds, and callers must tell them apart:
//   - *noWorkspaceError — a directory was named or reached, but holds no decks/.
//   - anything else — a hard error (a --dir that does not exist, or is a file).
//
// An explicit --dir/$SLIDES_DIR must already exist, but need not yet be a workspace:
// `slides new` initializes it. That is why the marker check happens for every
// resolution source alike, and yields the same recoverable sentinel.
func findRoot(startDir, flagDir, envDir string) (string, error) {
	if flagDir != "" {
		return explicitRoot(flagDir, "--dir")
	}
	if envDir != "" {
		return explicitRoot(envDir, "$"+EnvDir)
	}

	start, err := filepath.Abs(startDir)
	if err != nil {
		return "", fmt.Errorf("resolve %s: %w", startDir, err)
	}

	// Walk toward the filesystem root. $HOME is checked like any other ancestor:
	// a stray ~/decks/ legitimately turns all of $HOME into a workspace, which is
	// exactly why every command reports the root it resolved.
	for dir := start; ; {
		if isWorkspace(dir) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir { // reached "/" (or a volume root) — stop.
			break
		}
		dir = parent
	}
	return "", &noWorkspaceError{Dir: start}
}

// explicitRoot validates a root named outright by --dir or $SLIDES_DIR.  The path must
// already exist and be a directory; it is never created, so a typo fails loudly instead
// of scaffolding somewhere unintended.
func explicitRoot(dir, source string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("%s %s: %w", source, dir, err)
	}
	info, err := os.Stat(abs)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return "", fmt.Errorf("%s %s: no such directory (it is never created)", source, abs)
	case err != nil:
		return "", fmt.Errorf("%s %s: %w", source, abs, err)
	case !info.IsDir():
		return "", fmt.Errorf("%s %s: not a directory", source, abs)
	case !isWorkspace(abs):
		return "", &noWorkspaceError{Dir: abs}
	}
	return abs, nil
}

// isWorkspace reports whether dir carries the workspace marker: a decks/ directory.
//
// decks/ is the marker rather than a dedicated dotfile because it already exists in
// every workspace, and config.toml is optional by design (absent → defaults) and so
// cannot serve as one.
func isWorkspace(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, deck.DecksDir))
	return err == nil && info.IsDir()
}

// parseGlobalFlags pulls the global --dir flag off the front of args, before the
// subcommand, mirroring `git -C`.  Both `--dir <path>` and `--dir=<path>` are accepted;
// a later occurrence wins.  It returns the remaining args (the subcommand and its own
// arguments), which are parsed by the caller's switch.
//
// Any other leading `-`-prefixed token is rejected rather than passed through, so a
// mistyped global flag surfaces as a flag error instead of "unknown command".
func parseGlobalFlags(args []string) (dir string, rest []string, err error) {
	for len(args) > 0 {
		arg := args[0]
		switch {
		case arg == "--dir":
			if len(args) < 2 || args[1] == "" {
				return "", nil, errors.New("--dir requires a path")
			}
			dir, args = args[1], args[2:]
		case strings.HasPrefix(arg, "--dir="):
			value := strings.TrimPrefix(arg, "--dir=")
			if value == "" {
				return "", nil, errors.New("--dir requires a path")
			}
			dir, args = value, args[1:]
		case strings.HasPrefix(arg, "-"):
			return "", nil, fmt.Errorf("unknown global flag %q", arg)
		default:
			return dir, args, nil
		}
	}
	return dir, args, nil
}

// auxDirs are the workspace directories that are *not* the root marker.  Their absence
// is never an error: readers already treat a missing shared/ as empty, so they are
// created on demand inside an already-resolved root.
var auxDirs = []string{"templates", "shared", "themes"}

// ensureAuxDirs creates the non-marker workspace directories inside an already-resolved
// root.  Safe by construction: root is proven to be a workspace before this runs.
func ensureAuxDirs(root string) error {
	for _, d := range auxDirs {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", d, err)
		}
	}
	return nil
}

// initWorkspace turns dir into a workspace by creating the decks/ marker plus the
// auxiliary directories.  Only `slides new` calls this, and only once a root has been
// established — either named explicitly, or because no enclosing workspace exists and
// the cwd is therefore the user's intended one.
func initWorkspace(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, deck.DecksDir), 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", deck.DecksDir, err)
	}
	return ensureAuxDirs(dir)
}
