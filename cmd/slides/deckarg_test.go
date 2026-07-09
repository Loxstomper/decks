package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// deckWorkspace builds a workspace holding decks/intro (with an assets/ subdir) and
// decks/other, returning the root.
func deckWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, d := range []string{
		filepath.Join("decks", "intro", "assets"),
		filepath.Join("decks", "other"),
	} {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// TestResolveDeckArg_Resolves covers every accepted spelling of a deck argument, from
// several working directories — the point of P21-1 is that where you stand stops mattering.
func TestResolveDeckArg_Resolves(t *testing.T) {
	root := deckWorkspace(t)
	decks := filepath.Join(root, "decks")
	intro := filepath.Join(decks, "intro")

	tests := []struct {
		name string
		cwd  string
		arg  string
		want string
	}{
		{"bare name from root", root, "intro", "intro"},
		{"bare name from inside a deck", intro, "other", "other"},
		{"bare name from outside the workspace", t.TempDir(), "intro", "intro"},
		{"path from root", root, filepath.Join("decks", "intro"), "intro"},
		{"path to a subdir of a deck", root, filepath.Join("decks", "intro", "assets"), "intro"},
		{"dot inside a deck", intro, ".", "intro"},
		{"dot inside a deck subdir", filepath.Join(intro, "assets"), ".", "intro"},
		{"dotdot from a deck subdir", filepath.Join(intro, "assets"), "..", "intro"},
		{"sibling deck by relative path", intro, filepath.Join("..", "other"), "other"},
		{"explicit ./ prefix from decks/", decks, "./intro", "intro"},
		{"trailing separator from decks/", decks, "intro/", "intro"},
		{"absolute path to a deck", t.TempDir(), intro, "intro"},
		{"absolute path into a deck", t.TempDir(), filepath.Join(intro, "assets"), "intro"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveDeckArg(root, tc.cwd, tc.arg)
			if err != nil {
				t.Fatalf("resolveDeckArg(%q) from %q: %v", tc.arg, tc.cwd, err)
			}
			if got != tc.want {
				t.Errorf("resolveDeckArg(%q) = %q, want %q", tc.arg, got, tc.want)
			}
		})
	}
}

// TestResolveDeckArg_BareNameBeatsPath pins the disambiguation rule. From inside
// decks/intro/, `slides validate assets` asks for a deck named "assets" — it must NOT
// silently resolve to the deck "intro" just because decks/intro/assets happens to exist.
// A path-first reading would do exactly that, and the user would never know.
func TestResolveDeckArg_BareNameBeatsPath(t *testing.T) {
	root := deckWorkspace(t)
	intro := filepath.Join(root, "decks", "intro")

	if _, err := resolveDeckArg(root, intro, "assets"); err == nil {
		t.Fatal(`resolveDeckArg("assets") from inside decks/intro must not resolve to "intro"`)
	}
	// Spelled as a path, the same string does name the enclosing deck.
	got, err := resolveDeckArg(root, intro, "./assets")
	if err != nil {
		t.Fatalf(`resolveDeckArg("./assets"): %v`, err)
	}
	if got != "intro" {
		t.Errorf(`resolveDeckArg("./assets") = %q, want "intro"`, got)
	}
}

// TestResolveDeckArg_RefusesTraversal — a path that escapes decks/ is refused by name.
// resolveDeckArg narrows to deck.ValidName, the guard the HTTP layer relies on; it must
// never hand back a name that could walk out of the workspace.
func TestResolveDeckArg_RefusesTraversal(t *testing.T) {
	root := deckWorkspace(t)
	intro := filepath.Join(root, "decks", "intro")

	tests := []struct {
		name string
		cwd  string
		arg  string
	}{
		{"parent escape", intro, filepath.Join("..", "..", "..", "etc")},
		{"absolute outside", root, string(filepath.Separator) + "etc"},
		{"workspace root itself", root, "."},
		{"sibling of decks/", filepath.Join(root, "decks"), ".." + string(filepath.Separator) + "templates"},
		{"embedded traversal", root, filepath.Join("decks", "intro", "..", "..", "..", "evil")},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveDeckArg(root, tc.cwd, tc.arg)
			if err == nil {
				t.Fatalf("resolveDeckArg(%q) = %q, want a refusal", tc.arg, got)
			}
			if !strings.Contains(err.Error(), "outside") {
				t.Errorf("error should say the path is outside decks/, got: %v", err)
			}
		})
	}
}

// TestResolveDeckArg_DecksDirIsNotADeck — pointing at decks/ itself is a distinct mistake
// from pointing outside it, and deserves its own message.
//
// Reachable only via a path spelling: the bare word "decks" is a deck *name*, and correctly
// looks for decks/decks.
func TestResolveDeckArg_DecksDirIsNotADeck(t *testing.T) {
	root := deckWorkspace(t)
	decks := filepath.Join(root, "decks")

	for _, tc := range []struct{ cwd, arg string }{
		{decks, "."},
		{root, "./decks"},
		{root, "decks/"},
		{t.TempDir(), decks},
	} {
		_, err := resolveDeckArg(root, tc.cwd, tc.arg)
		if err == nil {
			t.Fatalf("resolveDeckArg(%q) from %q: want a refusal", tc.arg, tc.cwd)
		}
		if !strings.Contains(err.Error(), "not a deck") {
			t.Errorf("resolveDeckArg(%q): want a 'not a deck' message, got: %v", tc.arg, err)
		}
	}

	// The bare word "decks" is a name, not the directory: it looks for decks/decks.
	_, err := resolveDeckArg(root, root, "decks")
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf(`resolveDeckArg("decks") should look for a deck named "decks", got: %v`, err)
	}
}

// TestResolveDeckArg_NotFound — a deck that does not exist reports itself by name, whether
// it was spelled as a name or as a path.
func TestResolveDeckArg_NotFound(t *testing.T) {
	root := deckWorkspace(t)

	for _, tc := range []struct{ name, arg string }{
		{"bare", "nope"},
		{"path", filepath.Join("decks", "nope")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := resolveDeckArg(root, root, tc.arg)
			if err == nil {
				t.Fatalf("resolveDeckArg(%q): want a not-found error", tc.arg)
			}
			if !strings.Contains(err.Error(), `"nope"`) {
				t.Errorf("error should name the missing deck, got: %v", err)
			}
		})
	}
}

// TestResolveDeckArg_RejectsAFile — decks are folders; a file inside decks/ is not one.
func TestResolveDeckArg_RejectsAFile(t *testing.T) {
	root := deckWorkspace(t)
	file := filepath.Join(root, "decks", "README.md")
	if err := os.WriteFile(file, []byte("notes\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got, err := resolveDeckArg(root, root, "README.md"); err == nil {
		t.Errorf("resolveDeckArg on a file returned %q, want a refusal", got)
	}
}

// TestResolveDeckArg_Empty — an empty argument is rejected before any path joining, which
// would otherwise silently resolve to the cwd.
func TestResolveDeckArg_Empty(t *testing.T) {
	root := deckWorkspace(t)
	if _, err := resolveDeckArg(root, filepath.Join(root, "decks", "intro"), ""); err == nil {
		t.Error("resolveDeckArg(\"\"): want an error")
	}
}

// TestDeckArgStartDir — naming a deck by path also says where its workspace is, so the
// upward search starts there. Without this, `slides validate /abs/ws/decks/intro` from an
// unrelated cwd fails at workspace resolution, before the argument naming the workspace is
// ever read.
func TestDeckArgStartDir(t *testing.T) {
	root := deckWorkspace(t)
	intro := filepath.Join(root, "decks", "intro")
	elsewhere := t.TempDir()

	tests := []struct {
		name     string
		cwd, arg string
		want     string
	}{
		{"bare name keeps the cwd", elsewhere, "intro", elsewhere},
		{"empty keeps the cwd", elsewhere, "", elsewhere},
		{"absolute deck path", elsewhere, intro, intro},
		{"absolute path into a deck", elsewhere, filepath.Join(intro, "assets"), filepath.Join(intro, "assets")},
		{"relative path", root, filepath.Join("decks", "intro"), intro},
		{"dot resolves to the cwd", intro, ".", intro},
		{"missing leaf falls back to its parent", root, filepath.Join("decks", "nope"), filepath.Join(root, "decks")},
		{"nonexistent path keeps the cwd", elsewhere, filepath.Join("no", "such", "place"), elsewhere},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := deckArgStartDir(tc.cwd, tc.arg); got != tc.want {
				t.Errorf("deckArgStartDir(%q, %q) = %q, want %q", tc.cwd, tc.arg, got, tc.want)
			}
		})
	}
}

// TestDeckArgStartDir_FindsWorkspaceFromAnAbsolutePath ties the start dir back to root
// resolution: the pair must locate the workspace from a cwd entirely outside it.
func TestDeckArgStartDir_FindsWorkspaceFromAnAbsolutePath(t *testing.T) {
	root := deckWorkspace(t)
	intro := filepath.Join(root, "decks", "intro")
	elsewhere := t.TempDir()

	start := deckArgStartDir(elsewhere, intro)
	got, err := findRoot(start, "", "")
	if err != nil {
		t.Fatalf("findRoot from an absolute deck path: %v", err)
	}
	if got != root {
		t.Errorf("findRoot = %q, want the deck's workspace %q", got, root)
	}

	name, err := resolveDeckArg(got, elsewhere, intro)
	if err != nil || name != "intro" {
		t.Errorf("resolveDeckArg = (%q, %v), want (\"intro\", nil)", name, err)
	}
}

// TestResolveWorkspaceAndDeck covers the composition: the cwd's workspace is tried first,
// the deck's own path is a fallback, and an explicit --dir / $SLIDES_DIR pins the root.
func TestResolveWorkspaceAndDeck(t *testing.T) {
	w1 := deckWorkspace(t) // decks/{intro,other}
	w2 := deckWorkspace(t) // a second, unrelated workspace
	farIn2 := filepath.Join(w2, "decks", "intro")
	introIn1 := filepath.Join(w1, "decks", "intro")
	nowhere := t.TempDir() // no workspace above it

	tests := []struct {
		name                      string
		flagDir, envDir, cwd, arg string
		wantRoot, wantDeck        string
	}{
		{"bare name in the cwd's workspace", "", "", w1, "intro", w1, "intro"},
		{"path in the cwd's workspace", "", "", w1, "decks/other", w1, "other"},
		{"dot inside a deck", "", "", introIn1, ".", w1, "intro"},
		{"absolute path from a dir with no workspace", "", "", nowhere, introIn1, w1, "intro"},
		{"absolute path into another workspace", "", "", introIn1, farIn2, w2, "intro"},
		{"--dir pins the root", w1, "", nowhere, "other", w1, "other"},
		{"$SLIDES_DIR pins the root", "", w1, nowhere, "intro", w1, "intro"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root, deckName, err := resolveWorkspaceAndDeck(tc.flagDir, tc.envDir, tc.cwd, tc.arg)
			if err != nil {
				t.Fatalf("resolveWorkspaceAndDeck: %v", err)
			}
			if root != tc.wantRoot || deckName != tc.wantDeck {
				t.Errorf("= (%q, %q), want (%q, %q)", root, deckName, tc.wantRoot, tc.wantDeck)
			}
		})
	}
}

// TestResolveWorkspaceAndDeck_PinnedRootWins — with --dir set, a deck named by an absolute
// path into a *different* workspace is refused rather than silently followed. The user
// named the workspace; we do not second-guess it.
func TestResolveWorkspaceAndDeck_PinnedRootWins(t *testing.T) {
	w1, w2 := deckWorkspace(t), deckWorkspace(t)
	other2 := filepath.Join(w2, "decks", "other")

	for _, tc := range []struct{ name, flagDir, envDir string }{
		{"--dir", w1, ""},
		{"$SLIDES_DIR", "", w1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := resolveWorkspaceAndDeck(tc.flagDir, tc.envDir, w1, other2)
			if err == nil {
				t.Fatal("a deck outside the pinned workspace must be refused")
			}
			if !strings.Contains(err.Error(), "outside") {
				t.Errorf("want an 'outside' error, got: %v", err)
			}
		})
	}
}

// TestResolveWorkspaceAndDeck_ReportsThePrimaryFailure — when the fallback finds nothing,
// the error must describe the attempt the user actually made.  Standing inside a workspace
// and naming a path outside decks/ is an "outside decks/" error, not "some unrelated
// ancestor is not a workspace" — the latter is what a naive start-dir override produces.
func TestResolveWorkspaceAndDeck_ReportsThePrimaryFailure(t *testing.T) {
	w1 := deckWorkspace(t)
	intro := filepath.Join(w1, "decks", "intro")

	_, _, err := resolveWorkspaceAndDeck("", "", intro, filepath.Join("..", "..", "..", "etc"))
	if err == nil {
		t.Fatal("want a refusal")
	}
	if !strings.Contains(err.Error(), "outside") {
		t.Errorf("want the 'outside decks/' diagnosis, got: %v", err)
	}

	// And from a cwd with no workspace at all, a bare name reports the workspace problem.
	_, _, err = resolveWorkspaceAndDeck("", "", t.TempDir(), "intro")
	if err == nil {
		t.Fatal("want a refusal")
	}
	var nw *noWorkspaceError
	if !errors.As(err, &nw) {
		t.Errorf("want a *noWorkspaceError, got %T: %v", err, err)
	}
}

// TestLooksLikePath documents the name-or-path rule directly.
func TestLooksLikePath(t *testing.T) {
	for _, arg := range []string{".", "..", "./x", "../x", "a/b", "x/", "/abs"} {
		if !looksLikePath(arg) {
			t.Errorf("looksLikePath(%q) = false, want true", arg)
		}
	}
	for _, arg := range []string{"my-talk", "intro", "a.b", "deck2"} {
		if looksLikePath(arg) {
			t.Errorf("looksLikePath(%q) = true, want false", arg)
		}
	}
}
