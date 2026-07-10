// Package validate implements `decks validate`: an independent, spec-driven
// checker for deck.html files (spec claude-code-integration "the sleeper feature", spec principles-and-invariants validation
// + offline-first).
//
// WHY a separate Go validator (it does NOT reuse the TS model):
//
// The editor's byte-stable parse→model→serialize round-trip lives in the
// TypeScript model (web/src/lib/model). That code is the source of truth for
// *editing*. This Go package deliberately re-implements the SAME spec rules
// independently so that decks authored OUTSIDE the editor — by Claude Code or a
// human hand-editing HTML — can be gated before they reach the canvas
// (spec claude-code-integration: "Run by both Claude Code and the editor's save path, so malformed
// decks are caught instead of silently breaking the canvas"). Two independent
// implementations of one contract is intentional: it catches drift in either.
//
// The checks (spec claude-code-integration / principles-and-invariants / layout-vocabulary):
//
//	(a) data-lay / data-align / data-justify and numeric data-* values are in
//	    the ALLOWED sets (the layout contract, spec layout-vocabulary).
//	(b) data-eid uniqueness (no duplicates — stable ids must be unique to target).
//	(c) asset existence: referenced relative srcs/hrefs resolve to files that
//	    exist under the deck folder (excluding http(s):// and data: URLs).
//	(d) parse / well-formedness: the HTML parses and tags are balanced enough to
//	    be safe to render. We use golang.org/x/net/html's tokenizer to detect
//	    gross malformation (mismatched / unclosed / stray tags, tokenizer errors).
//	(e) offline guard (cross-cutting X-1, spec principles-and-invariants): ZERO external http(s):// (or
//	    protocol-relative //) resource URLs — every dependency must be vendored.
package validate

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// Issue is a single validation diagnostic. Line and EID are best-effort context
// (omitted from JSON when zero/empty) so callers can point the author at the
// offending element.
type Issue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Line    int    `json:"line,omitempty"`
	EID     string `json:"eid,omitempty"`
}

// Result is the outcome of validating a deck. OK is true only when Errors is
// empty. It marshals directly to the HTTP endpoint's JSON contract:
//
//	{"ok":bool,"errors":[{"code","message","line"?,"eid"?}]}
type Result struct {
	OK     bool    `json:"ok"`
	Errors []Issue `json:"errors"`
}

// Allowed enum sets — the layout contract (spec layout-vocabulary). These mirror the TS
// LayValue / AlignValue / JustifyValue unions in web/src/lib/model/layout.ts,
// kept in sync by hand (see package doc on why duplication is intentional).
//
// allowedTheme mirrors THEME_NAMES in web/src/lib/model/theme.ts (P10).
// Both lists must stay identical — they are independent re-implementations of
// the same spec contract (same reason as layout: catch drift in either).
var (
	allowedLay     = map[string]bool{"stack": true, "row": true, "grid": true, "layers": true}
	allowedAlign   = map[string]bool{"start": true, "center": true, "end": true, "stretch": true}
	allowedJustify = map[string]bool{"start": true, "center": true, "end": true, "between": true, "around": true}
	// allowedTheme — bundled reveal.js theme names (spec P10). Keep in sync with
	// THEME_NAMES in web/src/lib/model/theme.ts.
	allowedTheme = map[string]bool{
		"black": true, "white": true, "league": true, "beige": true,
		"night": true, "moon": true, "solarized": true, "solarized-dark": true,
		"dracula": true, "sky": true,
	}
)

// voidElements never have an end tag (HTML5 void elements). They are skipped by
// the tag-balance check so a self-closing <img>/<br>/<meta> is not flagged as
// "unclosed".
var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}

// optionalEndElements may legally omit their end tag in HTML5 (the parser infers
// it). We exclude them from strict balance checking so valid markup like
// "<li>a<li>b" or "<td>x<td>y" is not reported as malformed. Their content is
// still tokenized; we simply do not require a matching close.
var optionalEndElements = map[string]bool{
	"p": true, "li": true, "dt": true, "dd": true, "td": true, "th": true,
	"tr": true, "thead": true, "tbody": true, "tfoot": true, "option": true,
	"optgroup": true, "colgroup": true, "rp": true, "rt": true,
}

// resourceAttr maps an element name to the attribute that carries a resource
// URL we must (a) verify exists on disk when relative and (b) reject when
// external. Only attributes that reference loadable assets are listed; <a href>
// is intentionally excluded (it is navigation, commonly a "#" fragment).
var resourceAttr = map[string]string{
	"img":    "src",
	"script": "src",
	"link":   "href",
	"video":  "src",
	"audio":  "src",
	"source": "src",
	"track":  "src",
	"iframe": "src",
	"embed":  "src",
}

// Deck validates decks/<name>'s deck.html on disk. deckDir is the deck folder
// (…/decks/<name>); relative asset references are resolved against it.
func Deck(deckDir string) (Result, error) {
	src, err := os.ReadFile(filepath.Join(deckDir, "deck.html"))
	if err != nil {
		return Result{}, fmt.Errorf("validate: read deck.html: %w", err)
	}
	return Bytes(src, deckDir), nil
}

// Bytes validates raw deck HTML. deckDir is used only to resolve relative asset
// references for the existence check; pass "" to skip asset existence (the enum,
// eid, well-formedness, and external-URL checks still run).
//
// All checks run in a SINGLE tokenizer pass so every Issue can carry a line
// number. The x/net/html tokenizer is a streaming HTML5 tokenizer: it never
// "fixes up" the tree the way html.Parse does, which is exactly what we want —
// we are validating the author's literal bytes, not a normalized DOM.
func Bytes(src []byte, deckDir string) Result {
	var issues []Issue

	z := html.NewTokenizer(strings.NewReader(string(src)))

	// line tracks the 1-based starting line of the current token by counting
	// newlines consumed in prior tokens' raw bytes.
	line := 1
	consumed := 0

	// seenEIDs maps a data-eid to the line it first appeared on, so a duplicate
	// can name where the collision is.
	seenEIDs := map[string]int{}

	// openStack is the balance stack of "must-close" elements (non-void,
	// non-optional). Each entry remembers the tag and its line for diagnostics.
	type openTag struct {
		name string
		line int
	}
	var openStack []openTag

tokenize:
	for {
		tt := z.Next()
		// The starting line of this token is 1 + all newlines consumed before it.
		line = 1 + consumed
		raw := z.Raw()
		consumed += strings.Count(string(raw), "\n")

		switch tt {
		case html.ErrorToken:
			err := z.Err()
			if err == io.EOF {
				break tokenize
			}
			// A non-EOF tokenizer error means the bytes could not be tokenized at
			// all — gross malformation (spec claude-code-integration (d)).
			issues = append(issues, Issue{
				Code:    "malformed-html",
				Message: "HTML could not be tokenized: " + err.Error(),
				Line:    line,
			})
			break tokenize

		case html.StartTagToken, html.SelfClosingTagToken:
			nameBytes, hasAttr := z.TagName()
			name := strings.ToLower(string(nameBytes))

			// Collect attributes into a map for this element (last value wins,
			// matching browser behaviour).
			attrs := map[string]string{}
			if hasAttr {
				for {
					k, v, more := z.TagAttr()
					attrs[strings.ToLower(string(k))] = string(v)
					if !more {
						break
					}
				}
			}

			issues = append(issues, checkElement(name, attrs, line, seenEIDs, deckDir)...)

			// Tag-balance bookkeeping (well-formedness, spec claude-code-integration (d)).
			// SelfClosingTagToken (<x/>) and void elements never open a scope.
			if tt == html.StartTagToken && !voidElements[name] && !optionalEndElements[name] {
				openStack = append(openStack, openTag{name: name, line: line})
			}

		case html.EndTagToken:
			nameBytes, _ := z.TagName()
			name := strings.ToLower(string(nameBytes))
			if voidElements[name] || optionalEndElements[name] {
				continue // not tracked on the stack
			}
			if len(openStack) == 0 {
				issues = append(issues, Issue{
					Code:    "malformed-html",
					Message: fmt.Sprintf("stray closing tag </%s> with no matching open tag", name),
					Line:    line,
				})
				continue
			}
			top := openStack[len(openStack)-1]
			if top.name != name {
				// Mismatched nesting (e.g. <div><span></div>) — proper nesting is
				// required for the tracked element set.
				issues = append(issues, Issue{
					Code:    "malformed-html",
					Message: fmt.Sprintf("mismatched closing tag </%s>: expected </%s> (opened at line %d)", name, top.name, top.line),
					Line:    line,
				})
				continue
			}
			openStack = openStack[:len(openStack)-1]
		}
	}

	// Anything left open at EOF was never closed.
	for _, o := range openStack {
		issues = append(issues, Issue{
			Code:    "malformed-html",
			Message: fmt.Sprintf("unclosed <%s> tag", o.name),
			Line:    o.line,
		})
	}

	return Result{OK: len(issues) == 0, Errors: issues}
}

// checkElement runs the per-element spec checks (enums, numerics, eid
// uniqueness, asset existence, external URLs) and returns any issues.
func checkElement(name string, attrs map[string]string, line int, seenEIDs map[string]int, deckDir string) []Issue {
	var issues []Issue
	eid := attrs["data-eid"]

	// (b) data-eid uniqueness.
	if eid != "" {
		if first, dup := seenEIDs[eid]; dup {
			issues = append(issues, Issue{
				Code:    "duplicate-eid",
				Message: fmt.Sprintf("duplicate data-eid %q (first seen at line %d)", eid, first),
				Line:    line,
				EID:     eid,
			})
		} else {
			seenEIDs[eid] = line
		}
	}

	// (a) enum attributes.
	if v, ok := attrs["data-lay"]; ok && !allowedLay[v] {
		issues = append(issues, enumIssue("data-lay", v, "stack|row|grid|layers", line, eid))
	}
	if v, ok := attrs["data-align"]; ok && !allowedAlign[v] {
		issues = append(issues, enumIssue("data-align", v, "start|center|end|stretch", line, eid))
	}
	if v, ok := attrs["data-justify"]; ok && !allowedJustify[v] {
		issues = append(issues, enumIssue("data-justify", v, "start|center|end|between|around", line, eid))
	}
	if v, ok := attrs["data-visibility"]; ok && v != "hidden" {
		// Only data-visibility="hidden" is defined (the slide-hide flag, layout
		// contract). Any other value is a typo that would silently do nothing.
		issues = append(issues, enumIssue("data-visibility", v, "hidden", line, eid))
	}
	// data-theme is only meaningful on <section> elements (P10). Any value not in
	// the bundled theme list is flagged. data-background-color is a reveal.js
	// pass-through attribute and is always tolerated (no validation). Inline
	// --r-* CSS custom properties in style= are also silently tolerated so that
	// P10-3/4 output passes validation without changes here.
	if v, ok := attrs["data-theme"]; ok && name == "section" && !allowedTheme[v] {
		issues = append(issues, enumIssue("data-theme", v,
			"black|white|league|beige|night|moon|solarized|solarized-dark|dracula|sky", line, eid))
	}

	// data-background-* set (reveal.js per-slide background, spec theming-and-styles). ALL of
	// these are TOLERATED with no enum: -color, -size, -position, -repeat,
	// -opacity, -gradient, -video-loop, -video-muted are plain pass-through
	// strings reveal.js renders natively in 5.x. The two that reference loadable
	// assets — data-background-image and data-background-video — get the same
	// treatment as <img src>/<video src>: the offline X-1 guard flags http(s)://
	// values, and LOCAL relative paths are asset-existence-checked. Everything
	// else passes through untouched.
	//
	// Dual-encoded: also see getThemeProps/setThemeProps + BACKGROUND_ATTRS in
	// web/src/lib/model/theme.ts (keep the attribute set in sync). The TS model
	// round-trips the whole set; this validator only constrains the two asset
	// references and the offline guard.
	for _, bgAsset := range []string{"data-background-image", "data-background-video"} {
		if v, ok := attrs[bgAsset]; ok {
			issues = append(issues, checkResourceURL(name, bgAsset, v, line, eid, deckDir)...)
		}
	}

	// data-layout (P14): layout-preset MARKER on <section> elements.
	// Intentionally NOT enum-restricted — the value is the preset name (e.g.
	// "title-body", "two-column") chosen from the preset list, but that list is
	// open-ended and must not be encoded here to avoid coupling. Any non-empty
	// string is valid; the marker has no reflow semantics of its own.
	// Dual-encoded: also see getLayoutMarker/setLayoutMarker in
	// web/src/lib/model/layout.ts (keep in sync on attribute name).
	if v, ok := attrs["data-layout"]; ok && name == "section" && strings.TrimSpace(v) == "" {
		issues = append(issues, Issue{
			Code:    "invalid-attr",
			Message: "data-layout on <section> must be a non-empty string (preset name)",
			Line:    line,
			EID:     eid,
		})
	}

	// data-slot (P14): named-slot MARKER on any element.
	// Identifies the semantic role of a container within a preset layout (e.g.
	// "content", "sidebar"). Any non-empty string is valid; the attribute has no
	// reflow semantics of its own — it is purely informational for preset tooling.
	// Dual-encoded: also see getSlot/setSlot in web/src/lib/model/layout.ts
	// (keep in sync on attribute name).
	if v, ok := attrs["data-slot"]; ok && strings.TrimSpace(v) == "" {
		issues = append(issues, Issue{
			Code:    "invalid-attr",
			Message: "data-slot must be a non-empty string (slot name)",
			Line:    line,
			EID:     eid,
		})
	}

	// data-chart / data-chart-data (P17-15): Chart.js chart block on a <canvas>.
	//   • data-chart      — the chart TYPE string ("bar", "line", "pie", …). Any
	//                       non-empty string is valid (the Chart.js type list is
	//                       open-ended; do not enum-couple it here). Empty → error.
	//   • data-chart-data — a JSON Chart.js config `{type, data, options?}` the
	//                       runtime plugin JSON.parses. It MUST be present and
	//                       parse as JSON; malformed JSON is flagged invalid-attr.
	// Dual-encoded: also see getChartProps/setChartProps in
	// web/src/lib/model/layout.ts and the canvas-data-chart leaf rule in
	// web/src/lib/model/classify.ts (keep in sync on the attribute names).
	if v, ok := attrs["data-chart"]; ok {
		if strings.TrimSpace(v) == "" {
			issues = append(issues, Issue{
				Code:    "invalid-attr",
				Message: "data-chart must be a non-empty string (chart type)",
				Line:    line,
				EID:     eid,
			})
		}
		// A chart marker implies a data config; require it to be present + parseable.
		raw, hasData := attrs["data-chart-data"]
		if !hasData {
			issues = append(issues, Issue{
				Code:    "invalid-attr",
				Message: "data-chart requires a data-chart-data JSON config attribute",
				Line:    line,
				EID:     eid,
			})
		} else if !json.Valid([]byte(raw)) {
			issues = append(issues, Issue{
				Code:    "invalid-attr",
				Message: "data-chart-data must be parseable JSON (Chart.js config)",
				Line:    line,
				EID:     eid,
			})
		}
	} else if raw, ok := attrs["data-chart-data"]; ok && !json.Valid([]byte(raw)) {
		// data-chart-data present without data-chart (unusual) — still validate it.
		issues = append(issues, Issue{
			Code:    "invalid-attr",
			Message: "data-chart-data must be parseable JSON (Chart.js config)",
			Line:    line,
			EID:     eid,
		})
	}
	// data-qr / data-qr-* (P19): QR code block on a <div>.
	//   • data-qr       — the encoded PAYLOAD (URL/text). Any non-empty string is
	//                      valid; empty → error (nothing to encode).
	//   • data-qr-ec    — error-correction level, one of L | M | Q | H. Other
	//                      values are rejected (the generator only accepts these).
	//   • data-qr-quiet — quiet-zone width in modules, a non-negative integer
	//                      (validated with the numeric attributes below).
	//   • data-qr-fg / data-qr-bg — free-form colour strings (no constraint here).
	// Dual-encoded: also see getQrProps/setQrProps in web/src/lib/model/layout.ts
	// and the div-data-qr leaf rule in web/src/lib/model/classify.ts (keep in sync
	// on the attribute names and the EC enum).
	if v, ok := attrs["data-qr"]; ok && strings.TrimSpace(v) == "" {
		issues = append(issues, Issue{
			Code:    "invalid-attr",
			Message: "data-qr must be a non-empty string (the encoded payload)",
			Line:    line,
			EID:     eid,
		})
	}
	if v, ok := attrs["data-qr-ec"]; ok {
		switch strings.TrimSpace(v) {
		case "L", "M", "Q", "H":
			// valid
		default:
			issues = append(issues, Issue{
				Code:    "invalid-attr",
				Message: fmt.Sprintf("data-qr-ec=%q must be one of L, M, Q, H", v),
				Line:    line,
				EID:     eid,
			})
		}
	}

	// data-footer-hidden (P17-18): boolean MARKER on a <section> opting that slide
	// out of the deck-level footer overlay (a managed custom.css rule keyed off
	// section:not([data-footer-hidden])). It is presence-only — any value (incl.
	// the empty boolean-attribute form) is tolerated, so there is nothing to
	// reject here; the clause documents the recognised attribute and keeps the
	// contract dual-encoded with getFooterHidden/setFooterHidden in
	// web/src/lib/model/layout.ts (keep in sync on the attribute name).
	_ = attrs["data-footer-hidden"]

	// (a) numeric attributes. gap/pad/grow are non-negative integers; span is a
	// positive integer (>=1). These are the documented integer attributes of the
	// layout contract.
	for _, n := range []struct {
		attr string
		min  int
	}{
		{"data-gap", 0}, {"data-pad", 0}, {"data-grow", 0}, {"data-span", 1},
		// data-autoslide (P17-20): reveal-native per-slide auto-advance, in ms.
		// Non-negative integer (0 = pause on this slide). Only emitted on
		// <section> by the editor, but validated wherever present.
		{"data-autoslide", 0},
		// data-qr-quiet (P19): QR quiet-zone width in modules. Non-negative int.
		{"data-qr-quiet", 0},
	} {
		if v, ok := attrs[n.attr]; ok {
			if iv, err := strconv.Atoi(strings.TrimSpace(v)); err != nil || iv < n.min {
				issues = append(issues, Issue{
					Code:    "invalid-numeric",
					Message: fmt.Sprintf("%s=%q must be an integer >= %d", n.attr, v, n.min),
					Line:    line,
					EID:     eid,
				})
			}
		}
	}

	// Free-element coordinates: numeric (floats allowed); w/h must be >= 0.
	for _, n := range []struct {
		attr   string
		nonNeg bool
	}{
		{"data-x", false}, {"data-y", false}, {"data-rot", false},
		{"data-w", true}, {"data-h", true},
	} {
		if v, ok := attrs[n.attr]; ok {
			fv, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
			if err != nil || (n.nonNeg && fv < 0) {
				bound := "a number"
				if n.nonNeg {
					bound = "a number >= 0"
				}
				issues = append(issues, Issue{
					Code:    "invalid-numeric",
					Message: fmt.Sprintf("%s=%q must be %s", n.attr, v, bound),
					Line:    line,
					EID:     eid,
				})
			}
		}
	}

	// (c)/(e) resource URLs: external-URL guard + asset existence.
	if attr, ok := resourceAttr[name]; ok {
		if url, present := attrs[attr]; present {
			issues = append(issues, checkResourceURL(name, attr, url, line, eid, deckDir)...)
		}
	}

	return issues
}

// enumIssue builds an "invalid-enum" diagnostic.
func enumIssue(attr, got, allowed string, line int, eid string) Issue {
	return Issue{
		Code:    "invalid-enum",
		Message: fmt.Sprintf("%s=%q is not allowed (expected one of %s)", attr, got, allowed),
		Line:    line,
		EID:     eid,
	}
}

// checkResourceURL enforces the offline guard (no external URLs) and asset
// existence for a single resource reference.
func checkResourceURL(tag, attr, url string, line int, eid, deckDir string) []Issue {
	raw := strings.TrimSpace(url)
	if raw == "" {
		return nil
	}

	lower := strings.ToLower(raw)

	// (e) Offline guard (X-1, spec principles-and-invariants): zero external resource URLs. http(s)://
	// and protocol-relative // both reach the network.
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(raw, "//") {
		return []Issue{{
			Code:    "external-url",
			Message: fmt.Sprintf("<%s %s=%q> is an external URL; decks must be offline-first (vendor it locally, spec principles-and-invariants)", tag, attr, url),
			Line:    line,
			EID:     eid,
		}}
	}

	// Non-file schemes that are legitimately offline/inline: skip existence.
	if strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") || strings.HasPrefix(raw, "#") {
		return nil
	}

	// (c) Asset existence: only meaningful when we know the deck folder.
	if deckDir == "" {
		return nil
	}

	// Strip query/fragment so "img/x.png?v=2#a" resolves to the file.
	path := raw
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	path = filepath.FromSlash(path)

	// Resolve relative to the deck folder and confine to it: a reference that
	// escapes the deck (../../etc/passwd) is itself an error — decks are
	// self-contained (spec principles-and-invariants).
	resolved := filepath.Join(deckDir, path)
	rel, err := filepath.Rel(deckDir, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return []Issue{{
			Code:    "asset-escapes-deck",
			Message: fmt.Sprintf("<%s %s=%q> resolves outside the deck folder; decks must be self-contained", tag, attr, url),
			Line:    line,
			EID:     eid,
		}}
	}

	if _, err := os.Stat(resolved); err != nil {
		return []Issue{{
			Code:    "missing-asset",
			Message: fmt.Sprintf("<%s %s=%q> references a file that does not exist in the deck", tag, attr, url),
			Line:    line,
			EID:     eid,
		}}
	}
	return nil
}
