// Package server implements the slides-builder HTTP server.
//
// Routes:
//
//	GET  /health           → 200 OK
//	GET  /api/decks        → JSON list of deck names
//	GET  /api/decks/{name} → deck.html contents
//	PUT  /api/decks/{name} → write deck.html atomically
//	GET  /decks/{name}/... → static deck files (deck.html + assets/, for the iframe)
//	GET  /events           → SSE stream of watcher events
//	GET  /                 → embedded Svelte SPA (falls back to index.html)
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"slides-builder/internal/deck"
	"slides-builder/internal/watch"
)

// Server holds the HTTP mux and its dependencies.
type Server struct {
	root    string
	watcher *watch.Watcher
	mux     *http.ServeMux
}

// New creates a Server.  root is the workspace root directory.
// staticFS is the embedded frontend filesystem (web/dist); pass nil to skip
// serving static files (useful in tests).
func New(root string, w *watch.Watcher, staticFS fs.FS) *Server {
	s := &Server{
		root:    root,
		watcher: w,
		mux:     http.NewServeMux(),
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
	s.mux.HandleFunc("GET /api/decks", s.handleDeckList)
	s.mux.HandleFunc("GET /api/decks/{name}", s.handleDeckRead)
	s.mux.HandleFunc("PUT /api/decks/{name}", s.handleDeckWrite)
	s.mux.HandleFunc("GET /decks/{name}/{path...}", s.handleDeckStatic)
	s.mux.HandleFunc("GET /events", s.handleSSE)

	if staticFS != nil {
		s.mux.Handle("/", spaHandler(staticFS))
	}
}

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

	// os.DirFS confines all access to deckDir; ServeFileFS sets Content-Type
	// from the file extension and handles conditional/range requests.
	http.ServeFileFS(w, r, os.DirFS(deckDir), rel)
}

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

// isNotExist returns true when err (or its chain) represents a not-found error.
func isNotExist(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such file") ||
		strings.Contains(err.Error(), "not found")
}
