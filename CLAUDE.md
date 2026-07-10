# CLAUDE.md — operational notes

Build status & progress live in `IMPLEMENTATION_PLAN.md`, not here. Keep this file
operational only (commands, gotchas).

## Layout
- Go backend: `cmd/decks` (entrypoint + CLI), `internal/{config,deck,server,watch}`.
- Frontend: `web/` (Svelte 5 + TS + Vite + Tailwind). Embedded into the binary via `web/embed.go` (`//go:embed all:dist`).

## Build & run
- Frontend build **must run before** `go build` (the binary embeds `web/dist/`):
  - `cd web && npm ci && npm run build`        # outputs to web/dist/. `ci`, never `install`:
                                               # installs from the lockfile, never rewrites it.
  - `go build -o bin/decks ./cmd/decks`          # single binary
- Run server: `decks` (or `go run ./cmd/decks`). Default port **3000** (override in `config.toml`: `port = 8080`).
- Scaffold a deck: `decks new <name>` → `decks/<name>/{deck.html,custom.css,assets/}` (with reveal.js vendored offline into `assets/vendor/reveal/`).
- Re-vendor reveal into an existing deck: `decks vendor <name>`.
- Append a starter slide: `decks add-slide <name>`.
- Validate a deck (layout contract, unique eids, asset existence, well-formedness, offline guard): `decks validate <name>` (exit 0 = clean, non-zero + diagnostics = invalid). **Run after editing a deck by hand or with Claude Code.**
- (Re)install the authoring skill into the workspace's `.claude/skills/`: `decks install-skill` (auto-run by `decks new` on a fresh root; a no-op when already current).

## Workspace resolution
Every command resolves a **workspace root** — the directory holding `decks/` — before doing
anything: `--dir <path>` (global, *before* the subcommand) › `$DECKS_DIR` › nearest ancestor of
the cwd containing `decks/`. So the binary runs from `$PATH`, from anywhere, including inside a
deck folder. The resolved root is always logged.
- **`new` is the only command that creates a workspace.** Everything else exits non-zero outside
  one rather than scaffolding an unproven root. `--dir`/`$DECKS_DIR` paths must already exist.
- **`<deck>` may be a name, a path (`decks/my-talk`, or any path inside it), or `.`** for
  `vendor`/`upgrade`/`add-slide`/`validate`. A bare word is always a *name*, never a relative path
  — otherwise `validate assets` inside `decks/my-talk/` would silently mean `my-talk`. An absolute
  deck path also locates its workspace, so it works from anywhere (unless `--dir` pins one).
  `new` still takes a bare name.
- Testing against a throwaway root: `decks --dir /tmp/ws new intro` then `decks --dir /tmp/ws`.

## Deck authoring (for Claude Code)
When authoring/editing decks in `decks/`, follow the `decks-authoring` skill and its full contract reference (`AUTHORING.md`, installed beside it): the `data-*` layout vocabulary, `data-eid` rules, offline-first (no external URLs), and turn-taking. Always finish with `decks validate <name>`.

**Edit the skill at its source, `internal/skill/assets/decks-authoring/`** — never at
`.claude/skills/decks-authoring/`, which is a generated copy the binary installs (and this repo
commits so a fresh clone has it). `TestRepoInstalledCopyIsCurrent` fails if they diverge; after
changing the source, run `decks install-skill` from the repo root and commit both.

## Dev
- `cd web && npm run dev` (Vite on :5173). Vite proxies `/api` and `/events` to the Go backend on **:3000** (override with `GO_PORT`). Run the Go server separately.

## Test
- Go: `go test ./...` (+ `gofmt -l cmd/ internal/` — must print nothing; `go vet ./...`).
- Frontend types: `cd web && npm run check` (svelte-check). **Not** bare `npx tsc` — it can't
  resolve types exported from `<script module>` in `.svelte` files and reports phantom errors.
- Frontend: `cd web && npx vitest run`
- E2e (Playwright vs the built binary): `cd web && npm run test:e2e` (builds FE+binary, spins a temp
  workspace on port 19999, runs Chromium). In CI/without local browsers, run inside the host
  `mcr.microsoft.com/playwright` image via `npm run test:e2e:docker`. Specs live in `web/e2e/*.spec.ts`.

## Gotchas
- **The layout contract is encoded five times.** Independent re-implementations of the same
  `data-*` vocabulary; changing it means changing all of them, or they silently disagree:
  - `web/src/lib/model/layout.ts` — TS, the editor's enums/getters/setters.
  - `internal/validate/validate.go` — Go, the CLI + save-path `validate` (allowed-sets must
    match `layout.ts`, else `validate` and the editor disagree).
  - `internal/deck/vendor/decks-layout-init.js` — applies the **numeric** attrs
    (`data-gap/pad/cols/rows/grow/basis/span`, free `data-x/y/w/h/rot`) at runtime in the deck.
  - `web/src/lib/slides/thumbnail-layout.ts` — a static port of that same numeric vocabulary to
    inline styles, because navigator thumbnails are **script-free** and never run the init JS.
  - `internal/skill/assets/decks-authoring/{SKILL.md,AUTHORING.md}` — prose, the copy the binary
    installs into each workspace for Claude Code. A stale one is the worst kind: the deck looks
    authored correctly and fails `validate`.
- **Adding a vendored plugin or a `<head>` link only fixes *new* decks.** The scaffold template
  and `Vendor()` copy files; existing decks keep their old `deck.html`. Anything the editor can
  insert into *any* deck (chart, QR, per-slide themes) must also be injected into existing decks
  by `deck.Upgrade` (`decks upgrade <name>`) — idempotent, byte-stable, matching the scaffold's
  bytes — or the inserted block silently renders nowhere. See `injectQrPlugin` /
  `injectSlideThemesLink` for the pattern.
- **JS-rendered leaves must paint a thumbnail placeholder** (code, KaTeX, Chart, QR). The
  thumbnail iframe runs no scripts; this is a documented fidelity gap, not a bug (spec slide-management).
- **Optional external tools degrade gracefully** (offline-first): image providers need
  `UNSPLASH_ACCESS_KEY` / `GIPHY_API_KEY` (absent → provider disabled); PDF export needs Chrome
  via `$CHROME_BIN` or a common name (absent → 503); video transcode needs `ffmpeg` (absent →
  skipped). `GET /api/capabilities` reports what's available so the UI can adapt.
- **Generated/gitignored, never commit:** the `decks` binary, and the workspace runtime dirs
  `decks/`, `shared/` (re-created/refreshed on run). Rebuild `web/dist/` before `go build`.

## Endpoints
`GET /health` · `GET /api/decks` · `GET|PUT /api/decks/{name}` · `GET /decks/{name}/...` (static deck files: `deck.html` + `assets/`, traversal-guarded; the iframe loads `/decks/{name}/deck.html`) · `GET /events` (SSE) · `GET /` (SPA).
Deck-config rewrites (byte-stable edits to `Reveal.initialize` in deck.html): `POST /api/decks/{name}/slide-number` (`{enabled,format}`) · `POST /api/decks/{name}/autoslide` (`{ms,loop}`). The present route (`GET /present/{name}`) injects the chalkboard + laser plugins **in-memory only** (deck.html on disk stays byte-identical).
