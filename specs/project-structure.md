# Project structure

**Status:** decided

## Workspace layout

```
config.toml               # editor prefs, grid size, provider settings (no secrets)
decks/                    # ← the workspace-root marker (see "Workspace resolution")
  my-talk/
    deck.html             # source of truth (reveal config inline)
    custom.css            # per-deck styling; CSS custom properties
    assets/               # images, video, fonts — self-contained
      fonts/              # downloaded/self-hosted fonts (offline)
templates/                # reusable slide/layout snippets (user/Claude-authored layout presets)
shared/                   # optional source library (copied into decks on insert)
themes/                   # custom reveal themes (optional)
.claude/skills/           # the authoring skill, installed FROM the binary (generated — see [11])
```

The `slides` binary itself lives on `$PATH`, not in the workspace. A workspace is any directory
containing `decks/`; it is commonly its own git repo (a private decks repo), separate from the
slides-builder source tree.

## Notes

- **Deck = a folder.** `deck.html` + `custom.css` + `assets/`. Self-contained and portable
  (see [Assets & media](assets-and-media.md)).
- **Decks are git-friendly.** Git is the durable history ([Principles & invariants](principles-and-invariants.md)).
- **Secrets** (Unsplash / Giphy / Gemini keys) come from **env vars or a gitignored local
  config file**, never committed `config.toml`.
- **`config.toml`** holds non-secret editor preferences (default aspect ratio, grid size,
  enabled providers, etc.).
- **The binary is workspace-relative:** it operates on a workspace root, resolved as below —
  never on a path baked into the binary. The binary itself may live anywhere (`$PATH`).
- **`templates/`** holds **slide-layout presets** — `<section>` snippets listed (alongside the
  bundled built-in presets) via `GET /api/templates` and applied per slide
  ([Slide management](slide-management.md) "Slide layouts"). User- and Claude-authored; offline.

## Workspace resolution

**Status:** decided

The binary is expected to be on `$PATH` and invoked from wherever you happen to be — inside a
deck folder, elsewhere in the workspace, or outside it entirely. It resolves the workspace root
in this precedence order:

1. **`--dir <path>`** — a global flag, before the subcommand (`slides --dir ~/talks new intro`),
   mirroring `git -C`. The path must already exist; it is never created.
2. **`$SLIDES_DIR`** — same semantics. Lets a wrapper script or a Claude Code hook point at a
   workspace without threading a flag through every invocation.
3. **Upward search** — walk from the cwd toward the filesystem root; the nearest ancestor
   containing a `decks/` directory is the workspace root. So `slides validate my-talk` works
   from inside `decks/my-talk/`, the way `git` works from anywhere in a repo.
4. **Not found** — an error, *not* a silently-created workspace (see below).

`decks/` is the root marker. It is implicit rather than a dedicated dotfile because it already
exists in every workspace, and `config.toml` is optional by design (absent → defaults) and so
cannot serve as one. Once the root is resolved, `config.toml` is read from it.

### Never scaffold an unproven root

Creating the workspace directories is only safe **after** the root is established. Otherwise a
mistyped `cd` followed by `slides` litters empty `decks/`, `templates/`, `shared/`, and
`themes/` directories into an unrelated folder and serves an empty editor.

- **`slides new <name>`** is the one initializing command. If a workspace is found, the deck is
  created there (so `slides new intro` from inside `decks/my-talk/` lands it beside it, at
  `decks/intro`). If none is found, the cwd *becomes* a workspace — scaffolded, then the deck
  created.
- **Every other subcommand** (`serve`, `vendor`, `upgrade`, `add-slide`, `validate`) requires an
  existing workspace and exits non-zero without one, naming both escape hatches:

  ```
  error: ~/Downloads is not a slides workspace (no decks/).
    slides new <name>     initialize one here
    slides --dir <path>   use an existing one
  ```

- Missing *non-deck* directories (`templates/`, `shared/`, `themes/`) inside an already-resolved
  root are created on demand; their absence is not an error, and readers already treat an absent
  `shared/` as empty.

Commands **always report the resolved root** (`serve` logs it at startup; errors name it). The
upward search can legitimately surprise — a stray `~/decks/` turns all of `$HOME` into a
workspace — and a visible root makes that diagnosable instead of silent.

## Related

[Architecture](architecture.md) · [Assets & media](assets-and-media.md) · [Principles & invariants](principles-and-invariants.md)
