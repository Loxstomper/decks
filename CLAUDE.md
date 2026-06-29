# CLAUDE.md — operational notes

Build status & progress live in `IMPLEMENTATION_PLAN.md`, not here. Keep this file
operational only (commands, gotchas).

## Layout
- Go backend: `cmd/slides` (entrypoint + CLI), `internal/{config,deck,server,watch}`.
- Frontend: `web/` (Svelte 5 + TS + Vite + Tailwind). Embedded into the binary via `web/embed.go` (`//go:embed all:dist`).

## Build & run
- Frontend build **must run before** `go build` (the binary embeds `web/dist/`):
  - `cd web && npm install && npm run build`   # outputs to web/dist/
  - `go build -o slides ./cmd/slides`          # single binary
- Run server: `./slides` (or `go run ./cmd/slides`). Default port **3000** (override in `config.toml`: `port = 8080`).
- Scaffold a deck: `./slides new <name>` → `decks/<name>/{deck.html,custom.css,assets/}` (created **workspace-relative to CWD**, with reveal.js vendored offline into `assets/vendor/reveal/`).
- Re-vendor reveal into an existing deck: `./slides vendor <name>`.

## Dev
- `cd web && npm run dev` (Vite on :5173). Vite proxies `/api` and `/events` to the Go backend on **:3000** (override with `GO_PORT`). Run the Go server separately.

## Test
- Go: `go test ./...`
- Frontend: `cd web && npx vitest run`

## Endpoints
`GET /health` · `GET /api/decks` · `GET|PUT /api/decks/{name}` · `GET /decks/{name}/...` (static deck files: `deck.html` + `assets/`, traversal-guarded; the iframe loads `/decks/{name}/deck.html`) · `GET /events` (SSE) · `GET /` (SPA).
