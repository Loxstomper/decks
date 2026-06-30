---
name: slides-authoring
description: >
  Use when authoring or editing reveal.js presentation decks in the
  slides-builder project. Covers creating/modifying deck.html files,
  applying the data-* layout vocabulary, writing valid HTML that survives
  round-trips, and running the CLI to scaffold or validate decks. Trigger
  whenever the user asks you to write, edit, add slides to, or fix a deck
  in the decks/ directory.
---

# slides-authoring skill

You are editing reveal.js decks managed by slides-builder. This file teaches
you every rule you need to author valid decks that the editor, the presenter,
and the offline renderer all handle correctly.

Read `docs/AUTHORING.md` for the full contracts reference; this skill is the
practical how-to guide with annotated snippets.

---

## 1. Project layout

```
<workspace>/
  slides           # the Go binary (run from this directory)
  config.toml      # editor prefs — no secrets
  decks/
    <name>/
      deck.html    # source of truth — the only file you edit for content
      custom.css   # per-deck CSS custom properties and overrides
      assets/
        vendor/    # reveal.js + plugins + layout CSS (auto-vendored; DO NOT EDIT)
        fonts/     # self-hosted fonts (downloaded once; never CDN links)
        *.png …    # deck images and media
  templates/       # reusable slide snippets
  shared/          # workspace-level reference copy of vendor files
  themes/          # custom reveal themes (optional)
```

**The single source of truth is `deck.html`.** No sidecar JSON, no separate
data file. Both the editor and Claude Code read and write this one file.

A deck folder is fully self-contained and portable: zip `decks/<name>/` and it
renders anywhere with zero network access.

---

## 2. The layout vocabulary

Layout intent is encoded as `data-*` attributes, not pixels and not Tailwind
classes. The editor renders these attributes into flex/grid CSS via a bundled
stylesheet (`assets/vendor/slides-layout.css`).

### The five primitives

| Primitive  | How to declare           | CSS equivalent         | When to use                           |
|------------|--------------------------|------------------------|---------------------------------------|
| **stack**  | `data-lay="stack"`       | flex column            | Default slide body, title over body   |
| **row**    | `data-lay="row"`         | flex row               | Two-column "text \| image" layouts    |
| **grid**   | `data-lay="grid"`        | CSS grid               | Card walls, logo/image grids          |
| **layers** | `data-lay="layers"`      | r-stack / z-stack      | Background + overlaid text, fragments |
| **free**   | `data-free` on the el    | absolute + logical px  | Pixel-precise escape hatch            |

### Container attributes (go on the element that has `data-lay`)

| Attribute      | Valid values                                    | Notes                               |
|----------------|-------------------------------------------------|-------------------------------------|
| `data-lay`     | `stack` \| `row` \| `grid` \| `layers`         | Required to make an element a container |
| `data-gap`     | non-negative integer (logical px)               | Gap between children                |
| `data-align`   | `start` \| `center` \| `end` \| `stretch`      | Cross-axis (stack=horizontal, row=vertical) |
| `data-justify` | `start` \| `center` \| `end` \| `between` \| `around` | Main-axis justification       |
| `data-pad`     | non-negative integer (logical px)               | Inner padding                       |
| `data-cols`    | integer or CSS template string                  | Grid only: column count or template |
| `data-rows`    | integer or CSS template string                  | Grid only: row count or template    |

### Child attributes (go on the element that is a child of a container)

| Attribute    | Valid values                         | Notes                                        |
|--------------|--------------------------------------|----------------------------------------------|
| `data-grow`  | non-negative integer                 | flex-grow factor; `1` = equal share of space |
| `data-basis` | integer (logical px) or "50%"        | flex-basis for a row/stack child             |
| `data-span`  | positive integer >= 1                | grid-column span count                       |

### Free element attributes (go on elements with `data-free`)

| Attribute  | Values               | Meaning                   |
|------------|----------------------|---------------------------|
| `data-free` | (boolean; presence = true) | Mark element as free-positioned |
| `data-x`   | logical px integer   | Left edge from slide left  |
| `data-y`   | logical px integer   | Top edge from slide top    |
| `data-w`   | logical px integer   | Width                      |
| `data-h`   | logical px integer   | Height                     |
| `data-rot` | degrees (integer)    | Clockwise rotation         |

Logical coordinates map to the 1920×1080 canvas (spec 05). reveal.js scales
the canvas to any screen at present time; the editor overlays share the same
coordinate system, so WYSIWYG is preserved.

---

## 3. The `data-eid` rule

Every element the editor manages carries a **stable, unique ID**:

```html
<h2 data-eid="t1" class="text-sky-300">Title</h2>
<p  data-eid="p1">Body text.</p>
<img data-eid="i1" src="assets/chart.svg" data-grow="1">
```

Rules for `data-eid`:

1. **Unique per deck.** No two elements in the same `deck.html` may share an eid.
2. **Stable across edits.** Once assigned, never change an existing eid. The
   editor uses it for canvas selection; Claude Code uses it for targeting ("rewrite
   eid `p1`"); auto-animate derives `data-id` from it.
3. **Short, slug-like.** Convention: type-prefix + counter (`t1`, `p2`, `img3`,
   `row1`, `s4`). Use the same prefix style you see in the existing deck.
4. **On containers and leaves.** Every `data-lay` container and every known leaf
   element (`h1`-`h6`, `p`, `ul`, `ol`, `img`, `pre`, `code`, `table`, `figure`,
   `iframe`, `svg`, `video`, `audio`, `canvas` [chart]) should have a `data-eid`.
5. **Do NOT add** `data-eid` to passthrough elements (script, style, meta, link,
   div without data-lay, span, em, strong, a, br, etc.). The editor preserves
   those verbatim.

---

## 4. Snippets — one per primitive

### 4a. Stack (vertical column)

```html
<section data-eid="s1">
  <div data-lay="stack" data-gap="32" data-pad="64" data-eid="col1">
    <h2 data-eid="t1">Title</h2>
    <p  data-eid="p1">Body paragraph. Supports <strong>inline markup</strong>.</p>
    <ul data-eid="ul1">
      <li>First point</li>
      <li>Second point</li>
    </ul>
  </div>
</section>
```

### 4b. Row (horizontal, two-column text | image)

```html
<section data-eid="s2">
  <div data-lay="row" data-gap="64" data-align="center" data-pad="48" data-eid="row1">
    <div data-lay="stack" data-gap="16" data-grow="1" data-eid="col2">
      <h2 data-eid="t2">Quarterly Results</h2>
      <p  data-eid="p2">Revenue up 24%.</p>
    </div>
    <img data-eid="i1" src="assets/chart.svg" data-grow="1" alt="Revenue chart">
  </div>
</section>
```

### 4c. Grid (card wall, 3 columns)

```html
<section data-eid="s3">
  <div data-lay="grid" data-cols="3" data-gap="32" data-pad="48" data-eid="grid1">
    <div data-lay="stack" data-gap="8" data-eid="card1">
      <h3 data-eid="t3">Card A</h3>
      <p  data-eid="p3">Description.</p>
    </div>
    <div data-lay="stack" data-gap="8" data-eid="card2">
      <h3 data-eid="t4">Card B</h3>
      <p  data-eid="p4">Description.</p>
    </div>
    <div data-lay="stack" data-gap="8" data-eid="card3">
      <h3 data-eid="t5">Card C</h3>
      <p  data-eid="p5">Description.</p>
    </div>
  </div>
</section>
```

Grid with unequal columns using a template:

```html
<div data-lay="grid" data-cols="2fr 1fr" data-gap="32" data-eid="grid2">
  <!-- main content gets 2/3, sidebar gets 1/3 -->
</div>
```

A child spanning two columns:

```html
<div data-eid="wide1" data-span="2">Full-width item</div>
```

### 4d. Layers (z-stack, background + overlay)

```html
<section data-eid="s4">
  <div data-lay="layers" data-eid="lyr1">
    <!-- bottom layer: background image -->
    <img data-eid="i2" src="assets/bg.jpg" style="width:100%;height:100%;object-fit:cover;">
    <!-- top layer: text overlay -->
    <div data-lay="stack" data-gap="16" data-align="center" data-justify="center" data-eid="ovl1"
         style="position:absolute;inset:0;">
      <h1 data-eid="t6" class="text-white">Overlay Title</h1>
    </div>
  </div>
</section>
```

### 4e. Free (absolute positioning escape hatch)

```html
<section data-eid="s5">
  <!-- Most content uses layout containers... -->
  <!-- ...but one element needs pixel-precise placement: -->
  <div data-free data-x="200" data-y="400" data-w="600" data-h="200" data-eid="free1"
       style="background:#1e40af;border-radius:8px;padding:24px;">
    <p data-eid="p6" style="color:#fff;">Callout box at exact position.</p>
  </div>
</section>
```

`data-free` presence (boolean) is what matters; the value is ignored.
Coordinates are in the 1920×1080 logical space.

### 4f. Chart block (Chart.js leaf)

A chart is a `<canvas>` carrying two editor-owned markers — `data-chart` (the
type) and `data-chart-data` (a JSON Chart.js config). The bundled chart plugin
`JSON.parse`s the config and renders it offline.

```html
<canvas data-eid="chart1"
        data-chart="bar"
        data-chart-data='{"type":"bar","data":{"labels":["Q1","Q2","Q3"],"datasets":[{"label":"Revenue","data":[12,19,24]}]}}'>
</canvas>
```

- `data-chart` must be a non-empty type string (`bar`, `line`, `pie`, …).
- `data-chart-data` must be **parseable JSON** (a `{type, data, options?}`
  config). `slides validate` rejects malformed JSON.
- A bare `<canvas>` without `data-chart` is left as passthrough — the editor
  only manages charts it emitted.

---

## 5. Slide-level attributes

These go on `<section>` elements:

```html
<!-- Hide a slide from presentation (still in source) -->
<section data-eid="s6" data-visibility="hidden">

<!-- Per-slide transition override -->
<section data-eid="s7" data-transition="fade">

<!-- Transition speed override -->
<section data-eid="s8" data-transition-speed="fast">

<!-- Auto-animate: reveal tweens elements between consecutive aa slides -->
<section data-eid="s9" data-auto-animate>

<!-- Vertical stacking: nested sections create a 2D deck grid -->
<section>
  <section data-eid="s10">Slide A (top)</section>
  <section data-eid="s11">Slide B (below A, press ↓)</section>
</section>
```

Allowed `data-transition` values: `slide` | `fade` | `convex` | `concave` | `zoom` | `none`
Allowed `data-transition-speed` values: `default` | `fast` | `slow`

### Per-slide theme override (P10)

```html
<section data-eid="s15" data-theme="dracula">
```

Overrides the deck theme for one slide. Allowed values: `black` | `white` |
`league` | `beige` | `night` | `moon` | `solarized` | `solarized-dark` |
`dracula` | `sky` (any other value fails validation).

### Per-slide background (P16)

reveal.js renders these natively — set whichever you need on the `<section>`:

| Attribute | Value |
|-----------|-------|
| `data-background-color` | any CSS color |
| `data-background-gradient` | a CSS gradient string |
| `data-background-image` | `assets/…` relative path (offline-first) |
| `data-background-size` / `-position` / `-repeat` / `-opacity` | CSS `background-*` values |
| `data-background-video` | `assets/…` relative path |
| `data-background-video-loop` / `-muted` | `"true"` / `"false"` |

`data-background-image` and `data-background-video` must point at **local
assets** — external `http(s)://` URLs fail the offline guard.

### Layout-preset markers (P14)

When a slide is built from a layout preset, the editor stamps informational
markers that have **no reflow semantics** (flex/grid still comes from `data-lay`):

- `data-layout="<preset>"` on the `<section>` (e.g. `title-body`, `two-column`)
- `data-slot="<role>"` on its child containers (e.g. `content`, `sidebar`)

Both are non-empty strings. Preserve them verbatim — the editor relies on them
for content-preserving "Change layout". Don't invent new values by hand.

### Footer opt-out (P17)

```html
<section data-eid="s16" data-footer-hidden>
```

Boolean marker: hides the deck-level footer overlay on this one slide. Presence
is all that matters (any value counts).

---

## 6. Fragments (step reveals)

```html
<ul data-eid="ul2">
  <li class="fragment">First bullet appears at step 1</li>
  <li class="fragment" data-fragment-index="2">Third bullet (index controls order)</li>
  <li class="fragment" data-fragment-index="1">Second bullet</li>
</ul>

<!-- Fragment animation styles -->
<p class="fragment fade-up" data-eid="p7">Fades up</p>
<p class="fragment highlight-red" data-eid="p8">Highlights red</p>
```

Fragment style classes: `fade-out`, `fade-up`, `fade-down`, `fade-left`,
`fade-right`, `fade-in-then-out`, `fade-in-then-semi-out`, `grow`, `shrink`,
`strike`, `highlight-red`, `highlight-green`, `highlight-blue`,
`highlight-current-red`, `highlight-current-green`, `highlight-current-blue`.

---

## 7. Auto-animate

Auto-animate tweens elements between consecutive slides that both carry
`data-auto-animate`. Elements are matched by `data-id` (or by content for
leaf elements).

```html
<!-- Slide A -->
<section data-eid="s12" data-auto-animate>
  <h2 data-eid="t7" data-id="hero-title" style="font-size:2em;">Small title</h2>
</section>

<!-- Slide B — duplicate of A, then restyled -->
<section data-eid="s13" data-auto-animate>
  <h2 data-eid="t8" data-id="hero-title" style="font-size:4em;">Big title</h2>
  <p data-eid="p9">New content added on second slide.</p>
</section>
```

Derive `data-id` from the `data-eid` of the source element for consistency
(`data-id="hero-title"` where eid was `t7`). Keep the value meaningful and
unique within the auto-animate pair.

---

## 8. Speaker notes

```html
<section data-eid="s14">
  <h2 data-eid="t9">My slide</h2>
  <aside class="notes">
    Reminder: pause here and ask the audience.
    These notes appear in the speaker view (press S).
  </aside>
</section>
```

`<aside class="notes">` is a **passthrough** element — the editor does not
manage it. Write it in raw HTML; it round-trips verbatim. Do not add
`data-eid` to `<aside>`.

---

## 9. Code blocks

```html
<pre data-eid="pre1"><code class="language-typescript">
const greeting = (name: string): string =>
  `Hello, ${name}!`;
</code></pre>
```

highlight.js is bundled (`assets/vendor/highlight/`). Use `language-*` classes
on `<code>`. No CDN required.

---

## 10. Math / KaTeX

```html
<!-- Inline math -->
<p data-eid="p10">The formula $E = mc^2$ is elegant.</p>

<!-- Display math -->
<p data-eid="p11">$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$</p>
```

KaTeX renders `$…$` and `$$…$$` delimiters via the bundled math plugin. All
KaTeX assets are local (`assets/vendor/katex/`). No network required.

---

## 11. Offline-first rule (critical)

**Never** reference external URLs anywhere in a deck:

```html
<!-- WRONG — breaks offline -->
<img src="https://example.com/photo.jpg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">
<script src="https://cdn.jsdelivr.net/npm/reveal.js/..."></script>

<!-- CORRECT — always localize first -->
<img src="assets/photo.jpg">
```

Rules:
- All images, video, and media: copy into `assets/` first.
- reveal.js and all plugins: already vendored in `assets/vendor/` by
  `slides new`. Do not modify these files.
- Fonts: download once and place in `assets/fonts/`. Reference via
  `@font-face` in `custom.css` using a relative path.
- Never add CDN script or link tags to `deck.html`.

---

## 12. Styling split

> The editor owns **layout** (`data-*`). You own **styling** (Tailwind / inline / `custom.css`).

You can freely add Tailwind utility classes, inline `style=""`, or `custom.css`
overrides. The editor passes unknown classes through verbatim — they survive
every save/reload cycle unchanged.

```html
<!-- data-* = layout intent (editor reads/writes) -->
<!-- class/style = visual styling (you own; editor passes through) -->
<h2 data-eid="t10" class="text-sky-300 font-bold tracking-tight"
    style="text-shadow: 0 2px 8px rgba(0,0,0,.4);">
  Styled Title
</h2>
```

Per-deck theme overrides go in `custom.css` as CSS custom properties:

```css
/* custom.css */
:root {
  --r-main-color: #e0e0e0;
  --r-heading-color: #60a5fa;
  --r-background-color: #0f172a;
}
```

### Inline marks & links (rich text within a leaf)

Inside a text leaf (`p`, `h1`–`h6`, `li`, …) you may use an allowlisted set of
inline marks. These are rich text *within* content — addressed by the leaf's
`data-eid` plus a selection range — so they do **not** take their own `data-eid`:

| Mark | Use |
|------|-----|
| `<strong>` / `<em>` | bold / italic |
| `<u>` / `<s>` | underline / strikethrough |
| `<a href="…">` | link (see below) |
| `<span style="color:…;font-size:…">` | inline color / size |

```html
<p data-eid="p12">
  Ship <strong>fast</strong>, stay <em>offline</em>, and
  <a href="assets/spec.pdf">read the spec</a>.
</p>
```

The editor normalises marks to this allowlist on save:

- Legacy tags map to canonical ones (`<b>`→`<strong>`, `<i>`→`<em>`, `<font>`→`<span>`).
- `<span style>` keeps only `color` and `font-size`; other declarations, classes,
  ids, and `on*` handlers are stripped (an emptied span is unwrapped).
- `<a>` keeps `href` / `target` / `rel`; `javascript:`, `vbscript:`, and `data:`
  hrefs are neutralised (the anchor is unwrapped).
- Unknown/disallowed inline tags are unwrapped (text kept, tag dropped).

For links: prefer relative `assets/…` paths for in-deck resources. Unlike `src`,
an `<a href>` is navigation rather than a loaded resource, so external
`http(s)://` link *targets* are allowed and not flagged by validation — but they
won't resolve offline.

---

## 13. Turn-taking with the editor

The editor and Claude Code both write `deck.html`. v1 uses **turn-taking**:

1. One party writes; the other reloads before editing.
2. The server watches for file changes via `fsnotify`.
3. An external write triggers an SSE event; the editor reloads automatically
   when it is not mid-gesture.
4. A status badge shows `synced` / `external change` / `unsaved`.

**Rules for Claude Code:**

- Write **complete files** only — never partial `deck.html` fragments. The
  round-trip is file-level.
- Do not write while the editor is showing `unsaved` (the human has uncommitted
  changes). Ask the user to save first.
- Do not make trivial whitespace-only edits. The parser is byte-stable but
  spurious diffs pollute git history.
- Target elements by their `data-eid` when describing what you changed
  ("I updated eid `p1` to add the new bullet").

---

## 14. CLI workflow

```bash
# Scaffold a new deck
slides new my-talk

# (Re)vendor reveal.js into an existing deck after a binary upgrade
slides vendor my-talk

# Start the editor (serves on port 3000 by default)
slides serve          # or just: slides
```

```bash
# Append a starter <section> to a deck (byte-stable for the rest of the file)
slides add-slide my-talk

# Validate deck well-formedness (unique eids, valid data-*, assets exist)
slides validate my-talk
```

ALWAYS run `slides validate` after editing a deck — it exits non-zero with
readable diagnostics when the deck is malformed, so you can fix it before the
canvas or presenter silently breaks:

```bash
slides validate my-talk && echo "deck is valid"
```

It checks: valid `data-lay`/`data-align`/`data-justify` enum values, unique
`data-eid`s, referenced assets exist (and are not external `http(s)://` URLs —
decks are offline-first), and that the HTML parses and round-trips. The editor
runs the same checks over HTTP (`POST /api/decks/{name}/validate`) and on its
own save path, so a malformed candidate is caught instead of clobbering disk.

---

## 15. Quick invariant checklist

Before finishing any deck edit, verify:

- [ ] Every `data-lay` value is one of: `stack` | `row` | `grid` | `layers`
- [ ] Every `data-align` value is one of: `start` | `center` | `end` | `stretch`
- [ ] Every `data-justify` value is one of: `start` | `center` | `end` | `between` | `around`
- [ ] Every `data-gap` and `data-pad` is a non-negative integer
- [ ] Every `data-span` is a positive integer >= 1
- [ ] Every `data-grow` is a non-negative integer
- [ ] Every `data-theme` (if present) is one of the 10 bundled theme names
- [ ] Every `data-layout` / `data-slot` value is a non-empty string
- [ ] Every `data-chart` has a parseable `data-chart-data` JSON config
- [ ] Inline marks are limited to `strong` / `em` / `u` / `s` / `a` / `span[style]`
- [ ] All `data-eid` values are unique within the file
- [ ] No external URLs in image/media `src=`, `data-background-image/-video=`, or `url()` (external `<a href>` link targets are allowed; speaker-note URLs are fine)
- [ ] `assets/vendor/` was not modified
- [ ] `deck.html` is complete (not a fragment) before saving

See `docs/AUTHORING.md` for the WHY behind each rule.
