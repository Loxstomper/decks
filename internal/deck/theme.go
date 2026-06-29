package deck

import (
	"bytes"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Per-slide theming (P10-1).
//
// reveal.js applies a single theme per deck via the <link> to theme/<name>.css,
// which sets a family of --r-* CSS custom properties (text/heading/link colours,
// fonts, background) on :root and styles .reveal off them.  To let an individual
// section override the deck theme, we DERIVE — from the very same embedded theme
// CSS, the single source of truth — a stylesheet that re-declares those --r-*
// vars scoped to section[data-theme="<name>"].  Because reveal's own rules read
// the vars via var(--r-…), re-binding them on a section restyles that section's
// text, headings and links without a parallel hand-maintained colour table.
//
// We intentionally do NOT scope --r-background-color here: reveal paints the
// slide background from .reveal-viewport (deck-level), not per section, so the
// per-section background is applied separately by the editor/runtime using the
// ThemeBackgrounds() map.

// cssRuleRE matches a flat CSS rule block: "selector { body }".  Theme files
// declare all --r-* custom properties in top-level :root / .reveal blocks (no
// nesting), so a non-greedy brace match is sufficient.
var cssRuleRE = regexp.MustCompile(`([^{}]+)\{([^{}]*)\}`)

// cssVarDeclRE matches a single "--r-foo: value;" declaration inside a block.
var cssVarDeclRE = regexp.MustCompile(`(--r-[A-Za-z0-9-]+)\s*:\s*([^;]+);`)

// cssCommentRE matches /* … */ comments, stripped before block parsing so a
// comment sitting between rules isn't glued onto the following selector.
var cssCommentRE = regexp.MustCompile(`(?s)/\*.*?\*/`)

// themeVars parses one bundled theme's embedded CSS and returns its --r-*
// custom properties (last declaration wins, mirroring CSS cascade), collected
// from :root and .reveal rule blocks — the blocks reveal uses to seed its vars.
func themeVars(name string) (map[string]string, error) {
	data, err := revealVendor.ReadFile("vendor/reveal/theme/" + name + ".css")
	if err != nil {
		return nil, fmt.Errorf("themeVars: read %s: %w", name, err)
	}
	data = cssCommentRE.ReplaceAll(data, nil)
	vars := map[string]string{}
	for _, m := range cssRuleRE.FindAllSubmatch(data, -1) {
		selector := strings.TrimSpace(string(m[1]))
		// Only harvest from the blocks that legitimately define the theme's
		// custom-property contract.  ":root" and ".reveal" (exactly) avoid
		// accidentally scooping decls out of malformed/nested matches.
		if selector != ":root" && selector != ".reveal" {
			continue
		}
		for _, d := range cssVarDeclRE.FindAllSubmatch(m[2], -1) {
			key := string(d[1])
			val := strings.TrimSpace(string(d[2]))
			vars[key] = val
		}
	}
	if len(vars) == 0 {
		return nil, fmt.Errorf("themeVars: %s: no --r-* custom properties found", name)
	}
	return vars, nil
}

// GenerateSlideThemesCSS derives a stylesheet (from the embedded reveal theme
// CSS) with one block per bundled theme:
//
//	.reveal section[data-theme="<name>"] { --r-main-color: …; --r-heading-color: …; … }
//
// Re-binding the --r-* vars on a section makes reveal restyle that section's
// text/headings/links to the chosen theme (per-slide theming, P10-1).  The
// background colour is excluded (see ThemeBackgrounds) because reveal paints
// backgrounds at deck level, not per section.
func GenerateSlideThemesCSS() []byte {
	var b bytes.Buffer
	b.WriteString("/* slides-builder per-slide themes (P10-1) — GENERATED, do not edit.\n")
	b.WriteString("   Derived from the embedded reveal.js theme CSS (single source of truth):\n")
	b.WriteString("   each block re-declares a theme's --r-* custom properties scoped to a\n")
	b.WriteString("   section[data-theme] so an individual slide restyles its text/headings/links.\n")
	b.WriteString("   Background colours are applied separately (see /api/themes/backgrounds). */\n\n")

	for _, name := range BundledThemes {
		vars, err := themeVars(name)
		if err != nil {
			// Skip a malformed theme rather than emit a broken block; the Go
			// tests assert every bundled theme yields a non-empty block.
			continue
		}
		// Stable, sorted key order so the generated CSS is byte-deterministic.
		keys := make([]string, 0, len(vars))
		for k := range vars {
			if k == "--r-background-color" {
				continue // applied per ThemeBackgrounds, not scoped here
			}
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			continue
		}
		fmt.Fprintf(&b, ".reveal section[data-theme=%q] {\n", name)
		for _, k := range keys {
			fmt.Fprintf(&b, "  %s: %s;\n", k, vars[k])
		}
		b.WriteString("}\n")

		// Re-asserting `color` at section scope (P18-1). reveal sets
		// `color: var(--r-main-color)` on `.reveal` — an ANCESTOR of the section.
		// `color` inherits as a COMPUTED value, so merely rebinding --r-main-color
		// on a descendant section never recomputes the inherited body text colour
		// (headings/links use their own per-element rules, so they updated; body
		// paragraphs did not). We must explicitly set `color` (and re-assert the
		// heading/link colours) ON the section so the override actually restyles
		// the slide's text, not just its background. Emitted only when the theme
		// declares the corresponding var, keeping the output theme-faithful.
		if _, ok := vars["--r-main-color"]; ok {
			fmt.Fprintf(&b, ".reveal section[data-theme=%q] {\n  color: var(--r-main-color);\n}\n", name)
		}
		if _, ok := vars["--r-heading-color"]; ok {
			fmt.Fprintf(&b, ".reveal section[data-theme=%q] :is(h1, h2, h3, h4, h5, h6) {\n  color: var(--r-heading-color);\n}\n", name)
		}
		if _, ok := vars["--r-link-color"]; ok {
			fmt.Fprintf(&b, ".reveal section[data-theme=%q] a {\n  color: var(--r-link-color);\n}\n", name)
		}
		b.WriteString("\n")
	}
	return b.Bytes()
}

// ThemeBackgrounds returns a map of bundled theme name → its
// --r-background-color value, parsed from the embedded reveal theme CSS.  The
// editor/runtime uses this to paint a per-slide background (reveal applies
// backgrounds at deck level, so per-section backgrounds are set explicitly).
func ThemeBackgrounds() map[string]string {
	out := map[string]string{}
	for _, name := range BundledThemes {
		vars, err := themeVars(name)
		if err != nil {
			continue
		}
		if bg, ok := vars["--r-background-color"]; ok {
			out[name] = bg
		}
	}
	return out
}
