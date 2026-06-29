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

## Deleting elements

- **Delete / Backspace** removes the current selection — works whether the element was
  selected on the canvas or highlighted in the outline panel. Multi-selection deletes all.
- **Guarded by editing context:** the key is intercepted only when no text-editing surface
  has focus (not while in-place `contenteditable`, the source pane, or any input), so typing
  is never swallowed.
- One delete = one undo entry = one autosave (consistent with every other command).
- Deleting a **leaf** removes the node; deleting a **container** removes it and its subtree
  (the outline makes the scope visible before you commit). Whole-slide deletion stays in the
  navigator ([06](06-slide-management.md)); this is element-level deletion *within* a slide.
- **Passthrough** elements ([02](02-document-model.md)) can be deleted but never silently
  mangled — they go as a whole or not at all.

## Context menu

Right-click opens a context menu of element actions. It is **a UI surface over existing
commands**, not a new mutation path — each item dispatches to the same `deckStore` command the
inspector/toolbar already use (single source of truth).

- **Trigger surfaces:** the canvas (inside the iframe) **and** the outline panel rows share one
  menu and one action registry. The outline is the easiest way to target nested or passthrough
  elements.
- **Right-click selects.** Right-clicking an element selects it first (same nearest-element
  resolution as left-click), unless it is already part of a multi-selection (then the
  selection is kept, and actions apply to the whole set). The canvas handler lives alongside
  the existing click handlers and re-attaches after a reload (`reloadNonce`).
- **Rendered in the parent overlay**, above the iframe, positioned at the cursor with
  edge-flip, keyboard-navigable, dismissed on Escape / click-outside / selection change /
  reload.
- **Actions are context-dependent** on element kind (a pure `menuItemsFor(selection)`):
  - *Any:* Delete · **Duplicate** · Cut / Copy / Paste · Jump to source.
  - *Text leaf:* Edit text · Text color.
  - *Structured:* Make free · move up/down among siblings.
  - *Free:* Make structured · **Bring to front / Send to back** · Align/Distribute (multi).
  - *Container:* Insert block inside · Equal columns · quick align.
  - *Passthrough:* Delete · Jump to source only — **never** structural edits (never-destroy,
    [12](12-principles-and-invariants.md)).
- **Slide-level menu:** right-clicking empty slide background opens slide actions
  (Duplicate / Delete / Hide / Insert slide), reusing the navigator's slide ops
  ([06](06-slide-management.md)).

### New element operations the menu introduces

These are the only net-new model commands (each one undo entry + one autosave, byte-stable):

- **Duplicate element** — clone the selected subtree, **regenerate its `data-eid`s** (uniqueness
  per [02](02-document-model.md), as slide duplication already does), insert after the original.
- **Z-order (free only)** — free elements paint in sibling order; *bring to front* / *send to
  back* reorder the element to last/first among its siblings (reuses the reorder op). Not shown
  for structured elements (they flow, not stack).
- **Element clipboard** — a **session-scoped, in-memory** model-subtree buffer (like the undo
  stack; offline, never touches disk). *Copy* captures the subtree; *Cut* = copy + delete;
  *Paste* inserts a clone with **freshly regenerated `data-eid`s** after the current selection
  (or as the last child of a selected container), so paste works across slides without eid
  collisions.

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

## Canvas reload preserves view state

The canvas reflects the **on-disk bytes**: after each autosave, undo/redo, or external
(SSE/Claude) change, the iframe reloads the deck from the server rather than patching the live
DOM (so relative assets resolve and the canvas matches persisted source — see
[01](01-architecture.md) data flow). reveal re-initialises on reload and, left alone, returns
to the **first slide**.

- **Invariant: a same-deck reload must preserve the viewer's current slide.** The current
  `(h, v)` indices are captured before the reload and restored once reveal is ready again, so
  committing an edit on slide 5 (e.g. pressing **Enter** to confirm an in-place text edit)
  leaves you on slide 5 — not slide 1. This applies to every reload cause: autosave,
  undo/redo, and external changes ([11](11-claude-code-integration.md)).
- **Only switching decks resets to the first slide** (a new `deck.html`, not a refresh of the
  current one).
- The restore happens while the iframe is still hidden, so the intermediate first-slide render
  is never shown.
- *Follow-up (under consideration):* pure in-place text commits could persist **without** a
  full reload (the contenteditable already mutated the live DOM correctly), reserving reloads
  for structural/external changes — eliminating the reload entirely for typing. Deferred
  pending confidence that the canvas cannot drift from the on-disk bytes.

## Panes / layout

Four zones: **Navigator** (slide filmstrip, [06](06-slide-management.md)) · **Canvas**
(iframe + overlay) · **Outline + Properties** · **Source** (CodeMirror 6, toggle/split with
properties). The source pane and canvas stay synced ([02](02-document-model.md)).

### Collapsible & resizable chrome

The editor shell is the user's workspace, so its panes are adjustable and stay out of the
way when not needed:

- **Collapsible side panels.** The left navigator and the right (outline/properties/source)
  panel each collapse to a thin rail via a **chevron**; clicking the rail (or chevron)
  restores them to their previous width. Collapse state and last width persist across reloads.
- **Collapsible source pane.** The source pane collapses independently (it is the bottom of
  the right panel), so the outline/properties can use the full right-panel height. A toggle
  in the source pane header collapses/expands it; its last height is remembered.
- **Per-pane resizing.** Every boundary is a drag handle (extending the existing `Splitter`):
  the two vertical splits (nav↔canvas, canvas↔right) and the horizontal split inside the
  right panel (outline/properties ↕ source) are all individually draggable, within sane
  min/max bounds. Sizes persist.

### Source ↔ selection sync

Selection is two-way with the source pane, not just the canvas and outline:

- **Jump-to-source on select.** When an element is selected and the source pane is visible,
  the pane **scrolls to and reveals that element's `data-eid`** in the HTML, so the inspector,
  canvas, and source always point at the same node. (Coarse, attribute-anchored scroll — it
  finds the `data-eid="…"` occurrence; it is not a full source-map.)
- It is a convenience, not a mode: it never steals focus from an active edit, and an
  un-stamped or passthrough element simply doesn't scroll.

## Related

[02](02-document-model.md) · [03](03-layout-vocabulary.md) · [05](05-scaling-and-resolution.md) · [06](06-slide-management.md)
