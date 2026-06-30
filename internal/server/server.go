// Package server implements the slides-builder HTTP server.
//
// Routes:
//
//	GET  /health                              → 200 OK
//	GET  /api/decks                           → JSON list of deck names
//	GET  /api/decks/{name}                    → deck.html contents
//	PUT  /api/decks/{name}                    → write deck.html atomically
//	POST /api/decks/{name}/assets             → upload asset (multipart or raw body)
//	POST /api/decks/{name}/validate           → validate deck → {ok,errors} (P8-2)
//	GET  /api/decks/{name}/custom.css         → read custom.css (P6-11)
//	PUT  /api/decks/{name}/custom.css         → write custom.css atomically (P6-11)
//	POST /api/decks/{name}/fonts              → localize a Google Font offline (P6-13)
//	GET  /api/decks/{name}/export.pdf         → PDF via headless Chrome ?print-pdf (P7-3)
//	GET  /api/decks/{name}/export.zip         → ZIP of the entire deck folder (P7-4)
//	GET  /api/themes                          → list bundled reveal.js themes (P6-10)
//	GET  /api/shared                          → list shared/ library entries
//	POST /api/shared/{filename}/copy          → copy shared file into a deck (?deck=)
//	GET  /api/providers                       → list enabled image providers
//	GET  /api/providers/{name}/search         → search a provider (?q=&page=)
//	POST /api/providers/{name}/fetch          → fetch & localize into deck (body JSON)
//	GET  /api/capabilities                    → feature-detection flags (e.g. ffmpeg)
//	GET  /present/{name}                      → pure deck.html for presentation (P7-1)
//	GET  /decks/{name}/...                    → static deck files (for the iframe)
//	GET  /shared/...                          → static shared/ library files (previews)
//	GET  /events                              → SSE stream of watcher events
//	GET  /                                    → embedded Svelte SPA (falls back to index.html)
package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"slides-builder/internal/assets"
	"slides-builder/internal/deck"
	"slides-builder/internal/provider"
	"slides-builder/internal/validate"
	"slides-builder/internal/watch"
)

// Server holds the HTTP mux and its dependencies.
type Server struct {
	root      string
	watcher   *watch.Watcher
	mux       *http.ServeMux
	providers *provider.Registry
}

// New creates a Server.  root is the workspace root directory.
// staticFS is the embedded frontend filesystem (web/dist); pass nil to skip
// serving static files (useful in tests).
// reg is the provider registry; pass nil to disable provider routes.
func New(root string, w *watch.Watcher, staticFS fs.FS) *Server {
	return NewWithProviders(root, w, staticFS, nil)
}

// NewWithProviders creates a Server with an explicit provider registry.
func NewWithProviders(root string, w *watch.Watcher, staticFS fs.FS, reg *provider.Registry) *Server {
	if reg == nil {
		reg = &provider.Registry{}
	}
	s := &Server{
		root:      root,
		watcher:   w,
		mux:       http.NewServeMux(),
		providers: reg,
	}
	s.routes(staticFS)
	return s
}

// ServeHTTP implements http.Handler so Server can be passed to http.ListenAndServe.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// routes registers all HTTP handlers.
func (s *Server) routes(staticFS fs.FS) {
	s.mux.HandleFunc("GET /health", s.handleHealth)

	// Deck CRUD
	s.mux.HandleFunc("GET /api/decks", s.handleDeckList)
	s.mux.HandleFunc("POST /api/decks/{name}", s.handleDeckCreate)
	s.mux.HandleFunc("GET /api/decks/{name}", s.handleDeckRead)
	s.mux.HandleFunc("PUT /api/decks/{name}", s.handleDeckWrite)

	// Asset upload (P5-3, P5-14)
	s.mux.HandleFunc("POST /api/decks/{name}/assets", s.handleAssetUpload)

	// Validation (P8-2, spec 11/12): check a deck against the layout contract,
	// eid uniqueness, asset existence, well-formedness, and the offline guard.
	s.mux.HandleFunc("POST /api/decks/{name}/validate", s.handleValidate)

	// Custom CSS (P6-11): read and atomic write of per-deck custom.css.
	// GET is redundant with the static /decks/{name}/custom.css route but
	// provided here for symmetry and to allow JSON error responses.
	s.mux.HandleFunc("GET /api/decks/{name}/custom.css", s.handleCustomCSSRead)
	s.mux.HandleFunc("PUT /api/decks/{name}/custom.css", s.handleCustomCSSWrite)

	// Auto-advance (P17-20): set the deck-level autoSlide/loop in Reveal.initialize.
	s.mux.HandleFunc("POST /api/decks/{name}/autoslide", s.handleAutoSlide)
	// Slide numbers (P17-17): set the deck-level slideNumber in Reveal.initialize.
	s.mux.HandleFunc("POST /api/decks/{name}/slide-number", s.handleSlideNumber)

	// Font localization (P6-13): download a Google Font into assets/fonts/.
	s.mux.HandleFunc("POST /api/decks/{name}/fonts", s.handleFontLocalize)

	// PDF export (P7-3): headless Chrome renders the deck with ?print-pdf.
	s.mux.HandleFunc("GET /api/decks/{name}/export.pdf", s.handleExportPDF)

	// ZIP export (P7-4): streams the full deck folder as a self-contained zip.
	s.mux.HandleFunc("GET /api/decks/{name}/export.zip", s.handleExportZIP)

	// Bundled theme list (P6-10): static list of themes shipped in the binary.
	s.mux.HandleFunc("GET /api/themes", s.handleThemeList)
	// Per-theme background colours (P10-1): name → --r-background-color.
	s.mux.HandleFunc("GET /api/themes/backgrounds", s.handleThemeBackgrounds)

	// Slide-layout templates (P14-2): bundled presets + user snippets from the
	// workspace templates/ dir.
	s.mux.HandleFunc("GET /api/templates", s.handleTemplateList)

	// Shared library (P5-5)
	s.mux.HandleFunc("GET /api/shared", s.handleSharedList)
	s.mux.HandleFunc("POST /api/shared/{filename}/copy", s.handleSharedCopy)

	// Provider system (P5-6, P5-7, P5-8)
	s.mux.HandleFunc("GET /api/providers", s.handleProviderList)
	s.mux.HandleFunc("GET /api/providers/{name}/search", s.handleProviderSearch)
	s.mux.HandleFunc("POST /api/providers/{name}/fetch", s.handleProviderFetch)

	// Capability flags
	s.mux.HandleFunc("GET /api/capabilities", s.handleCapabilities)

	// Present route (P7-1): serves the pure deck.html for fullscreen presentation.
	// Registered before /decks/ so /present/ is a distinct path namespace.
	s.mux.HandleFunc("GET /present/{name}", s.handlePresent)
	s.mux.HandleFunc("GET /present/{name}/{path...}", s.handlePresent)

	// Iframe static serving
	s.mux.HandleFunc("GET /decks/{name}/{path...}", s.handleDeckStatic)

	// Shared library static serving (P5-5): lets the editor preview shared/
	// thumbnails. Read-only; copy-into-deck is the only way content enters a deck.
	s.mux.HandleFunc("GET /shared/{path...}", s.handleSharedStatic)

	// SSE
	s.mux.HandleFunc("GET /events", s.handleSSE)

	if staticFS != nil {
		s.mux.Handle("/", spaHandler(staticFS))
	}
}

// ── Core deck handlers ────────────────────────────────────────────────────────

// handleHealth returns a 200 with a simple JSON body.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"status":"ok"}`)
}

// handleDeckList returns a JSON array of deck folder names.
func (s *Server) handleDeckList(w http.ResponseWriter, r *http.Request) {
	names, err := deck.List(s.root)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if names == nil {
		names = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(names)
}

// handleDeckRead returns the deck.html for a named deck.
func (s *Server) handleDeckRead(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	data, err := deck.Read(s.root, name)
	if err != nil {
		if isNotExist(err) {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

// handleDeckWrite atomically writes deck.html for a named deck.
func (s *Server) handleDeckWrite(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	if err := deck.Write(s.root, name, body); err != nil {
		if isNotExist(err) {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Start watching the deck folder if not already watched.
	if s.watcher != nil {
		deckPath := deck.DeckPath(s.root, name)
		_ = s.watcher.Watch(name, deckPath) // idempotent in practice
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleDeckCreate scaffolds a new deck using the same logic as `slides new`.
//
//	POST /api/decks/{name}
//
// Name is validated via deck.ValidName; 409 Conflict is returned if the deck
// folder already exists. On success the deck is created and watched, and the
// handler returns 201 Created with a JSON body {"name":"<name>"}.
//
// WHY POST /api/decks/{name} (not POST /api/decks with a JSON body):
// The deck name IS the resource identifier — it becomes the folder name and
// the URL slug. Encoding it as a path segment is idiomatic REST and keeps the
// UI simple: the only state the client needs to supply is the name.
func (s *Server) handleDeckCreate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	// Reject if the deck already exists — creation must never clobber.
	deckDir := deck.DeckPath(s.root, name)
	if _, err := os.Stat(deckDir); err == nil {
		http.Error(w, "deck already exists", http.StatusConflict)
		return
	}

	// Scaffold using the same function the CLI uses — single source of truth,
	// no duplicated logic (spec 12 / P9-11 invariant).
	if err := deck.New(s.root, name); err != nil {
		http.Error(w, "create deck: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Begin watching the new deck so SSE change events fire for it.
	if s.watcher != nil {
		if err := s.watcher.Watch(name, deckDir); err != nil {
			log.Printf("create-deck: could not watch %q: %v", name, err)
		}
	}

	log.Printf("create-deck: scaffolded %q", name)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"name": name})
}

// ── Asset upload (P5-3, P5-14) ───────────────────────────────────────────────

// assetResponse is the JSON shape returned by POST /api/decks/{name}/assets.
type assetResponse struct {
	// Src is the relative path from the deck folder, e.g. "assets/img/photo.jpg".
	Src string `json:"src"`
	// Transcoded is true when ffmpeg re-encoded a video to H.264/MP4 (P5-14).
	Transcoded bool `json:"transcoded,omitempty"`
}

// handleAssetUpload accepts a multipart/form-data upload with a "file" field,
// copies the file into decks/<name>/assets/ (traversal-safe, deduplicated),
// and returns a JSON body with the relative src.
//
// For video files, optional ffmpeg transcoding is attempted when available (P5-14).
//
// Content-Type detection order:
//  1. The Content-Type of the multipart part (most reliable for browser uploads).
//  2. File extension of the uploaded filename.
func (s *Server) handleAssetUpload(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	// Verify the deck exists.
	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	// Parse multipart form (32 MB in-memory limit; larger files spill to disk).
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "invalid multipart form: "+err.Error(), http.StatusBadRequest)
		return
	}

	fh, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing 'file' field in multipart form", http.StatusBadRequest)
		return
	}
	defer fh.Close()

	// Determine MIME type from the part's Content-Type header, falling back to
	// extension-based detection.  Never trust the extension alone for security
	// decisions, but here we only use it to choose a storage subdirectory.
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mimeByFilename(header.Filename)
	}
	// Strip parameters (e.g. "image/jpeg; charset=utf-8" → "image/jpeg").
	if mt, _, err2 := mime.ParseMediaType(mimeType); err2 == nil {
		mimeType = mt
	}

	data, err := io.ReadAll(fh)
	if err != nil {
		http.Error(w, "read upload: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var relSrc string
	var transcoded bool

	if strings.HasPrefix(mimeType, "video/") {
		// Video path: optional ffmpeg transcode (P5-14, graceful if absent).
		relSrc, transcoded, err = assets.LocalizeVideo(s.root, name, data, header.Filename)
	} else {
		relSrc, err = assets.LocalizeBytes(s.root, name, data, header.Filename, mimeType)
	}
	if err != nil {
		http.Error(w, "asset upload: "+err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("asset: uploaded %s → %s (deck=%s, transcoded=%v)", header.Filename, relSrc, name, transcoded)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(assetResponse{Src: relSrc, Transcoded: transcoded})
}

// mimeByFilename returns a MIME type inferred from the filename extension.
func mimeByFilename(name string) string {
	ext := strings.ToLower(strings.TrimPrefix(strings.ToLower(name[max(0, strings.LastIndex(name, ".")):]), ""))
	// mime.TypeByExtension returns "type/sub; ...params" but we just need the type.
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	// Fallback table for types not in the stdlib mime package.
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/avi"
	}
	return "application/octet-stream"
}

// max returns the larger of a and b (used for string index clamping above).
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ── Validation (P8-2, spec 11/12) ─────────────────────────────────────────────

// handleValidate validates a deck against the spec rules and returns JSON.
//
//	POST /api/decks/{name}/validate
//
// Request body (optional):
//   - empty            → validate the on-disk decks/<name>/deck.html.
//   - raw HTML bytes   → validate those bytes against decks/<name>/ for asset
//     resolution.  This lets the editor's save path validate a candidate
//     document BEFORE writing it (spec 12: validation gates the save path).
//
// Response: {"ok":bool,"errors":[{"code","message","line"?,"eid"?}]}
//
// WHY 200 even when ok=false: validation FAILURE is a normal, expected result
// the client must inspect, not a transport error.  Only a missing deck (404) or
// an unreadable file (500) is an HTTP-level error.
func (s *Server) handleValidate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var res validate.Result
	if len(body) > 0 {
		// Validate the supplied candidate document; resolve assets against the deck.
		res = validate.Bytes(body, deckDir)
	} else {
		res, err = validate.Deck(deckDir)
		if err != nil {
			http.Error(w, "validate: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Ensure errors marshals as [] (not null) for a stable client contract.
	if res.Errors == nil {
		res.Errors = []validate.Issue{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// ── Shared library (P5-5) ────────────────────────────────────────────────────

// handleSharedList returns a JSON array of files in the shared/ library.
func (s *Server) handleSharedList(w http.ResponseWriter, r *http.Request) {
	entries, err := assets.ListShared(s.root)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if entries == nil {
		entries = []assets.SharedEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

// handleSharedCopy copies a shared library file into a deck's assets/.
//
//	POST /api/shared/{filename}/copy?deck=<deckname>
//
// Response: {"src":"assets/img/logo.png"}
func (s *Server) handleSharedCopy(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	deckName := r.URL.Query().Get("deck")

	if deckName == "" {
		http.Error(w, "missing 'deck' query parameter", http.StatusBadRequest)
		return
	}
	if !deck.ValidName(deckName) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	relSrc, err := assets.CopyFromShared(s.root, deckName, filename)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"src": relSrc})
}

// handleSharedStatic serves a read-only preview of files in the workspace
// shared/ library so the editor's Shared-library picker can render thumbnails.
//
//	GET /shared/{path...}
//
// Path-traversal safety mirrors handleDeckStatic: fs.ValidPath rejects absolute
// paths and ".." segments, and os.DirFS confines all access to the shared/ dir,
// so a crafted URL cannot read files outside it.
func (s *Server) handleSharedStatic(w http.ResponseWriter, r *http.Request) {
	rel := r.PathValue("path")
	if rel == "" || !fs.ValidPath(rel) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	sharedDir := filepath.Join(s.root, "shared")
	if info, err := os.Stat(sharedDir); err != nil || !info.IsDir() {
		http.Error(w, "shared library not found", http.StatusNotFound)
		return
	}
	http.ServeFileFS(w, r, os.DirFS(sharedDir), rel)
}

// ── Provider system (P5-6, P5-7, P5-8) ───────────────────────────────────────

// handleProviderList returns a JSON array of enabled providers.
func (s *Server) handleProviderList(w http.ResponseWriter, r *http.Request) {
	enabled := s.providers.Enabled()
	list := make([]provider.ProviderInfo, 0, len(enabled))
	for _, p := range enabled {
		list = append(list, provider.ProviderInfo{Name: p.Name(), Label: p.Label()})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

// handleProviderSearch proxies a search query to the named provider.
//
//	GET /api/providers/{name}/search?q=<query>&page=<n>
//
// Response: {"results":[…],"page":1,"total_pages":10}
func (s *Server) handleProviderSearch(w http.ResponseWriter, r *http.Request) {
	pName := r.PathValue("name")
	p := s.providers.Get(pName)
	if p == nil {
		http.Error(w, "unknown provider: "+pName, http.StatusNotFound)
		return
	}
	if !p.Enabled() {
		http.Error(w, "provider not enabled: "+pName, http.StatusForbidden)
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, "missing 'q' query parameter", http.StatusBadRequest)
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	results, totalPages, err := p.Search(query, page)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"results":     results,
		"page":        page,
		"total_pages": totalPages,
	})
}

// handleProviderFetch downloads an asset from a provider and localizes it.
//
//	POST /api/providers/{name}/fetch
//	Body: {"id":"<provider-id>","deck":"<deck-name>"}
//
// Response: {"src":"assets/img/photo.jpg"}
func (s *Server) handleProviderFetch(w http.ResponseWriter, r *http.Request) {
	pName := r.PathValue("name")
	p := s.providers.Get(pName)
	if p == nil {
		http.Error(w, "unknown provider: "+pName, http.StatusNotFound)
		return
	}
	if !p.Enabled() {
		http.Error(w, "provider not enabled: "+pName, http.StatusForbidden)
		return
	}

	var body struct {
		ID   string `json:"id"`
		Deck string `json:"deck"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.ID == "" {
		http.Error(w, "missing 'id' in request body", http.StatusBadRequest)
		return
	}
	if body.Deck == "" {
		http.Error(w, "missing 'deck' in request body", http.StatusBadRequest)
		return
	}
	if !deck.ValidName(body.Deck) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	// Verify deck exists.
	deckDir := deck.DeckPath(s.root, body.Deck)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	relSrc, err := p.Fetch(body.ID, s.root, body.Deck)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	log.Printf("provider: fetched %s/%s → %s (deck=%s)", pName, body.ID, relSrc, body.Deck)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"src": relSrc})
}

// ── Capabilities (P5-14) ──────────────────────────────────────────────────────

// handleCapabilities reports optional feature availability (e.g. ffmpeg).
// The frontend uses this to show/hide the "transcode video" option.
func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"ffmpeg": assets.HasFFmpeg(),
	})
}

// ── Static deck serving ───────────────────────────────────────────────────────

// handleDeckStatic serves the on-disk files of a deck folder so the editor's
// reveal.js <iframe> can load /decks/{name}/deck.html and resolve its sibling
// assets (assets/vendor/reveal/..., images, custom.css) via relative URLs.
//
// WHY a separate route (not /api/...): reveal.js and the browser request these
// as ordinary static resources with correct Content-Types and relative-path
// resolution; the iframe's src IS this URL, so relative links inside deck.html
// resolve here without extra config.
//
// Path-traversal safety (spec 12 — never escape the workspace): the deck name
// is validated as a single safe segment (deck.ValidName), and the remaining
// path is served through os.DirFS rooted at the deck folder. os.DirFS rejects
// any path that fails fs.ValidPath (absolute paths or ".." segments), so a
// crafted URL cannot read files outside decks/<name>/.
func (s *Server) handleDeckStatic(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	rel := r.PathValue("path")
	if rel == "" {
		rel = "deck.html" // /decks/{name}/ → the entry document
	}
	// fs.ValidPath rejects leading slashes, "." and ".." segments. os.DirFS
	// enforces the same invariant on Open, but checking here yields a clean 400
	// instead of a 404 for obviously malicious input.
	if !fs.ValidPath(rel) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	// The MUTABLE deck documents (deck.html, custom.css) are rewritten in place by
	// the editor/Claude Code and the iframe must reflect the new bytes immediately
	// after a save. ServeFileFS uses Last-Modified for conditional requests, but
	// HTTP Last-Modified has only 1-SECOND granularity: an edit + the follow-up
	// canvas reload land within the same second, so the browser's If-Modified-Since
	// matches the freshly-written file's mtime and the server answers 304 — the
	// iframe then renders the STALE cached copy (e.g. an inline font-size run shows
	// on disk and in the present route but never in the canvas). Forbid caching of
	// these two files so every reload fetches the current bytes. The immutable
	// vendor/asset files keep normal caching.
	if rel == "deck.html" || rel == "custom.css" {
		w.Header().Set("Cache-Control", "no-store")
	}

	// os.DirFS confines all access to deckDir; ServeFileFS sets Content-Type
	// from the file extension and handles conditional/range requests.
	http.ServeFileFS(w, r, os.DirFS(deckDir), rel)
}

// ── SSE ───────────────────────────────────────────────────────────────────────

// handleSSE streams watcher events as Server-Sent Events.
func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	// Send an initial comment to establish the connection.
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	if s.watcher == nil {
		// No watcher; keep the connection open until the client disconnects.
		<-r.Context().Done()
		return
	}

	ch := s.watcher.Subscribe()
	defer s.watcher.Unsubscribe(ch)

	log.Printf("sse: client connected from %s", r.RemoteAddr)
	for {
		select {
		case <-r.Context().Done():
			log.Printf("sse: client disconnected from %s", r.RemoteAddr)
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// ── SPA handler ───────────────────────────────────────────────────────────────

// spaHandler serves files from staticFS and falls back to index.html for
// unknown paths (client-side routing).
func spaHandler(staticFS fs.FS) http.Handler {
	fileServer := http.FileServerFS(staticFS)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Check whether the file exists in the embedded FS.
		if _, err := fs.Stat(staticFS, path); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		// Fall back to index.html for SPA client-side routes.
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/index.html"
		fileServer.ServeHTTP(w, r2)
	})
}

// ── Custom CSS (P6-11) ────────────────────────────────────────────────────────

// handleCustomCSSRead returns the current custom.css for a named deck.
//
//	GET /api/decks/{name}/custom.css
//
// WHY THIS ENDPOINT: the static /decks/{name}/custom.css route already serves
// the file, but having an explicit API endpoint lets the FE store use a uniform
// /api/… path and receive proper JSON errors on missing decks.
func (s *Server) handleCustomCSSRead(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}
	data, err := deck.ReadCustomCSS(s.root, name)
	if err != nil {
		if isNotExist(err) {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Write(data)
}

// handleCustomCSSWrite atomically writes custom.css for a named deck (P6-11).
//
//	PUT /api/decks/{name}/custom.css
//
// Body: the raw CSS text. Uses the same atomic temp+rename pattern as
// handleDeckWrite so a partial write never leaves a corrupt file.
func (s *Server) handleCustomCSSWrite(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	if err := deck.WriteCustomCSS(s.root, name, body); err != nil {
		if isNotExist(err) {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAutoSlide sets the deck-level auto-advance default (P17-20).
//
//	POST /api/decks/{name}/autoslide
//	Body: {"ms": 3000, "loop": true}
//
// Rewrites deck.html's Reveal.initialize so it carries `autoSlide: <ms>` and
// `loop: <bool>` (ms <= 0 or loop=false remove the respective key). The rewrite
// is byte-stable: a deck already in the requested state is left untouched on
// disk. Mirrors the custom.css write handler's shape.
func (s *Server) handleAutoSlide(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	var reqBody struct {
		MS   int  `json:"ms"`
		Loop bool `json:"loop"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if reqBody.MS < 0 {
		http.Error(w, "ms must be a non-negative integer", http.StatusBadRequest)
		return
	}

	if err := deck.SetAutoSlide(s.root, name, reqBody.MS, reqBody.Loop); err != nil {
		if isNotExist(err) {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// allowedSlideNumberFormats is the whitelist of reveal slideNumber format tokens
// the editor exposes. Restricting the set keeps the value safe to splice into the
// single-quoted JS literal (no escaping needed) and the editor UI in sync.
var allowedSlideNumberFormats = map[string]bool{
	"c":   true, // current slide number only
	"c/t": true, // current/total
}

// handleSlideNumber sets the deck-level slide-number config (P17-17).
//
//	POST /api/decks/{name}/slide-number
//	Body: {"enabled": true, "format": "c/t"}
//
// Rewrites deck.html's Reveal.initialize so it carries `slideNumber: false` (off)
// or `slideNumber: '<format>'` (on). The rewrite is byte-stable: a deck already in
// the requested state is left untouched on disk. Mirrors the custom.css write
// handler's shape. The watcher → SSE → editor reload picks up the change.
func (s *Server) handleSlideNumber(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	var reqBody struct {
		Enabled bool   `json:"enabled"`
		Format  string `json:"format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if reqBody.Enabled && reqBody.Format != "" && !allowedSlideNumberFormats[reqBody.Format] {
		http.Error(w, "unsupported slideNumber format", http.StatusBadRequest)
		return
	}

	if err := deck.SetSlideNumber(s.root, name, reqBody.Enabled, reqBody.Format); err != nil {
		if isNotExist(err) {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Font localization (P6-13) ──────────────────────────────────────────────────

// handleFontLocalize downloads a Google Font and localizes it into the deck's
// assets/fonts/ directory so the deck renders offline (spec 12).
//
//	POST /api/decks/{name}/fonts
//	Body: {"family":"Inter","weights":"400;700"}
//
// Response: {"cssPath":"assets/fonts/inter/font-face.css","family":"Inter"}
//
// On network error (device offline, Google Fonts unreachable) returns 503 so
// the FE can surface a friendly "font unavailable offline" message rather than
// crashing. The deck is left unchanged.
func (s *Server) handleFontLocalize(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	// Verify deck exists before attempting a network fetch.
	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	var reqBody struct {
		Family  string `json:"family"`
		Weights string `json:"weights"` // optional, e.g. "400;700"
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if reqBody.Family == "" {
		http.Error(w, "missing 'family' in request body", http.StatusBadRequest)
		return
	}

	result, err := deck.LocalizeFont(s.root, name, reqBody.Family, reqBody.Weights)
	if err != nil {
		// WHY 503 for network-related errors:
		// A 503 tells the FE the operation failed transiently (network offline or
		// Google Fonts down) rather than the request itself being malformed.
		log.Printf("font: localize %q (deck=%s): %v", reqBody.Family, name, err)
		http.Error(w, "font localization failed: "+err.Error(), http.StatusServiceUnavailable)
		return
	}

	log.Printf("font: localized %q → %s (deck=%s)", result.Family, result.CSSPath, name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ── Theme list (P6-10) ────────────────────────────────────────────────────────

// handleThemeList returns the ordered list of bundled reveal.js themes.
//
//	GET /api/themes
//
// Response: ["black","white","league","beige","night","moon","solarized","dracula","sky"]
//
// WHY EXPOSE AN API: the FE can rely on this instead of a hardcoded list, so
// adding a new theme to the binary automatically surfaces it in the picker.
func (s *Server) handleThemeList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deck.BundledThemes)
}

// handleThemeBackgrounds returns each bundled theme's background colour.
//
//	GET /api/themes/backgrounds
//
// Response: {"black":"#191919","solarized-dark":"#002b36", …}
//
// WHY: reveal paints slide backgrounds at deck level, so the editor uses this
// map (derived from the embedded theme CSS) to paint a per-slide background
// when a section overrides its theme (P10-1).
func (s *Server) handleThemeBackgrounds(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deck.ThemeBackgrounds())
}

// ── Slide-layout templates (P14-2) ────────────────────────────────────────────

// handleTemplateList returns the slide-layout presets the editor offers when
// inserting a new slide (Phase 14, Google-Slides-style layouts).
//
//	GET /api/templates
//
// Response: [{"name":"title","label":"Title","html":"<section …>…</section>"}, …]
//
// The list is the binary's BundledLayouts() followed by any user snippets
// dropped into the workspace templates/ dir (templates/*.html, each mapped to
// {name: filename-without-ext, label, html}). User snippets are appended after
// the built-ins; a user file whose name collides with a built-in overrides it.
//
// Offline + traversal-safe: only *.html files directly inside templates/ are
// read (subdirectories and other extensions ignored), so no path component can
// escape the workspace.
func (s *Server) handleTemplateList(w http.ResponseWriter, r *http.Request) {
	templates := deck.BundledLayouts()

	// index built-ins by name so a user override replaces rather than duplicates.
	index := make(map[string]int, len(templates))
	for i, t := range templates {
		index[t.Name] = i
	}

	dir := filepath.Join(s.root, "templates")
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".html") {
				continue
			}
			name := strings.TrimSuffix(e.Name(), ".html")
			// Skip names that are not safe single path components.
			if name == "" || !deck.ValidName(name) {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			preset := deck.LayoutPreset{
				Name:  name,
				Label: name,
				HTML:  string(data),
			}
			if i, ok := index[name]; ok {
				templates[i] = preset
			} else {
				index[name] = len(templates)
				templates = append(templates, preset)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

// ── Present route (P7-1) ─────────────────────────────────────────────────────

// handlePresent serves the deck for fullscreen presentation — no editor chrome.
//
//	GET /present/{name}             → deck.html (the entry document)
//	GET /present/{name}/{path...}   → sibling assets (vendor/, custom.css, …)
//
// WHY a separate /present/ namespace (not just /decks/{name}/):
// /decks/{name}/deck.html is already accessible and is the iframe src in edit
// mode.  /present/ gives the presenter a stable, bookmarkable URL that is
// clearly distinct from the editing entry point.  Internally it uses the same
// os.DirFS mechanism as handleDeckStatic so the bytes served are IDENTICAL to
// the on-disk file (spec 10: "present exactly the file").
//
// Asset resolution: relative hrefs in deck.html (assets/vendor/reveal/…,
// custom.css, etc.) resolve against the entry document's base URL, which the
// browser takes as everything up to the last "/" in the address. The bare URL
// /present/{name} therefore has base /present/ — relative assets would 404.
// We redirect /present/{name} → /present/{name}/ so the base becomes
// /present/{name}/ and sub-path requests
// (GET /present/{name}/assets/vendor/reveal/reveal.js) are served from the
// deck folder by this same handler. All relative URLs then resolve with zero
// additional config and no in-document <base> tag (keeping the served bytes
// identical to the on-disk file, per spec 10).
func (s *Server) handlePresent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	// Resolve the deck folder up front so an unknown deck 404s before we issue
	// any redirect — keeps the bare and trailing-slash URLs consistent.
	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	// Determine the file to serve within the deck folder.
	rel := r.PathValue("path")
	if rel == "" {
		// Entry document. If the URL lacks a trailing slash, redirect so the
		// browser resolves relative asset paths against /present/{name}/ rather
		// than /present/. Preserve the query string (e.g. ?print-pdf used by the
		// PDF exporter, which follows the redirect).
		if !strings.HasSuffix(r.URL.Path, "/") {
			target := r.URL.Path + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}
		rel = "deck.html" // /present/{name}/ → deck entry document
	}
	if !fs.ValidPath(rel) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	// The entry document is served with the present-only annotation/laser
	// plugins injected in-memory (P17-19). The on-disk deck.html is NEVER
	// modified — present-mode annotations are ephemeral (spec 10) — so we read
	// the bytes, augment a COPY, and serve that. Asset sub-paths fall through to
	// the plain file server below.
	if rel == "deck.html" {
		raw, err := os.ReadFile(filepath.Join(deckDir, rel))
		if err != nil {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		out := injectPresentPlugins(raw)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// Present mode is dynamic (in-memory augmentation); avoid stale caches.
		w.Header().Set("Cache-Control", "no-store")
		w.Write(out)
		return
	}

	// os.DirFS confines access to deckDir; identical security model to
	// handleDeckStatic.  ServeFileFS sets correct Content-Type and handles
	// conditional / range requests.
	http.ServeFileFS(w, r, os.DirFS(deckDir), rel)
}

// presentPluginMarker is a substring unique to the injected block; its presence
// makes injectPresentPlugins idempotent.
const presentPluginMarker = "assets/vendor/chalkboard/plugin.js"

// presentPluginBlock is injected just before </body> on the present route only.
//
// WHY post-init Reveal.registerPlugin (not a plugins:[] array rewrite): the
// vendored reveal.js 5.x registerPlugin() immediately calls plugin.init(Reveal)
// when the deck is already "loaded" (verified in internal/deck/vendor/reveal/
// reveal.js: `"loaded"===this.state && ... e.init(this.Reveal)`). The block runs
// AFTER the existing reveal-init <script> (which sits just before </body>), so
// `Reveal` exists and is loaded — registering here boots both plugins without
// touching the deck's plugins:[] config. That keeps the injection a pure append
// and the on-disk deck.html byte-identical.
//
// Offline-first: every src/href is deck-relative (the present route already
// serves assets/vendor/{chalkboard,laser}/...); zero external URLs are
// introduced. The chalkboard plugin resolves its cursor images relative to its
// own script src (assets/vendor/chalkboard/img/...), which is vendored.
const presentPluginBlock = "" +
	`  <link rel="stylesheet" href="assets/vendor/chalkboard/style.css" />` + "\n" +
	`  <script src="assets/vendor/chalkboard/plugin.js"></script>` + "\n" +
	`  <script src="assets/vendor/laser/plugin.js"></script>` + "\n" +
	"  <script>\n" +
	"    if (window.Reveal && window.RevealChalkboard) Reveal.registerPlugin(RevealChalkboard);\n" +
	"    if (window.Reveal && window.RevealLaser) Reveal.registerPlugin(RevealLaser);\n" +
	"  </script>\n"

// injectPresentPlugins returns a COPY of the deck HTML with the chalkboard +
// laser plugin tags appended just before </body> (P17-19). Pure and idempotent:
// HTML that already carries the block (marker present) is returned unchanged, as
// is HTML with no </body> to anchor against. The input slice is never mutated.
func injectPresentPlugins(html []byte) []byte {
	if bytes.Contains(html, []byte(presentPluginMarker)) {
		return html
	}
	idx := bytes.LastIndex(html, []byte("</body>"))
	if idx < 0 {
		return html
	}
	out := make([]byte, 0, len(html)+len(presentPluginBlock))
	out = append(out, html[:idx]...)
	out = append(out, presentPluginBlock...)
	out = append(out, html[idx:]...)
	return out
}

// ── PDF export (P7-3) ─────────────────────────────────────────────────────────

// chromeCandidates is the ordered list of Chrome/Chromium binary names probed
// on PATH.  CHROME_BIN env var is checked first so CI / power users can pin a
// specific binary without mutating PATH.
var chromeCandidates = []string{
	"google-chrome",
	"google-chrome-stable",
	"chromium",
	"chromium-browser",
	"chrome",
}

// FindChrome returns the absolute path of a usable Chrome/Chromium binary.
//
// Detection order:
//  1. $CHROME_BIN environment variable (explicit override, highest priority).
//  2. Each name in chromeCandidates probed with exec.LookPath.
//
// Returns ("", false) when no binary is found so the caller can return a
// graceful 503 instead of crashing (P7-3 requirement: no hard dependency).
// Exported so tests can call it to skip when Chrome is absent.
func FindChrome() (string, bool) {
	if bin := os.Getenv("CHROME_BIN"); bin != "" {
		if _, err := os.Stat(bin); err == nil {
			return bin, true
		}
	}
	for _, name := range chromeCandidates {
		if path, err := exec.LookPath(name); err == nil {
			return path, true
		}
	}
	return "", false
}

// handleExportPDF drives headless Chrome against the deck's present URL with
// reveal's ?print-pdf query parameter and streams the resulting PDF back.
//
//	GET /api/decks/{name}/export.pdf
//
// Chrome is located via findChrome (see above).  If absent the handler returns
// 503 with a JSON error body — no crash, no hard build dependency on Chrome.
//
// WHY --headless --print-to-pdf (not chromedp):
// chromedp would add a large indirect dependency.  os/exec is sufficient: we
// launch Chrome, wait for it to finish writing the PDF to a temp file, then
// stream that file.  The deck is served by the running server on localhost so
// Chrome can reach it without any networking.
func (s *Server) handleExportPDF(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	chromeBin, ok := FindChrome()
	if !ok {
		// Graceful degradation: 503 with actionable JSON error so the frontend
		// can surface "install Chrome to export PDF" instead of a generic error.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintf(w, `{"error":"chrome not found","detail":"install google-chrome, chromium, or set CHROME_BIN","candidates":%q}`,
			strings.Join(chromeCandidates, ","))
		return
	}

	// We need Chrome to reach the deck over HTTP.  Detect the server's address
	// from the incoming request Host header so the URL works for any port.
	//
	// WHY use the HTTP server (not file://): reveal.js's print-pdf mode makes
	// relative requests for CSS/JS assets; file:// can have CORS/path issues.
	// Serving over the already-running HTTP server avoids both problems.
	host := r.Host
	if host == "" {
		host = "localhost:3000"
	}
	deckURL := fmt.Sprintf("http://%s/present/%s?print-pdf", host, name)

	// Write the PDF to a temp file; Chrome writes the complete file before we
	// read it, avoiding partial-read races.
	tmp, err := os.CreateTemp("", "slides-export-*.pdf")
	if err != nil {
		http.Error(w, "pdf export: create temp: "+err.Error(), http.StatusInternalServerError)
		return
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	// --headless: no GUI.
	// --disable-gpu: required in most headless Linux environments.
	// --no-sandbox: required when running as root (e.g. inside Docker/CI).
	// --print-to-pdf: write a PDF to the given path and exit.
	// --print-to-pdf-no-header: suppress Chrome's default date/URL header/footer.
	// --run-all-compositor-stages-before-draw: ensures full render before capture.
	cmd := exec.CommandContext(r.Context(), chromeBin,
		"--headless",
		"--disable-gpu",
		"--no-sandbox",
		"--run-all-compositor-stages-before-draw",
		"--print-to-pdf-no-header",
		"--print-to-pdf="+tmpPath,
		deckURL,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("pdf export: chrome error for %s: %v\n%s", name, err, out)
		http.Error(w, "pdf export: chrome failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	pdfData, err := os.ReadFile(tmpPath)
	if err != nil {
		http.Error(w, "pdf export: read result: "+err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("pdf export: generated %d bytes for deck %s", len(pdfData), name)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"`, name))
	w.Header().Set("Content-Length", strconv.Itoa(len(pdfData)))
	w.Write(pdfData)
}

// ── ZIP export (P7-4) ─────────────────────────────────────────────────────────

// handleExportZIP streams a zip archive of the entire deck folder so it can be
// opened and presented as a standalone, self-contained offline deck.
//
//	GET /api/decks/{name}/export.zip
//
// The zip contains all files under decks/<name>/ with the deck folder name as
// the top-level directory, e.g.:
//
//	my-talk/deck.html
//	my-talk/custom.css
//	my-talk/assets/vendor/reveal/reveal.js
//	…
//
// WHY include the full assets/vendor/ tree: every deck is self-contained
// (spec 12 offline-first).  The zip must open in any browser without a server.
//
// Traversal safety: we walk the deck directory with os.DirFS and only include
// paths that pass fs.ValidPath; the deck name itself is validated by
// deck.ValidName before we open any file.
func (s *Server) handleExportZIP(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !deck.ValidName(name) {
		http.Error(w, "invalid deck name", http.StatusBadRequest)
		return
	}

	deckDir := deck.DeckPath(s.root, name)
	if info, err := os.Stat(deckDir); err != nil || !info.IsDir() {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, name))

	zw := zip.NewWriter(w)
	defer zw.Close()

	// Walk the deck directory and add every file to the zip.
	// os.DirFS ensures we stay inside deckDir; WalkDir yields only relative paths.
	deckFS := os.DirFS(deckDir)
	err := fs.WalkDir(deckFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil // directories are implicit in zip
		}
		// path is already relative to deckDir (e.g. "deck.html", "assets/vendor/...").
		// Prefix with the deck name to create a self-contained top-level folder.
		zipPath := name + "/" + path

		f, err := deckFS.Open(path)
		if err != nil {
			return fmt.Errorf("zip export: open %s: %w", path, err)
		}
		defer f.Close()

		zf, err := zw.Create(zipPath)
		if err != nil {
			return fmt.Errorf("zip export: create zip entry %s: %w", zipPath, err)
		}
		if _, err := io.Copy(zf, f); err != nil {
			return fmt.Errorf("zip export: write %s: %w", zipPath, err)
		}
		return nil
	})
	if err != nil {
		// Headers already sent; log and bail — the partial zip will signal
		// corruption to the client rather than silently truncating.
		log.Printf("zip export: walk error for deck %s: %v", name, err)
	} else {
		log.Printf("zip export: streamed deck %s", name)
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

// isNotExist returns true when err (or its chain) represents a not-found error.
func isNotExist(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such file") ||
		strings.Contains(err.Error(), "not found")
}
