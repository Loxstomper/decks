# 09 — Theming & styles

**Status:** decided

## Summary

Theming via reveal's built-in themes plus a per-deck `custom.css`, with color/font controls
backed by CSS custom properties. All fonts are self-hosted for offline use.

## Decisions

- **Theme picker** — reveal's bundled themes, selectable per deck (bundled locally, not CDN).
- **`custom.css`** in each deck folder, edited in a CodeMirror 6 pane (the slides.com "Custom
  CSS" / "Theme Editor" equivalent).
- **CSS custom properties** back the editor's color/font controls, so pickers and stylesheet
  stay in sync (e.g., `--accent`, `--heading-font`).
- **Ownership:** styling (Tailwind / inline / `custom.css`) is owned by the user and Claude
  Code; the editor owns only *layout* (see [03](03-layout-vocabulary.md)).

## Fonts (offline-first)

- Choose a font (e.g., from Google Fonts) **once, online**; the editor **downloads the font
  files** into `assets/fonts/` (or a shared font cache) and rewrites `@font-face` to point
  local.
- After that, the deck renders the font with **no network**.
- No CDN `<link>` references in saved decks.

## Related

[03](03-layout-vocabulary.md) · [08](08-assets-and-media.md) · [12](12-principles-and-invariants.md)
