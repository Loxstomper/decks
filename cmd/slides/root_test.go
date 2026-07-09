package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// mkWorkspace creates dir and the decks/ marker inside it, returning dir.
func mkWorkspace(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "decks"), 0o755); err != nil {
		t.Fatalf("mkWorkspace %s: %v", dir, err)
	}
	return dir
}

// mkDir creates dir (no decks/ marker), returning dir.
func mkDir(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkDir %s: %v", dir, err)
	}
	return dir
}

// asNoWorkspace extracts a *noWorkspaceError, or fails.
func asNoWorkspace(t *testing.T, err error) *noWorkspaceError {
	t.Helper()
	var nw *noWorkspaceError
	if !errors.As(err, &nw) {
		t.Fatalf("expected *noWorkspaceError, got %T: %v", err, err)
	}
	return nw
}

// TestFindRoot_Precedence pins the precedence chain from spec project-structure:
// --dir › $SLIDES_DIR › upward search.  Each case wires up all three sources so a
// regression that consults them out of order fails loudly rather than passing by luck.
func TestFindRoot_Precedence(t *testing.T) {
	base := t.TempDir()
	flagWS := mkWorkspace(t, filepath.Join(base, "flag"))
	envWS := mkWorkspace(t, filepath.Join(base, "env"))
	cwdWS := mkWorkspace(t, filepath.Join(base, "cwd"))
	nested := mkDir(t, filepath.Join(cwdWS, "decks", "my-talk", "assets"))

	tests := []struct {
		name                   string
		start, flagDir, envDir string
		want                   string
	}{
		{"flag beats env and cwd", cwdWS, flagWS, envWS, flagWS},
		{"flag beats env with no cwd workspace", base, flagWS, envWS, flagWS},
		{"env beats cwd", cwdWS, "", envWS, envWS},
		{"upward search when neither set", cwdWS, "", "", cwdWS},
		{"start dir is itself the root", cwdWS, "", "", cwdWS},
		{"upward search from a nested deck dir", nested, "", "", cwdWS},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := findRoot(tc.start, tc.flagDir, tc.envDir)
			if err != nil {
				t.Fatalf("findRoot: unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("findRoot = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestFindRoot_NearestAncestorWins guards the "nearest" in "nearest ancestor containing
// decks/": a workspace nested inside another must resolve to the inner one, the way git
// resolves to the innermost repo.
func TestFindRoot_NearestAncestorWins(t *testing.T) {
	outer := mkWorkspace(t, t.TempDir())
	inner := mkWorkspace(t, filepath.Join(outer, "projects", "inner"))
	start := mkDir(t, filepath.Join(inner, "decks", "talk"))

	got, err := findRoot(start, "", "")
	if err != nil {
		t.Fatalf("findRoot: %v", err)
	}
	if got != inner {
		t.Errorf("findRoot = %q, want the nearest ancestor %q (not %q)", got, inner, outer)
	}
}

// TestFindRoot_NotFound covers the walk terminating at the filesystem root.  The error
// must be the recoverable sentinel naming the *start* directory: that is the directory
// `slides new` will initialize, and the one every other command names in its error.
func TestFindRoot_NotFound(t *testing.T) {
	start := mkDir(t, filepath.Join(t.TempDir(), "not", "a", "workspace"))

	_, err := findRoot(start, "", "")
	if err == nil {
		t.Fatal("findRoot: expected an error walking to the filesystem root")
	}
	if got := asNoWorkspace(t, err).Dir; got != start {
		t.Errorf("noWorkspaceError.Dir = %q, want the start dir %q", got, start)
	}
}

// TestFindRoot_RelativeStartIsAbsolute — the resolved root is always absolute, so it can
// be reported and joined against regardless of where the binary was invoked.
func TestFindRoot_RelativeStartIsAbsolute(t *testing.T) {
	ws := mkWorkspace(t, t.TempDir())
	prev, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(ws); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(prev) })

	got, err := findRoot(".", "", "")
	if err != nil {
		t.Fatalf("findRoot: %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("findRoot = %q, want an absolute path", got)
	}
}

// TestFindRoot_ExplicitDirMustExist — a --dir/$SLIDES_DIR typo is a *hard* error, never a
// recoverable one: `slides new --dir /typo` must fail rather than create /typo.  This is
// the invariant that keeps "never scaffold an unproven root" true even for explicit paths.
func TestFindRoot_ExplicitDirMustExist(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")

	for _, tc := range []struct {
		name            string
		flagDir, envDir string
	}{
		{"--dir", missing, ""},
		{"$SLIDES_DIR", "", missing},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := findRoot(t.TempDir(), tc.flagDir, tc.envDir)
			if err == nil {
				t.Fatal("expected an error for a non-existent explicit dir")
			}
			var nw *noWorkspaceError
			if errors.As(err, &nw) {
				t.Fatalf("expected a hard error, got the recoverable sentinel: %v", err)
			}
			if _, statErr := os.Stat(missing); !os.IsNotExist(statErr) {
				t.Fatalf("findRoot created %s; it must never create a directory", missing)
			}
		})
	}
}

// TestFindRoot_ExplicitDirIsAFile — pointing --dir at a regular file is a hard error too.
func TestFindRoot_ExplicitDirIsAFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(file, []byte("port = 3000\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := findRoot(t.TempDir(), file, "")
	if err == nil {
		t.Fatal("expected an error for a --dir pointing at a file")
	}
	var nw *noWorkspaceError
	if errors.As(err, &nw) {
		t.Fatalf("expected a hard error, got the recoverable sentinel: %v", err)
	}
}

// TestFindRoot_ExplicitDirWithoutMarker — an existing --dir that is not yet a workspace
// yields the recoverable sentinel naming it, so `slides new --dir ~/talks intro`
// initializes ~/talks while `slides --dir ~/talks serve` refuses.
func TestFindRoot_ExplicitDirWithoutMarker(t *testing.T) {
	bare := mkDir(t, filepath.Join(t.TempDir(), "talks"))

	for _, tc := range []struct {
		name            string
		flagDir, envDir string
	}{
		{"--dir", bare, ""},
		{"$SLIDES_DIR", "", bare},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := findRoot(t.TempDir(), tc.flagDir, tc.envDir)
			if err == nil {
				t.Fatal("expected noWorkspaceError for an existing dir without decks/")
			}
			if got := asNoWorkspace(t, err).Dir; got != bare {
				t.Errorf("noWorkspaceError.Dir = %q, want %q", got, bare)
			}
		})
	}
}

// TestFindRoot_MarkerMustBeADirectory — a *file* named decks is not the marker, so the
// walk continues past it to a real workspace above.
func TestFindRoot_MarkerMustBeADirectory(t *testing.T) {
	root := mkWorkspace(t, t.TempDir())
	decoy := mkDir(t, filepath.Join(root, "decoy"))
	if err := os.WriteFile(filepath.Join(decoy, "decks"), []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := findRoot(decoy, "", "")
	if err != nil {
		t.Fatalf("findRoot: %v", err)
	}
	if got != root {
		t.Errorf("findRoot = %q, want %q — a file named decks is not the marker", got, root)
	}
}

// TestFindRoot_CreatesNothing is the load-bearing safety test for Phase 20: resolution
// reads the filesystem and never writes to it.  A failure here is the original bug —
// `slides` in ~/Downloads littering empty decks/ templates/ shared/ themes/.
func TestFindRoot_CreatesNothing(t *testing.T) {
	base := t.TempDir()
	start := mkDir(t, filepath.Join(base, "downloads"))

	if _, err := findRoot(start, "", ""); err == nil {
		t.Fatal("expected noWorkspaceError")
	}

	entries, err := os.ReadDir(start)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("findRoot created %v in a non-workspace dir; it must create nothing", names)
	}
}

// TestParseGlobalFlags covers both spellings of --dir, its position ahead of the
// subcommand, and the rejection of unknown leading flags.
func TestParseGlobalFlags(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		wantDir  string
		wantRest []string
		wantErr  bool
	}{
		{"no flags", []string{"validate", "deck"}, "", []string{"validate", "deck"}, false},
		{"no args at all", nil, "", nil, false},
		{"separate value", []string{"--dir", "/w", "serve"}, "/w", []string{"serve"}, false},
		{"equals value", []string{"--dir=/w", "serve"}, "/w", []string{"serve"}, false},
		{"flag only, no subcommand", []string{"--dir", "/w"}, "/w", []string{}, false},
		{"last occurrence wins", []string{"--dir", "/a", "--dir=/b", "new", "x"}, "/b", []string{"new", "x"}, false},
		{"subcommand args untouched", []string{"--dir=/w", "new", "--dir"}, "/w", []string{"new", "--dir"}, false},
		{"missing value", []string{"--dir"}, "", nil, true},
		{"empty value", []string{"--dir", ""}, "", nil, true},
		{"empty equals value", []string{"--dir="}, "", nil, true},
		{"unknown global flag", []string{"--verbose", "serve"}, "", nil, true},
		{"unknown short flag", []string{"-x"}, "", nil, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir, rest, err := parseGlobalFlags(tc.args)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("parseGlobalFlags(%v): expected an error", tc.args)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseGlobalFlags(%v): %v", tc.args, err)
			}
			if dir != tc.wantDir {
				t.Errorf("dir = %q, want %q", dir, tc.wantDir)
			}
			if len(rest) != len(tc.wantRest) {
				t.Fatalf("rest = %v, want %v", rest, tc.wantRest)
			}
			for i := range rest {
				if rest[i] != tc.wantRest[i] {
					t.Fatalf("rest = %v, want %v", rest, tc.wantRest)
				}
			}
		})
	}
}

// TestInitWorkspace_IdempotentAndComplete — initWorkspace creates the marker plus the
// auxiliary dirs, and re-running it is a no-op rather than an error.
func TestInitWorkspace_IdempotentAndComplete(t *testing.T) {
	dir := t.TempDir()

	for i := range 2 {
		if err := initWorkspace(dir); err != nil {
			t.Fatalf("initWorkspace (run %d): %v", i+1, err)
		}
	}
	for _, want := range append([]string{"decks"}, auxDirs...) {
		info, err := os.Stat(filepath.Join(dir, want))
		if err != nil {
			t.Errorf("initWorkspace did not create %s/: %v", want, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("%s exists but is not a directory", want)
		}
	}
	if !isWorkspace(dir) {
		t.Error("initWorkspace left a directory that isWorkspace does not recognize")
	}
}

// TestEnsureAuxDirs_LeavesMarkerAlone — the aux dirs are created on demand inside an
// already-resolved root; decks/ is *not* among them, so ensureAuxDirs can never
// manufacture the marker that proves a workspace.
func TestEnsureAuxDirs_LeavesMarkerAlone(t *testing.T) {
	dir := t.TempDir()

	if err := ensureAuxDirs(dir); err != nil {
		t.Fatalf("ensureAuxDirs: %v", err)
	}
	if isWorkspace(dir) {
		t.Error("ensureAuxDirs created decks/; only initWorkspace may create the marker")
	}
	for _, want := range auxDirs {
		if _, err := os.Stat(filepath.Join(dir, want)); err != nil {
			t.Errorf("ensureAuxDirs did not create %s/: %v", want, err)
		}
	}
}
