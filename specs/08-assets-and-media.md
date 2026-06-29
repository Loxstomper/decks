# 08 — Assets & media

**Status:** decided (Gemini provider deferred)

## Summary

Assets are stored per-deck and self-contained. Anything fetched from the internet is always
**localized** into the deck so it works offline forever after.

## Storage model

- **`decks/<name>/assets/` is canonical.** Dropping/pasting an image copies it there and
  inserts a relative `src`. Keeps each deck independently portable and offline.
- **`shared/` (top-level) is an optional *source library*.** Inserting from `shared/`
  **copies** the file into the deck's `assets/` — never creates a cross-deck reference. So
  decks stay self-contained.

## Image providers (pluggable "acquire → localize" pipeline)

All providers fetch from the internet, then **download into `assets/`** and rewrite the `src`
to local. They are the only network-dependent features, and degrade gracefully offline.

| Provider | Status | Notes |
|---|---|---|
| Local upload / drag / paste | core | No network. |
| Unsplash search | v1 | API key in config. |
| Giphy search | v1 | API key in config. |
| **Gemini image generation** | **deferred** | Generate from a prompt → save into `assets/`. Same pipeline; drops in with no rework. |

Design the asset layer so providers are interchangeable behind one "image provider" interface.

## Video

- Local `<video>` referencing `assets/`.
- Optional transcode via the Go backend (`ffmpeg`) when a format is unsupported.

## Fonts

- See [09](09-theming-and-styles.md): fonts are **downloaded and self-hosted** into
  `assets/fonts/` (or a shared font cache) so decks run fully offline.

## Related

[09](09-theming-and-styles.md) · [12](12-principles-and-invariants.md) · [13](13-project-structure.md)
