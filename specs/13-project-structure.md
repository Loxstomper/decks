# 13 — Project structure

**Status:** decided

## Workspace layout

```
slides-builder            # the single Go binary (Svelte frontend embedded via go:embed)
config.toml               # editor prefs, grid size, provider settings (no secrets)
decks/
  my-talk/
    deck.html             # source of truth (reveal config inline)
    custom.css            # per-deck styling; CSS custom properties
    assets/               # images, video, fonts — self-contained
      fonts/              # downloaded/self-hosted fonts (offline)
templates/                # reusable slide/layout snippets (user/Claude-authored layout presets)
shared/                   # optional source library (copied into decks on insert)
themes/                   # custom reveal themes (optional)
```

## Notes

- **Deck = a folder.** `deck.html` + `custom.css` + `assets/`. Self-contained and portable
  (see [08](08-assets-and-media.md)).
- **Decks are git-friendly.** Git is the durable history ([12](12-principles-and-invariants.md)).
- **Secrets** (Unsplash / Giphy / Gemini keys) come from **env vars or a gitignored local
  config file**, never committed `config.toml`.
- **`config.toml`** holds non-secret editor preferences (default aspect ratio, grid size,
  enabled providers, etc.).
- **The binary is workspace-relative:** drop it into a workspace containing `decks/` and run.
- **`templates/`** holds **slide-layout presets** — `<section>` snippets listed (alongside the
  bundled built-in presets) via `GET /api/templates` and applied per slide
  ([06](06-slide-management.md) "Slide layouts"). User- and Claude-authored; offline.

## Related

[01](01-architecture.md) · [08](08-assets-and-media.md) · [12](12-principles-and-invariants.md)
