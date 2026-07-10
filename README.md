# decks

A local, offline WYSIWYG editor for [reveal.js](https://revealjs.com) decks — where the HTML on
disk stays the source of truth.

Drag things around on a canvas. Or edit `deck.html` in your editor. Or let Claude Code edit it.
All three write the same file, and none of them destroys the others' work.

<!-- TODO: demo.gif — canvas drag on the left, deck.html updating on the right -->

## Quickstart

Download a binary from [Releases](https://github.com/Loxstomper/decks/releases), put it on your
`$PATH`, then:

```bash
decks new my-talk     # scaffold a deck (and a workspace, if there isn't one)
decks                 # start the editor on http://localhost:3000
```

That's it. No account, no network, no `node_modules`. reveal.js is vendored into your deck, so it
keeps working on a plane, in five years, after this project is abandoned.

## The idea

Hand-authoring reveal.js means fighting CSS to center two boxes. Slides.com solves that, but your
deck becomes a row in someone's database.

`decks` keeps the deck as plain reveal.js HTML and puts a canvas over it. Alignment is recorded as
**declared intent**, not pixel coordinates:

```html
<div data-lay="row" data-gap="64" data-align="center">
  <h2>Before</h2>
  <h2>After</h2>
</div>
```

You dragged that in the canvas; this is what landed on disk. It reads like English, so Claude Code
can edit it too. And because nothing is a coordinate, it survives a resolution change, an
aspect-ratio change, and an edit that makes the text longer.

There are five layout primitives — `stack`, `row`, `grid`, `layers`, and `free`, the
absolute-positioning escape hatch, which uses a 1920×1080 logical space that reveal.js scales to
any screen. That's the whole vocabulary.

Two properties hold everywhere:

- **Idempotent round-trip.** Load → save is byte-stable. Your formatting survives.
- **Never destroy the unknown.** HTML the canvas can't represent is preserved verbatim and marked
  "source only" rather than dropped.

## Claude Code

The binary embeds an authoring skill and installs it into your workspace's
`.claude/skills/decks-authoring/` — so the tool ships the document that teaches an AI how to use
the tool, and the two can't drift.

```bash
decks validate my-talk    # layout contract, unique element ids, assets exist, no external URLs
```

Claude Code edits `deck.html`, runs `decks validate`, and the editor reloads over SSE. You take
turns; git is the history.

## What's in it

Slide navigator with thumbnails, vertical slides, per-slide themes and backgrounds, smart guides
and snapping, an outline panel, a command palette, and a CodeMirror 6 source pane wired to the
canvas selection. Fragments, transitions, and auto-animate. Charts, QR codes, code highlighting,
and KaTeX math. Speaker view, a chalkboard and laser pointer while presenting, PDF export, and a
self-contained HTML bundle.

Optional extras degrade gracefully when their dependency is missing: image search needs
`UNSPLASH_ACCESS_KEY` / `GIPHY_API_KEY`, PDF export needs Chrome on `$CHROME_BIN`, video transcode
needs `ffmpeg`. Everything else works with zero network.

## Workspace

A workspace is any directory containing `decks/`. Every command resolves one before doing
anything — `--dir <path>`, then `$DECKS_DIR`, then the nearest ancestor of the cwd with a `decks/`
in it — so the binary runs from anywhere, including from inside a deck folder.

```
my-workspace/
├── decks/my-talk/{deck.html, custom.css, assets/}
├── .claude/skills/decks-authoring/
└── config.toml          # optional; port, aspect_ratio, grid_size
```

`decks new` is the only command that creates a workspace. The rest exit non-zero outside one
rather than scaffolding an unproven directory somewhere you didn't mean.

## Status

**Alpha.** It works, and I use it — but it is weeks old and has one author. Expect sharp edges,
and please open an issue when you find one.

Known gaps, in the order you'll hit them:

- Navigator thumbnails render without scripts, so JS-drawn leaves (code highlighting, KaTeX,
  charts, QR) paint a placeholder instead of their content. Deliberate; the deck itself is fine.
- PDF export needs Chrome and returns 503 without it.
- The end-to-end browser suite only recently started running in CI. Several features rest mostly
  on unit coverage.
- The `data-*` layout contract is implemented independently in five places. They agree today, and
  a test pins the two that can be pinned — but a change to the vocabulary has to touch all five.

## Build from source

The binary embeds `web/dist/`, so **the frontend build must run first**:

```bash
cd web && npm install && npm run build
cd .. && go build -o bin/decks ./cmd/decks
```

`go install` does not work and cannot be made to work: it never runs the frontend build, so it
produces a binary with no editor in it. (The binary tells you so if you try.) Use a release binary
or the two commands above.

Tests:

```bash
go test ./... && gofmt -l cmd/ internal/ && go vet ./...
cd web && npm run check && npx vitest run   # svelte-check, not tsc
cd web && npm run test:e2e                  # Playwright against the built binary
```

## Design

The `specs/` directory is the real documentation: thirteen documents covering the document model,
the layout vocabulary, canvas interaction, theming, presenting, and the invariants that hold it
together. Start at [`specs/README.md`](specs/README.md). Specs describe *what and why*;
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) describes *how and when*.

## How this was built

Most of this codebase was written by [Claude Code](https://claude.com/claude-code) running in a
loop. I wrote the specs, then a prompt that told the agent to pick the single most important
unfinished task, implement it, test it, update the plan, and commit — over and over.
[`PROMPT_BUILD.md`](PROMPT_BUILD.md) is that prompt. Only one line has been removed from it since:
an instruction to tag every green build, which is what produced the 21 `0.0.x` tags that used to
be in this repo.

It went further than I expected, and the places where it went wrong are the interesting part —
that layout contract implemented five times is exactly the kind of cross-cutting duplication a
phase-at-a-time agent is worst at noticing.

## License

MIT — see [`LICENSE`](LICENSE).

reveal.js, KaTeX, Chart.js, highlight.js, the chalkboard plugin, and qrcode-generator are vendored
and redistributed under their own licenses. Each one's license text sits beside its code and is
copied into every deck you scaffold, so a deck you share already carries the notices it needs. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
