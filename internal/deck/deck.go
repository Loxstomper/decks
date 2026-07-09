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
	"regexp"
	"strconv"
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
//   - vendor/slides-layout.css     — CSS for enum data-* attributes (spec layout-vocabulary)
//   - vendor/slides-layout-init.js — applies numeric data-* to inline styles
//
// These are shipped alongside reveal so decks render layout offline (spec principles-and-invariants).
//
//go:embed vendor/slides-layout.css vendor/slides-layout-init.js
var layoutVendor embed.FS

// highlightVendor holds the reveal.js highlight plugin (P5-9, spec principles-and-invariants):
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
// Bundled so LaTeX math expressions render offline (spec principles-and-invariants – zero CDN URLs).
//
//go:embed vendor/math vendor/katex
var mathVendor embed.FS

// notesVendor holds the reveal.js speaker-notes plugin (P7-2):
//   - vendor/notes/notes.js        — UMD bundle that exports RevealNotes (load this)
//   - vendor/notes/plugin.js       — unbundled ESM source (NOT browser-loadable as a classic script)
//   - vendor/notes/speaker-view.html — the popup speaker window document
//
// Pressing 'S' during a presentation opens the speaker window with notes,
// next-slide preview, and a timer.  All assets are local (zero external URLs,
// spec principles-and-invariants offline-first).
//
//go:embed vendor/notes
var notesVendor embed.FS

// chartVendor holds Chart.js + the slides-builder chart plugin (P17-14/15):
//   - vendor/chart/chart.umd.js — Chart.js 4.x UMD bundle (exposes window.Chart)
//   - vendor/chart/plugin.js    — thin reveal plugin reading data-chart-data JSON
//
// Loaded in the scaffold so <canvas data-chart> blocks render in the editor,
// the present route, and PDF export — all offline (spec principles-and-invariants, zero CDN URLs).
//
//go:embed vendor/chart
var chartVendor embed.FS

// qrVendor holds the QR generator + the slides-builder QR plugin (P19):
//   - vendor/qr/qrcode.js — qrcode-generator (Kazuhiko Arase, MIT; exposes the
//                           global `qrcode`), the matrix/error-correction core.
//   - vendor/qr/plugin.js  — thin reveal plugin reading data-qr + data-qr-*,
//                           building the SVG from the module matrix.
//
// Loaded in the scaffold so <div data-qr> blocks render in the editor, the
// present route, and PDF export — all offline (spec principles-and-invariants, zero CDN URLs).
//
//go:embed vendor/qr
var qrVendor embed.FS

// chalkboardVendor holds the reveal.js chalkboard/annotation plugin (P17-19):
//   - vendor/chalkboard/plugin.js — drawing/annotation (window.RevealChalkboard)
//   - vendor/chalkboard/style.css — toolbar/cursor styles
//   - vendor/chalkboard/img/*.png — board/marker/chalk cursor images
//
// Vendored into each deck but enabled ONLY on the present route (server injects
// the script + plugin registration so the editor stays clean and deck.html is
// never mutated — present-mode annotations are ephemeral, spec presenting-and-export).
//
//go:embed vendor/chalkboard
var chalkboardVendor embed.FS

// laserVendor holds the self-authored laser-pointer plugin (P17-19):
//   - vendor/laser/plugin.js — press 'l' to toggle a red dot (window.RevealLaser)
//
// Like chalkboard: vendored per deck, enabled only on the present route.
//
//go:embed vendor/laser
var laserVendor embed.FS

// revealVersion is the pinned reveal.js version embedded in the binary.
// Update this constant whenever vendor/ is refreshed.
const revealVersion = "5.1.0"

// deckHTML is the minimal valid reveal.js template used by New.
// All resource paths are RELATIVE so the deck renders without any network
// access (spec principles-and-invariants – offline-first).  The path structure mirrors the deck
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
  <!-- reveal.js vendored locally – no network required (spec principles-and-invariants offline-first) -->
  <link rel="stylesheet" href="assets/vendor/reveal/reset.css" />
  <link rel="stylesheet" href="assets/vendor/reveal/reveal.css" />
  <link rel="stylesheet" href="assets/vendor/reveal/theme/black.css" />
  <!-- slides-builder layout vocabulary – enum data-* → flex/grid (spec layout-vocabulary) -->
  <link rel="stylesheet" href="assets/vendor/slides-layout.css" />
  <!-- Per-slide themes – section[data-theme] re-binds reveal --r-* vars (P10-1) -->
  <link rel="stylesheet" href="assets/vendor/slides-slide-themes.css" />
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
  <script src="assets/vendor/notes/notes.js"></script>
  <!-- Chart.js + chart plugin – <canvas data-chart> blocks (P17-15, offline) -->
  <script src="assets/vendor/chart/chart.umd.js"></script>
  <script src="assets/vendor/chart/plugin.js"></script>
  <!-- QR generator + plugin – <div data-qr> blocks (P19, offline) -->
  <script src="assets/vendor/qr/qrcode.js"></script>
  <script src="assets/vendor/qr/plugin.js"></script>
  <script>
    Reveal.initialize({
      // Logical canvas matches the editor (spec scaling-and-resolution): reveal scales this 1920x1080
      // space to any screen at present time, so editor overlays and the rendered
      // deck share one coordinate system (WYSIWYG). Aspect changes rewrite these.
      width: 1920,
      height: 1080,
      // Full logical canvas at origin: free coords are identity (spec scaling-and-resolution, Phase 15).
      // center:false + margin:0 stop reveal from inset-offsetting the slide, so a
      // [data-free] element at data-x=0,data-y=0 lands at the true canvas top-left.
      // Structured 'stack' slides still center via data-justify in slides-layout.css.
      center: false,
      margin: 0,
      hash: true,
      controls: true,
      progress: true,
      slideNumber: false,
      transition: 'slide',
      // KaTeX: point at local assets so math renders offline (spec principles-and-invariants, P5-10).
      // The math plugin constructs URLs as: local + '/dist/katex.min.{css,js}'
      // and local + '/dist/contrib/auto-render.min.js'.
      katex: { local: 'assets/vendor/katex' },
      plugins: [ RevealHighlight, RevealMath.KaTeX, RevealNotes, RevealChart, RevealQR ]
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
	"solarized-dark",
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

	// Vendor reveal into the deck so it is self-contained (spec principles-and-invariants).
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

	// Per-slide theme stylesheet → assets/vendor/slides-slide-themes.css (P10-1).
	// Derived from the embedded reveal theme CSS so a section[data-theme] can
	// restyle its own --r-* vars (per-slide theming, single source of truth).
	if err := writeSlideThemesCSS(vendorDir); err != nil {
		return fmt.Errorf("vendor: write slide themes to deck: %w", err)
	}
	log.Printf("deck: vendored slides-slide-themes.css → %s", vendorDir)

	// Highlight plugin → assets/vendor/highlight/ (P5-9, spec principles-and-invariants offline-first)
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
	// (popup window). All local so speaker view works offline (spec principles-and-invariants).
	if err := copyEmbeddedFS(notesVendor, "vendor/notes", filepath.Join(vendorDir, "notes")); err != nil {
		return fmt.Errorf("vendor: copy notes plugin: %w", err)
	}
	log.Printf("deck: vendored notes plugin → %s/notes", vendorDir)

	// Chart.js + chart plugin → assets/vendor/chart/ (P17-15, in scaffold template)
	if err := copyEmbeddedFS(chartVendor, "vendor/chart", filepath.Join(vendorDir, "chart")); err != nil {
		return fmt.Errorf("vendor: copy chart plugin: %w", err)
	}
	log.Printf("deck: vendored chart plugin → %s/chart", vendorDir)

	// QR generator + plugin → assets/vendor/qr/ (P19, in scaffold template)
	if err := copyEmbeddedFS(qrVendor, "vendor/qr", filepath.Join(vendorDir, "qr")); err != nil {
		return fmt.Errorf("vendor: copy qr plugin: %w", err)
	}
	log.Printf("deck: vendored qr plugin → %s/qr", vendorDir)

	// Chalkboard plugin → assets/vendor/chalkboard/ (P17-19, present-route only)
	if err := copyEmbeddedFS(chalkboardVendor, "vendor/chalkboard", filepath.Join(vendorDir, "chalkboard")); err != nil {
		return fmt.Errorf("vendor: copy chalkboard plugin: %w", err)
	}
	log.Printf("deck: vendored chalkboard plugin → %s/chalkboard", vendorDir)

	// Laser plugin → assets/vendor/laser/ (P17-19, present-route only)
	if err := copyEmbeddedFS(laserVendor, "vendor/laser", filepath.Join(vendorDir, "laser")); err != nil {
		return fmt.Errorf("vendor: copy laser plugin: %w", err)
	}
	log.Printf("deck: vendored laser plugin → %s/laser", vendorDir)

	if err := EnsureSharedVendor(root); err != nil {
		// Non-fatal: shared/ is a reference copy, not required for deck rendering.
		log.Printf("deck: warning: could not refresh shared vendor: %v", err)
	}
	return nil
}

// initKeyRE matches a property key inside the Reveal.initialize({…}) object,
// e.g. `center:` or `margin:` at the start of a line (after indentation). Used
// by Upgrade to test whether a config key is already present so the rewrite is
// idempotent and byte-stable.
func initKeyRE(key string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*:`)
}

// upgradeInitialize inserts `center: false,` and `margin: 0,` into the first
// Reveal.initialize({…}) call if those keys are absent (Phase 15: full logical
// canvas at origin so free coords are identity, spec scaling-and-resolution). It is a pure function
// for testability. Returns the (possibly rewritten) HTML and whether it changed.
//
// Guarantees:
//   - Idempotent / byte-stable: if both keys are already present (any value),
//     the input is returned unchanged. Re-running makes no further diff.
//   - Minimal diff: only the missing key lines (plus one WHY comment) are
//     inserted; nothing else is touched.
//   - Indentation is copied from the line following the `{` so the insertion
//     matches the surrounding style.
func upgradeInitialize(html string) (string, bool) {
	const marker = "Reveal.initialize({"
	i := strings.Index(html, marker)
	if i < 0 {
		return html, false
	}

	needCenter := !initKeyRE("center").MatchString(html)
	needMargin := !initKeyRE("margin").MatchString(html)
	if !needCenter && !needMargin {
		return html, false
	}

	// Insertion point: start of the line after the marker's line.
	after := i + len(marker)
	nl := strings.IndexByte(html[after:], '\n')
	if nl < 0 {
		return html, false
	}
	insertAt := after + nl + 1

	// Copy indentation from the line at the insertion point.
	indent := ""
	for _, r := range html[insertAt:] {
		if r == ' ' || r == '\t' {
			indent += string(r)
			continue
		}
		break
	}

	var b strings.Builder
	b.WriteString(html[:insertAt])
	b.WriteString(indent + "// Full logical canvas at origin: free coords are identity (spec scaling-and-resolution, Phase 15).\n")
	if needCenter {
		b.WriteString(indent + "center: false,\n")
	}
	if needMargin {
		b.WriteString(indent + "margin: 0,\n")
	}
	b.WriteString(html[insertAt:])
	return b.String(), true
}

// initLineRE matches an entire `key: value,` line of the Reveal.initialize({…})
// config object (key at line start after indentation, through the newline). Used
// by setInitKey to replace or remove a single key's line idempotently.
func initLineRE(key string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^[ \t]*` + regexp.QuoteMeta(key) + `[ \t]*:[^\n]*\n`)
}

// setInitKey upserts (value != "") or removes (value == "") exactly one key in
// the first Reveal.initialize({…}) object. `value` is the raw JS literal placed
// after the colon (e.g. "3000", "true", "false", or "'c/t'"). Pure, idempotent
// and byte-stable: if
// the desired state already holds the input is returned unchanged (changed=false),
// so re-running produces no diff. New keys are inserted at the top of the object
// (right after the `{` line) with the surrounding indentation; the always-present
// trailing comma is safe there. Returns the (possibly rewritten) HTML + changed.
func setInitKey(html, key, value string) (string, bool) {
	const marker = "Reveal.initialize({"
	mi := strings.Index(html, marker)
	if mi < 0 {
		return html, false
	}
	loc := initLineRE(key).FindStringIndex(html[mi:])

	if value == "" {
		// Remove the line if present; otherwise nothing to do.
		if loc == nil {
			return html, false
		}
		s, e := mi+loc[0], mi+loc[1]
		return html[:s] + html[e:], true
	}

	desired := key + ": " + value + ","
	if loc != nil {
		// Replace the existing line, preserving its indentation + trailing newline.
		s, e := mi+loc[0], mi+loc[1]
		line := html[s:e]
		indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
		newLine := indent + desired + "\n"
		if newLine == line {
			return html, false
		}
		return html[:s] + newLine + html[e:], true
	}

	// Insert after the marker's line, copying indentation from the next line.
	after := mi + len(marker)
	nl := strings.IndexByte(html[after:], '\n')
	if nl < 0 {
		return html, false
	}
	insertAt := after + nl + 1
	indent := ""
	for _, r := range html[insertAt:] {
		if r == ' ' || r == '\t' {
			indent += string(r)
			continue
		}
		break
	}
	return html[:insertAt] + indent + desired + "\n" + html[insertAt:], true
}

// setRevealAutoSlide sets the deck-level auto-advance config in Reveal.initialize:
// `autoSlide: <ms>` (milliseconds between automatic advances) and `loop: true`.
// `ms <= 0` removes the `autoSlide` key (auto-advance off); `loop == false`
// removes the `loop` key. Pure, idempotent and byte-stable — a deck already in
// the requested state is returned unchanged so saving the same setting twice
// yields no diff. Implemented as a focused helper (not a generalization of other
// lanes' init rewrites) to keep this lane's edit localized.
func setRevealAutoSlide(html string, ms int, loop bool) (string, bool) {
	changed := false

	autoVal := ""
	if ms > 0 {
		autoVal = strconv.Itoa(ms)
	}
	if out, c := setInitKey(html, "autoSlide", autoVal); c {
		html, changed = out, true
	}

	loopVal := ""
	if loop {
		loopVal = "true"
	}
	if out, c := setInitKey(html, "loop", loopVal); c {
		html, changed = out, true
	}

	return html, changed
}

// SetAutoSlide rewrites decks/<name>/deck.html under root so Reveal.initialize
// carries the requested deck-level auto-advance default (`autoSlide`, ms) and
// `loop` flag (P17-20). The rewrite is byte-stable: when the deck already has
// the requested config the file is left untouched (no atomic write at all).
// Uses the same temp-file + os.Rename atomic pattern as Write.
func SetAutoSlide(root, name string, ms int, loop bool) error {
	if err := validateName(name); err != nil {
		return err
	}
	html, err := Read(root, name)
	if err != nil {
		return err
	}
	out, changed := setRevealAutoSlide(string(html), ms, loop)
	if !changed {
		return nil
	}
	return Write(root, name, []byte(out))
}

// setSlideNumber sets the deck-level slide-number config in Reveal.initialize:
// `slideNumber: false` (off) or `slideNumber: '<format>'` (e.g. 'c/t' for
// current/total, 'c' for current). The key is always KEPT present (set to `false`
// when disabled) rather than removed, matching the scaffold which ships
// `slideNumber: false`, so a freshly scaffolded deck toggled off is byte-stable.
// Pure, idempotent and byte-stable: a deck already in the requested state is
// returned unchanged. `format` is the raw token placed inside single quotes —
// callers must restrict it to a safe whitelist (the endpoint does) so no quote
// escaping is required.
func setSlideNumber(html string, enabled bool, format string) (string, bool) {
	val := "false"
	if enabled {
		f := format
		if f == "" {
			f = "c/t"
		}
		val = "'" + f + "'"
	}
	return setInitKey(html, "slideNumber", val)
}

// SetSlideNumber rewrites decks/<name>/deck.html under root so Reveal.initialize
// carries the requested deck-level slide-number config (P17-17). When `enabled`
// is false the key is set to `false`; otherwise to the quoted `format` token. The
// rewrite is byte-stable: when the deck already holds the requested config the
// file is left untouched (no atomic write at all). Uses the same temp-file +
// os.Rename atomic pattern as Write.
func SetSlideNumber(root, name string, enabled bool, format string) error {
	if err := validateName(name); err != nil {
		return err
	}
	html, err := Read(root, name)
	if err != nil {
		return err
	}
	out, changed := setSlideNumber(string(html), enabled, format)
	if !changed {
		return nil
	}
	return Write(root, name, []byte(out))
}

// slideThemesLinkRE detects an existing slides-slide-themes.css <link> so the
// injection is idempotent (matches any quoting/whitespace around the href).
var slideThemesLinkRE = regexp.MustCompile(`<link[^>]+slides-slide-themes\.css`)

// slideThemesLinkTag is the exact <link> tag the scaffold emits, reused so an
// upgraded deck's head matches a freshly scaffolded one byte-for-byte.
const slideThemesLinkTag = `<link rel="stylesheet" href="assets/vendor/slides-slide-themes.css" />`

// injectSlideThemesLink ensures deck.html links the per-slide theme stylesheet
// (P18-2). Decks scaffolded before Phase 10 never had the <link> written into
// their <head>; vendor/upgrade copied the file but left the markup alone, so
// data-theme overrides had no rules to match. This adds the link exactly once,
// ordered right after the slides-layout.css link (matching the scaffold:
// slides-layout.css → slides-slide-themes.css → custom.css). Pure + idempotent:
// returns the HTML unchanged (changed=false) when the link is already present,
// or when no anchor to position it against is found.
func injectSlideThemesLink(html string) (string, bool) {
	if slideThemesLinkRE.MatchString(html) {
		return html, false
	}
	// Anchor on the slides-layout.css link line so ordering matches the scaffold.
	anchorRE := regexp.MustCompile(`(?m)^([ \t]*)<link[^>]+slides-layout\.css[^>]*>[^\n]*\n`)
	loc := anchorRE.FindStringSubmatchIndex(html)
	if loc == nil {
		// No layout link to anchor against (unusual). Fall back to before the
		// custom.css link, else give up rather than guess at <head> structure.
		fallbackRE := regexp.MustCompile(`(?m)^([ \t]*)<link[^>]+href="custom\.css"[^>]*>[^\n]*\n`)
		loc = fallbackRE.FindStringSubmatchIndex(html)
		if loc == nil {
			return html, false
		}
		indent := html[loc[2]:loc[3]]
		insertAt := loc[0]
		return html[:insertAt] + indent + slideThemesLinkTag + "\n" + html[insertAt:], true
	}
	indent := html[loc[2]:loc[3]]
	insertAt := loc[1] // end of the matched layout-link line (incl. newline)
	return html[:insertAt] + indent + slideThemesLinkTag + "\n" + html[insertAt:], true
}

// qrScriptRE detects an existing QR generator <script> so injection is idempotent.
var qrScriptRE = regexp.MustCompile(`assets/vendor/qr/qrcode\.js`)

// qrScriptTags is the exact pair of <script> tags (with the scaffold comment) the
// template emits for the QR block, reused so an upgraded deck matches a freshly
// scaffolded one byte-for-byte. Trailing newline included so it slots in cleanly.
const qrScriptTags = `  <!-- QR generator + plugin – <div data-qr> blocks (P19, offline) -->
  <script src="assets/vendor/qr/qrcode.js"></script>
  <script src="assets/vendor/qr/plugin.js"></script>
`

// qrScriptInsertIndex returns the byte offset at which the QR <script> tags are
// spliced in: the start of the line holding the bare inline `<script>` tag that
// opens the `Reveal.initialize` block. The QR scripts must load before that block
// executes (it names RevealQR in its plugins array). Returns -1 when the deck has
// no Reveal.initialize call, or no inline `<script>` precedes it.
//
// WHY not a single "<script> then Reveal.initialize" regex: the inline block often
// carries setup code between its `<script>` open tag and Reveal.initialize (custom
// demo wiring, mermaid config, dock sync). Requiring adjacency misses those decks —
// the scripts get skipped while RevealQR is still registered, so init throws on the
// undefined global and the whole deck renders blank. Anchoring on the block that
// *contains* Reveal.initialize is robust to whatever sits in between.
func qrScriptInsertIndex(html string) int {
	ri := strings.Index(html, "Reveal.initialize")
	if ri < 0 {
		return -1
	}
	// The bare inline `<script>` (no src attr) that opens the init block is the
	// last such tag before Reveal.initialize; the `>` in the literal guarantees
	// we skip `<script src=…>` external tags.
	open := strings.LastIndex(html[:ri], "<script>")
	if open < 0 {
		return -1
	}
	// Back up to the start of that line so the inserted tags keep indentation.
	return strings.LastIndex(html[:open], "\n") + 1
}

// qrPluginsArrayRE captures the `plugins: [ … ]` array so RevealQR can be appended
// when absent. Identifiers only (no nested brackets), so `[^\]]*` is safe.
var qrPluginsArrayRE = regexp.MustCompile(`plugins:\s*\[[^\]]*\]`)

// qrPluginsCloseRE matches the closing bracket (with any leading space) of that
// array so we can splice `, RevealQR ` in before it, byte-matching the scaffold's
// `…RevealChart, RevealQR ]` spacing.
var qrPluginsCloseRE = regexp.MustCompile(`\s*\]$`)

// injectQrPlugin ensures deck.html loads the QR generator + plugin and registers
// RevealQR (P19). Decks scaffolded before Phase 19 never had the <script> tags or
// the plugin registration written into their markup; vendor/upgrade copies the
// files but left the markup alone, so an inserted `<div data-qr>` never rendered.
// This adds both, exactly once each, positioned/spaced to match the scaffold.
// Pure + idempotent: returns changed=false when both are already present.
//
// The two mutations are COUPLED: if the scripts are missing but there's no init
// block to anchor them against, the deck is left completely untouched rather than
// registering RevealQR without loading it (a half-wired deck throws at init and
// renders blank — the exact failure this migration exists to prevent).
func injectQrPlugin(html string) (string, bool) {
	haveScripts := qrScriptRE.MatchString(html)

	// Locate the script insertion point up front so we can bail atomically when
	// the scripts are missing and unplaceable — before touching the plugins array.
	insertAt := -1
	if !haveScripts {
		if insertAt = qrScriptInsertIndex(html); insertAt < 0 {
			return html, false
		}
	}

	out := html
	changed := false

	// (1) <script> tags — inject before the inline Reveal.initialize block.
	if !haveScripts {
		out = out[:insertAt] + qrScriptTags + out[insertAt:]
		changed = true
	}

	// (2) plugins array — append RevealQR when absent. Re-scan `out` (step 1 may
	// have shifted offsets) rather than the original html.
	if m := qrPluginsArrayRE.FindString(out); m != "" && !strings.Contains(m, "RevealQR") {
		replaced := qrPluginsCloseRE.ReplaceAllString(m, ", RevealQR ]")
		out = strings.Replace(out, m, replaced, 1)
		changed = true
	}

	return out, changed
}

// Upgrade migrates an existing deck to the current vendored assets and the
// Phase 15 coordinate-identity reveal config. It:
//
//  1. Re-vendors via Vendor() so the deck picks up updated CSS/JS (notably the
//     slides-layout.css canvas/containing-block rules).
//  2. Rewrites deck.html's Reveal.initialize to add center:false + margin:0 when
//     absent. The rewrite is byte-stable when those keys already exist (a deck
//     scaffolded by the current template is left untouched) and idempotent.
//
// Only deck.html and vendored assets change; deck authoring content is preserved.
func Upgrade(root, name string) error {
	if err := validateName(name); err != nil {
		return err
	}

	// (a) Refresh vendored assets (CSS/JS/plugins) for this deck.
	if err := Vendor(root, name); err != nil {
		return fmt.Errorf("upgrade: vendor: %w", err)
	}

	// (b) Rewrite the reveal config if needed (byte-stable otherwise).
	html, err := Read(root, name)
	if err != nil {
		return fmt.Errorf("upgrade: read deck.html: %w", err)
	}
	updated, changedInit := upgradeInitialize(string(html))
	updated, changedLink := injectSlideThemesLink(updated)
	updated, changedQr := injectQrPlugin(updated)
	if changedInit || changedLink || changedQr {
		if err := Write(root, name, []byte(updated)); err != nil {
			return fmt.Errorf("upgrade: write deck.html: %w", err)
		}
		log.Printf("deck: upgraded deck.html in %s (reveal config: %v, slide-themes link: %v, qr plugin: %v)",
			filepath.Join(root, DecksDir, name, "deck.html"), changedInit, changedLink, changedQr)
	} else {
		log.Printf("deck: deck.html already current in %s (no change)", name)
	}
	return nil
}

// writeSlideThemesCSS writes the DERIVED per-slide theme stylesheet (P10-1)
// into destDir as slides-slide-themes.css. The content is generated from the
// embedded reveal theme CSS (GenerateSlideThemesCSS), not copied from an
// embedded file, so it always reflects the bundled themes.
func writeSlideThemesCSS(destDir string) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("writeSlideThemesCSS: mkdir: %w", err)
	}
	dest := filepath.Join(destDir, "slides-slide-themes.css")
	if err := os.WriteFile(dest, GenerateSlideThemesCSS(), 0o644); err != nil {
		return fmt.Errorf("writeSlideThemesCSS: write %s: %w", dest, err)
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
