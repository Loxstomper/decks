# Assets & media

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

## Image accessibility (alt text)

- Every inserted image carries an **`alt`** attribute, editable from the inspector when an image
  is selected. Provider images seed `alt` from the result description; uploads / drag / paste
  start empty for the author to fill.
- `alt` round-trips like any other attribute (one undo + one autosave, byte-stable) and is the
  one accessibility field the editor surfaces directly. An empty `alt=""` is allowed (decorative
  images); the field just makes it explicit and editable.

## Video

- Local `<video>` referencing `assets/`.
- Optional transcode via the Go backend (`ffmpeg`) when a format is unsupported.

## Fonts

- See [Theming & styles](theming-and-styles.md): fonts are **downloaded and self-hosted** into
  `assets/fonts/` (or a shared font cache) so decks run fully offline.

## Related

[Theming & styles](theming-and-styles.md) · [Principles & invariants](principles-and-invariants.md) · [Project structure](project-structure.md)
