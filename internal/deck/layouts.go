package deck

import (
	"embed"
	"sort"
	"strings"
)

// layoutPresetVendor holds the bundled slide-layout preset <section> snippets
// (Phase 14). Each file under vendor/layouts/<name>.html is a VALID, OFFLINE
// reveal.js <section> that composes the data-lay layout primitives
// (stack/row/grid/layers) with starter prompt content (e.g.
// <h1>Click to add title</h1>). The <section> carries a data-layout="<name>"
// marker and exactly one data-slot="content" container marking the primary
// content region the editor fills.
//
//go:embed vendor/layouts/*.html
var layoutPresetVendor embed.FS

// LayoutPreset is a bundled slide-layout template offered in the editor's
// "new slide" / layout picker (Phase 14, Google-Slides-style presets).
type LayoutPreset struct {
	// Name is the stable preset id (the filename without extension, and the
	// value of the section's data-layout attribute), e.g. "two-content".
	Name string `json:"name"`
	// Label is a human-readable display name derived from Name, e.g. "Two content".
	Label string `json:"label"`
	// HTML is the raw <section>…</section> snippet to insert into a deck.
	HTML string `json:"html"`
}

// bundledLayoutOrder is the display order of the built-in presets, mirroring the
// familiar Google-Slides layout gallery (title first, blank last). Names not in
// this list fall back to alphabetical order after the known ones.
var bundledLayoutOrder = []string{
	"title",
	"title-body",
	"section-header",
	"two-content",
	"comparison",
	"title-only",
	"big-number",
	"caption",
	"blank",
}

// BundledLayouts returns the ordered list of slide-layout presets vendored into
// the binary. The list is built from the embedded vendor/layouts/*.html files,
// so adding a preset file automatically surfaces it here (and via the API).
func BundledLayouts() []LayoutPreset {
	entries, err := layoutPresetVendor.ReadDir("vendor/layouts")
	if err != nil {
		// Embedded FS is compiled in; a read error is a programming error, not a
		// runtime condition. Return empty rather than panicking in a handler.
		return nil
	}

	rank := make(map[string]int, len(bundledLayoutOrder))
	for i, n := range bundledLayoutOrder {
		rank[n] = i
	}

	presets := make([]LayoutPreset, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".html") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".html")
		data, err := layoutPresetVendor.ReadFile("vendor/layouts/" + e.Name())
		if err != nil {
			continue
		}
		presets = append(presets, LayoutPreset{
			Name:  name,
			Label: layoutLabel(name),
			HTML:  string(data),
		})
	}

	sort.SliceStable(presets, func(i, j int) bool {
		ri, oki := rank[presets[i].Name]
		rj, okj := rank[presets[j].Name]
		switch {
		case oki && okj:
			return ri < rj
		case oki != okj:
			return oki // known-order presets sort before unknown ones
		default:
			return presets[i].Name < presets[j].Name
		}
	})
	return presets
}

// layoutLabel derives a human-readable label from a preset name by replacing
// hyphens with spaces and capitalising the first letter, e.g.
// "section-header" → "Section header".
func layoutLabel(name string) string {
	s := strings.ReplaceAll(name, "-", " ")
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
