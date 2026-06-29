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
   and write the same `deck.html`. See [02](02-document-model.md).
2. **Offline-first.** All core editing and presenting works with zero network. Only image
   *acquisition* helpers need the internet, and they always localize what they fetch. See
   [12](12-principles-and-invariants.md).
3. **Hybrid layout: structured by default, absolute when needed.** Alignment is expressed as
   declared layout *intent*, not coordinates. See [03](03-layout-vocabulary.md).
4. **Idempotent round-trip & never destroy the unknown.** Load→save is byte-stable; content
   the canvas can't represent is preserved verbatim. See [12](12-principles-and-invariants.md).
5. **Single binary.** Go backend with the Svelte frontend embedded via `go:embed`. See
   [01](01-architecture.md).

## Locked decisions (at a glance)

| Area | Decision |
|---|---|
| Backend | Go (`fsnotify`, file I/O, SSE, serves decks + assets) |
| Distribution | Single static binary via `go:embed` |
| Frontend | Svelte 5 + TypeScript + Tailwind, built with Vite |
| Renderer | reveal.js in a sandboxed `<iframe>` |
| Document model | DOM-as-model with verbatim passthrough |
| Code pane | CodeMirror 6 |
| Undo/redo | Snapshot-based (session-only; git is durable history) |
| Concurrency | Turn-taking + reload over SSE |
| Logical canvas | 1920×1080, configurable aspect ratio |
| Layout contract | `data-*` attributes; editor owns layout, you own styling |
| Project layout | `decks/<name>/{deck.html, custom.css, assets/}` |
| AI interface | Claude Code **skill** + CLI first; MCP later |

## Spec index

| # | Spec | Concern |
|---|---|---|
| 01 | [Architecture](01-architecture.md) | Tech stack, runtime, components, data flow |
| 02 | [Document model](02-document-model.md) | Source of truth, DOM-as-model, passthrough, element IDs |
| 03 | [Layout vocabulary](03-layout-vocabulary.md) | The 5 primitives, `data-*` contract, alignment-as-intent, leaf blocks |
| 04 | [Canvas & interaction](04-canvas-interaction.md) | Coordinate/scale, selection, guides, snapping, resize, layers panel |
| 05 | [Scaling & resolution](05-scaling-and-resolution.md) | Logical canvas, aspect ratio, present-scale vs editor-zoom |
| 06 | [Slide management](06-slide-management.md) | Navigator, vertical slides, CRUD/reorder/hide |
| 07 | [Motion & transitions](07-motion-and-transitions.md) | Fragments, transitions, auto-animate authoring |
| 08 | [Assets & media](08-assets-and-media.md) | Asset folders, image providers, video, font localization |
| 09 | [Theming & styles](09-theming-and-styles.md) | Themes, `custom.css`, CSS variables, fonts |
| 10 | [Presenting & export](10-presenting-and-export.md) | Edit/present modes, speaker view, PDF, HTML bundle |
| 11 | [Claude Code integration](11-claude-code-integration.md) | Skill, CLI, turn-taking handshake, future MCP |
| 12 | [Principles & invariants](12-principles-and-invariants.md) | Offline-first, round-trip, never-destroy, validation, secrets |
| 13 | [Project structure](13-project-structure.md) | Directory tree, config, git |

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
- **Passthrough** — HTML the editor doesn't manage but preserves verbatim in the model.
- **`data-eid`** — stable per-element ID stamped by the editor; lets the canvas and Claude
  Code reference the same element.
- **Turn-taking** — concurrency model: human edits, then hands off to Claude Code (or vice
  versa); the editor reloads on external file change.
