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
- Append a starter slide: `./slides add-slide <name>`.
- Validate a deck (layout contract, unique eids, asset existence, well-formedness, offline guard): `./slides validate <name>` (exit 0 = clean, non-zero + diagnostics = invalid). **Run after editing a deck by hand or with Claude Code.**

## Deck authoring (for Claude Code)
When authoring/editing decks in `decks/`, follow the `slides-authoring` skill (`.claude/skills/slides-authoring/SKILL.md`) and the full contract reference (`docs/AUTHORING.md`): the `data-*` layout vocabulary, `data-eid` rules, offline-first (no external URLs), and turn-taking. Always finish with `./slides validate <name>`.

## Dev
- `cd web && npm run dev` (Vite on :5173). Vite proxies `/api` and `/events` to the Go backend on **:3000** (override with `GO_PORT`). Run the Go server separately.

## Test
- Go: `go test ./...`
- Frontend: `cd web && npx vitest run`

## Endpoints
`GET /health` · `GET /api/decks` · `GET|PUT /api/decks/{name}` · `GET /decks/{name}/...` (static deck files: `deck.html` + `assets/`, traversal-guarded; the iframe loads `/decks/{name}/deck.html`) · `GET /events` (SSE) · `GET /` (SPA).
