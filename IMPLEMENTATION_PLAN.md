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
  code, in `git log`, in `CLAUDE.md` (operational gotchas), and in [`specs/`](specs/README.md)
  (design rationale). Keep this file to what remains.

## Where we are

**Phases 0–21 are complete**, and the open-source hardening on top of them is done and merged.
`git log --oneline | grep Phase` walks the whole build. The product covers: the Go+Svelte skeleton
and single-binary embed; the source-preserving document model and live editor; text editing with
per-command undo/autosave; the five layout primitives and alignment-as-intent; free positioning
with smart guides; content blocks and the acquire→localize asset pipeline; slides, motion, and
theming; presenting, PDF, and bundle export; the authoring skill, `decks validate`, and
turn-taking; per-slide themes and backgrounds; thumbnail fidelity; context menu; slide-layout
presets; inline rich text, links, charts, command palette, footers, present-mode polish; the QR
block; workspace resolution (`decks` runs from anywhere on `$PATH`); and skill distribution (the
binary embeds and installs the `decks-authoring` skill).

`origin/main` is `be275e5` with CI fully green (Go · Frontend · E2E · Secret scan). The remaining
work to ship the first release is manual GitHub steps plus the loose ends below.

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

## Before the first release

The engineering is done and merged (rename to `decks`, MIT license + third-party notices, README +
demo, CI + GoReleaser + `--version`, a clean secret scan, the history rewrite that purged the
committed binaries, the e2e suite at 37/37, Go 1.26.5, and the dependency big-bang in PR #9). The
repo description + topics are set. What's left is maintainer-only and mostly outward-facing:

- [ ] **Enable GitHub secret scanning + push protection** (only available once the repo is public).
- [ ] **Flip public**, then `git tag v0.0.1 && git push origin v0.0.1` to trigger the release.
  Both `README.md` and `web.ErrNotBuilt` link `/releases`, which 404s until this lands.
- [ ] **Decide dependabot #10** (`typescript` 5.9.3 → 6.0.3). Below the `>=7.0.0` ignore rule
  (which targets the TS 7 *native port* that breaks svelte-check). TS 6 is still the JS compiler,
  so it may be fine — but it's an untested major; run `npm run check` on a branch before merging.

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
- [ ] **The layout contract is re-encoded five times.** `layout.ts`, `validate.go`,
  `decks-layout-init.js`, `thumbnail-layout.ts`, and the prose skill
  (`internal/skill/assets/decks-authoring/`). `TestRepoInstalledCopyIsCurrent` pins the repo's
  committed `.claude/skills/` copy to the embedded bytes, but nothing checks the *prose* against
  the *validator's* allowed-sets — a vocabulary change can still update the code and leave the
  skill teaching the old rules. A generated allowed-values table in `AUTHORING.md` would close it.
- [ ] **`decks new` still takes only a bare name**, unlike the other deck commands — the deck
  doesn't exist yet, so a path can't be resolved against it. Safe, not broken: `deck.validateName`
  rejects `new decks/foo` and `new ../escape`, so no traversal is possible. Open only as sugar:
  should `new decks/foo` mean `new foo`? Its error also arrives via `log.Fatalf`, so it carries a
  `main.go:NNN:` prefix the other commands' `fatalf` errors don't.
- [ ] **A free *container* can't be selected from the canvas.** `resolveSelectable()` only resolves
  a click to a recognised leaf tag, so a hand/AI-authored `<div data-free>` renders and positions
  correctly but can only be picked up from the outline panel — which is what spec canvas-interaction
  prescribes ("click-through / outline panel to select containers"). `FreeTransformOverlay` gates on
  `isFreeEl()` alone, so once selected *any* free element gets handles. Decide whether a click
  should resolve to the nearest `[data-free]` ancestor even when it is a container.
  _Done when:_ decided + (if adopted) a `<div data-free>` is click-selectable.
- [ ] **`decks upgrade` is required for pre-existing decks.** The `[data-free] { margin: 0 }` fix
  lives in the vendored `decks-layout.css`, which existing decks hold a stale copy of. Harmless
  pre-release, but a deck predating that commit keeps its free elements offset until
  `decks vendor <name>`. Consider whether `decks validate` should warn on a stale vendored asset.
- [ ] **No visual regression suite.** The Tailwind 4 migration was only safe because a throwaway
  screenshot test was stood up for it and then deleted. Preflight/token changes are exactly the
  class of break the headless suite can't see. Decide whether to keep a small `toHaveScreenshot`
  baseline for the editor chrome (masking the reveal iframe + thumbnails, which aren't Tailwind's).
  _Done when:_ decided + (if adopted) a baseline lands with a documented update path.
- [ ] **Revisit TypeScript 7** once svelte-check supports the native port; drop the `ignore` entry
  in `.github/dependabot.yml`. (Toolchain — no spec.)

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
| M4 | AI-native — authoring skill + safe handoff | ✅ Phase 8 |
| M5 | Polished — adjustable chrome, e2e coverage | ✅ Phase 9 |
| M6 | Per-slide theming | ✅ Phases 10 + 18 |
| M7 | Slides-app parity — context menu, layouts, thumbnails, backgrounds | ✅ Phases 11–16 |
| M8 | Everyday-authoring parity — inline text, links, charts, palette | ✅ Phase 17 |
| M9 | **Installable CLI** — `decks` on `$PATH`, run from anywhere | ✅ Phase 20 (core) |
| M10 | **AI-native distribution** — the binary ships the skill that teaches its own contract | ✅ P21-2 |
| M11 | **Run from anywhere** — workspace found by walking up; deck named by name, path, or `.` | ✅ Phase 21 |
