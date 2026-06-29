# 07 — Motion & transitions

**Status:** decided

## Summary

Step reveals (fragments), slide transitions, and **auto-animate authoring** — the last being a
signature feature that the stable-ID architecture makes nearly free.

## Fragments (reveal-native)

- Click an element → "appear at step N"; writes `class="fragment"` + `data-fragment-index`.
- A per-slide **fragment-order list** to reorder reveals.
- Fragment styles (fade, fade-up, highlight, etc.) selectable per element.

## Transitions (reveal-native)

- Per-deck default and per-slide override → `data-transition`
  (`slide` / `fade` / `convex` / `concave` / `zoom` / `none`).
- Transition speed → `data-transition-speed`.

## Auto-advance (reveal-native)

- A deck can advance on a timer: a per-deck default and per-slide override via **`data-autoslide`**
  (milliseconds; `0` / absent = manual), plus a **loop** option (reveal's `loop`). Declarative
  attributes — byte-stable, Claude-authorable.
- Surfaced as an auto-advance control in the editor; consumed by the present route
  ([10](10-presenting-and-export.md)).
- Distinct from fragments / transitions (which animate *within* and *between* steps) — this
  drives the *timing* of advancement.

## Auto-animate authoring (signature feature)

reveal's auto-animate tweens elements between two consecutive `data-auto-animate` slides,
matching them by `data-id` (or by content). Our architecture makes this smooth:

- **Workflow:** duplicate a slide, then move/resize/restyle elements on the copy.
- The editor keeps `data-id` consistent across the pair (derived from `data-eid`, see
  [02](02-document-model.md)) and sets `data-auto-animate` on both `<section>`s.
- reveal then animates position/size/style deltas automatically.
- Provide an **"animate from previous slide"** affordance to set this up in one action.

This is slides.com's flagship "wow"; stable IDs make it near-free here.

## Related

[02](02-document-model.md) · [06](06-slide-management.md)
