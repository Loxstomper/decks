// Package deck — font.go implements Google Font localization (P6-13, spec principles-and-invariants).
//
// WHY THIS EXISTS:
// The offline-first invariant (spec principles-and-invariants) forbids CDN @import in saved decks.
// LocalizeFont downloads a chosen Google Font once while online, writes the
// woff2 files into the deck's assets/fonts/{slug}/ directory, generates a
// local @font-face CSS, and returns the relative path so the deck can render
// the font with zero network access thereafter.
//
// USAGE PATTERN:
//
//	POST /api/decks/{name}/fonts  {"family":"Inter","weights":"400;700"}
//	→ {"cssPath":"assets/fonts/inter/font-face.css","family":"Inter"}
//
// The caller then adds @import url("assets/fonts/inter/font-face.css") to
// custom.css and updates --r-main-font accordingly.
//
// GRACEFUL DEGRADATION:
// If the device is offline or Google Fonts is unreachable, LocalizeFont
// returns an error and does not write any files, so the caller can surface
// the failure without corrupting the deck.

package deck

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// fontHTTPClient is the shared client for Google Fonts requests.
// Timeout is generous: woff2 files can be a few hundred KB each.
var fontHTTPClient = &http.Client{Timeout: 30 * time.Second}

// googleFontsBaseURL is the CSS2 API endpoint; substituted in tests via
// SetGoogleFontsBaseURL so tests can run without hitting the real internet.
var googleFontsBaseURL = "https://fonts.googleapis.com/css2"

// GoogleFontsBaseURL returns the current base URL (test helper).
func GoogleFontsBaseURL() string { return googleFontsBaseURL }

// SetGoogleFontsBaseURL overrides the base URL for testing.
// Call SetGoogleFontsBaseURL(original) in a defer to restore.
func SetGoogleFontsBaseURL(u string) { googleFontsBaseURL = u }

// FontResult holds the outcome of a successful LocalizeFont call.
type FontResult struct {
	// CSSPath is the deck-relative path to the generated @font-face CSS, e.g.
	// "assets/fonts/inter/font-face.css".
	CSSPath string `json:"cssPath"`
	// Family is the canonical font family name, e.g. "Inter".
	Family string `json:"family"`
}

// LocalizeFont downloads a Google Font into the deck's assets/fonts/{slug}/
// directory, generates a local @font-face CSS at
// assets/fonts/{slug}/font-face.css, and returns a FontResult.
//
// family is the Google Fonts family name (e.g. "Inter", "Roboto", "Open Sans").
// weights is a semicolon-separated weight list (e.g. "400;700") or empty for
// 400;700 default. Italic variants are not fetched to keep the download small.
//
// All woff2 files are deduplicated by URL so each file is downloaded once even
// if the @font-face CSS references it multiple times (e.g. different Unicode
// ranges pointing to the same glyph subset file).
//
// Returns an error when:
//   - The Google Fonts API is unreachable (offline → caller degrades gracefully).
//   - The family name is empty or contains path-traversal characters.
//   - Any HTTP request returns non-200.
func LocalizeFont(root, deckName, family, weights string) (*FontResult, error) {
	if err := validateName(deckName); err != nil {
		return nil, err
	}
	if family == "" {
		return nil, fmt.Errorf("font family must not be empty")
	}

	// Verify the deck exists before making any network requests (fail fast).
	deckDir := filepath.Join(root, DecksDir, deckName)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("deck %q not found", deckName)
	}

	// Guard against path traversal in the family name used as a directory.
	slug := familySlug(family)
	if slug == "" || slug == "." || slug == ".." {
		return nil, fmt.Errorf("invalid font family name %q", family)
	}

	if weights == "" {
		weights = "400;700"
	}

	// Fetch the @font-face CSS from Google Fonts.
	// WHY Chrome UA: the Google Fonts API serves woff2 only to modern browsers.
	// Without the right UA we get woff or ttf instead of the smallest/widest-
	// compatible woff2 format (spec principles-and-invariants § offline-first).
	apiURL := fmt.Sprintf("%s?family=%s:wght@%s&display=swap",
		googleFontsBaseURL,
		strings.ReplaceAll(family, " ", "+"),
		weights)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("font: build request: %w", err)
	}
	req.Header.Set("User-Agent",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "+
			"AppleWebKit/537.36 (KHTML, like Gecko) "+
			"Chrome/124.0.0.0 Safari/537.36")

	resp, err := fontHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("font: fetch CSS from Google Fonts: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("font: Google Fonts API returned %d for %q", resp.StatusCode, family)
	}

	cssBuf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("font: read CSS body: %w", err)
	}
	googleCSS := string(cssBuf)

	// Parse woff2 URLs from the CSS.
	woff2URLs := extractWoff2URLs(googleCSS)
	if len(woff2URLs) == 0 {
		return nil, fmt.Errorf("font: no woff2 URLs found in Google Fonts CSS for %q", family)
	}

	// Create the font directory: decks/<deckName>/assets/fonts/<slug>/
	fontDir := filepath.Join(root, DecksDir, deckName, "assets", "fonts", slug)
	if err := os.MkdirAll(fontDir, 0o755); err != nil {
		return nil, fmt.Errorf("font: mkdir %s: %w", fontDir, err)
	}

	// Download each unique woff2 file and build the URL→local-path map.
	// WHY DEDUP: Google Fonts may emit the same file URL in multiple @font-face
	// blocks (one per Unicode range subset), so we track which URLs we've already
	// fetched to avoid redundant HTTP round-trips.
	urlToLocal := make(map[string]string, len(woff2URLs))
	counter := 0
	for _, u := range woff2URLs {
		if _, seen := urlToLocal[u]; seen {
			continue
		}
		localName := fmt.Sprintf("font-%d.woff2", counter)
		counter++
		localPath := filepath.Join(fontDir, localName)

		if err := downloadFile(u, localPath); err != nil {
			// Remove partially-downloaded font dir so a retry starts clean.
			os.RemoveAll(fontDir)
			return nil, fmt.Errorf("font: download %s: %w", u, err)
		}
		// Store the relative path from the CSS file's location.
		urlToLocal[u] = localName
	}

	// Rewrite the Google Fonts CSS: replace each absolute woff2 URL with its
	// local relative path so the resulting file has ZERO external URLs.
	localCSS := rewriteFontURLs(googleCSS, urlToLocal)

	// Verify the rewrite produced no external URLs (spec principles-and-invariants offline invariant).
	if extURLRe.MatchString(localCSS) {
		os.RemoveAll(fontDir)
		return nil, fmt.Errorf("font: rewritten CSS still contains external URL — refusing to write")
	}

	// Persist the local @font-face CSS.
	cssDest := filepath.Join(fontDir, "font-face.css")
	if err := os.WriteFile(cssDest, []byte(localCSS), 0o644); err != nil {
		os.RemoveAll(fontDir)
		return nil, fmt.Errorf("font: write font-face.css: %w", err)
	}

	// Relative path from the deck root (used in custom.css @import and HTML).
	relCSS := filepath.Join("assets", "fonts", slug, "font-face.css")
	// Always use forward slashes in CSS paths (cross-platform).
	relCSS = filepath.ToSlash(relCSS)

	log.Printf("font: localized %q → %s (%d woff2 files)", family, relCSS, counter)
	return &FontResult{CSSPath: relCSS, Family: family}, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

// woff2URLRe matches a woff2 URL inside CSS src: url(...).
var woff2URLRe = regexp.MustCompile(`url\(([^)]+\.woff2(?:\?[^)]*)?)\)`)

// extURLRe matches any http(s):// URL; used for the offline-invariant check.
var extURLRe = regexp.MustCompile(`https?://`)

// extractWoff2URLs returns the ordered-unique list of woff2 URLs in css.
func extractWoff2URLs(css string) []string {
	seen := make(map[string]bool)
	var urls []string
	for _, m := range woff2URLRe.FindAllStringSubmatch(css, -1) {
		u := strings.Trim(m[1], `'"`)
		if !seen[u] {
			seen[u] = true
			urls = append(urls, u)
		}
	}
	return urls
}

// rewriteFontURLs replaces each absolute woff2 URL in css with its local file
// name from urlToLocal.
func rewriteFontURLs(css string, urlToLocal map[string]string) string {
	return woff2URLRe.ReplaceAllStringFunc(css, func(match string) string {
		// Extract the URL from url(...).
		sub := woff2URLRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		u := strings.Trim(sub[1], `'"`)
		local, ok := urlToLocal[u]
		if !ok {
			return match
		}
		return "url(" + local + ")"
	})
}

// familySlug converts a font family name to a safe, lowercase directory name
// by replacing runs of non-alphanumeric characters with a hyphen.
// "Open Sans" → "open-sans", "IBM Plex Mono" → "ibm-plex-mono"
func familySlug(family string) string {
	var sb strings.Builder
	prevHyphen := false
	for _, r := range strings.ToLower(family) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			sb.WriteRune(r)
			prevHyphen = false
		} else if !prevHyphen && sb.Len() > 0 {
			sb.WriteByte('-')
			prevHyphen = true
		}
	}
	return strings.TrimRight(sb.String(), "-")
}

// downloadFile fetches src over HTTP and writes the body to dst.
func downloadFile(src, dst string) error {
	req, err := http.NewRequest("GET", src, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	// Same Chrome UA so font CDN serves woff2 (some CDNs gate on UA).
	req.Header.Set("User-Agent",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "+
			"AppleWebKit/537.36 (KHTML, like Gecko) "+
			"Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://fonts.gstatic.com/")

	resp, err := fontHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	return os.WriteFile(dst, data, 0o644)
}
