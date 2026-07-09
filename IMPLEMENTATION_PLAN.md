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

**Phases 0–19 are complete** (tags `0.0.1`–`0.0.18`; Phase 19, the QR block, landed on `main`
untagged). That covers: the Go+Svelte skeleton and single-binary embed; the live editor shell and
source-preserving document model; text editing with per-command undo/autosave; the five layout
primitives and alignment-as-intent; free positioning with smart guides; content blocks and the
acquire→localize asset pipeline; slides, motion, and theming; presenting, PDF, and bundle export;
the Claude Code skill, `slides validate`, and turn-taking; per-slide theme overrides and
backgrounds; thumbnail fidelity; the context menu; slide-layout presets; inline rich text, links,
charts, command palette, footers, present-mode polish; and the QR block.

**Everything below is what remains.**

---

## Phase 20 — Workspace resolution (binary on `$PATH`)
> Goal: make `slides` usable as a **normal CLI on `$PATH`**, run from anywhere — inside a deck
> folder, elsewhere in the workspace, or outside it — instead of only from the workspace root.
> Specs: [Project structure](specs/project-structure.md) "Workspace resolution",
> [Claude Code integration](specs/claude-code-integration.md), [Architecture](specs/architecture.md).
>
> **Why now:** `workspaceRoot()` (`cmd/slides/main.go`) is an unconditional `os.Getwd()`, and
> `scaffoldWorkspace()` runs *before* the root is validated, from `serve` / `new` / `vendor` /
> `upgrade`. Harmless while the binary is invoked as `./slides` from the project root; the moment
> it lands on `$PATH`, a mistyped `cd` followed by `slides` creates empty `decks/`, `templates/`,
> `shared/`, `themes/` in an unrelated directory and serves an empty editor.
>
> **Decisions (locked, spec project-structure):**
> - **Precedence:** `--dir <path>` (global flag, *before* the subcommand, à la `git -C`) ›
>   `$SLIDES_DIR` › **upward search** for the nearest ancestor containing `decks/` › error.
>   `--dir` / `$SLIDES_DIR` paths must already exist; they are never created.
> - **`decks/` is the root marker.** Implicit rather than a dotfile: it exists in every workspace,
>   and `config.toml` is optional by design (absent → defaults) so it cannot serve as one.
> - **Never scaffold an unproven root.** Scaffolding isn't the hazard — scaffolding a directory we
>   haven't established *is*. `slides new` is the one initializing command (workspace found → deck
>   created there; none found → cwd becomes the workspace). Every other subcommand exits non-zero
>   with a message naming both escape hatches. Missing *non-deck* dirs inside an already-resolved
>   root are still created on demand (`assets.ListShared` already treats an absent `shared/` as
>   empty, so nothing hard-depends on them).
> - **Always report the resolved root.** The upward search can legitimately surprise — a stray
>   `~/decks/` makes all of `$HOME` a workspace — so a visible root keeps that diagnosable.
>
> **Blast radius:** `cmd/slides/main.go` only. Every `internal/` package already takes `root` as a
> parameter, so none of them change.

- [ ] **P20-1 — `findRoot` as a pure, tested function.** Extract root resolution out of
  `workspaceRoot()` (which today calls `os.Getwd()` + `log.Fatalf` and is untestable) into
  `findRoot(startDir, flagDir, envDir) (string, error)`: precedence chain, upward walk, stop at
  the filesystem root (checking `$HOME` on the way), `--dir`/`$SLIDES_DIR` must exist. Table-driven
  tests against `t.TempDir()`. _Done when:_ tests cover each precedence branch, a nested-deck start
  dir, a not-found walk, and a non-existent `--dir`; `go test ./...` green. (Spec project-structure)
- [ ] **P20-2 — Global `--dir` flag + `$SLIDES_DIR`.** Pre-parse `--dir <path>` and `--dir=<path>`
  ahead of the subcommand switch in `main.go` (the arg handling is a hand-rolled `switch` on
  `os.Args`; this is a small pre-parse loop, not a `flag` restructure). Wire `$SLIDES_DIR` as the
  fallback. `config.toml` loads from the resolved root. _Done when:_ `slides --dir <path> validate
  <deck>` and `SLIDES_DIR=<path> slides validate <deck>` both work from an unrelated cwd, and
  `--dir` beats the env var. (Spec project-structure, claude-code-integration)
- [ ] **P20-3 — Scaffold policy: `new` initializes, everything else errors.** `scaffoldWorkspace`
  runs only on a resolved root or from `new`. `serve` / `vendor` / `upgrade` / `add-slide` /
  `validate` exit non-zero outside a workspace with the workspace-resolution message (`slides new <name>` to
  initialize here, `slides --dir <path>` to use an existing one). `new` creates the deck in the
  found workspace, else initializes the cwd. _Done when:_ `slides` in an empty temp dir errors and
  creates **nothing**; `slides new intro` there initializes + creates the deck; `slides new other`
  from inside `decks/intro/` lands it at `decks/other`. (Spec project-structure)
- [ ] **P20-4 — Report the resolved root.** `serve` already logs it at startup; make every error
  path name the root (or the cwd it searched up from) too. _Done when:_ a surprising root (e.g. a
  stray `~/decks/`) is visible in the output rather than silent. (Spec project-structure)
- [ ] **P20-5 — Docs + smoke coverage.** Update `CLAUDE.md` — it says decks are created
  **workspace-relative to CWD**, true only until P20-3 lands — plus the `slides-authoring` skill
  and `docs/AUTHORING.md` where they assume a root-relative invocation. Smoke-test the built binary
  from inside a deck folder and from outside any workspace. _Done when:_ docs match behavior and
  both smoke paths behave as specified. (Spec project-structure, claude-code-integration)

- [ ] **P20-6 — (Follow-up) Deck argument accepts a path.** Let the deck arg be a path rather than
  only a bare name — `slides validate decks/my-talk`, or `.` from inside the deck folder.
  Independent of root resolution, but it's what makes the upward search fully pay off. _Done when:_
  a deck can be named by path, by `.`, or by bare name, and traversal outside the workspace is
  refused. (Spec project-structure, claude-code-integration)
- [ ] **P20-7 — Binary ships the authoring skill.** `go:embed` `.claude/skills/slides-authoring/`
  + `docs/AUTHORING.md` into the binary and install them into the resolved workspace's
  `.claude/skills/` — on `slides new` (fresh root) and via an explicit install/upgrade command,
  never silently on every run. Idempotent + byte-stable like `Vendor()`; the installed copy carries
  a "generated by `slides`, do not edit" header. **Why:** the skill and `AUTHORING.md` are further
  re-encodings of the `data-*` contract (with `layout.ts`, `validate.go`, `slides-layout-init.js`,
  `thumbnail-layout.ts`), and a workspace is usually a *separate repo* from the slides-builder
  tree — hand-copying forks the contract, so a deck authored to a stale skill fails `validate`.
  _Done when:_ a fresh workspace gets a skill matching the binary; re-installing is a byte-for-byte
  no-op; changing the vocabulary in slides-builder and reinstalling updates it. (Spec claude-code-integration, project-structure, architecture)

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
| M9 | **Installable CLI** — `slides` on `$PATH`, run from anywhere | ⬜ Phase 20 |
