# 05 — Scaling & resolution

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
  denominator (see [04](04-canvas-interaction.md)).
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
(see [03](03-layout-vocabulary.md)).

## Related

[03](03-layout-vocabulary.md) · [04](04-canvas-interaction.md) · [10](10-presenting-and-export.md)
