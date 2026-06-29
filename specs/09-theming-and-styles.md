# 09 — Theming & styles

**Status:** decided

## Summary

Theming via reveal's built-in themes plus a per-deck `custom.css`, with color/font controls
backed by CSS custom properties. All fonts are self-hosted for offline use.

## Decisions

- **Theme picker** — reveal's bundled themes, selectable per deck (bundled locally, not CDN).
  The bundled set includes a **Solarized Dark** theme alongside the existing light
  `solarized` (the two are distinct entries; Solarized Dark is the dark-background variant).
- **`custom.css`** in each deck folder, edited in a CodeMirror 6 pane (the slides.com "Custom
  CSS" / "Theme Editor" equivalent).
- **CSS custom properties** back the editor's color/font controls, so pickers and stylesheet
  stay in sync (e.g., `--accent`, `--heading-font`).
- **Ownership:** styling (Tailwind / inline / `custom.css`) is owned by the user and Claude
  Code; the editor owns only *layout* (see [03](03-layout-vocabulary.md)). The text-color
  control below is the one *narrow, explicit* appearance exception (see "Text appearance").

## Text appearance (per-element color)

- The inspector exposes a **text color** control for the selected text element
  (heading / paragraph / list / leaf). It writes an **inline `style="color: …"`** on that
  element — whole-element scope, not sub-string runs.
- Inline `style` round-trips through the model like any other attribute (the node becomes
  `dirty`, serializes canonically, one undo entry + one autosave) and survives validation.
- Scope is deliberately small: this is the appearance escape hatch for "make this heading
  red," not a rich-text editor. Sub-selection runs, font/size/weight controls, and palette
  swatches are explicitly out of scope for now (a later pass may add a theme-palette picker).
- Because it is the lone appearance property the editor writes, it stays a clear exception to
  the layout-only ownership rule — everything else remains `custom.css` / classes.

## Editor chrome themes (workspace themes)

Distinct from *slide* themes (which ship in the deck output), these restyle the **editor
shell itself** — navigator, panels, toolbars, source pane chrome.

- **Three workspace themes: Dark, Light, Solarized.** Dark is the default (today's look).
- Backed by **CSS custom properties** on the app root (the hardcoded Tailwind chrome tokens —
  `surface`, `surface-raised`, `surface-overlay`, `accent` — become variables a theme sets),
  so switching is a single root-class/variable swap with no per-component changes.
- The choice is an **editor preference**, persisted (config / localStorage), workspace-wide —
  it does not touch any deck's files and never appears in saved decks or exports.

## Fonts (offline-first)

- Choose a font (e.g., from Google Fonts) **once, online**; the editor **downloads the font
  files** into `assets/fonts/` (or a shared font cache) and rewrites `@font-face` to point
  local.
- After that, the deck renders the font with **no network**.
- No CDN `<link>` references in saved decks.

## Related

[03](03-layout-vocabulary.md) · [08](08-assets-and-media.md) · [12](12-principles-and-invariants.md)
