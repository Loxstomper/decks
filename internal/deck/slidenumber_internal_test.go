package deck

import (
	"strings"
	"testing"
)

const slideNumberInitFixture = `<html><body>
  <script>
    Reveal.initialize({
      width: 1920,
      height: 1080,
      hash: true,
      slideNumber: false,
      transition: 'slide',
      plugins: [ RevealHighlight ]
    });
  </script>
</body></html>`

// TestSetSlideNumber_Enable verifies enabling sets a quoted format token and
// replaces the scaffold's `slideNumber: false` in place (no duplicate key).
func TestSetSlideNumber_Enable(t *testing.T) {
	out, changed := setSlideNumber(slideNumberInitFixture, true, "c/t")
	if !changed {
		t.Fatal("expected changed=true when enabling")
	}
	if !strings.Contains(out, "slideNumber: 'c/t',") {
		t.Errorf("missing quoted slideNumber format:\n%s", out)
	}
	if strings.Count(out, "slideNumber:") != 1 {
		t.Errorf("expected exactly one slideNumber line, got %d", strings.Count(out, "slideNumber:"))
	}
}

// TestSetSlideNumber_DefaultFormat verifies an empty format falls back to 'c/t'.
func TestSetSlideNumber_DefaultFormat(t *testing.T) {
	out, _ := setSlideNumber(slideNumberInitFixture, true, "")
	if !strings.Contains(out, "slideNumber: 'c/t',") {
		t.Errorf("expected default 'c/t' format:\n%s", out)
	}
}

// TestSetSlideNumber_DisableByteStable verifies disabling on the scaffold (which
// already ships `slideNumber: false`) is a byte-stable no-op.
func TestSetSlideNumber_DisableByteStable(t *testing.T) {
	out, changed := setSlideNumber(slideNumberInitFixture, false, "")
	if changed {
		t.Error("expected changed=false: scaffold already has slideNumber: false")
	}
	if out != slideNumberInitFixture {
		t.Errorf("disable should be byte-stable on scaffold:\n%s", out)
	}
}

// TestSetSlideNumber_Idempotent verifies re-applying the same enabled config is a
// byte-stable no-op.
func TestSetSlideNumber_Idempotent(t *testing.T) {
	once, _ := setSlideNumber(slideNumberInitFixture, true, "c")
	twice, changed := setSlideNumber(once, true, "c")
	if changed {
		t.Error("expected changed=false when config already matches")
	}
	if once != twice {
		t.Errorf("not idempotent:\nonce=%q\ntwice=%q", once, twice)
	}
}

// TestSetSlideNumber_Roundtrip verifies enable→disable returns to the original
// scaffold bytes (the key is replaced, never duplicated/removed).
func TestSetSlideNumber_Roundtrip(t *testing.T) {
	enabled, _ := setSlideNumber(slideNumberInitFixture, true, "c/t")
	disabled, changed := setSlideNumber(enabled, false, "")
	if !changed {
		t.Fatal("expected changed=true when toggling back off")
	}
	if disabled != slideNumberInitFixture {
		t.Errorf("disable after enable should restore scaffold bytes:\ngot:\n%s", disabled)
	}
}

// TestSetSlideNumber_NoMarker returns unchanged when there is no Reveal.initialize.
func TestSetSlideNumber_NoMarker(t *testing.T) {
	in := "<html><body>no init</body></html>"
	out, changed := setSlideNumber(in, true, "c/t")
	if changed || out != in {
		t.Error("expected unchanged output with no Reveal.initialize marker")
	}
}
