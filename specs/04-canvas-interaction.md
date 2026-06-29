# 04 — Canvas & interaction

**Status:** decided

## Summary

The visual editing experience: how the canvas renders, how the coordinate/scale system works,
and the selection / drag / snapping / resize behaviors that make alignment feel effortless.

## Rendering

- reveal.js renders the deck inside a **sandboxed `<iframe>`** at the logical canvas size
  (1920×1080, see [05](05-scaling-and-resolution.md)).
- An **overlay layer** in the parent document sits over the iframe, drawing selection boxes,
  resize handles, and alignment guides.
- **Text editing happens in-place** on the real nodes inside the iframe (`contenteditable`);
  **manipulation** (select/move/resize) happens via the overlay. Hybrid: edit-in-place for
  content, overlay for geometry.

## Coordinate/scale system (load-bearing)

reveal fits the logical canvas to the viewport with a uniform `transform: scale()`. The
overlay lives outside that scaled space, so it must convert between screen pixels and logical
coordinates using the iframe's **current** scale.

- One shared transform: `screen = logical × scale + offset`.
- **present-scale** = `viewport / logical` (auto, fit-to-screen).
- **editor-zoom** = `pane / logical × userZoom` (fit / 100% / custom, for detailed work).
- All snapping, guides, and handle math operate in **logical coordinates**, so behavior is
  identical at any zoom or output resolution.

This is the first thing to prototype — everything visual depends on it.

## Selection

- Click to select a leaf; click-through / outline panel to select containers.
- **Outline/layers panel** (required by nesting, see [03](03-layout-vocabulary.md)): a tree of
  `<section>` → containers → leaves. Click to select, drag to reparent, toggle visibility.
- Marquee (drag-select) for multi-select.

## Two drag semantics

| Element kind | Drag means |
|---|---|
| **Structured** (in a container) | **Reorder / reparent** — drop into a different position or cell; container reflows. |
| **Free** (`data-free`) | **Move** — free positioning in logical coordinates, with snapping. |

## Alignment tools (the pain-solver)

- **Smart guides:** while dragging/resizing a free element, show snap lines when its edges or
  center align with siblings or slide center; snap to them.
- **Snap-to-grid:** optional grid (default 8 logical px) with toggle.
- **Resize handles:** 8 handles; Shift = preserve aspect; Alt = resize from center.
- **Keyboard nudge:** arrows = 1 logical unit; Shift+arrows = 10.
- **Align / distribute:** for free elements → coordinate ops; for structured elements → set
  container `data-align` / `data-justify` / `data-grow` ([03](03-layout-vocabulary.md)).

## Undo/redo

Snapshot-based: each command pushes the serialized model onto a history stack. Cheap for
slide-sized documents; session-only (git is durable history, see [13](13-project-structure.md)).

## Panes / layout

Four zones: **Navigator** (slide filmstrip, [06](06-slide-management.md)) · **Canvas**
(iframe + overlay) · **Outline + Properties** · **Source** (CodeMirror 6, toggle/split with
properties). The source pane and canvas stay synced ([02](02-document-model.md)).

## Related

[02](02-document-model.md) · [03](03-layout-vocabulary.md) · [05](05-scaling-and-resolution.md) · [06](06-slide-management.md)
