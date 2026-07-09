# slides-builder — Specifications

A local-first, WYSIWYG slide editor built on **reveal.js** — a Google-Slides-style visual
canvas *and* hand/AI-editable HTML source, kept in sync. Runs entirely locally as a single
binary. Designed so a human edits via the canvas and **Claude Code edits the source files**,
both operating on the same reveal.js HTML.

## Goal

Eliminate the alignment / "get it just right" friction of authoring reveal.js decks by hand,
without giving up the open, local, source-editable nature of reveal.js. Capture ~90% of
slides.com's value locally and free, with git as version history and Claude Code as the AI
authoring layer. (See [`../slides-features.md`](../slides-features.md) for the slides.com
feature investigation this project grew out of.)

## Core principles (the non-negotiables)

1. **Source of truth is plain reveal.js HTML on disk.** The editor and Claude Code both read
   and write the same `deck.html`. See [Document model](document-model.md).
2. **Offline-first.** All core editing and presenting works with zero network. Only image
   *acquisition* helpers need the internet, and they always localize what they fetch. See
   [Principles & invariants](principles-and-invariants.md).
3. **Hybrid layout: structured by default, absolute when needed.** Alignment is expressed as
   declared layout *intent*, not coordinates. See [Layout vocabulary](layout-vocabulary.md).
4. **Idempotent round-trip & never destroy the unknown.** Load→save is byte-stable; content
   the canvas can't represent is preserved verbatim. See [Principles & invariants](principles-and-invariants.md).
5. **Single binary.** Go backend with the Svelte frontend embedded via `go:embed`. See
   [Architecture](architecture.md).

## Locked decisions (at a glance)

| Area | Decision |
|---|---|
| Backend | Go (`fsnotify`, file I/O, SSE, serves decks + assets) |
| Distribution | Single static binary via `go:embed` |
| Frontend | Svelte 5 + TypeScript + Tailwind, built with Vite |
| Renderer | reveal.js in a sandboxed `<iframe>` |
| Document model | Source-preserving element tree (raw bytes; verbatim passthrough) |
| Code pane | CodeMirror 6 |
| Undo/redo | Snapshot-based (session-only; git is durable history) |
| Concurrency | Turn-taking + reload over SSE |
| Logical canvas | 1920×1080, configurable aspect ratio |
| Layout contract | `data-*` attributes; editor owns layout, you own styling |
| Project layout | `decks/<name>/{deck.html, custom.css, assets/}` |
| Workspace root | `--dir` › `$SLIDES_DIR` › nearest ancestor with `decks/` › error |
| AI interface | Claude Code **skill** + CLI first; MCP later |

## Spec index

Read roughly in this order — the foundations come first — but each spec stands alone.

| Spec | Concern |
|---|---|
| [Architecture](architecture.md) | Tech stack, runtime, components, data flow |
| [Document model](document-model.md) | Source of truth, DOM-as-model, passthrough, element IDs |
| [Layout vocabulary](layout-vocabulary.md) | The 5 primitives, `data-*` contract, alignment-as-intent, leaf blocks |
| [Canvas & interaction](canvas-interaction.md) | Coordinate/scale, selection, guides, snapping, resize, layers panel |
| [Scaling & resolution](scaling-and-resolution.md) | Logical canvas, aspect ratio, present-scale vs editor-zoom |
| [Slide management](slide-management.md) | Navigator, vertical slides, CRUD/reorder/hide |
| [Motion & transitions](motion-and-transitions.md) | Fragments, transitions, auto-animate authoring |
| [Assets & media](assets-and-media.md) | Asset folders, image providers, video, font localization |
| [Theming & styles](theming-and-styles.md) | Themes, `custom.css`, CSS variables, fonts |
| [Presenting & export](presenting-and-export.md) | Edit/present modes, speaker view, PDF, HTML bundle |
| [Claude Code integration](claude-code-integration.md) | Skill, CLI, turn-taking handshake, future MCP |
| [Principles & invariants](principles-and-invariants.md) | Offline-first, round-trip, never-destroy, validation, secrets |
| [Project structure](project-structure.md) | Directory tree, config, git |

> **Build sequencing** lives in [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md), not in
> `specs/`. Specs describe *what & why* (design concerns); the implementation plan describes
> *how & when* (atomic tasks, phases, milestones).

## Glossary

- **Logical canvas** — the fixed 1920×1080 coordinate space slides are authored against;
  reveal scales it uniformly to any screen at present time.
- **Structured element** — content laid out via a layout primitive (stack/row/grid/layers);
  reflows on resize/aspect change.
- **Free element** — an element opted into absolute positioning (`data-free`), using logical
  coordinates. The escape hatch.
- **Inline mark** — allowlisted inline formatting (`strong` / `em` / `u` / `s` / `a` /
  `span[style]`) inside a text leaf; rich text *within* content, addressed by the leaf's
  `data-eid` plus a selection range, not its own element. See [Document model](document-model.md).
- **Passthrough** — HTML the editor doesn't manage but preserves verbatim in the model.
- **`data-eid`** — stable per-element ID stamped by the editor; lets the canvas and Claude
  Code reference the same element.
- **Turn-taking** — concurrency model: human edits, then hands off to Claude Code (or vice
  versa); the editor reloads on external file change.
- **Workspace root** — the directory holding `decks/` (plus `config.toml`, `templates/`,
  `shared/`, `themes/`). Every command resolves one before doing anything; `decks/` is the
  marker that identifies it. See [Project structure](project-structure.md).
