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
