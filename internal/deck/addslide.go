package deck

import (
	"bytes"
	"fmt"
)

// starterSection is the body of the slide appended by AddSlide. It is a minimal
// VALID reveal.js slide (a heading + paragraph) so the result passes
// `slides validate`. It carries no data-eid — stable ids are stamped by the
// editor model (web/src/lib/model) on load; an author-added slide need not
// predeclare one.
const starterSection = "<section>\n" +
	"%[1]s  <h2>New slide</h2>\n" +
	"%[1]s  <p>Edit this slide.</p>\n" +
	"%[1]s</section>"

// AddSlide appends a starter <section> to decks/<name>/deck.html (spec claude-code-integration
// `slides add-slide`).  It inserts the new slide just before the closing
// </div> of the `.slides` container, matching the existing child indentation,
// and leaves every other byte of the file untouched (byte-stability is a core
// invariant — spec principles-and-invariants idempotent round-trip — so the editor and Claude Code do
// not churn each other's files).
func AddSlide(root, name string) error {
	if err := validateName(name); err != nil {
		return err
	}
	src, err := Read(root, name)
	if err != nil {
		return fmt.Errorf("add-slide: read deck: %w", err)
	}
	out, err := insertStarterSlide(src)
	if err != nil {
		return fmt.Errorf("add-slide: %w", err)
	}
	if err := Write(root, name, out); err != nil {
		return fmt.Errorf("add-slide: write deck: %w", err)
	}
	return nil
}

// insertStarterSlide returns src with a starter <section> inserted before the
// `.slides` container's closing </div>.  It is pure (no I/O) so it is directly
// unit-testable for byte-stability of the surrounding bytes.
//
// WHY locate the close by depth-matching <div>: the `.slides` div nests
// arbitrary <div> containers (the layout primitives, spec layout-vocabulary).  Counting div
// depth from the opening tag finds the correct matching </div> regardless of
// how deeply slides nest, rather than guessing at the last </div>.
func insertStarterSlide(src []byte) ([]byte, error) {
	// Find the `.slides` opening tag.  We anchor on class="slides" then back up
	// to the enclosing "<div".
	classIdx := bytes.Index(src, []byte(`class="slides"`))
	if classIdx == -1 {
		return nil, fmt.Errorf("could not find .slides container (class=\"slides\")")
	}
	openStart := bytes.LastIndex(src[:classIdx], []byte("<div"))
	if openStart == -1 {
		return nil, fmt.Errorf("could not find <div for .slides container")
	}
	// End of the opening tag (the first '>' at or after class="slides").
	gt := bytes.IndexByte(src[classIdx:], '>')
	if gt == -1 {
		return nil, fmt.Errorf(".slides opening tag is not closed")
	}
	scanFrom := classIdx + gt + 1

	// Walk forward tracking <div> depth (starting inside .slides at depth 1)
	// until the matching </div> brings us back to 0.
	depth := 1
	pos := scanFrom
	closeIdx := -1
	for pos < len(src) {
		open := bytes.Index(src[pos:], []byte("<div"))
		closeTag := bytes.Index(src[pos:], []byte("</div"))
		if closeTag == -1 {
			break // no more closing tags
		}
		if open != -1 && open < closeTag {
			// A nested <div> opens before the next </div>.
			depth++
			pos += open + len("<div")
			continue
		}
		// The next div token is a closing tag.
		depth--
		abs := pos + closeTag
		if depth == 0 {
			closeIdx = abs
			break
		}
		pos = abs + len("</div")
	}
	if closeIdx == -1 {
		return nil, fmt.Errorf("could not find matching </div> for .slides container")
	}

	// Derive the indentation of the line that holds the closing </div>, then
	// indent the new section's children two spaces deeper (matching the scaffold:
	// the slides-close is 4 spaces, sections sit at 6).
	lineStart := bytes.LastIndexByte(src[:closeIdx], '\n') + 1 // 0 if not found → start of file
	indent := src[lineStart:closeIdx]
	// Guard: indentation must be whitespace only; otherwise there is content on
	// the close line and we cannot safely compute indentation.
	for _, b := range indent {
		if b != ' ' && b != '\t' {
			indent = []byte("    ") // fall back to the scaffold's 4-space close indent
			break
		}
	}
	childIndent := string(indent) + "  "

	section := fmt.Sprintf(starterSection, childIndent)
	// Insert the section followed by a blank separator line, before the close
	// line's indentation.  Everything before lineStart and from closeIdx onward
	// is preserved verbatim (byte-stable).
	insertion := []byte(childIndent + section + "\n\n")

	out := make([]byte, 0, len(src)+len(insertion))
	out = append(out, src[:lineStart]...)
	out = append(out, insertion...)
	out = append(out, src[lineStart:]...)
	return out, nil
}
