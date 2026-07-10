# Architecture

**Status:** decided

## Summary

A Go backend serves a Svelte single-page editor and the deck files; reveal.js renders decks
in a sandboxed iframe; the whole thing ships as one static binary. The Go process owns the
filesystem boundary (read/write/watch); the Svelte client owns the rich editing experience.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | **Go** | File I/O, `fsnotify` watching, SSE, asset handling; plays to owner's expertise; compiles to a single binary. |
| Distribution | **Single binary** via `go:embed` | Put it on `$PATH` and run it against any workspace ([Project structure](project-structure.md)); no Node runtime in production. The binary carries everything a workspace needs: the frontend, the vendored reveal.js + plugins, the bundled themes/layouts, and the Claude Code authoring skill ([Claude Code integration](claude-code-integration.md)). |
| Frontend | **Svelte 5 + TypeScript** | Lightweight, HTML-centric (suits the owner's htmx/Alpine taste); runes give fine-grained reactivity ideal for canvas state. |
| Styling | **Tailwind** | Already familiar; used for editor chrome and for *appearance* styling of slide content (not layout — see [Layout vocabulary](layout-vocabulary.md)). |
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
│  • deck/file API: list, create, read, write, asset upload│
│  • fsnotify watcher → SSE "file changed" events          │
│  • headless-Chrome driver for PDF export                  │
│  • CLI subcommands (decks new / add-slide / validate)   │
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
  (guarded by turn-taking, see [Claude Code integration](claude-code-integration.md)).

## Dev vs prod

- **Dev:** Vite dev server (HMR for editor code) + Go API; Vite proxies API/SSE to Go.
- **Prod:** `go build` with the Vite build output embedded via `go:embed`; one binary serves
  everything.
- **Testing:** Go (`go test`) and frontend unit tests (vitest) plus an **end-to-end suite
  (Playwright)** that drives a real browser against the **built binary**, covering the editing
  flows units can't (see [Principles & invariants](principles-and-invariants.md#testing)).

## Related

[Document model](document-model.md) · [Canvas & interaction](canvas-interaction.md) · [Claude Code integration](claude-code-integration.md) · [Project structure](project-structure.md)
