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

- [ ] **P6-1 — Slide navigator filmstrip.** List slides; click to jump. _Done when:_ navigator reflects sections and navigates. (Spec 06)
- [ ] **P6-2 — Slide thumbnails.** Scaled render/snapshot per slide, updated on edit. _Done when:_ thumbnails match content. (Spec 06)
- [ ] **P6-3 — Add/duplicate/delete slide.** Duplicate regenerates `data-eid` but preserves `data-id` pairing potential. _Done when:_ each op updates source correctly. (Spec 06)
- [ ] **P6-4 — Reorder slides.** Drag in the filmstrip. _Done when:_ document order changes persist. (Spec 06)
- [ ] **P6-5 — Vertical slides (2D navigator).** Nest/promote/demote verticals. _Done when:_ nested sections render and navigate down. (Spec 06)
- [ ] **P6-6 — Hide slide.** `data-visibility="hidden"`; skipped when presenting. _Done when:_ hidden slide stays in source, absent from present. (Spec 06)
- [ ] **P6-7 — Fragments UI.** Mark element to appear at step N; reorder list. _Done when:_ `class="fragment"`+index write and reveal steps work. (Spec 07)
- [ ] **P6-8 — Transitions UI.** Per-deck/per-slide `data-transition` + speed. _Done when:_ transition changes apply. (Spec 07)
- [ ] **P6-9 — Auto-animate authoring.** "Animate from previous slide": set `data-auto-animate` on the pair, derive `data-id` from `data-eid`. _Done when:_ moving an element across the pair tweens. (Spec 07)
- [ ] **P6-10 — Theme picker.** Select bundled reveal theme per deck. _Done when:_ theme switch re-styles the deck. (Spec 09)
- [ ] **P6-11 — `custom.css` pane.** Edit per-deck CSS in CM6. _Done when:_ edits apply and persist to `custom.css`. (Spec 09)
- [ ] **P6-12 — CSS variable controls.** Color/font pickers bound to CSS custom properties. _Done when:_ picker changes `--accent`/`--heading-font` and canvas updates. (Spec 09)
- [ ] **P6-13 — Font localization.** Download a chosen Google Font into `assets/fonts/`, rewrite `@font-face` local. _Done when:_ deck renders the font with network disabled. (Spec 09, 12)

## Phase 7 — Presenting & export
> Goal: present and export. Spec: [10](specs/10-presenting-and-export.md).

- [ ] **P7-1 — Present route.** `/present/<deck>` serves the pure `deck.html` via reveal, no editor. _Done when:_ presenting matches the saved file exactly. (Spec 10)
- [ ] **P7-2 — Speaker view.** Verify reveal's S-key speaker window works off the present route; notes field per slide writes `<aside class="notes">`. _Done when:_ speaker window shows notes/next/timer. (Spec 10)
- [ ] **P7-3 — PDF export.** Go drives headless Chrome with `?print-pdf`. _Done when:_ a correct PDF downloads. (Spec 10)
- [ ] **P7-4 — HTML bundle export.** Zip the deck folder. _Done when:_ the zip opens and presents standalone offline. (Spec 10, 12)

## Phase 8 — Claude Code integration
> Goal: the AI authoring layer + safe handoff. Spec: [11](specs/11-claude-code-integration.md).

- [ ] **P8-1 — `slides add-slide <deck>` CLI.** Append a starter `<section>`. _Done when:_ command adds a valid slide. (Spec 11)
- [ ] **P8-2 — `slides validate <deck>` CLI.** Check `data-lay` validity, unique eids, asset existence, parse+round-trip. _Done when:_ returns non-zero with diagnostics on a malformed deck. (Spec 11, 12)
- [ ] **P8-3 — Validate on save.** Editor save path runs validation. _Done when:_ a save that would break the model is surfaced, not silently applied. (Spec 12)
- [ ] **P8-4 — Conventions doc + skill.** Write the Claude Code skill (vocabulary, folder layout, turn-taking, offline rules). _Done when:_ skill is installed and Claude Code can author a valid deck from it. (Spec 11)
- [ ] **P8-5 — Turn-taking status indicator.** Show `synced / external change / unsaved`. _Done when:_ indicator reflects each state. (Spec 11)
- [ ] **P8-6 — Dirty-guard conflict prompt.** On external change while dirty, prompt instead of clobbering. _Done when:_ concurrent edit triggers the prompt. (Spec 11)
- [ ] **P8-7 — Highlight external changes.** After an SSE reload, highlight elements Claude changed (by `data-eid` diff). _Done when:_ changed elements are visually marked. (Spec 02, 11)
- [ ] **P8-8 — (Later) MCP layer.** Expose CLI ops as MCP tools. _Done when:_ an MCP client can `add_slide`/`set_layout`/`insert_image`. (Spec 11 — deferred)

---

## Cross-cutting (maintain throughout)

- [ ] **X-1 — Offline guard test.** A CI/dev check that the built deck loads no external URLs. (Spec 12)
- [ ] **X-2 — Round-trip corpus grows.** Add any odd HTML encountered to the golden-file corpus (P1-6). (Spec 12)
- [ ] **X-3 — Never-destroy badge.** Passthrough/partially-editable elements show a "source only" badge wherever surfaced. (Spec 02, 12)
- [ ] **X-4 — Secrets hygiene.** Provider keys only via env/gitignored config; never written to `config.toml` or decks. (Spec 12, 13)

## Suggested milestones

- **M1 (usable):** through Phase 3 — visual editing + alignment beats hand-authoring.
- **M2 (rich):** through Phase 5 — full content + assets.
- **M3 (complete):** through Phase 7 — motion, theming, present, export.
- **M4 (AI-native):** Phase 8 — Claude Code skill + safe handoff.
