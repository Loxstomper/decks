package skill_test

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"slides-builder/internal/skill"
)

// installedPath is the workspace-relative location Claude Code discovers skills at.
func installedPath(root, name string) string {
	return filepath.Join(root, ".claude", "skills", "slides-authoring", name)
}

// TestFilesShipsBothDocs — the skill is the how-to guide *and* its contract reference.
// Shipping only SKILL.md would leave its "see AUTHORING.md" pointer dangling in a
// workspace that is a separate repo from slides-builder.
func TestFilesShipsBothDocs(t *testing.T) {
	files, err := skill.Files()
	if err != nil {
		t.Fatalf("Files: %v", err)
	}
	for _, want := range []string{"SKILL.md", "AUTHORING.md"} {
		if !slices.Contains(files, want) {
			t.Errorf("embedded skill is missing %s (got %v)", want, files)
		}
	}
}

// TestRenderKeepsFrontmatterFirst is load-bearing: Claude Code discovers a skill by
// parsing YAML frontmatter starting at byte 0.  Naively prepending the generated header
// would push the fence down and silently make the skill undiscoverable — the file would
// still look fine to a human reader.
func TestRenderKeepsFrontmatterFirst(t *testing.T) {
	got, err := skill.Render("SKILL.md")
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !bytes.HasPrefix(got, []byte("---\nname: slides-authoring\n")) {
		t.Fatalf("rendered SKILL.md must open with its YAML frontmatter, got:\n%.80s", got)
	}

	// The header lands after the closing fence, not before it.
	fenceEnd := bytes.Index(got[4:], []byte("\n---\n"))
	if fenceEnd < 0 {
		t.Fatal("rendered SKILL.md has no closing frontmatter fence")
	}
	headerAt := bytes.Index(got, []byte("GENERATED"))
	if headerAt < 0 {
		t.Fatal("rendered SKILL.md carries no generated header")
	}
	if headerAt < fenceEnd {
		t.Error("generated header was inserted inside the frontmatter block")
	}
}

// TestRenderStampsHeader — every installed file says it is generated and names the source
// of truth.  A copy that silently looks hand-authored is the thing that gets edited.
func TestRenderStampsHeader(t *testing.T) {
	files, err := skill.Files()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		got, err := skill.Render(name)
		if err != nil {
			t.Fatalf("Render(%s): %v", name, err)
		}
		for _, want := range []string{
			"GENERATED",
			"do not edit",
			"internal/skill/assets/slides-authoring/",
			"slides install-skill",
		} {
			if !bytes.Contains(got, []byte(want)) {
				t.Errorf("%s: header missing %q", name, want)
			}
		}
	}
}

// TestRenderPreservesBody — stamping must not damage the contract text itself.
func TestRenderPreservesBody(t *testing.T) {
	skillMD, err := skill.Render("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	authoring, err := skill.Render("AUTHORING.md")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(skillMD, []byte("# slides-authoring skill")) {
		t.Error("SKILL.md body was lost")
	}
	// A spot-check of the data-* vocabulary the skill exists to teach.
	for _, want := range []string{`data-lay="stack"`, "data-eid", "offline"} {
		if !bytes.Contains(skillMD, []byte(want)) {
			t.Errorf("SKILL.md no longer teaches %q", want)
		}
	}
	if !bytes.Contains(authoring, []byte("# Authoring conventions")) {
		t.Error("AUTHORING.md body was lost")
	}
	if !bytes.HasPrefix(authoring, []byte("<!-- GENERATED")) {
		t.Error("AUTHORING.md (no frontmatter) should open with the header")
	}
}

// TestInstallWritesSkill — a fresh workspace gets a skill matching the binary.
func TestInstallWritesSkill(t *testing.T) {
	root := t.TempDir()

	res, err := skill.Install(root)
	if err != nil {
		t.Fatalf("Install: %v", err)
	}
	if !res.Changed() {
		t.Fatal("first Install reported no changes")
	}
	if res.Total != 2 {
		t.Errorf("Total = %d, want 2 (SKILL.md + AUTHORING.md)", res.Total)
	}

	for _, name := range []string{"SKILL.md", "AUTHORING.md"} {
		got, err := os.ReadFile(installedPath(root, name))
		if err != nil {
			t.Fatalf("installed %s: %v", name, err)
		}
		want, err := skill.Render(name)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("installed %s does not match the rendered bytes", name)
		}
	}
}

// TestInstallIsIdempotentNoOp — re-installing an unchanged skill must not touch a single
// file.  A decks repo commits the skill as a build artifact; rewriting identical bytes
// would churn mtimes and produce spurious diffs on every `slides new`.
func TestInstallIsIdempotentNoOp(t *testing.T) {
	root := t.TempDir()
	if _, err := skill.Install(root); err != nil {
		t.Fatal(err)
	}

	before := map[string]os.FileInfo{}
	for _, name := range []string{"SKILL.md", "AUTHORING.md"} {
		fi, err := os.Stat(installedPath(root, name))
		if err != nil {
			t.Fatal(err)
		}
		before[name] = fi
	}

	res, err := skill.Install(root)
	if err != nil {
		t.Fatalf("second Install: %v", err)
	}
	if res.Changed() {
		t.Errorf("re-install rewrote %v; it must be a byte-for-byte no-op", res.Written)
	}
	for name, fi := range before {
		now, err := os.Stat(installedPath(root, name))
		if err != nil {
			t.Fatal(err)
		}
		if !now.ModTime().Equal(fi.ModTime()) {
			t.Errorf("%s mtime changed on a no-op re-install", name)
		}
	}
}

// TestInstallRestoresEditedCopy — the installed copy converges on the contract the binary
// enforces.  Local edits are *not* preserved: a forked skill is the exact failure this
// package exists to prevent.
func TestInstallRestoresEditedCopy(t *testing.T) {
	root := t.TempDir()
	if _, err := skill.Install(root); err != nil {
		t.Fatal(err)
	}

	target := installedPath(root, "SKILL.md")
	if err := os.WriteFile(target, []byte("---\nname: hacked\n---\nlies\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// And delete the other file entirely.
	if err := os.Remove(installedPath(root, "AUTHORING.md")); err != nil {
		t.Fatal(err)
	}

	res, err := skill.Install(root)
	if err != nil {
		t.Fatalf("Install after tampering: %v", err)
	}
	if len(res.Written) != 2 {
		t.Errorf("Written = %v, want both files restored", res.Written)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	want, err := skill.Render("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Error("Install did not restore an edited SKILL.md to the canonical bytes")
	}
	if _, err := os.Stat(installedPath(root, "AUTHORING.md")); err != nil {
		t.Errorf("Install did not restore a deleted AUTHORING.md: %v", err)
	}
}

// TestInstallCreatesOnlyTheSkillDir — Install assumes an already-resolved workspace and
// must not scaffold anything else (spec project-structure, "never scaffold an unproven
// root"; the caller owns decks/ and friends).
func TestInstallCreatesOnlyTheSkillDir(t *testing.T) {
	root := t.TempDir()
	if _, err := skill.Install(root); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != ".claude" {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Errorf("Install created %v, want only .claude/", names)
	}
}

// TestRepoInstalledCopyIsCurrent is the anti-drift guard for slides-builder's *own*
// workspace.  This repo commits its installed skill so a fresh clone gives Claude Code
// the skill without first building the binary — which means the committed copy can go
// stale the moment someone edits the source under internal/skill/assets/.
//
// If this fails, run `slides install-skill` from the repo root and commit the result.
func TestRepoInstalledCopyIsCurrent(t *testing.T) {
	repoRoot := filepath.Join("..", "..") // test cwd is the package dir.

	files, err := skill.Files()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		want, err := skill.Render(name)
		if err != nil {
			t.Fatal(err)
		}
		path := installedPath(repoRoot, name)
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("the repo's committed skill is missing %s: %v\n"+
				"run `slides install-skill` from the repo root and commit the result", path, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s has drifted from internal/skill/assets/slides-authoring/%s\n"+
				"run `slides install-skill` from the repo root and commit the result", path, name)
		}
	}
}

// TestSkillTeachesTheCurrentCLI — the skill documents the CLI, so a command rename must
// not leave it teaching a command that no longer exists.
func TestSkillTeachesTheCurrentCLI(t *testing.T) {
	got, err := skill.Render("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(got)
	for _, cmd := range []string{"slides new ", "slides validate ", "slides add-slide ", "slides vendor "} {
		if !strings.Contains(text, cmd) {
			t.Errorf("SKILL.md no longer documents %q", cmd)
		}
	}
	// The skill must not tell Claude Code to run the binary from the workspace root
	// (Phase 20 put it on $PATH and made it resolve the root itself).
	if strings.Contains(text, "./slides") {
		t.Error(`SKILL.md still tells Claude Code to run "./slides"; the binary lives on $PATH`)
	}
}
