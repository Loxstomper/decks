package deck

import (
	"strings"
	"testing"
)

const autoslideInitFixture = `<html><body>
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

// TestSetRevealAutoSlide_Insert verifies autoSlide + loop are inserted at the
// top of the init object with the surrounding indentation.
func TestSetRevealAutoSlide_Insert(t *testing.T) {
	out, changed := setRevealAutoSlide(autoslideInitFixture, 3000, true)
	if !changed {
		t.Fatal("expected changed=true on first insert")
	}
	if !contains(out, "autoSlide: 3000,") {
		t.Errorf("missing autoSlide line:\n%s", out)
	}
	if !contains(out, "loop: true,") {
		t.Errorf("missing loop line:\n%s", out)
	}
}

// TestSetRevealAutoSlide_Idempotent verifies re-applying the same config is a
// byte-stable no-op.
func TestSetRevealAutoSlide_Idempotent(t *testing.T) {
	once, _ := setRevealAutoSlide(autoslideInitFixture, 3000, true)
	twice, changed := setRevealAutoSlide(once, 3000, true)
	if changed {
		t.Error("expected changed=false when config already matches")
	}
	if once != twice {
		t.Errorf("not idempotent:\nonce=%q\ntwice=%q", once, twice)
	}
}

// TestSetRevealAutoSlide_Replace verifies an existing value is replaced (not
// duplicated), preserving indentation.
func TestSetRevealAutoSlide_Replace(t *testing.T) {
	once, _ := setRevealAutoSlide(autoslideInitFixture, 3000, false)
	out, changed := setRevealAutoSlide(once, 5000, false)
	if !changed {
		t.Fatal("expected changed=true when ms differs")
	}
	if !contains(out, "autoSlide: 5000,") {
		t.Errorf("missing replaced autoSlide value:\n%s", out)
	}
	if countSubstr(out, "autoSlide:") != 1 {
		t.Errorf("expected exactly one autoSlide line, got %d", countSubstr(out, "autoSlide:"))
	}
}

// TestSetRevealAutoSlide_Remove verifies ms<=0 / loop=false remove the keys and
// that removing absent keys is a no-op (changed=false, unchanged bytes).
func TestSetRevealAutoSlide_Remove(t *testing.T) {
	withCfg, _ := setRevealAutoSlide(autoslideInitFixture, 3000, true)
	out, changed := setRevealAutoSlide(withCfg, 0, false)
	if !changed {
		t.Fatal("expected changed=true when removing keys")
	}
	if contains(out, "autoSlide:") || contains(out, "loop:") {
		t.Errorf("keys should be removed:\n%s", out)
	}
	// Removing from a deck with no keys is byte-stable.
	out2, changed2 := setRevealAutoSlide(out, 0, false)
	if changed2 || out2 != out {
		t.Error("removing absent keys should be a no-op")
	}
}

// TestSetRevealAutoSlide_NoMarker returns unchanged when there is no
// Reveal.initialize call.
func TestSetRevealAutoSlide_NoMarker(t *testing.T) {
	in := "<html><body>no init</body></html>"
	out, changed := setRevealAutoSlide(in, 3000, true)
	if changed || out != in {
		t.Error("expected unchanged output with no Reveal.initialize marker")
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }

func countSubstr(s, sub string) int { return strings.Count(s, sub) }
