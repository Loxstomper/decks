# 03 — Layout vocabulary

**Status:** decided

## Summary

The hybrid layout model: a small, explicit set of layout primitives expressed as `data-*`
attributes, plus an absolute-positioning escape hatch. Alignment is a *declared intent*, not a
coordinate. The editor owns layout; you and Claude Code own styling.

## The five primitives

| Primitive | `data-lay` | CSS | Use |
|---|---|---|---|
| **Stack** (vertical) | `stack` | flex column | Default slide body; title over body. |
| **Row** (horizontal) | `row` | flex row | Two-column "text \| image". |
| **Grid** | `grid` | CSS grid | Card walls, logo/image grids. |
| **Layers** (z-stack) | `layers` | reveal `r-stack` | Background + overlaid text; auto-animate/fragment layers. |
| **Free** | `data-free` (on the element) | absolute, logical coords | Escape hatch for pixel-precise placement. |

Four structured containers + one escape hatch covers essentially every real slide. The set is
deliberately small: each primitive needs its own canvas drag behavior and property controls.

## The `data-*` contract

Layout is encoded as attributes the editor reads back into the properties panel:

```html
<section data-eid="s3">
  <div data-lay="row" data-gap="64" data-align="center">
    <div data-lay="stack" data-gap="16" data-grow="1">
      <h2 data-eid="t1" class="text-sky-300">Quarterly Results</h2>
      <p data-eid="p1">Revenue up 24%.</p>
    </div>
    <img data-eid="i1" src="assets/chart.svg" data-grow="1">
  </div>
</section>
```

Container attributes:

| Attribute | Applies to | Values |
|---|---|---|
| `data-lay` | container | `stack` \| `row` \| `grid` \| `layers` |
| `data-gap` | container | logical px |
| `data-align` | stack/row | cross-axis: `start` \| `center` \| `end` \| `stretch` |
| `data-justify` | stack/row | main-axis: `start` \| `center` \| `end` \| `between` \| `around` |
| `data-cols` / `data-rows` | grid | integer or template |
| `data-pad` | container | logical px |

Child attributes:

| Attribute | Values |
|---|---|
| `data-grow` | flex grow factor |
| `data-basis` | flex basis (logical px or %) |
| `data-span` | grid cell span |

Free element attributes: `data-free`, `data-x`, `data-y`, `data-w`, `data-h`, `data-rot`
(all logical units).

A small bundled stylesheet maps every `data-*` value to the corresponding flex/grid CSS.

### Why data-attributes (vs classes / Tailwind)

- The editor reads/writes clean key→value pairs — no class-string parsing.
- Reads almost like English to Claude Code ("a row, gap 64, centered").
- Arbitrary values (gap 47) stay clean. Tailwind utility soup round-trips poorly.

## Alignment-as-intent

The toolbar's align/distribute controls **set container properties**, not pixel positions:

- "center horizontally" → `data-align="center"`
- "space between" → `data-justify="between"`
- "equal columns" → all children `data-grow="1"`

So alignment survives resolution changes, aspect-ratio changes, and content edits — the
original "get it just right" pain. (For *free* elements, align/distribute operate on
coordinates instead.)

## Ownership split

> **The editor owns *layout* (`data-*`); you and Claude Code own *styling* (Tailwind / inline
> / CSS).**

Styling classes the editor doesn't recognize pass through verbatim ([02](02-document-model.md)).

## Leaf block types

Text (heading / paragraph / list, `contenteditable`) · Image · Code (highlighted) · Math
(KaTeX) · Table · Shape / line / arrow · Embed / iframe · SVG / icon. Each is insertable,
selectable, individually styleable, and knows how to serialize itself.

## Nesting → requires a layers/outline panel

Containers nest arbitrarily (a row whose cell is a stack). You can't grab a parent container
by clicking the canvas alone, so the UI needs an **outline/layers tree**. See
[04](04-canvas-interaction.md).

## Related

[02](02-document-model.md) · [04](04-canvas-interaction.md) · [05](05-scaling-and-resolution.md)
