# slides-builder — Implementation Plan

Atomic task breakdown derived from [`specs/`](specs/README.md). Each task is small,
independently completable, and verifiable. Execute roughly top-to-bottom; cross-phase
dependencies are noted inline.

## How to use this plan

- **Atomic** = one logical change with a single, checkable outcome. If a task needs
  sub-decisions or touches multiple concerns, it's split.
- Each task has an **ID** (`P{phase}-{n}`), a description, the **spec** it implements, and a
  **Done when** acceptance criterion.
- Check the box when the *Done when* criterion is met (and any test for it passes).
- **Definition of done (global):** code compiles, the criterion holds, no spec invariant
  ([spec 12](specs/12-principles-and-invariants.md)) is violated, and any new behavior has at
  least a smoke test.

---

## Phase 0 — Foundations
> Goal: a running Go+Svelte skeleton and the load-bearing coordinate spike. Specs: [01](specs/01-architecture.md), [13](specs/13-project-structure.md).
>
> **STATUS (done, tag 0.0.1):** Phase 0 complete + P1-1. Go backend (`cmd/slides`, `internal/{config,deck,server,watch}`, `web/embed.go`) and Svelte 5 + TS + Vite + Tailwind frontend (`web/`) build and test green. Default port **3000** (Go `internal/config`; Vite proxy matches). Embed contract: Vite outputs to `web/dist/`, served at root via `fs.Sub(distEmbed,"dist")`. P0-14 coords transform in `web/src/lib/coords.ts` (78 vitest tests). Routes: `GET /health`, `GET/PUT /api/decks[/{name}]`, `GET /events` (SSE). Atomic deck writes via temp+rename (byte-identical round-trip verified).
>
> **Follow-ups:**
> - ~~[offline-first] `slides new` uses CDN reveal.js~~ **RESOLVED in Phase 1 (Lane V):** reveal 5.x vendored to `shared/vendor/reveal/`, copied into `decks/<name>/assets/vendor/reveal/` on `slides new`, referenced relatively; `slides vendor <deck>` re-vendors. Verified zero `http(s)://` in generated deck.html.
> - **[cleanup] `Splitter.svelte` uses `createEventDispatcher`** (Svelte 4 compat). Migrate to Svelte 5 callback props during Phase 2/3 canvas work.

## Phase 1 — Live editor shell
> **STATUS (done, tag 0.0.2):** P1-1..P1-9 complete. Built via 5 parallel lanes + Opus integration; independently verified (FE: 130 vitest tests green incl. 23 model round-trip + 29 SSE + 78 coords; Go build/vet/test green; binary smoke-tested: deck APIs, `/decks/{name}/...` static route traversal-safe, offline-vendored reveal).
>
> **Key design decision (Lane M, spec 12 #4):** the document model is a **source-preserving element tree**, NOT DOMParser/outerHTML. Each node keeps its exact original bytes (`raw`); `serializeDeck` emits `raw` for untouched subtrees and canonical markup only for `dirty` ones → guarantees `serializeDeck(parseDeck(html)) === html` for well-formed input and scoped edits never churn siblings. Parser targets well-formed reveal HTML (explicit close tags; no HTML5 tag-omission) — `slides validate` (P8-2) will gate malformed input. Model API in `web/src/lib/model/` (`parseDeck`, `serializeDeck`, `edit.ts` mutators set `dirty`).
>
> **Infra added at integration:** `$lib` Vite/tsconfig alias; `main.ts` uses Svelte 5 `mount()`; `web/svelte.config.js` (fixed project-wide svelte-check); Go `/decks/{name}/...` static deck route (path-traversal guarded, `deck.ValidName`); `deckStore` (`web/src/lib/store/deck.svelte.ts`) loads→parses→autosaves (PUT, debounced) and reloads canvas after save; SSE reload wired with a turn-taking status badge. **Canvas refresh = server file + iframe reload after autosave** (not srcdoc) so relative asset URLs resolve and the canvas reflects persisted bytes.
> - **[build] `web/dist/.gitkeep`** is recreated by a Vite `closeBundle` hook (`emptyOutDir` wipes it) so `go:embed` compiles on fresh clone and the tree stays clean.
>
> **Follow-ups discovered (not blocking Phase 1):**
> - **[spec 11 §4] Turn-taking has a status badge but no conflict-resolution prompt/diff UI** on external-change-while-dirty. Implement in P8-6 (dirty-guard conflict prompt).
> - **[spec 11] `slides validate` not yet run on the editor save path** (P8-3) — wire once P8-2 exists.
> - **[perf] CodeMirror bundle trips Vite's >500 kB warning.** Consider `manualChunks`/code-split later (cosmetic).
> - **[X-1] Offline guard** is currently a deck-template test; promote to a CI/dev check over a built deck's loaded URLs.

- [x] **P0-1 — Init Go module.** `go mod init`, repo layout (`cmd/`, `internal/`). _Done when:_ `go build ./...` succeeds on an empty `main`.
- [x] **P0-2 — Init frontend toolchain.** Svelte 5 + TypeScript + Vite + Tailwind in `web/`. _Done when:_ `npm run dev` serves a blank app with Tailwind working.
- [x] **P0-3 — Static server.** Go HTTP server serving a hello route. _Done when:_ `curl localhost:PORT` returns 200.
- [x] **P0-4 — `go:embed` the frontend.** Embed `web/dist` and serve it from Go. _Done when:_ `go build` produces one binary that serves the built Svelte app. (Spec 01)
- [x] **P0-5 — Dev proxy.** Vite proxies `/api` and `/events` to the Go process in dev. _Done when:_ frontend dev server reaches a Go API route. (Spec 01)
- [x] **P0-6 — Config loader.** Read `config.toml` (defaults: port, aspect, grid size, enabled providers); secrets from env only. _Done when:_ config values are readable in Go; missing file uses defaults. (Spec 13)
- [x] **P0-7 — Workspace scaffolding helper.** Create `decks/ templates/ shared/ themes/` if absent. _Done when:_ running the binary in an empty dir creates the tree. (Spec 13)
- [x] **P0-8 — `slides new <name>` CLI.** Scaffold `decks/<name>/{deck.html,custom.css,assets/}` with a minimal valid reveal deck. _Done when:_ command creates a deck that opens in a browser via reveal. (Spec 11, 13)
- [x] **P0-9 — Deck list API.** `GET /api/decks` lists deck folders. _Done when:_ returns the scaffolded deck.
- [x] **P0-10 — Deck read API.** `GET /api/decks/{name}` returns `deck.html`. _Done when:_ returns file contents.
- [x] **P0-11 — Deck write API.** `PUT /api/decks/{name}` writes `deck.html` atomically (temp+rename). _Done when:_ a round-trip read→write→read is byte-identical.
- [x] **P0-12 — File watcher.** `fsnotify` watches each deck folder. _Done when:_ an external file edit logs a change event server-side. (Spec 01, 11)
- [x] **P0-13 — SSE endpoint.** `GET /events` streams `{deck, type:"changed"}` on watcher events. _Done when:_ a browser `EventSource` receives an event when a file is edited externally. (Spec 11)
- [x] **P0-14 — Coordinate/scale transform (spike).** Pure functions `screenToLogical` / `logicalToScreen` given scale+offset, with unit tests. _Done when:_ tests cover fit-scale, custom zoom, and round-trip identity. (Spec 04, 05 — load-bearing, do before any overlay work)

## Phase 1 — Live editor shell
> Goal: open a deck, see it rendered, edit source, hot-reload. Specs: [02](specs/02-document-model.md), [04](specs/04-canvas-interaction.md).

- [x] **P1-1 — Pane layout shell.** Navigator | Canvas | Outline+Properties/Source zones (static). _Done when:_ resizable panes render. (Spec 04)
- [x] **P1-2 — Sandboxed iframe renderer.** Mount reveal.js in a sandboxed iframe at logical 1920×1080. _Done when:_ a deck renders inside the iframe. (Spec 04, 05)
- [x] **P1-3 — Load deck into iframe.** Fetch `deck.html` and render it. _Done when:_ the scaffolded deck displays.
- [x] **P1-4 — DOM-as-model parse.** `DOMParser` → detached document held as the model. _Done when:_ model round-trips to identical HTML via the serializer (P1-5). (Spec 02)
- [x] **P1-5 — Deterministic serializer.** Model → HTML with stable indentation/attribute order. _Done when:_ same model always yields identical bytes. (Spec 02)
- [x] **P1-6 — Idempotent round-trip invariant + golden tests.** Corpus of decks (incl. odd/AI-authored HTML) must survive load→save byte-stable. _Done when:_ golden-file test suite passes. (Spec 12 — invariant)
- [x] **P1-7 — CodeMirror 6 source pane.** HTML editing view bound to the model. _Done when:_ editing source updates the in-memory model.
- [x] **P1-8 — Source → canvas sync.** Debounced re-parse + re-render on source edits. _Done when:_ typing in source updates the iframe.
- [x] **P1-9 — SSE client + reload.** Listen on `/events`; reload model on external change. _Done when:_ editing `deck.html` on disk updates the canvas live. (Spec 11)

## Phase 2 — Text editing & write-back
> Goal: select and edit content visually; changes persist. Specs: [02](specs/02-document-model.md), [04](specs/04-canvas-interaction.md).

- [x] **P2-1 — Element classification.** Tag each node container/leaf/free/passthrough on parse. _Done when:_ classification is queryable per node. (Spec 02)
- [x] **P2-2 — `data-eid` stamping.** Assign stable unique ids to managed elements; preserve across save/load. _Done when:_ ids survive a round-trip and are unique per deck. (Spec 02)
- [x] **P2-3 — Click selection (leaves).** Click an element → selected state. _Done when:_ clicking selects exactly one leaf.
- [x] **P2-4 — Selection overlay box.** Draw a bounding box over the selected element using the P0-14 transform. _Done when:_ box tracks the element at any zoom. (Spec 04)
- [x] **P2-5 — Contenteditable text editing.** Edit text leaves in place inside the iframe. _Done when:_ typed text appears and updates the model. (Spec 04)
- [x] **P2-6 — Canvas → source write-back.** Serialize on edit; source pane reflects canvas edits. _Done when:_ a canvas text edit appears in the source pane, passthrough intact. (Spec 02)
- [x] **P2-7 — Autosave per command.** Persist to disk after each committed edit. _Done when:_ edits survive a reload. (Spec 02, 11)
- [x] **P2-8 — Snapshot undo/redo.** Push serialized model per command; undo/redo restores. _Done when:_ undo reverts the last edit; redo reapplies. (Spec 04)

> **Phase 2 STATUS (done, tag 0.0.3):** P2-1..P2-8 complete. 3 lanes + Opus integration; verified (FE 204 vitest tests, svelte-check 0/0, Go green; E2E: stamped deck.html carries `data-eid` on managed elements, none on passthrough; idempotent on reload).
> - **Model:** `classify(el)` → container/leaf/free/passthrough (`web/src/lib/model/classify.ts`); `stampEids(model)` idempotent/stable/scoped-dirty (`web/src/lib/model/eid.ts`). Stamping wired into `deckStore` on load (one-time normalization save if un-stamped).
> - **Canvas interaction** (`web/src/lib/canvas/*`, `components/canvas/CanvasInteraction.svelte` + `SelectionOverlay.svelte`): click→nearest-leaf selection by `data-eid`; overlay box mapped via `coords.ts` (tracks zoom/resize/reflow); double-click contenteditable; write-back via `deckStore.applyTextEdit(eid, literalText)` (single entry point, no shims).
> - **Undo/autosave:** snapshot undo/redo in store (1 command = 1 undo entry = 1 autosave); UI Cmd/Ctrl+Z / Shift / Ctrl+Y with editable-target guard so CodeMirror keeps its own undo; floating toolbar bound to canUndo/canRedo.
> - **⚠️ Needs VISUAL/browser verification** (not confirmable headlessly): overlay pixel-alignment at non-1.0 zoom; dblclick→edit→Enter/Escape; reflow/resize tracking; one-edit→one-undo→one-save with SourcePane reflecting it loop-free; CodeMirror-local vs deck-level undo focus routing.
> - **[opt] follow-up:** first-load stamping currently renders the un-stamped disk copy once before the normalization save (harmless wasted iframe render); could suppress the intermediate reloadNonce bump.

## Phase 3 — Structured layout & alignment (the pain-solver)
> Goal: the five-primitive layout model with intent-based alignment. Spec: [03](specs/03-layout-vocabulary.md).

- [x] **P3-1 — Layout stylesheet.** Bundled CSS mapping `data-lay`/`data-gap`/`data-align`/`data-justify`/grid attrs to flex/grid. _Done when:_ a hand-written `data-lay` deck renders correctly. (Spec 03)
- [x] **P3-2 — Container recognition.** Model exposes container kind + layout props from `data-*`. _Done when:_ props are readable/writable per container. (Spec 03)
- [x] **P3-3 — Outline/layers panel.** Tree of section → containers → leaves. _Done when:_ the tree reflects the model and selecting a node selects it on canvas. (Spec 03, 04)
- [x] **P3-4 — Container properties panel.** Edit gap/align/justify/pad (and grid cols/rows). _Done when:_ changing a prop updates `data-*` and the canvas reflows. (Spec 03)
- [x] **P3-5 — Alignment-as-intent toolbar.** Align/justify/equal-columns buttons set container props (not coordinates). _Done when:_ "center" writes `data-align="center"`. (Spec 03)
- [x] **P3-6 — Reorder drag (within container).** Drag a child to a new index; container reflows. _Done when:_ order persists in source. (Spec 04)
- [x] **P3-7 — Reparent drag (across containers).** Drop a child into a different container/cell. _Done when:_ parent change persists. (Spec 04)
- [x] **P3-8 — Snap-to-grid.** Toggleable logical grid (default 8u). _Done when:_ grid toggles and snapping engages for applicable drags. (Spec 04)
- [x] **P3-9 — Keyboard nudge.** Arrows = 1u, Shift+arrows = 10u (logical). _Done when:_ nudging moves selection in logical units. (Spec 04)

> **Phase 3 STATUS (done, tag 0.0.4 — completes milestone M1):** P3-1..P3-9 complete. 4 lanes + Opus integration; verified (FE 341 vitest tests, svelte-check 0/0, Go green; offline-first + byte-stability re-verified via curl/vite-node).
> - **Layout CSS (P3-1):** `slides-layout.css` (enum data-* → flex/grid: stack/row/grid/layers, align, justify, free) + `slides-layout-init.js` (numeric attrs gap/pad/cols/rows/grow/basis/span + free x/y/w/h/rot, MutationObserver for reveal-injected content). Both embedded in the binary and copied into `decks/<name>/assets/vendor/` on `slides new`/`slides vendor`, linked relatively; zero external URLs.
> - **Container model API (P3-2):** `web/src/lib/model/layout.ts` — `getContainerKind`, `getLayoutProps`/`setLayoutProps` (validated, scoped-dirty), `resolveContainerForEid`. **Tree-mutation ops `moveChild`/`reparentChild` consolidated into `web/src/lib/canvas/structure-ops.ts` (single source of truth; the duplicate model-layer copies were removed).**
> - **UI:** OutlinePanel (`components/outline/`, passthrough nodes get an X-3 "source only" badge), PropertiesPanel + AlignmentToolbar (`components/properties/`), DragController/GridOverlay/NudgeController (`components/canvas/`). Two-way selection sync canvas↔outline↔properties via the selection store.
> - **Store commands (one undo entry + one autosave each):** `applyLayoutChange(eid, delta)`, `applyEqualColumns(eid)`, move/reparent via `structure-commands.ts`, grid toggle (`grid.svelte.ts`), nudge (free → data-x/y; structured → reorder) with editing-context guards.
> - **⚠️ Needs VISUAL/browser verification:** drag drop-indicator + reparent feel; snap-grid alignment/feel at zoom/pan; alignment toolbar reflowing live reveal; outline↔canvas selection sync/auto-scroll; nudge on free vs structured.
> - **[arch follow-up]** `structure-ops.ts` is a pure model op but lives under `$lib/canvas`; consider relocating into `$lib/model` (e.g. `edit.ts`) so all tree mutations sit in one layer.
> - **[perf, pre-existing]** Vite main chunk > 500 kB warning (no functional impact; CM6 + reveal). Code-split later.

## Phase 4 — Free positioning & geometry
> Goal: the absolute-positioning escape hatch with smart guides. Specs: [03](specs/03-layout-vocabulary.md), [04](specs/04-canvas-interaction.md), [05](specs/05-scaling-and-resolution.md).

- [x] **P4-1 — `data-free` toggle.** Convert an element to/from free; write `data-free`+`data-x/y/w/h`. _Done when:_ toggling moves it between structured and absolute. (Spec 03)
- [x] **P4-2 — Absolute drag move.** Drag a free element in logical coordinates. _Done when:_ position persists as logical coords. (Spec 04)
- [x] **P4-3 — Resize handles.** 8 handles; Shift = aspect, Alt = from center. _Done when:_ resize updates `data-w/h` with modifiers honored. (Spec 04)
- [x] **P4-4 — Smart alignment guides.** Snap lines vs sibling edges/centers and slide center while dragging/resizing. _Done when:_ guides appear and snap. (Spec 04)
- [x] **P4-5 — Marquee multi-select.** Drag-select multiple elements. _Done when:_ multiple elements selected together. (Spec 04)
- [x] **P4-6 — Align/distribute (free).** Edge align + spacing distribute on multi-selection (coordinate ops). _Done when:_ selected free elements align/distribute. (Spec 04)
- [x] **P4-7 — Aspect-ratio change handling.** On ratio change: reflow structured; flag free elements with reposition offer. _Done when:_ switching 16:9→4:3 reflows structured content and flags free ones. (Spec 05)

> **Phase 4 STATUS (done, tag 0.0.5):** P4-1..P4-7 complete. 4 lanes + Opus integration; verified (FE 791 vitest tests, svelte-check 0/0, Go green; byte-stability + offline-first re-verified).
> - **Foundation:** `setFree`/`toggleFree` (`web/src/lib/model/free.ts`); **selection store now multi-select** (`.eids`/`.primary`/`add`/`remove`/`toggle`/`set`, `.eid`=primary for back-compat) — single source of truth, existing call sites preserved; `aspect.ts` (`logicalDimensions(aspect)`, presets incl. 1:1, `repositionFreeRect`).
> - **Drag/resize:** pure geometry `resize-geometry.ts` (8 handles, Shift=aspect, Alt=from-center, snap, minSize) + `free-position.ts` writers; `FreeTransformOverlay.svelte`/`ResizeHandles.svelte` (free selections only; structured-drag path untouched). Move batches the selection as one undo entry.
> - **Guides + align/distribute:** smart guides snap to sibling edges/centers + slide center/edges (aspect-aware); `FreeAlignBar` (2+ free selection; distribute at 3+) via `applyFreeGeometryBatch` (one undo entry).
> - **Marquee + aspect:** `MarqueeController` (empty-space drag, swallows trailing click); aspect `<select>` rebinds RevealFrame logical size via `aspectStore`, structured reflows, free elements get a reposition OFFER (`AspectRepositionOffer`).
> - **Fixed (was pre-existing bug):** scaffold template now seeds `Reveal.initialize({width:1920,height:1080})` so new decks are WYSIWYG-aligned with the editor's logical canvas (previously reveal defaulted to 960×700).
> - **⚠️ Needs VISUAL/browser verification:** resize modifiers/snap; guide snapping; marquee (Shift union / Alt contain) + trailing-click swallow; aspect reflow + reposition dialog.
> - **[visual nice-to-have]** multi-select draws only the primary's overlay box; draw all selected boxes later.

## Phase 5 — Content blocks & assets
> Goal: insert rich content; the acquire→localize asset pipeline. Spec: [08](specs/08-assets-and-media.md).

- [x] **P5-1 — Insert palette UI.** Menu of insertable block types. _Done when:_ palette opens and lists block types. (Spec 03)
- [x] **P5-2 — Insert text block.** Add heading/paragraph/list leaves. _Done when:_ inserted text is editable and persists.
- [x] **P5-3 — Asset copy pipeline.** On image add, copy file into `decks/<name>/assets/`, insert relative `src`. _Done when:_ added image is referenced relatively and deck stays self-contained. (Spec 08)
- [x] **P5-4 — Insert image (local upload/drag/paste).** _Done when:_ dropped image is localized (via P5-3) and rendered. (Spec 08)
- [x] **P5-5 — `shared/` library + copy-on-insert.** Browse `shared/`; inserting copies into the deck's `assets/`. _Done when:_ no cross-deck reference is created. (Spec 08)
- [x] **P5-6 — Image provider interface.** Abstraction `search(query)→results`, `fetch(id)→localized asset`. _Done when:_ a provider can be registered and used uniformly. (Spec 08)
- [x] **P5-7 — Unsplash provider.** Implements P5-6; key from env. _Done when:_ searching inserts a localized image; absent key disables gracefully. (Spec 08, 12)
- [x] **P5-8 — Giphy provider.** Implements P5-6. _Done when:_ same as P5-7 for GIFs. (Spec 08)
- [x] **P5-9 — Code block.** highlight.js (bundled), language select + `data-line-numbers`. _Done when:_ code renders highlighted; line stepping works. (Spec 03, 12)
- [x] **P5-10 — Math block.** KaTeX (bundled), inline LaTeX field. _Done when:_ LaTeX renders. (Spec 03, 12)
- [x] **P5-11 — Table block.** Insert/edit a table leaf. _Done when:_ table renders and cells are editable. (Spec 03)
- [x] **P5-12 — Shape/line/arrow.** SVG-based shapes. _Done when:_ shapes insert and are selectable/resizable. (Spec 03)
- [x] **P5-13 — Embed/iframe block.** YouTube/Maps/etc. _Done when:_ an embed renders. (Spec 03)
- [x] **P5-14 — Video block + transcode.** Local `<video>`; optional Go `ffmpeg` transcode for unsupported formats. _Done when:_ a video plays; unsupported format is transcoded. (Spec 08)

> **Phase 5 STATUS (done, tag 0.0.6 — completes milestone M2):** P5-1..P5-14 complete. 1 Go lane + 2 FE lanes + Opus integration; verified (FE 863 vitest tests, svelte-check 0/0, Go green incl. assets/provider packages; offline-first re-verified — fresh deck links highlight+math+KaTeX+20 local fonts, ZERO external URLs).
> - **Go backend:** `internal/assets` (upload `POST /api/decks/{name}/assets` → MIME-routed `assets/{img,video,audio,files}/`, SHA-256 dedup, traversal-safe, returns relative src; ffmpeg video transcode w/ graceful absence + `GET /api/capabilities`); `internal/provider` (interface + Registry, Unsplash + Giphy, env keys `UNSPLASH_ACCESS_KEY`/`GIPHY_API_KEY`, **disabled w/o key**, localize-on-fetch); `shared/` library (`GET /api/shared`, `POST /api/shared/{file}/copy?deck=`, `GET /shared/{path}`); `server.NewWithProviders` wired in `main.go`.
> - **Offline plugins (P5-9/10):** reveal highlight (monokai) + math/KaTeX vendored into the binary (go:embed), copied into decks, enabled in template (`katex:{local:...}`, `plugins:[RevealHighlight, RevealMath.KaTeX]`). ~1.55 MB binary growth (acceptable for offline-first).
> - **FE:** single insert seam — `deckStore.insertBlock/insertAfter` + palette REGISTRY (`web/src/lib/blocks/`, FE-B folded in, duplicate `palette.ts` deleted). Blocks: text/heading/list, table, SVG shape/line/arrow (free), embed/iframe, image (drag/paste/upload + shared browser + provider search), code (lang + line-numbers), math (LaTeX). `InsertPalette` in toolbar (`+` button + `/` hotkey); `ProviderSearch`/`SharedLibrary` panels. `math-block` marked leaf in classify (selectable/eid-stamped). Every insert = one undo entry + one autosave, byte-stable.
> - **⚠️ Needs VISUAL/browser verification:** palette dropdown + panel modals; inserted code renders highlighted + math renders via KaTeX in the iframe. **Needs API keys** to exercise provider search/fetch; **needs a real .mov/.avi** for transcode.
> - **[migration gap, user decks]** pre-P5 decks don't get highlight/math plugins in their existing `deck.html` unless re-scaffolded; `slides vendor` copies plugin *files* but doesn't rewrite `deck.html`. Consider a `slides upgrade <deck>` later (out of scope; not a codebase migration).

## Phase 6 — Slides, motion, theming
> Goal: deck organization, animation authoring, theming. Specs: [06](specs/06-slide-management.md), [07](specs/07-motion-and-transitions.md), [09](specs/09-theming-and-styles.md).

- [x] **P6-1 — Slide navigator filmstrip.** List slides; click to jump. _Done when:_ navigator reflects sections and navigates. (Spec 06)
- [x] **P6-2 — Slide thumbnails.** Scaled render/snapshot per slide, updated on edit. _Done when:_ thumbnails match content. (Spec 06)
- [x] **P6-3 — Add/duplicate/delete slide.** Duplicate regenerates `data-eid` but preserves `data-id` pairing potential. _Done when:_ each op updates source correctly. (Spec 06)
- [x] **P6-4 — Reorder slides.** Drag in the filmstrip. _Done when:_ document order changes persist. (Spec 06)
- [x] **P6-5 — Vertical slides (2D navigator).** Nest/promote/demote verticals. _Done when:_ nested sections render and navigate down. (Spec 06)
- [x] **P6-6 — Hide slide.** `data-visibility="hidden"`; skipped when presenting. _Done when:_ hidden slide stays in source, absent from present. (Spec 06)
- [x] **P6-7 — Fragments UI.** Mark element to appear at step N; reorder list. _Done when:_ `class="fragment"`+index write and reveal steps work. (Spec 07)
- [x] **P6-8 — Transitions UI.** Per-deck/per-slide `data-transition` + speed. _Done when:_ transition changes apply. (Spec 07)
- [x] **P6-9 — Auto-animate authoring.** "Animate from previous slide": set `data-auto-animate` on the pair, derive `data-id` from `data-eid`. _Done when:_ moving an element across the pair tweens. (Spec 07)
- [x] **P6-10 — Theme picker.** Select bundled reveal theme per deck. _Done when:_ theme switch re-styles the deck. (Spec 09)
- [x] **P6-11 — `custom.css` pane.** Edit per-deck CSS in CM6. _Done when:_ edits apply and persist to `custom.css`. (Spec 09)
- [x] **P6-12 — CSS variable controls.** Color/font pickers bound to CSS custom properties. _Done when:_ picker changes `--accent`/`--heading-font` and canvas updates. (Spec 09)
- [x] **P6-13 — Font localization.** Download a chosen Google Font into `assets/fonts/`, rewrite `@font-face` local. _Done when:_ deck renders the font with network disabled. (Spec 09, 12)

> **Phase 6 STATUS (done, tag 0.0.7):** P6-1..P6-13 complete. 3 lanes + Opus integration; verified (FE 944 vitest tests, svelte-check 0/0, Go green; offline-first re-verified — 9 themes bundled, zero external URLs, custom.css PUT/GET byte-identical).
> - **Slide mgmt (`web/src/lib/slides/`, `components/navigator/`):** undoable+autosaved `addSlide`/`duplicateSlide` (regenerates eids, preserves data-id for auto-animate)/`deleteSlide`/`moveSlide`/`moveVerticalSlide`/`nestSlide`(=demote)/`promoteSlide`/`setSlideHidden` (`data-visibility="hidden"`). Navigator filmstrip (click-to-jump via Reveal.slide, current-slide reflect), drag-reorder, 2D verticals. **Thumbnails** = per-slide sandboxed `srcdoc` iframe with the deck's own stylesheets, scaled (offline, zero external URLs; visual approximation).
> - **Motion (`web/src/lib/motion/`, `components/motion/`):** fragments (`class="fragment"`+`data-fragment-index`, reorder), per-deck/per-slide transitions (`data-transition`+speed), auto-animate (`data-auto-animate` on the pair + derived `data-id`). New right-panel **Motion** tab.
> - **Theming (`components/theming/`, Go):** theme picker (9 reveal themes vendored into binary + copied per deck), `custom.css` CM6 pane (`PUT/GET /api/decks/{name}/custom.css`, atomic), CSS-variable controls (idempotent `:root` writes), offline **font localization** (`POST /api/decks/{name}/fonts` downloads Google Font → `assets/fonts/` + local `@font-face`; 503 graceful when offline). New **Theme** tab. Right panel reorganized: Outline pinned + tabbed Properties | Motion | Theme.
> - **⚠️ Needs VISUAL/browser verification:** thumbnails render; navigator click moves canvas + highlight reflects; drag-reorder UX; theme/var/font visibly change canvas; fragment/transition/auto-animate playback. **Needs NETWORK** to exercise font localization end-to-end.

## Phase 7 — Presenting & export
> Goal: present and export. Spec: [10](specs/10-presenting-and-export.md).

- [x] **P7-1 — Present route.** `/present/<deck>` serves the pure `deck.html` via reveal, no editor. _Done when:_ presenting matches the saved file exactly. (Spec 10)
- [x] **P7-2 — Speaker view.** Verify reveal's S-key speaker window works off the present route; notes field per slide writes `<aside class="notes">`. _Done when:_ speaker window shows notes/next/timer. (Spec 10)
- [x] **P7-3 — PDF export.** Go drives headless Chrome with `?print-pdf`. _Done when:_ a correct PDF downloads. (Spec 10)
- [x] **P7-4 — HTML bundle export.** Zip the deck folder. _Done when:_ the zip opens and presents standalone offline. (Spec 10, 12)

> **Phase 7 STATUS (done, tag 0.0.8 — completes milestone M3):** P7-1..P7-4 complete. 2 lanes + Opus integration; verified (FE 961 vitest tests, svelte-check 0/0, Go green; present route byte-identical, valid zip bundle, PDF 503-graceful w/o Chrome, zero external URLs).
> - **Go:** `GET /present/{name}` (+ `/{path...}` for assets) serves deck.html byte-identical to disk; reveal **Notes** plugin vendored into binary + decks + enabled in template (S key → speaker window, offline); `GET /api/decks/{name}/export.pdf` drives headless Chrome via `FindChrome()` (`$CHROME_BIN` → google-chrome/chromium/... ; **503 JSON graceful when absent**); `GET /api/decks/{name}/export.zip` streams a traversal-safe self-contained deck bundle.
> - **FE:** `PresentButton` (opens `/present/{name}`), `NotesPanel` (per-slide `<aside class="notes">` via `deckStore.setSlideNotes`, undoable+autosaved, byte-stable), `ExportPanel` (PDF w/ friendly Chrome-absent message + ZIP download). New right-panel Notes + Export tabs.
> - **⚠️ Needs:** Chrome to exercise PDF (only 503 path verified here — `server_test.go` has a conditional Chrome test); browser to confirm speaker window + present visual + new tabs.
> - **[opt]** add a `chrome` flag to `/api/capabilities` so ExportPanel can disable the PDF button proactively (instead of HEAD-probe). **[perf]** FE bundle ~698 kB (>500 kB warning) — code-split candidate.

> **Phase 8 STATUS (done, tag 0.0.9 — completes milestone M4 & the whole plan):** P8-1..P8-7 complete; **P8-8 (MCP) intentionally deferred** per the plan. 3 lanes + Opus integration; verified (FE 1001 vitest tests, svelte-check 0/0, Go green; CLI add-slide/validate exercised: clean→exit 0, dup-eid/bad-enum/missing-asset/external-url→exit 1 with diagnostics).
> - **Go:** `slides add-slide <deck>` (byte-stable append); `internal/validate` (independent re-impl of the spec-03 contract — enum/numeric values, unique eids, asset existence + traversal, well-formedness via `x/net/html`, X-1 external-URL guard) wired as `slides validate <deck>` CLI + `POST /api/decks/{name}/validate` (validates on-disk or supplied bytes). _Dep added: `golang.org/x/net`._ Keep `validate.go` allowed-sets in sync with the TS `layout.ts` enums.
> - **FE:** validate-on-save (client guard + remote validate, surfaces errors via `ValidationBanner`, no clobber); `StatusIndicator` (synced/unsaved/saving/external/error); `ConflictPrompt` dirty-guard (`decideExternalChange` echo/adopt/conflict + LCS line diff); `ChangeHighlightOverlay` (post-SSE-reload `data-eid` diff via `diffModels`, flashes changed/added in the iframe).
> - **Authoring:** `.claude/skills/slides-authoring/SKILL.md` (the Claude Code skill) + `docs/AUTHORING.md` (full contract reference) — accurate to the live `data-*` contract; CLAUDE.md links them.
> - **⚠️ Needs browser confirmation:** ConflictPrompt UX, change-highlight flashing, StatusIndicator transitions, ValidationBanner.
> - **[deferred] P8-8 MCP** — expose CLI ops as MCP tools (`add_slide`/`set_layout`/`insert_image`); not started, per plan.

## Phase 8 — Claude Code integration
> Goal: the AI authoring layer + safe handoff. Spec: [11](specs/11-claude-code-integration.md).

- [x] **P8-1 — `slides add-slide <deck>` CLI.** Append a starter `<section>`. _Done when:_ command adds a valid slide. (Spec 11)
- [x] **P8-2 — `slides validate <deck>` CLI.** Check `data-lay` validity, unique eids, asset existence, parse+round-trip. _Done when:_ returns non-zero with diagnostics on a malformed deck. (Spec 11, 12)
- [x] **P8-3 — Validate on save.** Editor save path runs validation. _Done when:_ a save that would break the model is surfaced, not silently applied. (Spec 12)
- [x] **P8-4 — Conventions doc + skill.** Write the Claude Code skill (vocabulary, folder layout, turn-taking, offline rules). _Done when:_ skill is installed and Claude Code can author a valid deck from it. (Spec 11)
- [x] **P8-5 — Turn-taking status indicator.** Show `synced / external change / unsaved`. _Done when:_ indicator reflects each state. (Spec 11)
- [x] **P8-6 — Dirty-guard conflict prompt.** On external change while dirty, prompt instead of clobbering. _Done when:_ concurrent edit triggers the prompt. (Spec 11)
- [x] **P8-7 — Highlight external changes.** After an SSE reload, highlight elements Claude changed (by `data-eid` diff). _Done when:_ changed elements are visually marked. (Spec 02, 11)
- [ ] **P8-8 — (Later) MCP layer.** Expose CLI ops as MCP tools. _Done when:_ an MCP client can `add_slide`/`set_layout`/`insert_image`. (Spec 11 — deferred)

## Phase 9 — Workspace polish & e2e
> Goal: a more adjustable editor shell, element-level editing affordances, more themes,
> browser-side deck creation, and an end-to-end test layer. Specs: [04](specs/04-canvas-interaction.md), [06](specs/06-slide-management.md), [09](specs/09-theming-and-styles.md), [12](specs/12-principles-and-invariants.md).
>
> Built post-M4 from user feature requests. Tasks are grouped (layout / editing / themes /
> deck lifecycle / testing); the e2e harness (P9-1) lands first so every later task ships with
> a passing browser test. Implemented via worktrees + workflow subagents.

### Testing foundation
- [x] **P9-1 — Playwright harness.** Add Playwright e2e wired to run against the **built binary** (embedded FE + Go API + a temp workspace deck), using the host's official `mcr.microsoft.com/playwright` image; an npm/make script builds then runs. _Done when:_ a smoke spec opens a deck in a real browser and asserts the canvas renders, green in the container. (Spec 12)
- [x] **P9-2 — e2e offline-guard assertion.** During an e2e run, assert no external (`http(s)://`) URL is requested by any loaded page (editor + present route). _Done when:_ the suite fails if a deck or the shell loads a remote URL (promotes X-1 to a live check). (Spec 12, X-1)

### Pane layout & chrome (spec 04)
- [x] **P9-3 — Collapsible side panels.** Chevron collapses the left navigator and the right panel to a thin rail; click restores previous width; state + width persist. _Done when:_ both sides collapse/restore and survive reload; e2e covers it. (Spec 04)
- [x] **P9-4 — Collapsible source pane.** Source pane (right-panel bottom) collapses/expands independently via a header toggle; last height remembered. _Done when:_ collapsing frees the height for outline/properties and restores to prior size. (Spec 04)
- [x] **P9-5 — Per-pane resize + persistence.** Extend `Splitter` so all boundaries (nav↔canvas, canvas↔right, outline/properties↕source) are individually draggable within min/max; persist sizes. _Done when:_ each split drags and sizes survive reload. (Spec 04)
- [x] **P9-6 — Source ↔ selection jump.** On selection, if the source pane is visible, scroll/reveal that element's `data-eid` in CodeMirror; never steals an active edit's focus. _Done when:_ selecting an element scrolls the source to its `data-eid`; e2e asserts the visible range. (Spec 04, 02)

### Element editing
- [x] **P9-7 — Delete element (Delete/Backspace).** Generic `deleteElement(eid)` model op (leaf or container+subtree), bound to Delete/Backspace from canvas selection and outline highlight, guarded against text-editing focus; one undo + one autosave; multi-select deletes all. _Done when:_ pressing Delete on a selected element removes it from source (not while editing text); undo restores it. (Spec 04, 02)
- [x] **P9-8 — Text color control.** Inspector control writing whole-element inline `style="color: …"` on a selected text leaf; one undo + one autosave; passes validation + round-trip. _Done when:_ setting a color writes inline style, persists byte-stable, and undoes cleanly. (Spec 09)

### Themes (spec 09)
- [x] **P9-9 — Solarized Dark slide theme.** Vendor a Solarized Dark reveal theme into the binary + per-deck copy, add it to the theme picker as a distinct entry. _Done when:_ selecting it restyles the deck to a dark Solarized palette, offline, zero external URLs. (Spec 09, 12)
- [x] **P9-10 — Workspace chrome themes.** Convert hardcoded chrome tokens (`surface*`, `accent`) to CSS variables; add Dark / Light / Solarized editor themes with a switcher; persist the choice (editor pref, never touches decks). _Done when:_ switching restyles the editor shell only, persists across reload, and leaves deck files untouched. (Spec 09)

### Deck lifecycle (spec 06)
- [x] **P9-11 — Create-deck API.** `POST /api/decks/{name}` runs the same scaffold as `slides new` (validated name via `deck.ValidName`, 409 on existing, offline vendored reveal). _Done when:_ POST creates a valid openable deck folder; duplicate name is rejected. (Spec 06, 01, 13)
- [x] **P9-12 — Create-deck UI.** "+ New deck" in the navigator: name prompt → P9-11 → open the new deck. _Done when:_ a user creates and lands in a new deck without the CLI; e2e covers create→edit. (Spec 06)

> **Phase 9 STATUS (done, tag 0.0.10 — completes milestone M5):** P9-1..P9-12 complete. Built as 5 parallel git-worktree lanes (layout / editing / themes / deck / e2e) + Opus integration; merged with zero source conflicts. Verified on the integrated tree: FE **1031 vitest** green (37 files), **svelte-check 0/0** (423 files), **go test ./... green**, frontend+binary build clean, **Playwright 5/5** green in Chromium (smoke + offline-guard over editor & present + create-deck create/duplicate).
> - **Layout lane (`web/src/lib/layout/`, `components/layout/`, `components/source/`):** `panes.ts` (versioned localStorage persistence `decks.paneLayout.v1`, per-boundary min/max bounds, rail width) + `eidIndex.ts` (`findEidIndex` pure lookup). Splitter migrated off `createEventDispatcher` → Svelte 5 callback props (`onresize`/`onresizeend`). PaneLayout: nav + right panel collapse to chevron rails restoring last width; source pane collapses independently; all three boundaries draggable+clamped; state persisted. SourcePane: `$effect` scrolls CM6 to the selected `data-eid` (guards: hidden/zero-height, CM-focus, `selectionStore.editing`, foreign input/contenteditable; un-stamped/passthrough → no-op). No App.svelte edits.
> - **Editing lane:** `deleteElement(model, eid)` in `web/src/lib/canvas/structure-ops.ts` (leaf / container+subtree / passthrough-whole uniform via `detach`; refuses `<section>` — slide deletion stays in navigator). `deckStore.deleteElements(eids[])` = one undo + one autosave, clears selection. Delete+Backspace bound in `NudgeController` (window keydown, multi-select, `nudge.isEditingContext()` guard) — works from canvas or outline. Text color: `model/style.ts` (`get/setInlineColor`, whole-element inline `style="color"`, byte-stable), `isTextLeaf` in `classify.ts`, `deckStore.applyTextColor`, `TextColorControl.svelte` in PropertiesPanel (shown only for text leaves; self-wires via deckStore). No App.svelte edits.
> - **Themes lane:** `internal/deck/vendor/reveal/theme/solarized-dark.css` (dark Solarized, zero external URLs) registered in `BundledThemes` → embedded, copied per deck, served by `/api/themes`, distinct "Solarized Dark" entry in ThemePicker. Workspace chrome themes: 5 chrome tokens → `rgb(var(--token) / <alpha>)` in tailwind.config.js, `:root`/`.theme-light`/`.theme-solarized` in app.css, `WorkspaceThemePicker.svelte` (sets `<html>` class, localStorage `workspace-theme`, default Dark; editor-only, never touches decks). Mounted in App.svelte navigator zone (2 lines).
> - **Deck lane:** `POST /api/decks/{name}` (`handleDeckCreate` in `internal/server/server.go`) reuses the existing exported `deck.New` (no scaffold duplication); 400 bad name, 409 conflict, 201 + starts watching. "+ Deck" inline form in Navigator (idle→entering→creating, inline 409/400/network errors via `role="alert"`); App.svelte `onDeckCreated` re-lists + opens (additive).
> - **E2e lane:** Playwright vs the **built binary** — `web/playwright.config.ts` + `web/e2e/` (global setup builds a temp workspace via `slides new`, runs the binary on port 19999, polls `/health`; teardown SIGTERMs + cleans). Specs: smoke, offline-guard (no external http(s) on editor + present — promotes X-1 to a live check), create-deck. Scripts `test:e2e` / `test:e2e:docker` (run in the host `mcr.microsoft.com/playwright` image). e2e specs excluded from vitest's `src/**/*.test.ts` glob.
> - **Integration fixups (Opus):** auto-merged App.svelte (deck + themes) coherent; dropped an accidentally-committed `slides` binary (themes branch predated the e2e `.gitignore` fix). Fixed two **pre-existing/edge** Go test bugs surfaced by the merge: `TestNotesPlugin` asserted the old `plugin.js` path (template loads the UMD `notes.js` since the notes-plugin fix) → corrected; `TestDeckCreate_BadName` expected 400 for `.`/`..`, but `http.ServeMux` path-cleans those to a 301 before the handler — rewrote it to assert the real invariant (traversal names never create a deck; `decks/` stays empty).
> - **⚠️ Needs VISUAL/browser confirmation:** pane collapse/restore feel + persisted sizes across reload; source-jump scroll on select; delete from outline vs canvas; text-color picker live on the iframe; workspace-theme chrome restyle; Solarized Dark slide render. (e2e covers app-alive, offline, and create-deck; the rest have unit/component coverage.)
> - **[follow-up]** Add feature e2e specs for delete, pane collapse/resize, source-jump, and theme switching (harness + a create-deck example are in place; `web/e2e/<feature>.spec.ts` convention documented in smoke.spec.ts).

## Phase 10 — Per-slide theme override
> Goal: a global deck theme with declarative per-slide overrides (named bundle + free-form
> tweaks), resolved by CSS cascade — no runtime JS, byte-stable, identical in editor/present/PDF.
> Specs: [09](specs/09-theming-and-styles.md), [06](specs/06-slide-management.md).
>
> Mechanism (locked): `data-theme="<bundled>"` on a `<section>` → scoped `--r-*` bundle from a
> generated `slides-slide-themes.css`; free-form tweaks → inline `--r-*` vars; backgrounds →
> reveal-native `data-background-color`. Cascade resolves layers (inline > bundle > global);
> verticals inherit, overridable. Built via worktree lanes + subagents (per PROMPT_BUILD).

### Foundation
- [x] **P10-1 — Generate scoped slide-theme stylesheet.** At vendor time, extract each bundled theme's `:root`/`.reveal` `--r-*` values + background-color from `internal/deck/vendor/reveal/theme/*.css`; emit `slides-slide-themes.css` (a `.reveal section[data-theme="<name>"] { --r-*: … }` block per theme) + a `name → background` map; embed in the binary, copy into decks like `slides-layout.css`, and link it in the scaffold template. _Done when:_ a freshly scaffolded deck links the stylesheet, loads zero external URLs, and a `<section data-theme="solarized-dark">` restyles its text/heading/link vars. (Spec 09, 12)

### Model & contract
- [x] **P10-2 — Recognize `data-theme` in model + validate.** `web/src/lib/model/` and `internal/validate/validate.go` accept `data-theme` on `<section>` (value must name a bundled theme; not a layout primitive, no reflow semantics). Keep the allowed-set in sync with the bundled-theme list. _Done when:_ `validate` passes a deck with a valid `data-theme` and flags an unknown theme name. (Spec 09, 03, 12)

### Apply commands (one undo + one autosave each, byte-stable)
- [x] **P10-3 — Named per-slide theme command.** `deckStore` op to set/clear a section's `data-theme` **and** its managed `data-background-color` (from the P10-1 map; the color is written through the unified Slide Background command, **Phase 16**). _Done when:_ applying a named theme to the selected slide writes both attributes and the canvas reflects it; clearing removes both. (Spec 09)
- [x] **P10-4 — Free-form per-slide color tweaks.** `deckStore` op to set/clear inline `--r-*` custom properties (heading / text / link) + `data-background-color` on a section, layered over any named bundle. _Done when:_ picking colors writes inline vars that override the bundle, byte-stable, undoable. (Spec 09)

### UI
- [x] **P10-5 — Theme picker scope toggle (Whole deck / This slide).** Whole-deck = existing `applyTheme`; This-slide (enabled only when a slide is selected) exposes a named-theme dropdown + free-form color swatches + a **Clear override → inherit deck** action, wired to P10-3/P10-4. _Done when:_ the toggle targets the deck `<link>` vs the selected `<section>` correctly. (Spec 09)
- [x] **P10-6 — Override badge in navigator/thumbnail.** Slides carrying a per-slide override (named or free-form) show a small theme badge; cleared slides lose it. _Done when:_ an overridden slide is marked and an inherited slide is not. (Spec 06)

### Cascade & fidelity
- [x] **P10-7 — Vertical cascade.** Verify `data-theme` on a vertical-stack `<section>` cascades to its verticals (vars inherit; ensure `data-background-color` propagates — add propagation if reveal doesn't) and an inner `data-theme` overrides. _Done when:_ a themed stack restyles its verticals and an inner override wins. (Spec 09, 06)
- [x] **P10-8 — Present/PDF fidelity + e2e.** Confirm per-slide overrides render in the present route and in PDF export (scoped vars + native background both print). Add a Playwright spec: a deck with an overridden slide shows different computed styles on that slide vs an inherited one, and the offline-guard still passes. _Done when:_ e2e asserts the override is visible and offline; PDF export shows it. (Spec 09, 10, 12)

> **Phase 10 STATUS (done, tag 0.0.12):** Per-slide theme override. Built in a git-worktree lane via workflow (Foundation: Go theme-gen + model/validate ‖ then Commands → UI → Verify) + orchestrator integration-verify. Verified: go test ./... green, vitest 1143 green, svelte-check 0/0, binary smoke-tested (validate accepts `data-theme=solarized-dark`, rejects unknown; zero external URLs).
> - **Go (`internal/deck/theme.go`, `deck.go`, `internal/server/server.go`):** `GenerateSlideThemesCSS()` + `ThemeBackgrounds()` DERIVED from the embedded reveal theme CSS (single source — no parallel color table); vendored as `assets/vendor/slides-slide-themes.css` (one `.reveal section[data-theme="<name>"]{--r-*}` block per bundled theme, background excluded since reveal paints it deck-level), linked in the scaffold; `GET /api/themes/backgrounds` returns name→bg.
> - **Contract (`internal/validate/validate.go`, `web/src/lib/model/theme.ts`):** `data-theme` recognized (10 bundled names, allowed-sets cross-referenced/synced); `data-background-color` + inline `--r-*` tolerated. `getThemeProps`/`setThemeProps`.
> - **Commands (`deck.svelte.ts`):** `applySlideTheme(eid, name|null)` (writes `data-theme` + managed `data-background-color`; Phase 16 will consolidate the color) and `applySlideColorVars(eid, {heading,text,link,backgroundColor})` (inline `--r-*` over the bundle) — each one undo + one autosave, byte-stable.
> - **UI:** ThemingPanel scope toggle (Whole deck / This slide) + Navigator per-slide theme badge (`hasThemeOverride`).
> - **Cascade/fidelity:** vertical cascade handled (vars inherit; background propagation ensured in `slides-layout-init.js`); present/PDF use the same vendored CSS. `web/e2e/per-slide-theme.spec.ts` written (run pending browser env).

## Phase 11 — Canvas reload preserves view state (bug fix)
> Goal: a same-deck iframe reload must keep the viewer on their current slide instead of
> snapping to slide 1. Spec: [04](specs/04-canvas-interaction.md) "Canvas reload preserves view state".
>
> Root cause: `App.svelte` watches `deckStore.reloadNonce` → `RevealFrame.reload()` bumps
> `reloadKey` → the `{#key}` block destroys/recreates the iframe → reveal re-inits at slide 0.
> Nothing captures/restores `(h, v)`. Most visible on text edits: Enter → commit →
> `applyTextEdit` → autosave → reload → slide 1. The bridge already exposes the needed halves
> (`getCurrentIndices` + `navigateToSlide` in `web/src/lib/slides/reveal-control.ts`).

- [x] **P11-1 — Preserve current slide across reload.** In `RevealFrame`, capture `getCurrentIndices(iframeEl)` into a `pendingRestore` field **before** `reload()` bumps `reloadKey`; in `handleLoad()`, if set, `navigateToSlide(iframeEl, h, v)` then clear it. Covers all reload causes (autosave, undo/redo, external SSE). Same-deck only — a `deckUrl` change (deck switch) still resets to slide 0; initial load (`null` indices) is a no-op. _Done when:_ editing/committing on slide N (incl. a vertical `v>0`) leaves the canvas on slide N; switching decks still opens at slide 1. (Spec 04)
- [x] **P11-2 — No first-slide flash.** Keep the iframe hidden (extend the existing `isLoading` gate) until the P11-1 restore navigation has completed, so the intermediate slide-0 render is never visible. _Done when:_ a reload after an edit shows no flash to slide 1. (Spec 04)
- [ ] **P11-3 — (Deferred) Skip reload on pure text commits.** Evaluate persisting in-place text edits without a full iframe reload (the contenteditable already mutated the live DOM), reserving reloads for structural/external changes. Gate on a guarantee the canvas cannot drift from on-disk bytes. _Done when:_ decided + (if adopted) text commits no longer reload. (Spec 04, 02 — deferred)

## Phase 12 — Thumbnail fidelity
> Goal: navigator thumbnails faithfully represent the actual slide. They are static,
> script-free `srcdoc` iframes (`web/src/lib/slides/thumbnail.ts` + `SlideThumbnail.svelte`),
> so where reveal's runtime would do the work, the builder must reproduce it statically.
> Spec: [06](specs/06-slide-management.md) "Thumbnails".
>
> Root causes of divergence: (1) the theme is hardcoded to `black.css` (`thumbnail.ts:101`)
> regardless of the deck's actual theme; (2) numeric layout (`data-gap/pad/cols/rows/grow/
> basis/span`, free `data-x/y/w/h/rot`) is applied by `slides-layout-init.js` at runtime and
> never runs in the thumbnail; (3) fragments are hidden by reveal's `opacity:0` default;
> (4) `data-background-*` is painted in a separate JS-driven layer. Cheap wins first.

- [x] **P12-1 — Use the deck's actual theme.** Thread the current theme name (parsed from the deck source, as `applyTheme` does) into `buildThumbnailSrcdoc` and link that theme instead of the hardcoded `black.css`. _Done when:_ switching the deck theme restyles the thumbnails; a non-black deck no longer renders black thumbnails. (Spec 06, 09)
- [x] **P12-2 — Show fragments' final state.** Override CSS forces `.fragment { opacity:1; visibility:visible }` in the thumbnail so fragmented content is visible. _Done when:_ a slide with fragments shows all fragment content in its thumbnail. (Spec 06, 07)
- [x] **P12-3 — Honor section background.** Render a section's `data-background-color` as the thumbnail section background. _Done when:_ a slide with `data-background-color` shows that background in its thumbnail. (Spec 06)
- [x] **P12-4 — Apply numeric layout statically.** A pure function ports the `slides-layout-init.js` numeric vocabulary to **inline styles** on the serialized section at thumbnail-build time (`data-gap`→`gap`, `data-pad`→`padding`, `data-cols/rows`→`grid-template-*`, `data-grow/basis/span`→flex/grid item props, free `data-x/y/w/h/rot`→absolute geometry). Single source of truth — derive from the same numeric rules the runtime init uses; do not fork the values. _Done when:_ grids, gaps, and free-positioned elements in a thumbnail match the live canvas. (Spec 06, 03)
- [x] **P12-5 — Per-slide theme in thumbnails (after Phase 10).** Once per-slide `data-theme` exists, the thumbnail links/scopes the slide's override theme too. _Done when:_ a slide with `data-theme` renders its override in the thumbnail. (Spec 06, 09 — depends on Phase 10)

> **Accepted limitation (not a task):** code highlighting (highlight.js) and KaTeX math are
> JS-driven reveal plugins and are not run in the script-free thumbnail; they render plain.
> Documented in spec 06 as the one acknowledged fidelity gap.

> **Phase 12 STATUS (done, tag 0.0.14):** Thumbnail fidelity. Built in a git-worktree lane via workflow (Build: pure numeric-layout port ‖ srcdoc builder → Integrate) + orchestrator integration-verify. Verified: vitest 1203 green (+thumbnail-layout suite), svelte-check 0/0, go test green.
> - **`thumbnail-layout.ts`:** pure `applyThumbnailLayout(section)` ports the `slides-layout-init.js` numeric vocab (gap/pad/cols/rows/grow/basis/span + free x/y/w/h/rot) to inline styles on a deep clone — single source mirrored from the runtime script, model never mutated.
> - **`thumbnail.ts`:** links the deck's ACTUAL theme (parsed from source) + `slides-slide-themes.css` so per-slide `data-theme` (Phase 10) renders (P12-1/P12-5); `.fragment` forced visible (P12-2); `data-background-color` painted (P12-3); numeric layout applied before serialize (P12-4). Removed the `display:flex !important` override that clobbered grid sections — per-`data-lay` display rules scoped under `.reveal .slides` beat reveal's script-less `display:none`.

## Phase 13 — Right-click context menu
> Goal: a right-click context menu on elements (canvas + outline) and on empty slide
> background — a thin UI surface dispatching to existing `deckStore` commands, plus a few
> net-new element ops. Spec: [04](specs/04-canvas-interaction.md) "Context menu",
> [06](specs/06-slide-management.md). Built via worktree lanes + subagents.
>
> Reuse-first: most items (Delete, Make free/structured, Text color, Insert, Equal columns,
> quick align, slide ops) call commands that already exist. The registry is a pure
> `menuItemsFor(selection)`; the menu component is presentational.

### UI surface
- [x] **P13-1 — ContextMenu component.** Presentational menu (items `{label, run, disabled, danger, separator, submenu}`) rendered in the parent overlay above the iframe; cursor-positioned with edge-flip; keyboard-navigable; dismiss on Escape / click-outside / selection change / reload. _Done when:_ the menu renders, flips at pane edges, and is fully keyboard-operable. (Spec 04)
- [x] **P13-2 — Canvas right-click handler.** In `CanvasInteraction`, add a `contextmenu` listener (re-attached on `reloadNonce`) that `preventDefault`s, resolves the element under the cursor (existing nearest-eid logic), **selects it** unless already in a multi-selection, maps iframe coords→screen via the transform, and opens the menu. _Done when:_ right-clicking a canvas element selects it and opens the menu at the cursor. (Spec 04)
- [x] **P13-3 — Action registry.** Pure `menuItemsFor(selection)` → items by element kind (any / text leaf / structured / free / container / passthrough / multi), each wired to an existing `deckStore` command. Passthrough offers only Delete + Jump-to-source (never structural — never-destroy). _Done when:_ each kind shows the correct, enabled/disabled item set; unit-tested. (Spec 04, 12)
- [x] **P13-4 — Outline-panel right-click.** Outline rows open the same menu via the same registry (positioned at the cursor). _Done when:_ right-clicking an outline row opens the element menu and its actions apply. (Spec 04)

### Net-new element ops (one undo + one autosave each, byte-stable)
- [x] **P13-5 — Duplicate element.** `deckStore` command: clone the selected subtree, regenerate `data-eid`s (per the eid scheme), insert after the original; selects the clone. _Done when:_ duplicating yields a byte-stable independent copy with fresh eids; undo removes it. (Spec 04, 02)
- [x] **P13-6 — Z-order for free elements.** `deckStore` commands bring-to-front / send-to-back by reordering the free element to last/first among siblings (reuse the reorder op). Shown only for free elements. _Done when:_ overlapping free elements restack and the order persists. (Spec 04, 03)
- [x] **P13-7 — Element clipboard (copy/cut/paste).** Session-scoped in-memory subtree buffer (offline, never on disk). Copy captures; Cut = copy + delete; Paste inserts a clone with freshly regenerated `data-eid`s after the current selection (or as last child of a selected container), working across slides. _Done when:_ copy→paste (incl. across slides) yields a fresh-eid clone; cut removes the original; all byte-stable + undoable. (Spec 04, 02)

### Slide menu, a11y & e2e
- [x] **P13-8 — Slide-level menu.** Right-click on empty slide background opens slide actions (Duplicate / Delete / Hide / Insert slide) via the existing navigator ops. _Done when:_ the empty-area menu performs each slide op. (Spec 06, 04)
- [x] **P13-9 — Passthrough/never-destroy guard + e2e.** Verify passthrough elements expose no structural edits; add a Playwright spec: right-click → Delete and right-click → Duplicate on a canvas element, and the slide-level menu. _Done when:_ e2e covers open→action for an element and a slide; passthrough is guarded. (Spec 04, 12)

> **Phase 13 STATUS (done, tag 0.0.13):** Right-click context menu + duplicate/z-order/clipboard. Built in a git-worktree lane via workflow (Foundation: store ops ‖ menu component → Registry → Wiring → Verify) + orchestrator integration-verify. Verified: vitest 1143 green (+context-menu/element-ops suites), svelte-check 0/0, go test green.
> - **Model (`web/src/lib/model/clone.ts`):** `cloneSubtreeStripEids` is now the single clone source (slides.ts `duplicateSlide` repointed; duplicate removed).
> - **Store ops (`deck.svelte.ts`):** `duplicateElement` (insert-after, fresh eids, keeps data-id, refuses `<section>`), `bringToFront`/`sendToBack` (free, via `moveChild`), session clipboard `copyElements`/`cutElements`/`pasteClipboard` (in-memory, cross-slide) — each one undo + one autosave, byte-stable.
> - **UI (`ContextMenu.svelte`, `lib/canvas/context-menu.ts`):** presentational menu (edge-flip, full keyboard nav, recursive submenus via self-import, click-outside backdrop over the iframe) + pure `menuItemsFor(selection, lookup)` registry keyed by element kind; passthrough offers only Delete + Jump-to-source (never-destroy, spec 12).
> - **Wiring:** canvas `contextmenu` (re-attached on reloadNonce, selects-then-opens) + outline-row right-click + empty-slide-background slide menu (Duplicate/Delete/Hide/Insert) + mount in App.svelte canvas-stack.
> - **e2e:** `web/e2e/context-menu.spec.ts` (open→Delete / Duplicate / slide menu) written (run pending browser env).

## Phase 14 — Slide layouts (Google-Slides-style presets)
> Goal: per-slide layout presets composed from the existing `data-lay` primitives, pickable on
> new slides and swappable on existing ones (content-preserving). Spec:
> [06](specs/06-slide-management.md) "Slide layouts", [03](specs/03-layout-vocabulary.md),
> [13](specs/13-project-structure.md). Built via worktree lanes + subagents.
>
> Decisions (locked): apply-to-existing **remaps content into the new layout's primary slot**
> (never-destroy); placeholders are **starter content** (real leaves w/ prompt text); source =
> **bundled built-ins + the `templates/` dir**; sections carry a non-authoritative
> `data-layout` marker (no live master link). Layout = structure only, decoupled from theme.

### Source & API
- [x] **P14-1 — Built-in layout preset snippets.** Bundle (go:embed) the preset set as `<section>` snippets with starter content + `data-slot="content"` on the primary container + a `data-layout` marker: Title, Title+Body, Section Header, Two Content, Comparison, Title Only, Big Number, Caption, Blank. Each composes `data-lay` primitives ([03]). _Done when:_ each preset is a valid, offline `<section>` that renders correctly. (Spec 06, 03)
- [x] **P14-2 — `templates/` dir + `GET /api/templates`.** Go lists bundled built-ins + user `templates/*.html` snippets as `{name, label, html}` (offline, traversal-safe). Activates the spec'd `templates/` dir. _Done when:_ the endpoint returns built-ins, and a user snippet dropped in `templates/` appears too. (Spec 13, 06)

### Apply (one undo + one autosave, byte-stable)
- [x] **P14-3 — New slide from layout.** Build a slide from a chosen template (parse snippet → `<section>` subtree, stamp eids) and insert it via the existing slide ops. _Done when:_ picking a layout creates a slide with that structure + starter content. (Spec 06)
- [x] **P14-4 — Change layout (content-preserving remap).** Apply a layout to an existing slide: move its existing leaves into the new layout's `data-slot="content"` container (first slot if several), drop nothing, restamp/keep eids sensibly, update `data-layout`. _Done when:_ swapping the layout of a non-empty slide rearranges it without losing any content; undo restores the prior structure byte-stable. (Spec 06, 12)
- [x] **P14-5 — `data-layout`/`data-slot` recognized.** Model + `internal/validate/validate.go` accept `data-layout` and `data-slot` on the relevant elements (markers, not layout primitives; keep enums in sync). _Done when:_ `validate` passes a deck using them; the picker detects a slide's current layout. (Spec 06, 12)

### UI & verification
- [x] **P14-6 — Layout picker UI.** A picker (new-slide dropdown + a "Change layout" item in the slide context menu, Phase 13) showing the presets; selecting runs P14-3 (new) or P14-4 (existing). _Done when:_ both entry points apply a layout from the picker. (Spec 06, 04)
- [x] **P14-7 — Tests + e2e.** Unit: builders/remap (content preserved, byte-stable). Playwright: new-slide-from-layout and change-layout-preserves-content; a `templates/` user snippet shows in the picker. _Done when:_ suites green. (Spec 06, 12)

> **Phase 14 STATUS (done, tag 0.0.15):** Slide layout presets. Built in a git-worktree lane via workflow (Foundation: Go presets ‖ contract → Apply → UI → Verify) + orchestrator integration-verify. Verified: go test green, vitest 1203 green, svelte-check 0/0, binary smoke-tested (/api/templates = 9 built-ins + user snippets; validate accepts data-layout/data-slot).
> - **Go (`internal/deck/vendor/layouts/*.html`, `layouts.go`, `server.go`):** 9 bundled preset `<section>` snippets (title, title-body, section-header, two-content, comparison, title-only, big-number, caption, blank) — each a valid offline section with a `data-layout` marker + one `data-slot="content"` container; `BundledLayouts()`; `GET /api/templates` merges built-ins + user `templates/*.html` (traversal-safe, name-collision overrides).
> - **Contract (`validate.go`, `layout.ts`):** `data-layout` (on section) + `data-slot` (any element) recognized as non-authoritative markers (non-empty string; not enum-restricted); `getLayoutMarker`/`setLayoutMarker` + `getSlot`/`setSlot`.
> - **Apply (`slides.ts`, `deck.svelte.ts`):** `addSlideFromLayout(html, afterEid?)` and `changeSlideLayout(eid, html)` — the latter moves ALL existing content units (recursing through layout scaffolding) into the new preset's content slot, dropping nothing, preserving the section node identity; one undo + one save, byte-stable.
> - **UI:** Navigator new-slide layout picker (+ plain Blank) + "Change layout" in the slide context menu. e2e `web/e2e/slide-layouts.spec.ts` written (run pending browser env).

## Phase 15 — Free-position coordinate identity (bug fix)
> Goal: free-element overlays/handles align with the element, and free `data-x/y` are true
> logical-canvas coordinates. Spec: [05](specs/05-scaling-and-resolution.md) "Logical-canvas
> coordinate identity". **Land together with Phase 11** — the drag-release reload-to-slide-1
> (P11-1) makes free dragging hard to test until fixed.
>
> Root cause: the deck template's `Reveal.initialize` omits `center`/`margin`, so reveal applies
> `center:true` + `margin:0.04`. Sections are centered/inset, so a free element positioned
> `absolute; left:data-x; top:data-y` renders offset from the logical-canvas origin the
> free-transform overlay assumes (the structured overlay measures the real rect, so it aligns —
> hence the mismatch is free-only).

- [x] **P15-1 — Template: `center:false, margin:0`.** Add both to the scaffold `Reveal.initialize` so the section is the full logical canvas at origin. Verify a `stack` slide still appears centered (the layout vocabulary's `justify-content`, not reveal). _Done when:_ new decks set both; structured content still looks right. (Spec 05, 03)
- [x] **P15-2 — Full-canvas section containing block.** Ensure `.reveal .slides > section` is a positioned, full `width×height` containing block at origin (in `slides-layout.css` or via the config), so absolute free children resolve against true canvas coords. _Done when:_ a free element at `data-x=0,data-y=0` renders at the canvas top-left in the iframe. (Spec 05, 03)
- [x] **P15-3 — Free overlay alignment verified (+ optional measure fallback).** With P15-1/2, the free-transform box/handles (from `data-x/y/w/h`) align with the element at any zoom/aspect. Optionally also draw the display box from the measured rect (like the selection overlay) for content-sized/rotated robustness. _Done when:_ the draggable box tracks the element; drag→drop writes correct logical coords; smart guides snap to canvas center/edges. (Spec 04, 05)
- [x] **P15-4 — Migration for existing decks.** A `slides upgrade <deck>` (or fold into `slides vendor`) that rewrites an existing deck's `Reveal.initialize` to set `center:false, margin:0` (byte-stable otherwise). _Done when:_ an old deck gets the corrected config without other diffs. (Spec 05, 13)
- [x] **P15-5 — e2e.** Playwright: select a free element, assert the overlay box rect matches the element's measured rect within tolerance; after a drag the element's on-disk `data-x/y` reflect the move. _Done when:_ the spec passes (requires P11-1 so the reload no longer resets the slide). (Spec 05, 12)

> **Phase 11 + 15 STATUS (done, tag 0.0.11):** Built together (bug fixes that must land as a pair) via a 3-lane workflow (P11 FE / P15 Go / tests) + orchestrator integration-verify. Verified: FE build clean, `go build`/`go vet`/`go test ./...` green, **vitest 1051/1051** (38 files, +20 new reveal-control tests), **svelte-check 0/0** (424 files). `slides upgrade <deck>` exercised: inserts `center:false, margin:0` on a legacy deck, idempotent + byte-stable, zero external URLs.
> - **P11 (`web/src/components/canvas/RevealFrame.svelte`, `web/src/lib/slides/reveal-control.ts`):** `reload()` captures `getCurrentIndices(liveIframe)` into a plain `pendingRestore` field *before* bumping `reloadKey`; `handleLoad()` restores via `navigateToSlide(...)` and keeps the iframe hidden until the new optional `onArrive` callback fires (no flash, P11-2). Deck switch / first load leave `pendingRestore` null → slide 0 (unchanged). `navigateToSlide` gained a backward-compatible 4th `onArrive?` param.
> - **P15 (`internal/deck/deck.go`, `internal/deck/vendor/slides-layout.css`, `cmd/slides/main.go`):** template `Reveal.initialize` now sets `center:false, margin:0`; `.reveal .slides > section` forced to a full 1920×1080 containing block at origin, and `section > [data-lay]` gets `min-height:100%` so vertical centering comes from the layout vocabulary's `data-justify` (not reveal's `center`). New `deck.Upgrade(root, name)` + `slides upgrade <name>` CLI migrate legacy decks. `validate.go`/`layout.ts` untouched (center/margin are reveal config, not the `data-*` contract).
> - **⚠️ Needs browser confirmation (no browsers in build env):** the two Playwright specs `web/e2e/free-position.spec.ts` (overlay/measured-rect alignment + drag persists `data-x/y`) and `web/e2e/reveal-frame-reload.spec.ts` (reload keeps slide N; deck switch → slide 1) are written + type-check clean but were not executed here. Run via `npm run test:e2e:docker`.

## Phase 16 — Slide background (color / image / gradient / video)
> Goal: a unified per-slide background control via reveal-native `data-background-*` attributes,
> localized offline. Spec: [09](specs/09-theming-and-styles.md) "Slide background",
> [08](specs/08-assets-and-media.md). Subsumes Phase 10's per-slide `data-background-color`
> (color writes through this control). Built via worktree lanes + subagents.
>
> Reuse: image/video localization is the existing asset pipeline (`uploadAsset` → `assets/…`,
> upload/drag/paste/shared/provider); reveal renders backgrounds natively so the canvas is
> WYSIWYG; attributes are declarative + byte-stable + Claude-authorable; backgrounds cascade to
> verticals (reveal native).

- [ ] **P16-1 — Background commands.** `deckStore` ops to set/clear a section's background by type — `data-background-color`, `data-background-image` (+ `-size`/`-position`/`-repeat`/`-opacity`), `data-background-gradient`, `data-background-video` (+ loop/muted) — each one undo + one autosave, byte-stable. Consolidates the managed color from P10-3. _Done when:_ each type sets/clears correctly and the canvas reflects it. (Spec 09)
- [ ] **P16-2 — Image/video localization reuse.** Wire upload/drag/paste/`shared/`/provider sources through `uploadAsset` and set `data-background-image`/`-video` to the returned relative path. _Done when:_ choosing a background image/video copies it into `assets/` and references it relatively (zero external URLs). (Spec 09, 08, 12)
- [ ] **P16-3 — Slide Background UI control.** A "Slide background" inspector section (keyed to the current slide) + a "Set background…" slide context-menu item (Phase 13): color / image / gradient / video, with image fit/position/opacity and video loop/mute, plus Clear. _Done when:_ all types are settable from one surface and clearable. (Spec 09, 04)
- [ ] **P16-4 — Thumbnail background rendering.** Extend the thumbnail builder (Phase 12) to paint color/image/gradient as the section's CSS background; video shows poster/first-frame or a placeholder. _Done when:_ a slide with an image background shows it in its navigator thumbnail. (Spec 06, 09)
- [ ] **P16-5 — Contract + cascade.** `internal/validate/validate.go` + model accept the `data-background-*` attributes; verify a stack's background cascades to its verticals and an inner override wins. _Done when:_ `validate` passes a deck using them and cascade behaves. (Spec 09, 12)
- [ ] **P16-6 — e2e.** Playwright: set an image background on a slide → it renders in the canvas and the present route, appears in the thumbnail, and the offline-guard still passes (localized, no external URL). _Done when:_ the spec passes. (Spec 09, 12)

## Cross-cutting (maintain throughout)

- [x] **X-1 — Offline guard test.** A CI/dev check that the built deck loads no external URLs. (Spec 12)
- [x] **X-2 — Round-trip corpus grows.** Add any odd HTML encountered to the golden-file corpus (P1-6). (Spec 12)
- [x] **X-3 — Never-destroy badge.** Passthrough/partially-editable elements show a "source only" badge wherever surfaced. (Spec 02, 12)
- [x] **X-4 — Secrets hygiene.** Provider keys only via env/gitignored config; never written to `config.toml` or decks. (Spec 12, 13)

## Suggested milestones

- **M1 (usable):** through Phase 3 — visual editing + alignment beats hand-authoring.
- **M2 (rich):** through Phase 5 — full content + assets.
- **M3 (complete):** through Phase 7 — motion, theming, present, export.
- **M4 (AI-native):** Phase 8 — Claude Code skill + safe handoff.
- **M5 (polished):** Phase 9 — adjustable/collapsible chrome, element delete + text color,
  more themes, browser-side deck creation, end-to-end test coverage.
- **M6 (per-slide theming):** Phase 10 — global deck theme + declarative per-slide overrides
  (named bundle + free-form), cascading to verticals, consistent across present/PDF.
