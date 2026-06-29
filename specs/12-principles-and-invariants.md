# 12 — Principles & invariants

**Status:** decided

Cross-cutting rules every other spec depends on.

## Offline-first

- **Core editing and presenting work with zero network.**
- reveal.js, highlight.js, KaTeX, themes, and **fonts** are bundled/self-hosted
  (`go:embed` into the binary or copied into the deck) — never CDN-linked.
- Fonts are downloaded once (online) and localized into `assets/fonts/`
  (see [09](09-theming-and-styles.md)).
- The **only** network-dependent features are image-acquisition helpers (Unsplash, Giphy,
  Gemini), and they **always localize** what they fetch and degrade gracefully offline
  (see [08](08-assets-and-media.md)).

## Idempotent round-trip

- `parse → model → serialize` is **stable**: loading a deck and saving with no edits produces
  **no diff**.
- This is a **tested invariant** — a golden-file corpus of decks (including AI-authored and
  edge-case HTML) must survive a load/save cycle byte-stable.
- Without it, the editor and Claude Code would churn each other's files.

## Never destroy the unknown

- HTML the canvas can't fully represent (custom widgets, unknown structure, plugins) is
  **preserved verbatim** via passthrough ([02](02-document-model.md)).
- Such elements/slides get a small **"source only / partially editable"** badge rather than
  being dropped or mangled. Trust over cleverness.

## Validation

- `slides validate` ([11](11-claude-code-integration.md)) gates both Claude Code edits and the
  editor's save path. Malformed decks are surfaced, not silently broken.

## Secrets

- API keys (Unsplash / Giphy / Gemini) come from **env vars or a gitignored local config** —
  never committed in `config.toml` (see [13](13-project-structure.md)).

## Versioning

- **Git is the durable revision history** (each deck folder is git-friendly: HTML + assets +
  CSS). The snapshot undo stack ([04](04-canvas-interaction.md)) is session-only.

## Related

All specs depend on these.
