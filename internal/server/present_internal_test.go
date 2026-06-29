package server

import (
	"bytes"
	"strings"
	"testing"
)

// TestInjectPresentPlugins_Basic verifies the chalkboard + laser plugin tags
// and the post-init registerPlugin block are appended just before </body>
// (P17-19), and that no external (http/https) URL is introduced.
func TestInjectPresentPlugins_Basic(t *testing.T) {
	in := []byte("<html><body>\n  <script>Reveal.initialize({});</script>\n</body></html>")
	out := injectPresentPlugins(in)
	s := string(out)

	for _, want := range []string{
		`assets/vendor/chalkboard/style.css`,
		`assets/vendor/chalkboard/plugin.js`,
		`assets/vendor/laser/plugin.js`,
		`Reveal.registerPlugin(RevealChalkboard)`,
		`Reveal.registerPlugin(RevealLaser)`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("injected HTML missing %q", want)
		}
	}

	// Injected block must sit before </body>, after the reveal-init script.
	bodyIdx := strings.Index(s, "</body>")
	pluginIdx := strings.Index(s, presentPluginMarker)
	initIdx := strings.Index(s, "Reveal.initialize")
	if pluginIdx < 0 || bodyIdx < 0 || initIdx < 0 {
		t.Fatalf("expected markers present: plugin=%d body=%d init=%d", pluginIdx, bodyIdx, initIdx)
	}
	if !(initIdx < pluginIdx && pluginIdx < bodyIdx) {
		t.Errorf("plugin block must be after init and before </body>: init=%d plugin=%d body=%d", initIdx, pluginIdx, bodyIdx)
	}

	// Offline guard: no external URLs introduced by the injection.
	if strings.Contains(s, "http://") || strings.Contains(s, "https://") {
		t.Errorf("injected HTML introduced an external URL:\n%s", s)
	}
}

// TestInjectPresentPlugins_Idempotent verifies re-injecting is a no-op (the
// marker guard prevents a second block) and that the input slice is not mutated.
func TestInjectPresentPlugins_Idempotent(t *testing.T) {
	in := []byte("<html><body>\n  <script>Reveal.initialize({});</script>\n</body></html>")
	orig := append([]byte(nil), in...)

	once := injectPresentPlugins(in)
	twice := injectPresentPlugins(once)

	if !bytes.Equal(once, twice) {
		t.Errorf("injection not idempotent:\nonce=%q\ntwice=%q", once, twice)
	}
	if strings.Count(string(twice), presentPluginMarker) != 1 {
		t.Errorf("expected exactly one plugin block, got %d", strings.Count(string(twice), presentPluginMarker))
	}
	if !bytes.Equal(in, orig) {
		t.Errorf("injectPresentPlugins mutated its input slice")
	}
}

// TestInjectPresentPlugins_NoBody returns the input unchanged when there is no
// </body> anchor to position the block against.
func TestInjectPresentPlugins_NoBody(t *testing.T) {
	in := []byte("<html>no body close here</html>")
	out := injectPresentPlugins(in)
	if !bytes.Equal(in, out) {
		t.Errorf("expected unchanged output when </body> is absent")
	}
}
