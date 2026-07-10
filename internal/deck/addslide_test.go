package deck

import (
	"bytes"
	"strings"
	"testing"

	"github.com/Loxstomper/decks/internal/validate"
)

// TestInsertStarterSlide_ByteStableRest verifies that inserting a slide leaves
// every byte outside the insertion point untouched (spec principles-and-invariants round-trip).
func TestInsertStarterSlide_ByteStableRest(t *testing.T) {
	src := strings.ReplaceAll(deckHTML, "{{DECK_NAME}}", "sample")
	out, err := insertStarterSlide([]byte(src))
	if err != nil {
		t.Fatalf("insertStarterSlide: %v", err)
	}

	// The output must be strictly longer (we added a section).
	if len(out) <= len(src) {
		t.Fatalf("expected output to grow, got %d <= %d", len(out), len(src))
	}

	// Removing the inserted region must reproduce the original bytes exactly.
	// The insertion is contiguous, so out == prefix + insertion + suffix where
	// prefix and suffix are slices of src. We reconstruct src by deleting the
	// added bytes: find the longest common prefix and suffix with src.
	pre := commonPrefix(src, string(out))
	suf := commonSuffix(src[pre:], string(out)[pre:])
	reconstructed := string(out)[:pre] + string(out)[len(out)-suf:]
	if reconstructed != src {
		t.Fatalf("surrounding bytes changed:\n got: %q\nwant: %q", reconstructed, src)
	}

	// The new slide must sit before the .slides closing </div>.
	if !bytes.Contains(out, []byte("<h2>New slide</h2>")) {
		t.Fatalf("inserted slide content missing from output")
	}
}

// TestInsertStarterSlide_ProducesValidSlide verifies the appended slide keeps
// the deck valid (well-formed; no broken layout attributes).
func TestInsertStarterSlide_ProducesValidSlide(t *testing.T) {
	src := strings.ReplaceAll(deckHTML, "{{DECK_NAME}}", "sample")
	out, err := insertStarterSlide([]byte(src))
	if err != nil {
		t.Fatalf("insertStarterSlide: %v", err)
	}
	// Validate without a deck dir so asset existence (vendor files) is skipped;
	// we only care that the structural edit stays well-formed and spec-clean.
	res := validate.Bytes(out, "")
	if !res.OK {
		t.Fatalf("expected valid deck after add-slide, got: %+v", res.Errors)
	}
	// Exactly one more <section> than before.
	if got, want := bytes.Count(out, []byte("<section")), bytes.Count([]byte(src), []byte("<section"))+1; got != want {
		t.Fatalf("section count = %d, want %d", got, want)
	}
}

// TestAddSlide_RoundTrip exercises the full disk path: scaffold a deck, add a
// slide, and confirm the deck still validates against its (vendored) assets.
func TestAddSlide_RoundTrip(t *testing.T) {
	root := t.TempDir()
	if err := New(root, "talk"); err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := AddSlide(root, "talk"); err != nil {
		t.Fatalf("AddSlide: %v", err)
	}
	res, err := validate.Deck(DeckPath(root, "talk"))
	if err != nil {
		t.Fatalf("validate.Deck: %v", err)
	}
	if !res.OK {
		t.Fatalf("deck invalid after add-slide: %+v", res.Errors)
	}
}

// TestScaffoldedDeckValidates confirms a freshly scaffolded deck passes
// validation, including asset existence of every vendored file it references.
func TestScaffoldedDeckValidates(t *testing.T) {
	root := t.TempDir()
	if err := New(root, "fresh"); err != nil {
		t.Fatalf("New: %v", err)
	}
	res, err := validate.Deck(DeckPath(root, "fresh"))
	if err != nil {
		t.Fatalf("validate.Deck: %v", err)
	}
	if !res.OK {
		t.Fatalf("scaffolded deck should validate clean, got: %+v", res.Errors)
	}
}

func commonPrefix(a, b string) int {
	n := 0
	for n < len(a) && n < len(b) && a[n] == b[n] {
		n++
	}
	return n
}

func commonSuffix(a, b string) int {
	n := 0
	for n < len(a) && n < len(b) && a[len(a)-1-n] == b[len(b)-1-n] {
		n++
	}
	return n
}
