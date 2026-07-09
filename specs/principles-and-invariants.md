# Principles & invariants

**Status:** decided

Cross-cutting rules every other spec depends on.

## Offline-first

- **Core editing and presenting work with zero network.**
- reveal.js, highlight.js, KaTeX, themes, and **fonts** are bundled/self-hosted
  (`go:embed` into the binary or copied into the deck) — never CDN-linked.
- Fonts are downloaded once (online) and localized into `assets/fonts/`
  (see [Theming & styles](theming-and-styles.md)).
- The **only** network-dependent features are image-acquisition helpers (Unsplash, Giphy,
  Gemini), and they **always localize** what they fetch and degrade gracefully offline
  (see [Assets & media](assets-and-media.md)).

## Idempotent round-trip

- `parse → model → serialize` is **stable**: loading a deck and saving with no edits produces
  **no diff**.
- This is a **tested invariant** — a golden-file corpus of decks (including AI-authored and
  edge-case HTML) must survive a load/save cycle byte-stable.
- Without it, the editor and Claude Code would churn each other's files.

## Never destroy the unknown

- HTML the canvas can't fully represent (custom widgets, unknown structure, plugins) is
  **preserved verbatim** via passthrough ([Document model](document-model.md)).
- Such elements/slides get a small **"source only / partially editable"** badge rather than
  being dropped or mangled. Trust over cleverness.

## Input sanitization

- Content entered through `contenteditable` or **paste** is sanitized before it reaches the
  model: only the inline-mark allowlist survives ([Document model](document-model.md)), and **scripts,
  event handlers, external resource URLs, and `javascript:` link hrefs are stripped**. This
  protects both the offline invariant (no smuggled remote resources) and the document model (no
  arbitrary HTML soup).
- Pasted images are localized through the asset pipeline ([Assets & media](assets-and-media.md)), never
  left as a remote `src`.

## Validation

- `slides validate` ([Claude Code integration](claude-code-integration.md)) gates both Claude Code edits and the
  editor's save path. Malformed decks are surfaced, not silently broken.

## Testing

Three tiers, each catching what the one below can't:

- **Unit** — Go (`go test ./...`) and frontend (vitest): model, layout, slide/motion ops,
  coordinate math, stores. Fast, pure, the bulk of coverage.
- **Golden round-trip** — the byte-stability corpus above (a tested invariant, not just a
  suite).
- **End-to-end (Playwright)** — a browser drives the **built binary** (embedded frontend +
  real Go API + real deck files), exercising the flows units can't reach: select → inspect →
  edit → autosave, delete via keyboard, pane collapse/resize, source↔selection sync, create
  deck, theme switching, present/export. Uses the official `mcr.microsoft.com/playwright`
  image already on the host. **Runs offline** (no external URLs loaded) — an e2e assertion
  doubles as a live offline-guard over real loaded pages (promotes X-1 from a template test).
  e2e is the layer that confirms the "needs visual/browser verification" items the unit suites
  have always had to leave open.

## Secrets

- API keys (Unsplash / Giphy / Gemini) come from **env vars or a gitignored local config** —
  never committed in `config.toml` (see [Project structure](project-structure.md)).

## Versioning

- **Git is the durable revision history** (each deck folder is git-friendly: HTML + assets +
  CSS). The snapshot undo stack ([Canvas & interaction](canvas-interaction.md)) is session-only.

## Related

All specs depend on these.
