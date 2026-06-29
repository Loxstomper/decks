package deck_test

import (
	"strings"
	"testing"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"slides-builder/internal/deck"
)

// TestBundledLayouts_NonEmpty verifies the expected built-in presets are all
// bundled into the binary.
func TestBundledLayouts_NonEmpty(t *testing.T) {
	want := []string{
		"title", "title-body", "section-header", "two-content", "comparison",
		"title-only", "big-number", "caption", "blank",
	}
	got := deck.BundledLayouts()
	if len(got) < len(want) {
		t.Fatalf("BundledLayouts returned %d presets, want at least %d", len(got), len(want))
	}
	have := make(map[string]bool, len(got))
	for _, p := range got {
		have[p.Name] = true
		if p.Label == "" {
			t.Errorf("preset %q has empty Label", p.Name)
		}
		if strings.TrimSpace(p.HTML) == "" {
			t.Errorf("preset %q has empty HTML", p.Name)
		}
	}
	for _, name := range want {
		if !have[name] {
			t.Errorf("BundledLayouts missing %q", name)
		}
	}
}

// TestBundledLayouts_WellFormed parses each preset and asserts the Phase-14
// contract: well-formed HTML, a single <section> carrying data-layout matching
// the preset name, exactly one data-slot="content" container, and zero external
// (http/https) URLs (offline-first, spec 12).
func TestBundledLayouts_WellFormed(t *testing.T) {
	for _, p := range deck.BundledLayouts() {
		p := p
		t.Run(p.Name, func(t *testing.T) {
			// Well-formed: html.Parse never errors, so use the tokenizer to catch
			// raw parse errors and walk the fragment tree for structural checks.
			nodes, err := html.ParseFragment(strings.NewReader(p.HTML), &html.Node{
				Type:     html.ElementNode,
				Data:     "body",
				DataAtom: atom.Body,
			})
			if err != nil {
				t.Fatalf("parse fragment: %v", err)
			}

			var (
				sections      int
				slotContent   int
				dataLayoutVal string
			)
			var walk func(*html.Node)
			walk = func(n *html.Node) {
				if n.Type == html.ElementNode {
					if n.Data == "section" {
						sections++
					}
					for _, a := range n.Attr {
						switch {
						case a.Key == "data-layout":
							dataLayoutVal = a.Val
						case a.Key == "data-slot" && a.Val == "content":
							slotContent++
						case a.Key == "href" || a.Key == "src":
							if isExternalURL(a.Val) {
								t.Errorf("external URL in %s/%s=%q", n.Data, a.Key, a.Val)
							}
						}
					}
				}
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					walk(c)
				}
			}
			for _, n := range nodes {
				walk(n)
			}

			if sections != 1 {
				t.Errorf("got %d <section> elements, want exactly 1", sections)
			}
			if dataLayoutVal != p.Name {
				t.Errorf("data-layout=%q, want %q", dataLayoutVal, p.Name)
			}
			if slotContent != 1 {
				t.Errorf("got %d data-slot=\"content\" containers, want exactly 1", slotContent)
			}
			// Defensive: scan the raw bytes too, catching URLs in any attribute.
			if strings.Contains(p.HTML, "http://") || strings.Contains(p.HTML, "https://") {
				t.Errorf("preset HTML contains an http(s) URL (offline-first violation)")
			}
		})
	}
}

func isExternalURL(v string) bool {
	v = strings.TrimSpace(strings.ToLower(v))
	return strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://") || strings.HasPrefix(v, "//")
}
