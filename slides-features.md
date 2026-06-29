# Slides.com Features — Investigation & Fit for a Local reveal.js + Claude Code Workflow

**Context:** You build presentations with reveal.js + Claude Code, run locally, and want
a nicer editing experience. Your main pain is *alignment / getting things "just right"*.

**Key fact:** slides.com is itself built on **reveal.js** (it's the SaaS product from
reveal.js's author). So almost every slides.com feature has a direct reveal.js equivalent —
the thing you're actually paying for is the **visual WYSIWYG editor**, the **cloud/team
layer**, and a handful of **convenience integrations**. This doc sorts every feature by how
much it helps *your* use case.

---

## TL;DR — What actually solves your pain

Your pain ("alignment, getting things just right") is a **WYSIWYG / visual-feedback gap**,
not a missing reveal.js capability. Most of the polish features are already free in reveal.js;
you just aren't using them. The high-leverage moves:

1. **Live-reload preview** so you see changes instantly while Claude Code edits the HTML/MD.
2. **Adopt reveal.js layout primitives** (`r-stack`, `r-fit-text`, `r-stretch`, `r-hstack`/
   `r-vstack`, flexbox) — these eliminate most manual pixel alignment.
3. **Auto-Animate** (`data-auto-animate`) — native in reveal.js 4, this is slides.com's
   flagship "wow" feature, free.
4. **A grid/guide overlay + snapping** during editing — the one genuine ergonomic thing
   slides.com gives you that vanilla reveal.js doesn't.
5. Enable the **plugins you're probably not using**: Markdown, Highlight, Math, Notes.

Everything cloud/team/billing-related is irrelevant to a local single-user setup.

---

## Tier 1 — Already native in reveal.js (just turn it on)

These are slides.com features that ship free with reveal.js. No reason to miss out.

| Slides.com feature | reveal.js equivalent | Notes |
|---|---|---|
| Fragments (step reveals) | `class="fragment"` | Core feature. |
| Auto-Animate | `data-auto-animate` on `<section>` | Animate elements moving between slides — the headline slides.com feature, native since v4. |
| Speaker View + Speaker Notes | `notes` plugin + press **S** | Separate presenter window with notes, next-slide, timer. |
| Syntax-highlighted code | `highlight` plugin (highlight.js) | Line numbers, line highlighting, step-through with `data-line-numbers`. |
| Math formulas | `math` plugin (KaTeX / MathJax) | Rendered LaTeX. |
| Import from Markdown | `markdown` plugin | Write slides in `.md`; great for Claude Code authoring. |
| Vertical slides | nested `<section>` | Down-navigation for sub-topics. |
| PDF export | `?print-pdf` + browser print | Self-contained, no service needed. |
| Style presets / themes | built-in themes + theme `.scss` | black, white, league, sky, etc. |
| Custom CSS / Edit HTML | it's your own files | You already have full control — the "Developer Mode" they sell. |
| Flexible resolution | `Reveal.initialize({ width, height })` | 16:9, 4:3, portrait, custom. |
| Transitions | `data-transition` | slide/fade/convex/concave/zoom. |
| Animations (element appearance) | fragments + CSS | Plus custom fragment styles. |
| Scroll Mode | `view: 'scroll'` (v5) | Scrollable single-page view. |
| Auto-Animate "interactivity" | `data-` events / JS hooks | Click/hover behaviors via your own JS. |
| Revision history | **git** | You get this for free + better, since you run locally. |
| Tables | plain HTML `<table>` | Styled by theme. |
| RTL support | `Reveal.initialize({ rtl: true })` | |
| Hidden slides | `class="hidden"` / comment out | |
| Kiosk / autoplay / loop | `autoSlide`, `loop` config | |

---

## Tier 2 — The real gap: visual editing & alignment (worth building/adding locally)

This is what slides.com genuinely does better than a code editor, and what maps directly to
your stated pain. Recommendations for getting it locally:

| Slides.com feature | Why it helps you | Local approach |
|---|---|---|
| **Layout Grid** | Snapping to a grid kills manual alignment fiddling. | Add a toggleable CSS grid/ruler overlay; or rely on `r-hstack`/`r-vstack` flex helpers so you never hand-position. |
| **Drag to Select / Drag positioning** | WYSIWYG nudging beats editing pixel values blind. | Hardest to replicate in pure code. Mitigate with live-reload + layout helpers so positioning is declarative, not absolute. |
| **Bulk-editing / Grouped Content** | Move/style many blocks at once. | In code: wrap in a container `<div>` and style the group; CSS classes are your "groups." |
| **Lines & Arrows** | Annotation/connectors are fiddly in HTML. | Use SVG overlays or a small helper; consider an arrow CSS utility. |
| **Freehand Drawing / Live Annotation** | Draw during presenting. | reveal.js has the community **chalkboard** plugin (`reveal.js-plugins`) — covers both. |
| **Context menu (right-click actions)** | Faster editing. | Editor-tooling concern; only relevant if you build a GUI. |
| **Live preview while editing** | See changes instantly — biggest single quality-of-life win. | Run reveal.js via `vite`/`live-server`/`reveal-md` with hot reload. **Do this first.** |

> **The honest takeaway:** if true drag-and-drop WYSIWYG is what you want, nothing local
> fully replaces slides.com's editor. But ~80% of the "alignment" pain disappears once you
> (a) stop hand-placing elements and use flex/grid layout helpers, and (b) get instant
> live-reload feedback. The remaining 20% (pixel-nudging) is the only thing a visual editor
> truly wins.

---

## Tier 3 — Nice convenience integrations (low effort to replicate)

| Slides.com feature | Local approach |
|---|---|
| Search Unsplash & GIPHY | Use Unsplash/Giphy APIs, or just have Claude Code fetch/insert images. |
| Media Library | A local `assets/` folder + naming convention. |
| SVG upload | Drop `.svg` into `assets/` and `<img>`/inline it. |
| Video upload/convert | Local `<video>` tags; convert with `ffmpeg` if needed. |
| Iframe embeds (YouTube/Maps) | Plain `<iframe>`. |
| Typekit & Google Fonts | `<link>` the font or self-host. |
| Slide Templates | Keep a `templates/` folder of `.html`/`.md` snippets Claude Code can reuse. |
| Import from PDF/PPT | Niche; pandoc / manual. Skip unless you migrate decks often. |
| Forking public decks | Clone any open-source reveal.js deck. |
| Math/code/themes | Already covered in Tier 1. |

---

## Tier 4 — AI features (you already have the better version)

| Slides.com feature | Your situation |
|---|---|
| Slides AI / AI Copywriter / AI Slide Generator | **Claude Code already does this**, and more flexibly — it writes the actual reveal.js source. |
| Presentation Translation (40+ langs) | Ask Claude Code to translate a copy of the deck. |
| **MCP API** | slides.com exposes an MCP server so AI assistants can manage decks. Interesting as a *pattern*: you could build a small MCP server (or just skills/scripts) so Claude Code manipulates your local decks with structured tools instead of raw text edits. Optional, but on-brand for your workflow. |

---

## Tier 5 — Irrelevant to a local, single-user setup (skip)

Cloud/SaaS/team/billing features with no bearing on running locally:

- Always-with-you cloud storage, Private Decks, Dropbox sync, Auto-expiring/private links,
  Password protection, Share publicly/privately, Embed hosting, Custom Domain.
- Live Stream, Remote Control, Live Cursor, Live Edits, Present Live (broadcast).
- Analytics (Google Analytics).
- All **Teams & Collaboration**: collaborate/comments, team homepage, shared media/templates,
  SSO, locked slides/designs, member management, unified billing.
- REST API / Define API / Developer Mode — you already edit source directly.
- Export to HTML zip — your project *is* already self-contained HTML.

> Note: Live Annotation, Remote Control, and Speaker Notes broadcasting have community
> plugin equivalents (chalkboard, remote control) if you ever want them — but they're
> presenting-time features, not editing, so they don't address your pain.

---

## Recommended next steps for `slides-builder`

A concrete build order, highest leverage first:

1. **Scaffold reveal.js with live-reload** (Vite or `reveal-md`) — instant visual feedback.
2. **Enable plugins**: Markdown, Highlight, Notes, Math, plus community **chalkboard**.
3. **Establish layout helpers as the default** (`r-stack`, `r-fit-text`, `r-stretch`,
   `r-hstack`/`r-vstack`, flex/grid utilities) so Claude Code lays things out *declaratively*
   — this is the single biggest fix for "alignment."
4. **Add a toggleable grid/guide overlay** (a dev-only CSS layer) for eyeballing alignment.
5. **Lean on `data-auto-animate`** for polished transitions (slides.com's signature look).
6. **Templates folder** of reusable slide snippets for Claude Code to pull from.
7. *(Optional)* A small **MCP server or Claude Code skill** that exposes structured
   slide-editing operations, mirroring slides.com's MCP API.

This gets you ~90% of the slides.com value locally and free, with git as version history and
Claude Code as the (superior) AI authoring layer. The only thing you forgo is true
drag-and-drop pixel nudging — which the layout primitives largely make unnecessary.
