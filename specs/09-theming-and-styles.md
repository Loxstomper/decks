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
   `slides-layout.css`) carries, for each bundled theme, a scoped block that both **rebinds the
   theme's `--r-*` custom properties** *and* **re-asserts the colour properties at section
   scope**:

   ```css
   .reveal section[data-theme="<name>"] {
     --r-main-color: …; --r-heading-color: …; --r-link-color: …; --r-main-font: …; …
     color: var(--r-main-color);                 /* body text — see below */
   }
   .reveal section[data-theme="<name>"] :is(h1,h2,h3,h4,h5,h6) { color: var(--r-heading-color); }
   .reveal section[data-theme="<name>"] a { color: var(--r-link-color); }
   ```

   Rebinding the vars alone is **not sufficient**. reveal sets body `color: var(--r-main-color)`
   on **`.reveal`** — an *ancestor* of the section — and `color` inherits as a *computed* value,
   so a descendant section that only rebinds `--r-main-color` never recomputes its body text
   colour. Headings and links *do* update from the rebound vars (their rules match elements
   *inside* the section), but **body text must be re-asserted explicitly** with a `color`
   declaration scoped to the section. The block re-declares `color` for the section (and
   heading/link rules for robustness) so a per-slide theme restyles text, headings, *and* links —
   not just the background.
3. **Free-form tweaks** — an arbitrary per-slide override written as inline custom properties
   on the section (`style="--r-heading-color:#fff; --r-main-color:#ddd"`). Closer scope, so it
   layers on top of a named bundle or stands alone.

Resolution is just CSS specificity: inline (3) > scoped bundle (2) > global link (1).

### Backgrounds

`--r-*` vars cannot reach a slide's background — reveal renders backgrounds in a separate
`.backgrounds` layer, not inside the `<section>`. So the background is set with reveal's
**native `data-background-*`** on the section (works in editor, present, and PDF). Applying
a named bundle therefore writes the bundle's background as a **managed `data-background-color`**
alongside `data-theme`. The full background surface (color/image/gradient/video) is the unified
**Slide background** control below — the per-slide theme's color simply writes through it.

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
- **The deck must link the stylesheet.** `data-theme` only takes effect if the deck's `<head>`
  links `slides-slide-themes.css`. The scaffold template links it; decks created *before*
  per-slide theming are migrated by `slides upgrade` / `vendor`, which **injects the missing
  `<link>`** (byte-stable otherwise). Without the link, only the managed `data-background-color`
  shows — the symptom that flagged this.
- **UI.** The theme picker gains a **Whole deck / This slide** scope toggle (the latter
  enabled when a slide is selected): a named-theme dropdown plus free-form color swatches
  (heading / text / link / background) and a **Clear override → inherit deck** action. Slides
  that override show a small badge in the navigator/thumbnail ([06](06-slide-management.md)).
- **Fidelity caveat.** A named per-slide bundle reproduces a theme's color/font *variables* +
  background — the visible essence — not 100% of its structural CSS. Per-slide theming is for
  accenting individual slides, not byte-identical theme cloning.

## Slide background

A unified per-slide **background** control covering color, image, gradient, and video — all via
reveal's native `data-background-*` attributes on the `<section>`, so the editor canvas renders
them WYSIWYG and present/PDF match. Color (above) and the other types are one surface, not two.

- **Types (one control):**
  - *Color* — `data-background-color` (shared with the per-slide theme override).
  - *Image* — `data-background-image` (a **localized** asset), with `data-background-size`
    (cover / contain / explicit), `data-background-position`, `data-background-repeat`, and
    `data-background-opacity`.
  - *Gradient* — `data-background-gradient` (a CSS gradient string).
  - *Video* — `data-background-video` (a **localized** asset), with loop / muted options.
- **Offline (see [08](08-assets-and-media.md), [12](12-principles-and-invariants.md)):** image
  and video backgrounds are localized through the **same asset pipeline** as inserted media
  (`uploadAsset` → `assets/…`; upload / drag / paste / `shared/` library / provider sources) —
  never an external URL.
- **Declarative & byte-stable:** plain attributes on the section (one undo + one autosave);
  Claude-authorable.
- **Cascade to verticals:** reveal propagates a stack's background to verticals that don't set
  their own — consistent with the per-slide theme cascade.
- **Thumbnails:** the static thumbnail builder paints the background (color / image / gradient)
  as the section's CSS background so navigator thumbnails match ([06](06-slide-management.md));
  video shows a poster/first-frame or placeholder.
- **Surface:** a "Slide background" section in the inspector (keyed to the current slide) plus a
  "Set background…" item in the slide context menu ([04](04-canvas-interaction.md)), with a
  Clear action.

## Text appearance (colour & inline formatting)

The editor writes a **narrow, explicit** set of text-appearance properties — the one place it
touches styling rather than layout. Two scopes:

- **Whole-element** — a **text colour** control for the selected text leaf
  (heading / paragraph / list), writing inline `style="color: …"`; plus block-level
  **text-align** and **list indent / outdent** ([04](04-canvas-interaction.md)).
- **Inline run** — within an in-place edit, a selected **word or phrase** can be made
  **bold / italic / underlined / struck-through**, **resized**, **coloured**, or **linked**, via
  the allowlisted inline marks (`strong` / `em` / `u` / `s` / `span[style]` / `a`) of the inline
  content model ([02](02-document-model.md)) and the floating formatting toolbar
  ([04](04-canvas-interaction.md)).

Inline `style` and marks round-trip through the model like any other content (the node becomes
`dirty`, serializes canonically, one undo + one autosave) and survive validation + sanitization
([12](12-principles-and-invariants.md)). This is still a *deliberately small* appearance
surface — common emphasis, colour, size, alignment, and links, **not** arbitrary CSS —
everything beyond it remains `custom.css` / classes. (Earlier specs scoped this to whole-element
colour only; inline runs are the planned superset, not a contradiction.)

## Slide numbers & footers

Recurring chrome that appears across slides — page numbers and a footer line (text / logo) —
without duplicating an element into every `<section>`.

- **Slide numbers** use reveal's native **`slideNumber`** (set in the deck's reveal config): a
  deck-level toggle with the usual formats (e.g. `c/t`). It shows in edit and present, and the
  same setting drives the on-screen number in present mode
  ([10](10-presenting-and-export.md)).
- **Footer / header** is **CSS-based**, not a per-slide element: a deck-level footer string
  (and optional logo) rendered as a fixed overlay via a **managed `custom.css`** rule, so it
  lives in one place, stays byte-stable, and never churns every section. A slide can opt out
  with `data-footer-hidden`. (reveal has no native footer; a CSS overlay is the offline,
  source-clean way to get one.)
- Both are declarative and offline; numbers are reveal config, the footer is `custom.css` the
  user or Claude Code can also hand-edit.

## Editor chrome themes (workspace themes)

Distinct from *slide* themes (which ship in the deck output), these restyle the **editor
shell itself** — navigator, panels, toolbars, source pane chrome.

- **Three workspace themes: Dark, Light, Solarized.** Dark is the default (today's look).
- Backed by **CSS custom properties** on the app root (the hardcoded Tailwind chrome tokens —
  `surface`, `surface-raised`, `surface-overlay`, `accent` — become variables a theme sets),
  so switching is a single root-class/variable swap with no per-component changes.
- **A foreground token is required, not optional.** The variable set must include a text colour
  (`--text` / a tailwind `fg` token), and chrome components must use it rather than a hardcoded
  `text-white`. Without it a "light" theme is *unexpressible* — light surfaces with hardcoded
  white text are unreadable. **Light = genuinely light surfaces + dark text**, not a
  lighter-dark variant; the palette must not drift toward an accent hue (the first cut shipped a
  dark-purple "Light", which was the bug this rule prevents recurring).
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
