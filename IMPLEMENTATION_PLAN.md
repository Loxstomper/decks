# decks — Implementation Plan

Atomic task breakdown derived from [`specs/`](specs/README.md). Each task is small,
independently completable, and verifiable.

## How to use this plan

- **Atomic** = one logical change with a single, checkable outcome. If a task needs
  sub-decisions or touches multiple concerns, it's split.
- Each task has an **ID** (`P{phase}-{n}`), a description, the **spec** it implements, and a
  **Done when** acceptance criterion.
- Check the box when the *Done when* criterion is met (and any test for it passes).
- **Definition of done (global):** code compiles, the criterion holds, no spec invariant
  ([spec principles-and-invariants](specs/principles-and-invariants.md)) is violated, and any new behavior has at
  least a smoke test.
- **This plan is forward-looking.** Completed work is not re-litigated here — it lives in the
  code, in `git log`, and in the tags below. Durable design rationale belongs in
  [`specs/`](specs/README.md); durable operational gotchas belong in `CLAUDE.md`.

## Where we are

**Phases 0–21 are complete.** Each phase's work is recorded in its commit — `git log --oneline |
grep Phase` walks the whole build. (The per-phase `0.0.x` tags the build loop created were build
markers, not releases; they were removed before open-sourcing. `0.0.1` is now the first real
release.) That covers: the Go+Svelte skeleton and
single-binary embed; the live editor shell and source-preserving document model; text editing with
per-command undo/autosave; the five layout primitives and alignment-as-intent; free positioning
with smart guides; content blocks and the acquire→localize asset pipeline; slides, motion, and
theming; presenting, PDF, and bundle export; the Claude Code skill, `decks validate`, and
turn-taking; per-slide theme overrides and backgrounds; thumbnail fidelity; the context menu;
slide-layout presets; inline rich text, links, charts, command palette, footers, present-mode
polish; the QR block; workspace resolution (the `decks` binary now runs from anywhere on
`$PATH`), and skill distribution (the binary embeds the `decks-authoring` skill and installs it
into each workspace), and a deck can be named by name, by path, or as `.` from inside its folder.

**Everything below is what remains.**

---

## Deferred

Decided-but-not-built, carried from earlier phases. Neither blocks anything.

- [ ] **P8-8 — MCP layer.** Expose the CLI ops as MCP tools (`add_slide` / `set_layout` /
  `insert_image`). The skill + CLI were always "v1 first, MCP later".
  _Done when:_ an MCP client can drive those ops. (Spec claude-code-integration)
- [ ] **P11-3 — Skip reload on pure text commits.** Evaluate persisting in-place text edits
  without a full iframe reload (the contenteditable already mutated the live DOM), reserving
  reloads for structural/external changes. Gate on a guarantee that the canvas cannot drift from
  on-disk bytes. _Done when:_ decided + (if adopted) text commits no longer reload. (Spec canvas-interaction, document-model)

## Before publishing (blocks the first release)

The repo is being open-sourced. Everything below is done and committed on local `main` except
where noted; **nothing has been pushed**. `origin/main` is still `fd81ea6` (82 commits, original
history); local `main` is `61c5c21` (94 commits, rewritten). They diverge → the first push must be
`--force`.

- [x] Renamed to `decks` (module `github.com/Loxstomper/decks`, `cmd/decks`, binary `bin/decks`).
- [x] MIT `LICENSE` + `THIRD_PARTY_NOTICES.md`; upstream licenses vendored beside the code they
  cover, so `decks new` copies them into every scaffolded deck.
- [x] `README.md` + `docs/demo.webp`.
- [x] CI (`.github/workflows/ci.yml`) + GoReleaser + `decks --version`. Actions pinned to commit
  SHAs; npm pinned to exact versions; the gitleaks module hash is asserted before use.
- [x] Secret scan: trufflehog (40.9 MB of blobs) and gitleaks (4.75 MB of patches) over all
  history. Clean. One documented false positive allowlisted in `.gitleaks.toml`.
- [x] `git filter-repo` removed both accidentally-committed `slides` binaries (13,533,426 and
  14,163,730 bytes). `.git` 22 MB → 3.5 MB. Re-grows on `git fetch`, which re-imports
  `origin/main`'s old objects; harmless, and gc'd once the force-push lands.

- [x] **Fixed the 10 failing e2e tests.** Suite is now 37/37 and order-independent (see below).
- [ ] **Force-push `main`**, delete the 2 stale remote branches and the 24 remote tag refs.
  Note: `git fetch` re-creates the 21 local tags until the remote ones are deleted.
- [ ] **Enable GitHub secret scanning + push protection** (free on public repos, currently off).
- [ ] **Flip public**, then `git tag v0.0.1 && git push origin v0.0.1` to trigger the release.
  Both `README.md` and `web.ErrNotBuilt` link `/releases`, which 404s until this lands.

## e2e: 37/37, and the suite is now order-independent (2026-07-10)

Four distinct root causes, not the two the earlier triage guessed. Two were real product/test
bugs; two were harness bugs that made specs pass alone and fail in the full run.

- **A real rendering bug — free elements drifted from their declared coordinates.**
  `[data-free]` is absolutely positioned, and `top`/`left` position the *margin* edge, so
  reveal's own `.reveal p { margin: var(--r-block-margin) 0 }` (specificity 0,1,1) silently
  offset every free text leaf from its `data-x`/`data-y` while the editor's overlay kept drawing
  handles at the declared rect — a visible 7px gap at default zoom. Fixed by `margin: 0
  !important` on `[data-free]` in `internal/deck/vendor/decks-layout.css`. `!important` because a
  bare `[data-free]` rule loses the cascade to the theme; margin is *layout*, and the editor owns
  layout (use padding to inset a free element). The thumbnail builder links the same stylesheet,
  so all five encodings of the contract stayed in agreement with one edit. **Existing decks pick
  this up only via `decks vendor <name>` / `decks upgrade <name>`** (Upgrade re-vendors first).

- **The three `context-menu` specs had never passed, over a working product.**
  `page.locator('.cm-item', { hasText: /^Delete$/ })` can never match: a `.cm-item`'s text is
  `"Delete "` — `ContextMenu.svelte` leaves a space between `<span class="cm-label">` and the
  `{#if item.submenu}` chevron block — so the anchored `$` fails. Now matched by accessible name
  via `menuItem(page, 'Delete')` (`getByRole('menuitem', { name, exact: true })`, which trims).

- **`free-position` used a fixture the product cannot select.** It injected `<div data-free>`, but
  `resolveSelectable()` climbs to the nearest recognised *leaf* tag, per spec canvas-interaction
  ("Click to select a leaf; click-through / outline panel to select containers"). A `<div>` is a
  container, so the click selected nothing and `FreeTransformOverlay` rendered no `.move-frame`.
  The fixture is now `<p data-free>`, which is what "Make free" actually produces. (A free
  *container* is still only selectable from the outline panel — intended, but see follow-ups.)

- **Harness bug 1: the editor opens `decks[0]`, not "your" deck.** `App.onMount` loads the first
  entry of `GET /api/decks`, which Go returns sorted by folder name. The moment
  `create-deck.spec.ts` created `e2e-created-deck`, every later spec's bare `page.goto('/')`
  silently opened the wrong deck. Now `openDeckInEditor(page, deck)` clicks the deck's own sidebar
  button and waits for the canvas iframe's `src` to name it.

- **Harness bug 2: all 37 tests shared one mutable `smoke-deck`.** Specs spliced fixture HTML into
  it with hand-rolled regexes, and a non-matching `String.replace` is a *silent* no-op. `qr.spec`'s
  injected slide introduced an earlier `</div></div>`, so `slide-background`'s splice landed
  *inside* a slide, where reveal never treats sections as slides. Every spec now scaffolds its own
  deck via `POST /api/decks/{name}`, and the injection helpers throw when their anchor is missing.

- **A trap for the next spec author: thumbnails are IntersectionObserver-gated.** `SlideThumbnail`
  only builds `srcdoc` once the row scrolls into view (each thumbnail refetches ~7 stylesheets).
  A test reading `iframe.thumb-frame`'s `srcdoc` must call `thumbnailSrcdocs(page)`, which scrolls
  every row in first — otherwise rows below the fold read empty, and the number of decks in the
  sidebar decides where the fold is. Thumbnails also carry **no `data-eid`**
  (`cloneSubtreeStripEids`, pinned by `thumbnail-layout.test.ts`), so correlate a thumbnail with
  its slide by rendered text, never by eid.

New shared harness modules: `web/e2e/constants.ts` (STATE_FILE / TEST_PORT / BASE_URL / SMOKE_DECK,
previously duplicated between setup and teardown) and `web/e2e/fixtures.ts` (`createDeck`,
`getDeckHtml`/`putDeckHtml`, `appendSlides`/`prependSlides`/`appendToFirstSlide`,
`openDeckInEditor`, `thumbnailSrcdocs`, `menuItem`). `getDeckHtml`/`putDeckHtml` had been
copy-pasted into six specs.

Still uncovered by any headless check: the **visual-only** confirmations several phases flagged
(overlay alignment at non-1.0 zoom, drag/snap feel, toolbar and palette UX, live restyles).

## Open follow-ups

Loose ends surfaced while building, none load-bearing.
- [ ] **Relocate `structure-ops.ts`.** It holds pure model tree-mutations (`moveChild`,
  `reparentChild`, `deleteElement`) but lives under `$lib/canvas`. Move into `$lib/model` so every
  tree mutation sits in one layer.
- [ ] **Code-split the Vite bundle.** The main chunk trips Vite's >500 kB warning (CodeMirror 6 +
  reveal). Cosmetic; no functional impact.
- [ ] **Suppress the first-load double render.** An un-stamped deck renders once before the
  `stampEids` normalization save bumps `reloadNonce`. Harmless wasted iframe render.
- [ ] **Proactive PDF capability check.** `ExportPanel` HEAD-probes for Chrome; add a `chrome` flag
  to `GET /api/capabilities` and disable the button up front instead.
- [ ] **Feature e2e coverage.** The harness and a create-deck example exist; delete/pane-collapse/
  source-jump/theme-switching still lack specs (`web/e2e/<feature>.spec.ts` convention).
- [ ] **Frontend typecheck is `npm run check` (svelte-check), not `npx tsc`.** Bare `tsc` cannot
  resolve types exported from `<script module>` in `.svelte` files (e.g. `MenuItem` from
  `ContextMenu.svelte`) and reports phantom errors. Recorded in `CLAUDE.md`.
- [ ] **The layout contract is now re-encoded five times.** `layout.ts`, `validate.go`,
  `decks-layout-init.js`, `thumbnail-layout.ts`, and the prose skill
  (`internal/skill/assets/decks-authoring/`). `TestRepoInstalledCopyIsCurrent` pins the repo's
  committed `.claude/skills/` copy to the embedded bytes, but nothing checks the *prose* against
  the *validator's* allowed-sets — a vocabulary change can still update the code and leave the
  skill teaching the old rules. A generated allowed-values table in `AUTHORING.md` would close it.
- [ ] **`decks new` still takes only a bare name**, unlike the other deck commands — the deck
  doesn't exist yet, so a path can't be resolved against it. This is *safe*, not broken:
  `deck.validateName` rejects `new decks/foo` and `new ../escape` with `deck name "…" is invalid
  (must be a simple folder name)`, so no traversal is possible. Open only as sugar: should
  `new decks/foo` mean `new foo`? Also note the message arrives via `log.Fatalf`, so it carries a
  `main.go:NNN:` prefix that the other commands' `fatalf` errors don't.
- [ ] **A free *container* can't be selected from the canvas.** `resolveSelectable()` only resolves
  a click to a recognised leaf tag, so a hand/AI-authored `<div data-free>` renders and positions
  correctly but cannot be picked up on the canvas — only from the outline panel, which is what spec
  canvas-interaction prescribes ("click-through / outline panel to select containers").
  `FreeTransformOverlay` gates on `isFreeEl()` alone, so once selected *any* free element gets
  handles. Decide whether a click should resolve to the nearest `[data-free]` ancestor even when it
  is a container. _Done when:_ decided + (if adopted) a `<div data-free>` is click-selectable.
- [ ] **`decks upgrade` is now required for pre-existing decks.** The `[data-free] { margin: 0 }`
  fix lives in the vendored `decks-layout.css`, which existing decks hold a stale copy of. Harmless
  pre-release (nothing is published), but if a deck predates this commit its free elements stay
  offset until `decks vendor <name>`. Consider whether `decks validate` should warn on a stale
  vendored asset.

## Cross-cutting (maintain throughout)

- [x] **X-1 — Offline guard test.** A CI/dev check that the built deck loads no external URLs. (Spec principles-and-invariants)
- [x] **X-2 — Round-trip corpus grows.** Add any odd HTML encountered to the golden-file corpus. (Spec principles-and-invariants)
- [x] **X-3 — Never-destroy badge.** Passthrough/partially-editable elements show a "source only" badge wherever surfaced. (Spec document-model, principles-and-invariants)
- [x] **X-4 — Secrets hygiene.** Provider keys only via env/gitignored config; never written to `config.toml` or decks. (Spec principles-and-invariants, project-structure)

## Milestones

| # | Theme | Status |
|---|---|---|
| M1 | Usable — visual editing + alignment beats hand-authoring | ✅ Phase 3 |
| M2 | Rich — full content + assets | ✅ Phase 5 |
| M3 | Complete — motion, theming, present, export | ✅ Phase 7 |
| M4 | AI-native — Claude Code skill + safe handoff | ✅ Phase 8 |
| M5 | Polished — adjustable chrome, e2e coverage | ✅ Phase 9 |
| M6 | Per-slide theming | ✅ Phases 10 + 18 |
| M7 | Slides-app parity — context menu, layouts, thumbnails, backgrounds | ✅ Phases 11–16 |
| M8 | Everyday-authoring parity — inline text, links, charts, palette | ✅ Phase 17 |
| M9 | **Installable CLI** — `decks` on `$PATH`, run from anywhere | ✅ Phase 20 (core) |
| M10 | **AI-native distribution** — the binary ships the skill that teaches its own contract | ✅ P21-2 |
| M11 | **Run from anywhere** — workspace found by walking up; deck named by name, path, or `.` | ✅ Phase 21 |
