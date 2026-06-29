package validate

import (
	"os"
	"path/filepath"
	"testing"
)

// hasCode reports whether res contains an issue with the given code.
func hasCode(res Result, code string) bool {
	for _, e := range res.Errors {
		if e.Code == code {
			return true
		}
	}
	return false
}

// validDeckHTML is a minimal, well-formed, offline deck that should pass every
// check (no external URLs; the one asset reference is created on disk by the
// test that uses asset resolution).
const validDeckHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ok</title>
  <link rel="stylesheet" href="custom.css" />
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section data-eid="s1">
        <div data-lay="row" data-gap="64" data-align="center" data-justify="between">
          <h2 data-eid="t1">Title</h2>
          <p data-eid="p1" data-grow="1">Body</p>
        </div>
      </section>
    </div>
  </div>
</body>
</html>
`

func TestValidate_CleanPasses(t *testing.T) {
	// No deckDir → asset existence skipped; everything else must pass.
	res := Bytes([]byte(validDeckHTML), "")
	if !res.OK {
		t.Fatalf("expected clean HTML to pass, got: %+v", res.Errors)
	}
}

func TestValidate_DuplicateEID(t *testing.T) {
	html := `<section data-eid="dup"><p data-eid="dup">x</p></section>`
	res := Bytes([]byte(html), "")
	if res.OK || !hasCode(res, "duplicate-eid") {
		t.Fatalf("expected duplicate-eid, got: %+v", res.Errors)
	}
}

func TestValidate_InvalidEnum(t *testing.T) {
	cases := []string{
		`<div data-lay="diagonal">x</div>`,
		`<div data-lay="row" data-align="middle">x</div>`,
		`<div data-lay="row" data-justify="spaced">x</div>`,
		`<section data-visibility="gone">x</section>`,
	}
	for _, c := range cases {
		res := Bytes([]byte(c), "")
		if res.OK || !hasCode(res, "invalid-enum") {
			t.Fatalf("expected invalid-enum for %q, got: %+v", c, res.Errors)
		}
	}
}

func TestValidate_InvalidNumeric(t *testing.T) {
	cases := []string{
		`<div data-lay="row" data-gap="-1">x</div>`,
		`<div data-lay="row" data-gap="lots">x</div>`,
		`<div data-span="0">x</div>`,
		`<div data-free data-w="-5">x</div>`,
	}
	for _, c := range cases {
		res := Bytes([]byte(c), "")
		if res.OK || !hasCode(res, "invalid-numeric") {
			t.Fatalf("expected invalid-numeric for %q, got: %+v", c, res.Errors)
		}
	}
}

func TestValidate_MissingAsset(t *testing.T) {
	dir := t.TempDir()
	html := `<section><img data-eid="i1" src="assets/nope.png" /></section>`
	res := Bytes([]byte(html), dir)
	if res.OK || !hasCode(res, "missing-asset") {
		t.Fatalf("expected missing-asset, got: %+v", res.Errors)
	}

	// Now create the file → the check should pass.
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "nope.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	res2 := Bytes([]byte(html), dir)
	if hasCode(res2, "missing-asset") {
		t.Fatalf("expected asset to resolve once created, got: %+v", res2.Errors)
	}
}

func TestValidate_ExternalURL(t *testing.T) {
	cases := []string{
		`<script src="https://cdn.example.com/x.js"></script>`,
		`<link rel="stylesheet" href="http://example.com/a.css" />`,
		`<img src="//example.com/a.png" />`,
	}
	for _, c := range cases {
		res := Bytes([]byte(c), "")
		if res.OK || !hasCode(res, "external-url") {
			t.Fatalf("expected external-url for %q, got: %+v", c, res.Errors)
		}
	}
}

func TestValidate_DataURLAllowed(t *testing.T) {
	// data: URIs are inline/offline and must NOT be flagged.
	html := `<img src="data:image/png;base64,AAAA" />`
	res := Bytes([]byte(html), "")
	if hasCode(res, "external-url") || hasCode(res, "missing-asset") {
		t.Fatalf("data: URI must be allowed, got: %+v", res.Errors)
	}
}

func TestValidate_MalformedHTML(t *testing.T) {
	cases := []string{
		`<section><h1>oops</section>`,   // mismatched close
		`<div><span>unclosed`,           // unclosed at EOF
		`</div>`,                        // stray close
		`<div><span>x</div></span>`,     // crossed nesting
	}
	for _, c := range cases {
		res := Bytes([]byte(c), "")
		if res.OK || !hasCode(res, "malformed-html") {
			t.Fatalf("expected malformed-html for %q, got: %+v", c, res.Errors)
		}
	}
}

func TestValidate_DataThemeValid(t *testing.T) {
	// All bundled theme names must pass validation on a <section>.
	validThemes := []string{
		"black", "white", "league", "beige", "night",
		"moon", "solarized", "solarized-dark", "dracula", "sky",
	}
	for _, theme := range validThemes {
		html := `<section data-eid="s1" data-theme="` + theme + `"><h2 data-eid="t1">ok</h2></section>`
		res := Bytes([]byte(html), "")
		if hasCode(res, "invalid-enum") {
			t.Errorf("data-theme=%q should be valid, got: %+v", theme, res.Errors)
		}
	}
}

func TestValidate_DataThemeInvalid(t *testing.T) {
	// Unknown theme name on a <section> must produce invalid-enum.
	html := `<section data-eid="s1" data-theme="bogus"><h2 data-eid="t1">x</h2></section>`
	res := Bytes([]byte(html), "")
	if res.OK || !hasCode(res, "invalid-enum") {
		t.Fatalf("expected invalid-enum for data-theme=bogus, got: %+v", res.Errors)
	}
}

func TestValidate_DataThemeOnNonSection(t *testing.T) {
	// data-theme on a non-section element is currently a no-op (not validated).
	html := `<div data-theme="bogus">x</div>`
	res := Bytes([]byte(html), "")
	if hasCode(res, "invalid-enum") {
		t.Errorf("data-theme on non-section should not flag invalid-enum, got: %+v", res.Errors)
	}
}

func TestValidate_DataBackgroundColorTolerated(t *testing.T) {
	// data-background-color is a reveal.js pass-through; any value must be
	// accepted without validation errors.
	html := `<section data-eid="s1" data-background-color="#ff0000"><h2 data-eid="t1">x</h2></section>`
	res := Bytes([]byte(html), "")
	if !res.OK {
		t.Fatalf("data-background-color must be tolerated, got: %+v", res.Errors)
	}
}

func TestValidate_DataBackgroundSetTolerated(t *testing.T) {
	// The full data-background-* pass-through set (spec 16) must be tolerated
	// without enum validation: size/position/repeat/opacity/gradient + video flags.
	html := `<section data-eid="s1"` +
		` data-background-size="cover"` +
		` data-background-position="center"` +
		` data-background-repeat="no-repeat"` +
		` data-background-opacity="0.5"` +
		` data-background-gradient="linear-gradient(to bottom, red, blue)"` +
		` data-background-video-loop="true"` +
		` data-background-video-muted="true"` +
		`><h2 data-eid="t1">x</h2></section>`
	res := Bytes([]byte(html), "")
	if !res.OK {
		t.Fatalf("full data-background-* set must be tolerated, got: %+v", res.Errors)
	}
}

func TestValidate_DataBackgroundImageLocalAsset(t *testing.T) {
	dir := t.TempDir()
	// Missing local image → flagged.
	html := `<section data-eid="s1" data-background-image="assets/img/x.png"><h2 data-eid="t1">x</h2></section>`
	res := Bytes([]byte(html), dir)
	if res.OK || !hasCode(res, "missing-asset") {
		t.Fatalf("expected missing-asset for absent background image, got: %+v", res.Errors)
	}

	// Create the file → check passes.
	if err := os.MkdirAll(filepath.Join(dir, "assets", "img"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "img", "x.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	res2 := Bytes([]byte(html), dir)
	if hasCode(res2, "missing-asset") {
		t.Fatalf("expected background image to resolve once created, got: %+v", res2.Errors)
	}
}

func TestValidate_DataBackgroundImageExternalFlagged(t *testing.T) {
	// External http(s):// background image violates the offline X-1 guard.
	html := `<section data-eid="s1" data-background-image="https://example.com/x.png"><h2 data-eid="t1">x</h2></section>`
	res := Bytes([]byte(html), "")
	if res.OK || !hasCode(res, "external-url") {
		t.Fatalf("expected external-url for https background image, got: %+v", res.Errors)
	}
}

func TestValidate_DataBackgroundVideoLocalAndExternal(t *testing.T) {
	dir := t.TempDir()
	// Missing local video → flagged.
	missing := `<section data-eid="s1" data-background-video="assets/v.mp4"><h2 data-eid="t1">x</h2></section>`
	if res := Bytes([]byte(missing), dir); res.OK || !hasCode(res, "missing-asset") {
		t.Fatalf("expected missing-asset for absent background video, got: %+v", res.Errors)
	}
	// External video → offline guard.
	external := `<section data-eid="s1" data-background-video="http://example.com/v.mp4"><h2 data-eid="t1">x</h2></section>`
	if res := Bytes([]byte(external), ""); res.OK || !hasCode(res, "external-url") {
		t.Fatalf("expected external-url for http background video, got: %+v", res.Errors)
	}
	// Present local video → passes.
	if err := os.WriteFile(filepath.Join(dir, "v.mp4"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if res := Bytes([]byte(`<section data-eid="s1" data-background-video="v.mp4"><h2 data-eid="t1">x</h2></section>`), dir); hasCode(res, "missing-asset") {
		t.Fatalf("expected background video to resolve once created, got: %+v", res.Errors)
	}
}

func TestValidate_InlineRVarsTolerated(t *testing.T) {
	// Inline --r-* CSS custom properties in the style attribute must pass
	// through without any validation error (P10-3/4 output).
	html := `<section data-eid="s1" style="--r-background-color:#0a0a0a;--r-main-color:#eee;"><h2 data-eid="t1">x</h2></section>`
	res := Bytes([]byte(html), "")
	if !res.OK {
		t.Fatalf("inline --r-* vars must be tolerated, got: %+v", res.Errors)
	}
}

func TestValidate_AssetEscapesDeck(t *testing.T) {
	dir := t.TempDir()
	html := `<img src="../../etc/passwd" />`
	res := Bytes([]byte(html), dir)
	if res.OK || !hasCode(res, "asset-escapes-deck") {
		t.Fatalf("expected asset-escapes-deck, got: %+v", res.Errors)
	}
}

// TestValidate_DataLayoutMarker verifies that data-layout on a <section> is
// accepted as any non-empty string (P14 layout-preset marker; not enum-restricted).
func TestValidate_DataLayoutMarker(t *testing.T) {
	cases := []string{
		"title-body",
		"two-column",
		"blank",
		"my-custom-preset",
	}
	for _, v := range cases {
		h := `<section data-eid="s1" data-layout="` + v + `"><div data-lay="stack" data-eid="c1"><h2 data-eid="t1">ok</h2></div></section>`
		res := Bytes([]byte(h), "")
		if !res.OK {
			t.Errorf("data-layout=%q on <section> must be valid, got: %+v", v, res.Errors)
		}
	}
}

// TestValidate_DataLayoutEmptyInvalid verifies that an empty data-layout value
// is flagged as invalid-attr.
func TestValidate_DataLayoutEmptyInvalid(t *testing.T) {
	h := `<section data-eid="s1" data-layout=""><div data-lay="stack" data-eid="c1"><h2 data-eid="t1">x</h2></div></section>`
	res := Bytes([]byte(h), "")
	if res.OK || !hasCode(res, "invalid-attr") {
		t.Fatalf("expected invalid-attr for empty data-layout, got: %+v", res.Errors)
	}
}

// TestValidate_DataSlotMarker verifies that data-slot on any element is accepted
// as any non-empty string (P14 named-slot marker; no enum restriction).
func TestValidate_DataSlotMarker(t *testing.T) {
	// data-slot on a section child container and on a section itself.
	h := `<section data-eid="s1" data-layout="two-column">` +
		`<div data-lay="row" data-eid="row1">` +
		`<div data-lay="stack" data-eid="col1" data-slot="content"><h2 data-eid="t1">Main</h2></div>` +
		`<div data-lay="stack" data-eid="col2" data-slot="sidebar"><p data-eid="p1">Side</p></div>` +
		`</div></section>`
	res := Bytes([]byte(h), "")
	if !res.OK {
		t.Fatalf("data-slot on containers must be valid, got: %+v", res.Errors)
	}
}

// TestValidate_DataSlotEmptyInvalid verifies that an empty data-slot value is
// flagged as invalid-attr.
func TestValidate_DataSlotEmptyInvalid(t *testing.T) {
	h := `<section data-eid="s1"><div data-lay="stack" data-eid="c1" data-slot=""><h2 data-eid="t1">x</h2></div></section>`
	res := Bytes([]byte(h), "")
	if res.OK || !hasCode(res, "invalid-attr") {
		t.Fatalf("expected invalid-attr for empty data-slot, got: %+v", res.Errors)
	}
}

// TestValidate_DataLayoutAndSlotTogether verifies a realistic deck using both
// data-layout on a <section> and data-slot on child containers passes cleanly.
func TestValidate_DataLayoutAndSlotTogether(t *testing.T) {
	h := validDeckHTMLWithPreset
	res := Bytes([]byte(h), "")
	if !res.OK {
		t.Fatalf("deck with data-layout + data-slot must pass, got: %+v", res.Errors)
	}
}

// validDeckHTMLWithPreset is a minimal well-formed deck that uses the P14
// data-layout marker on a section and data-slot on child containers.
const validDeckHTMLWithPreset = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>preset-test</title>
  <link rel="stylesheet" href="custom.css" />
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section data-eid="s1" data-layout="two-column">
        <div data-lay="row" data-gap="64" data-eid="row1">
          <div data-lay="stack" data-gap="16" data-grow="1" data-eid="col1" data-slot="content">
            <h2 data-eid="t1">Main Content</h2>
            <p data-eid="p1">Body text goes here.</p>
          </div>
          <div data-lay="stack" data-gap="16" data-grow="1" data-eid="col2" data-slot="sidebar">
            <p data-eid="p2">Sidebar text.</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</body>
</html>
`
