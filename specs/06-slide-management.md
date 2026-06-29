# 06 — Slide management

**Status:** decided

## Summary

Creating, organizing, and navigating slides — including reveal's 2D (vertical slides)
structure. All operations are DOM operations on `<section>` elements.

## Creating a deck (from the browser)

- A deck can be created **from the editor UI**, not only the `slides new` CLI — a "**+ New
  deck**" affordance in the navigator prompts for a name and creates the deck.
- It is the **same scaffold** as the CLI: a `POST /api/decks/{name}` runs the identical
  `slides new` logic server-side (`decks/<name>/{deck.html, custom.css, assets/}` with
  reveal vendored offline, see [13](13-project-structure.md)), then the editor opens it.
- Name validation reuses `deck.ValidName`; creating an existing name is rejected (no clobber).
  Creation is offline and writes no external URLs.

## Slide navigator

- A **sortable filmstrip** of slide thumbnails; click to jump, drag to reorder.
- Because reveal supports **vertical slides** (nested `<section>`), the navigator is **2D**:
  a horizontal track with optional vertical stacks hanging below each top-level slide.
- Drag within a stack (reorder verticals) or between stacks (promote/demote/move).

## Operations

| Action | DOM effect |
|---|---|
| Add slide | Insert a `<section>` (with a starter `data-lay="stack"`) |
| Duplicate | Clone a `<section>`, regenerate `data-eid`s (preserve for auto-animate pairing — see [07](07-motion-and-transitions.md)) |
| Delete | Remove the `<section>` |
| Reorder | Move the `<section>` in document order |
| Add vertical | Nest a `<section>` under a top-level `<section>` |
| Hide | `data-visibility="hidden"` (kept in source, skipped when presenting) |
| Theme override | `data-theme` (+ managed `data-background-color`) on the `<section>`; inherits the deck theme when absent (see [09](09-theming-and-styles.md)) |

Slides that override the deck theme show a small **theme badge** in the navigator/thumbnail.

## Thumbnails

Rendered from the live model and updated on edit. Each thumbnail is a **static, script-free
`srcdoc` iframe** (`sandbox=""`, offline) that links the deck's stylesheets and lays one
`<section>` out at the logical canvas, scaled down — deliberately lightweight (no reveal.js
instance per slide). Because it runs no JS, it must close the gaps where reveal's runtime would
otherwise do the work, so the thumbnail is **faithful to the actual slide**:

- **Actual theme, not a fixed one.** The thumbnail links the deck's *current* theme (and, once
  per-slide overrides exist, the slide's `data-theme` — see [09](09-theming-and-styles.md)),
  never a hardcoded default. Switching the deck theme restyles the thumbnails.
- **Numeric layout applied.** The numeric layout vocabulary (`data-gap`/`data-pad`/`data-cols`/
  `data-rows`/`data-grow`/`data-basis`/`data-span`, and free `data-x/y/w/h/rot`) is normally
  applied by `slides-layout-init.js` at runtime; with no JS the thumbnail builder emits the
  equivalent **inline styles** so grids, spacing, and free-positioned elements match.
- **Fragments show their final state** (forced visible), rather than vanishing under reveal's
  `opacity:0` default.
- **Backgrounds honored** — a section's `data-background-color` is rendered as its background.
- **Accepted approximation:** code highlighting and KaTeX math (reveal plugins, JS-driven) are
  not run, so they render plain. This is the one acknowledged fidelity gap, not a bug.

## Related

[02](02-document-model.md) · [04](04-canvas-interaction.md) · [07](07-motion-and-transitions.md) · [09](09-theming-and-styles.md)
