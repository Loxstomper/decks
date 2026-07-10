# Slide management

**Status:** decided

## Summary

Creating, organizing, and navigating slides — including reveal's 2D (vertical slides)
structure. All operations are DOM operations on `<section>` elements.

## Creating a deck (from the browser)

- A deck can be created **from the editor UI**, not only the `decks new` CLI — a "**+ New
  deck**" affordance in the navigator prompts for a name and creates the deck.
- It is the **same scaffold** as the CLI: a `POST /api/decks/{name}` runs the identical
  `decks new` logic server-side (`decks/<name>/{deck.html, custom.css, assets/}` with
  reveal vendored offline, see [Project structure](project-structure.md)), then the editor opens it.
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
| Duplicate | Clone a `<section>`, regenerate `data-eid`s (preserve for auto-animate pairing — see [Motion & transitions](motion-and-transitions.md)) |
| Delete | Remove the `<section>` |
| Reorder | Move the `<section>` in document order |
| Add vertical | Nest a `<section>` under a top-level `<section>` |
| Hide | `data-visibility="hidden"` (kept in source, skipped when presenting) |
| Theme override | `data-theme` (+ managed `data-background-color`) on the `<section>`; inherits the deck theme when absent (see [Theming & styles](theming-and-styles.md)) |

Slides that override the deck theme show a small **theme badge** in the navigator/thumbnail.

These same operations are reachable from a **slide-level context menu** (right-click on empty
slide background; see [Canvas & interaction](canvas-interaction.md) "Context menu") — one dispatch path, no
duplicated logic.

## Slide layouts

Google-Slides-style **layout presets**: named, pre-arranged slide structures (Title, Title +
Body, Section Header, Two Content, Comparison, Title Only, Big Number, Caption, Blank). A layout
is **structure, not theme** — it composes the existing `data-lay` primitives
([Layout vocabulary](layout-vocabulary.md)), decoupled from the reveal CSS theme
([Theming & styles](theming-and-styles.md)). It generalizes what `addSlide` already does (a starter
`data-lay="stack"` section).

- **Source = template snippets.** Each layout is a `<section>` snippet with **starter content**
  (real heading/body leaves carrying prompt text you overwrite — not ghost placeholders).
  Built-in presets ship bundled (embedded, offline); user/Claude-authored layouts live in the
  `templates/` directory ([Project structure](project-structure.md)). Both are listed together via
  `GET /api/templates`.
- **Pick a layout** when adding a slide, or **change a slide's layout** from the slide context
  menu ([Canvas & interaction](canvas-interaction.md)).
- **Apply preserves content (never-destroy, [Principles & invariants](principles-and-invariants.md)).** Changing
  the layout of a slide that already has content **moves its existing leaves into the new
  layout's primary content slot** rather than discarding them. A layout snippet marks its
  target container (e.g. `data-slot="content"`; the first slot when several exist). Applying is
  one undo entry + one autosave and round-trips byte-stable.
- **`data-layout="<name>"`** is stamped on the section as a **non-authoritative** marker — it
  lets the picker show the current layout and offer a swap. The structure remains the single
  source of truth; there is **no live master link** (editing a template does not retro-edit
  slides built from it).

## Thumbnails

Rendered from the live model and updated on edit. Each thumbnail is a **static, script-free
`srcdoc` iframe** (`sandbox=""`, offline) that links the deck's stylesheets and lays one
`<section>` out at the logical canvas, scaled down — deliberately lightweight (no reveal.js
instance per slide). Because it runs no JS, it must close the gaps where reveal's runtime would
otherwise do the work, so the thumbnail is **faithful to the actual slide**:

- **Actual theme, not a fixed one.** The thumbnail links the deck's *current* theme (and, once
  per-slide overrides exist, the slide's `data-theme` — see [Theming & styles](theming-and-styles.md)),
  never a hardcoded default. Switching the deck theme restyles the thumbnails.
- **Numeric layout applied.** The numeric layout vocabulary (`data-gap`/`data-pad`/`data-cols`/
  `data-rows`/`data-grow`/`data-basis`/`data-span`, and free `data-x/y/w/h/rot`) is normally
  applied by `decks-layout-init.js` at runtime; with no JS the thumbnail builder emits the
  equivalent **inline styles** so grids, spacing, and free-positioned elements match.
- **Fragments show their final state** (forced visible), rather than vanishing under reveal's
  `opacity:0` default.
- **Backgrounds honored** — a section's `data-background-color` is rendered as its background.
- **Accepted approximation:** code highlighting, KaTeX math, **Chart.js charts**, and **QR codes**
  (reveal plugins, JS-driven) are not run, so they render plain or as a placeholder
  ([Layout vocabulary](layout-vocabulary.md)). These are the acknowledged thumbnail-only fidelity gaps, not
  bugs — they render correctly everywhere JS runs (editor, present, PDF). Any future JS-rendered
  leaf joins this list and must paint a script-free placeholder.

## Related

[Document model](document-model.md) · [Canvas & interaction](canvas-interaction.md) · [Motion & transitions](motion-and-transitions.md) · [Theming & styles](theming-and-styles.md)
