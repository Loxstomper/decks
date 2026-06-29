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

## Thumbnails

Rendered from the live model (scaled-down reveal render or a cached snapshot). Update on edit.

## Related

[02](02-document-model.md) · [04](04-canvas-interaction.md) · [07](07-motion-and-transitions.md)
