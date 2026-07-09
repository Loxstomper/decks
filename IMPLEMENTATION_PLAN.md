# slides-builder — Implementation Plan

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

**Phases 0–21 are complete** (tags `0.0.1`–`0.0.21`; Phase 19, the QR block, landed on
`main` untagged). That covers: the Go+Svelte skeleton and
single-binary embed; the live editor shell and source-preserving document model; text editing with
per-command undo/autosave; the five layout primitives and alignment-as-intent; free positioning
with smart guides; content blocks and the acquire→localize asset pipeline; slides, motion, and
theming; presenting, PDF, and bundle export; the Claude Code skill, `slides validate`, and
turn-taking; per-slide theme overrides and backgrounds; thumbnail fidelity; the context menu;
slide-layout presets; inline rich text, links, charts, command palette, footers, present-mode
polish; the QR block; workspace resolution (the `slides` binary now runs from anywhere on
`$PATH`), and skill distribution (the binary embeds the `slides-authoring` skill and installs it
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

## Open follow-ups

Loose ends surfaced while building, none load-bearing.

- [ ] **Run the e2e suite in a real browser.** Specs for per-slide themes, context menu, slide
  layouts, free position, reveal-frame reload, slide background, phase 17, and QR are **written and
  type-checked but have never been executed** — the build env has no browsers. Until then, those
  features rest on unit coverage plus a green `tsc`. Run `cd web && npm run test:e2e:docker`.
  Several phases also flagged **visual-only** confirmations (overlay alignment at non-1.0 zoom,
  drag/snap feel, toolbar and palette UX, live restyles) that no headless check covers.
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
- [ ] **e2e global-setup now pins `--dir`.** `web/e2e/global-setup.ts` passes `--dir <tmpDir>` to
  both `new` and `serve` rather than relying on cwd-as-root. It has **not been executed** (no
  browsers in this env) — the workspace-resolution change it depends on is covered by
  `cmd/slides/root_test.go` and by manual binary smoke tests instead.
- [ ] **Frontend typecheck is `npm run check` (svelte-check), not `npx tsc`.** Bare `tsc` cannot
  resolve types exported from `<script module>` in `.svelte` files (e.g. `MenuItem` from
  `ContextMenu.svelte`) and reports phantom errors. Recorded in `CLAUDE.md`.
- [ ] **The layout contract is now re-encoded five times.** `layout.ts`, `validate.go`,
  `slides-layout-init.js`, `thumbnail-layout.ts`, and the prose skill
  (`internal/skill/assets/slides-authoring/`). `TestRepoInstalledCopyIsCurrent` pins the repo's
  committed `.claude/skills/` copy to the embedded bytes, but nothing checks the *prose* against
  the *validator's* allowed-sets — a vocabulary change can still update the code and leave the
  skill teaching the old rules. A generated allowed-values table in `AUTHORING.md` would close it.
- [ ] **`slides new` still takes only a bare name**, unlike the other deck commands — the deck
  doesn't exist yet, so a path can't be resolved against it. This is *safe*, not broken:
  `deck.validateName` rejects `new decks/foo` and `new ../escape` with `deck name "…" is invalid
  (must be a simple folder name)`, so no traversal is possible. Open only as sugar: should
  `new decks/foo` mean `new foo`? Also note the message arrives via `log.Fatalf`, so it carries a
  `main.go:NNN:` prefix that the other commands' `fatalf` errors don't.

## Cross-cutting (maintain throughout)

- [x] **X-1 — Offline guard test.** A CI/dev check that the built deck loads no external URLs. (Spec principles-and-invariants)
- [x] **X-2 — Round-trip corpus grows.** Add any odd HTML encountered to the golden-file corpus. (Spec principles-and-invariants)
- [x] **X-3 — Never-destroy badge.** Passthrough/partially-editable elements show a "source only" badge wherever surfaced. (Spec document-model, principles-and-invariants)
- [x] **X-4 — Secrets hygiene.** Provider keys only via env/gitignored config; never written to `config.toml` or decks. (Spec principles-and-invariants, project-structure)

## Milestones

| # | Theme | Status |
|---|---|---|
| M1 | Usable — visual editing + alignment beats hand-authoring | ✅ Phase 3 (`0.0.4`) |
| M2 | Rich — full content + assets | ✅ Phase 5 (`0.0.6`) |
| M3 | Complete — motion, theming, present, export | ✅ Phase 7 (`0.0.8`) |
| M4 | AI-native — Claude Code skill + safe handoff | ✅ Phase 8 (`0.0.9`) |
| M5 | Polished — adjustable chrome, e2e coverage | ✅ Phase 9 (`0.0.10`) |
| M6 | Per-slide theming | ✅ Phases 10 + 18 (`0.0.12`, `0.0.17`) |
| M7 | Slides-app parity — context menu, layouts, thumbnails, backgrounds | ✅ Phases 11–16 (`0.0.11`–`0.0.16`) |
| M8 | Everyday-authoring parity — inline text, links, charts, palette | ✅ Phase 17 (`0.0.18`) |
| M9 | **Installable CLI** — `slides` on `$PATH`, run from anywhere | ✅ Phase 20 (core) |
| M10 | **AI-native distribution** — the binary ships the skill that teaches its own contract | ✅ P21-2 |
| M11 | **Run from anywhere** — workspace found by walking up; deck named by name, path, or `.` | ✅ Phase 21 |
