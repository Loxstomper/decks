# 06 — Slide management

**Status:** decided

## Summary

Creating, organizing, and navigating slides — including reveal's 2D (vertical slides)
structure. All operations are DOM operations on `<section>` elements.

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
