# 01 — Architecture

**Status:** decided

## Summary

A Go backend serves a Svelte single-page editor and the deck files; reveal.js renders decks
in a sandboxed iframe; the whole thing ships as one static binary. The Go process owns the
filesystem boundary (read/write/watch); the Svelte client owns the rich editing experience.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | **Go** | File I/O, `fsnotify` watching, SSE, asset handling; plays to owner's expertise; compiles to a single binary. |
| Distribution | **Single binary** via `go:embed` | Drop the binary into a workspace and run; no Node runtime in production. |
| Frontend | **Svelte 5 + TypeScript** | Lightweight, HTML-centric (suits the owner's htmx/Alpine taste); runes give fine-grained reactivity ideal for canvas state. |
| Styling | **Tailwind** | Already familiar; used for editor chrome and for *appearance* styling of slide content (not layout — see [03](03-layout-vocabulary.md)). |
| Build | **Vite** | Dev server + HMR for the editor app; bundles the embedded frontend. |
| Renderer | **reveal.js** in sandboxed `<iframe>` | Isolates reveal's global CSS/keyboard from editor chrome; clean coordinate space; present mode = load the iframe with no overlay. |
| Code pane | **CodeMirror 6** | Lighter than Monaco; ample for HTML/CSS viewing/editing. |

> **Framework note:** the React-vs-Svelte call went to Svelte because this is the owner's
> personal tool and matches their taste; the only real cost is a smaller ecosystem / less
> training data than React. Accepted.

## Components

```
┌─────────────────────────────────────────────────────────┐
│ Go backend (single binary)                               │
│  • static server (embedded Svelte app)                   │
│  • deck/file API: read, write, list, asset upload        │
│  • fsnotify watcher → SSE "file changed" events          │
│  • headless-Chrome driver for PDF export                  │
│  • CLI subcommands (slides new / add-slide / validate)   │
└───────────────▲───────────────────────┬─────────────────┘
       SSE + REST│                       │ serves
                 │                       ▼
┌────────────────┴───────────────────────────────────────┐
│ Svelte editor (browser)                                 │
│  ┌───────────┬──────────────────┬────────────────────┐ │
│  │ Navigator │ Canvas (iframe +  │ Outline+Properties │ │
│  │ (slides)  │  overlay)         │  / Source (CM6)    │ │
│  └───────────┴──────────────────┴────────────────────┘ │
│  • DOM-as-model + snapshot undo                         │
│  • coordinate/scale transform                           │
│  • SSE listener → reload on external change             │
└─────────────────────────────────────────────────────────┘
```

## Data flow

- **Source → canvas:** read `deck.html` → parse into DOM model → render in iframe + build
  overlay. Editing the source pane re-parses (debounced).
- **Canvas → source:** canvas mutates DOM model → serialize → autosave to disk (each command).
- **External (Claude Code) → canvas:** fsnotify detects write → SSE event → client re-parses
  (guarded by turn-taking, see [11](11-claude-code-integration.md)).

## Dev vs prod

- **Dev:** Vite dev server (HMR for editor code) + Go API; Vite proxies API/SSE to Go.
- **Prod:** `go build` with the Vite build output embedded via `go:embed`; one binary serves
  everything.

## Related

[02](02-document-model.md) · [04](04-canvas-interaction.md) · [11](11-claude-code-integration.md) · [13](13-project-structure.md)
