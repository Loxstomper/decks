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

func TestValidate_AssetEscapesDeck(t *testing.T) {
	dir := t.TempDir()
	html := `<img src="../../etc/passwd" />`
	res := Bytes([]byte(html), dir)
	if res.OK || !hasCode(res, "asset-escapes-deck") {
		t.Fatalf("expected asset-escapes-deck, got: %+v", res.Errors)
	}
}
