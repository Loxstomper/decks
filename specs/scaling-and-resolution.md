# Scaling & resolution

**Status:** decided

## Summary

Slides are authored against a fixed **logical canvas** and scaled uniformly to any screen by
reveal.js. The deck's aspect ratio and canvas dimensions are configurable; default is
**1920×1080 (16:9)**.

## How reveal scaling works

reveal renders at a fixed logical size (`width` × `height`) and applies a single uniform
`transform: scale()` to fit any viewport, preserving aspect ratio (letterboxing if the output
ratio differs). Therefore:

- You don't pick an output resolution ("1080p vs 4K") — reveal scales **infinitely and
  crisply**. What you configure is the **logical canvas dimensions + aspect ratio**.
- Sharpness depends on assets: vector/SVG and high-res images stay crisp at any output.

## Decisions

- **Logical canvas: 1920×1080 by default.** Chosen over reveal's smaller defaults because the
  coordinate numbers are intuitive ("x=960 is centered") — this sets the mental model for every
  coordinate in the project.
- **Aspect ratio is configurable** via presets + custom.
- Config lives **in the reveal init script inside `deck.html`** — single source of truth;
  Claude Code edits it naturally. No sidecar.
- **`center: false` and `margin: 0` are required** (see "Logical-canvas coordinate identity").

## Logical-canvas coordinate identity (load-bearing)

For the editor overlays and the rendered deck to share **one** coordinate system (the WYSIWYG
promise above), a slide's `<section>` must *be* the full logical canvas at its origin —
`(0,0)` top-left, `width × height` exactly. That requires two reveal options the template
**must** set (they are not reveal's defaults):

- **`center: false`** — reveal's default `center: true` vertically/horizontally centers each
  section's content box, giving a short section a non-zero `top`. The **layout vocabulary**
  ([Layout vocabulary](layout-vocabulary.md)) already owns alignment (a `stack` centers via
  `justify-content`), so reveal centering is redundant *and* conflicting.
- **`margin: 0`** — reveal's default `margin: 0.04` insets the usable area by 4% and rescales,
  so the rendered origin/scale no longer equals the raw logical canvas.

With these, **free `data-x/y/w/h` are true logical-canvas coordinates**: an element at
`data-x=0,data-y=0` renders at the canvas origin, free-overlay handles align with the element,
and smart-guide snapping to canvas center/edges is correct. Without them, anything that reads
`data-x/y` as canvas coordinates (the free-transform overlay, guides) is offset by the
centering/margin delta — while overlays that *measure* the element (the structured selection
box) still track it, which is why the mismatch shows up **only in free mode**.

> Implication for existing decks: the requirement is enforced in the scaffold template; decks
> authored before it carry the old `Reveal.initialize` and need their config rewritten (a
> `slides upgrade`-style migration — `slides vendor` does not rewrite `deck.html`).

### Aspect presets

| Preset | Logical W×H | Use |
|---|---|---|
| 16:9 | 1920×1080 | Default; modern screens/projectors |
| 4:3 | 1440×1080 | Older projectors |
| 16:10 | 1920×1200 | Many laptops |
| 9:16 portrait | 1080×1920 | Mobile / vertical displays |
| Custom | any | Posters, unusual screens |

## Editor implications

- **Canvas mirrors present-time scaling exactly** → true WYSIWYG. Same transform, different
  denominator (see [Canvas & interaction](canvas-interaction.md)).
- **Two zoom concepts, not conflated:** present-scale (auto fit-to-screen) vs editor-zoom
  (fit / 100% / custom for detail work).
- **Target-output preview:** preview the deck letterboxed at a *different* target ratio
  (e.g., a 16:9 deck on a 4:3 projector) to check for bars before presenting somewhere unknown.
- Expose reveal knobs in deck settings with sane defaults: `margin`, `minScale`, `maxScale`.

## Aspect-ratio change behavior (important)

Changing the aspect ratio is the one operation that can break **free** elements (they're
pinned to coordinates that assumed the old canvas). On change:

- **Structured content reflows automatically** (flex/grid) — graceful.
- **Free elements are flagged**, with an offer to reposition/rescale.

This is another reason structured layout is the default and `free` is the escape hatch
(see [Layout vocabulary](layout-vocabulary.md)).

## Related

[Layout vocabulary](layout-vocabulary.md) · [Canvas & interaction](canvas-interaction.md) · [Presenting & export](presenting-and-export.md)
