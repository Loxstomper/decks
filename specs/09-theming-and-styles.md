# 09 — Theming & styles

**Status:** decided

## Summary

Theming via reveal's built-in themes plus a per-deck `custom.css`, with color/font controls
backed by CSS custom properties. All fonts are self-hosted for offline use.

## Decisions

- **Theme picker** — reveal's bundled themes, selectable per deck (bundled locally, not CDN).
  The bundled set includes a **Solarized Dark** theme alongside the existing light
  `solarized` (the two are distinct entries; Solarized Dark is the dark-background variant).
  This is the **global deck theme** (a single `<link>` in `<head>`); individual slides may
  override it (see "Per-slide theme override").
- **`custom.css`** in each deck folder, edited in a CodeMirror 6 pane (the slides.com "Custom
  CSS" / "Theme Editor" equivalent).
- **CSS custom properties** back the editor's color/font controls, so pickers and stylesheet
  stay in sync (e.g., `--accent`, `--heading-font`).
- **Ownership:** styling (Tailwind / inline / `custom.css`) is owned by the user and Claude
  Code; the editor owns only *layout* (see [03](03-layout-vocabulary.md)). The text-color
  control below is the one *narrow, explicit* appearance exception (see "Text appearance").

## Per-slide theme override

The global theme is one `<link>` for the whole deck. A slide may **override** it without
giving up offline-first, byte-stability, or PDF fidelity. reveal.js has no native per-slide
theme, so the override is expressed as **declarative attributes resolved by CSS cascade** —
never by swapping stylesheets at runtime (a link-swap on `slidechanged` would add JS and,
fatally, break PDF export, where `?print-pdf` renders every slide visible at once).

### Three layers (cascade resolves them)

1. **Global** — the `<head>` theme `<link>`. The base every slide inherits.
2. **Named per-slide bundle** — `data-theme="<bundled-theme>"` on a `<section>`. A generated,
   vendored stylesheet (`slides-slide-themes.css`, embedded + copied into the deck like
   `slides-layout.css`) carries, for each bundled theme, a scoped block:
   `.reveal section[data-theme="<name>"] { --r-main-color: …; --r-heading-color: …;
   --r-link-color: …; --r-main-font: …; … }`. Because these are the same `--r-*` custom
   properties reveal themes already drive, custom-property **inheritance** pushes them onto
   every element in that slide.
3. **Free-form tweaks** — an arbitrary per-slide override written as inline custom properties
   on the section (`style="--r-heading-color:#fff; --r-main-color:#ddd"`). Closer scope, so it
   layers on top of a named bundle or stands alone.

Resolution is just CSS specificity: inline (3) > scoped bundle (2) > global link (1).

### Backgrounds

`--r-*` vars cannot reach a slide's background — reveal renders backgrounds in a separate
`.backgrounds` layer, not inside the `<section>`. So the background is set with reveal's
**native `data-background-color`** on the section (works in editor, present, and PDF). Applying
a named bundle therefore writes **two** attributes — `data-theme` plus a managed
`data-background-color` (the bundle's background); a free-form background writes just
`data-background-color`. Clearing an override removes the attributes it added.

### Cascade to vertical slides

`data-theme` set on a vertical-stack `<section>` flows to its nested verticals two ways at
once: the `--r-*` vars inherit via CSS, and reveal already propagates a stack's
`data-background-color` to verticals that don't set their own. An inner vertical with its own
`data-theme` wins by closer scope. **Cascade by default, override where set.**

### Authoring & invariants

- **Declarative & byte-stable.** `data-theme`, `data-background-color`, and inline `--r-*`
  vars are plain attributes; writing them marks only that section `dirty` (one undo + one
  autosave) and round-trips byte-stable. Claude Code can author `data-theme` directly.
- **`data-theme` is a recognized attribute**, accepted by `validate` and the editor model
  ([12](12-principles-and-invariants.md)); its value must name a bundled theme. It is *not* a
  layout primitive ([03](03-layout-vocabulary.md)) — it carries no reflow semantics.
- **Offline.** `slides-slide-themes.css` and its `name → background` map are generated at
  vendor time from the bundled theme CSS (`:root`/`.reveal` `--r-*` values) and shipped
  locally — zero external URLs.
- **UI.** The theme picker gains a **Whole deck / This slide** scope toggle (the latter
  enabled when a slide is selected): a named-theme dropdown plus free-form color swatches
  (heading / text / link / background) and a **Clear override → inherit deck** action. Slides
  that override show a small badge in the navigator/thumbnail ([06](06-slide-management.md)).
- **Fidelity caveat.** A named per-slide bundle reproduces a theme's color/font *variables* +
  background — the visible essence — not 100% of its structural CSS. Per-slide theming is for
  accenting individual slides, not byte-identical theme cloning.

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
