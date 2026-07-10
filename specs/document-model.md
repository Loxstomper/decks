# Document model

**Status:** decided

## Summary

The source of truth is the plain reveal.js `deck.html` on disk. In memory, the editor
represents it as a tree that mirrors the DOM but **retains each node's original source bytes**,
not a custom AST and not a re-serialized DOM. The editor structures only the elements it
manipulates and preserves everything else verbatim.

## Decisions

- **Source of truth: `deck.html`** (standard reveal.js, with the reveal init config inline).
  Both the editor and Claude Code read/write this file. No sidecar data file.
- **In-memory model: a source-preserving element tree.** Parse `deck.html` into a tree that
  mirrors the DOM but keeps each node's *original bytes* (`raw`); mutators mark only the nodes
  they touch `dirty`. Serialization emits the verbatim `raw` for untouched subtrees and
  canonical markup **only for `dirty` nodes**. (We deliberately do *not* round-trip through
  `DOMParser` → `outerHTML`: that normalizes whitespace/attribute order/entities and would
  churn every file on save — the opposite of the byte-stable invariant below.)
- **Well-formed input.** The parser targets well-formed reveal HTML — explicit close tags, no
  HTML5 tag-omission. `decks validate` ([Claude Code integration](claude-code-integration.md)) gates malformed
  input rather than the parser guessing.
- **Passthrough.** Nodes the editor doesn't understand stay in the tree untouched (their `raw`
  bytes pass straight through on save). The editor recognizes elements by their classes /
  `data-*` attributes and only restructures those.
- **Stable IDs.** The editor stamps `data-eid` on elements it manages, so the canvas *and*
  Claude Code can target the same element deterministically.

## Why a source-preserving tree (not DOMParser/outerHTML)

- **Byte-stable round-trip is achievable** — emitting `raw` for untouched nodes means a
  load→save with no edits is a literal no-op, and a scoped edit never reformats its siblings.
  A `DOMParser`/`outerHTML` cycle cannot promise this (it always re-renders the whole tree).
- **Automatic passthrough** — Claude Code writes arbitrary reveal.js HTML/CSS/plugins between
  sessions; anything the editor doesn't touch is preserved for free as raw bytes. A custom
  JSON schema would have to model every possible thing Claude could write.
- **Canonical only where it matters** — `dirty` nodes serialize to predictable, machine-legible
  markup (consistent indentation, attribute ordering, `data-*` grouping), so the diff after an
  edit is exactly the edit.

## Element classification

When parsing, each node is one of:

| Class | Meaning | Editor behavior |
|---|---|---|
| **Container** | Has a `data-lay` layout primitive (see [Layout vocabulary](layout-vocabulary.md)) | Full layout editing |
| **Leaf** | A known content block (text, image, code, math, table, shape, embed) | Full content + style editing |
| **Free** | Any element with `data-free` | Absolute positioning editing |
| **Passthrough** | Anything else | Preserved verbatim; flagged "source only" in UI |

## `data-eid` scheme

- Stable, unique per deck (e.g., short slug + counter: `t1`, `p1`, `img1`).
- Assigned on first edit / insert; preserved across save/load.
- Used by: canvas selection, Claude Code targeting, auto-animate `data-id` derivation
  (see [Motion & transitions](motion-and-transitions.md)), and "highlight what Claude changed".

## Inline content model (rich text)

A **text leaf** (heading / paragraph / list item) may hold more than a single text node — a
small set of **inline marks**: `strong`, `em`, `u`, `s`, `a[href]`, and `span[style]`. So a
*word or phrase* can be bold / italic / coloured / linked, not just the whole element (the
whole-element text-color escape hatch in [Theming & styles](theming-and-styles.md) is the degenerate case;
this is the Google-Slides "select a word, bold it" expectation).

- **Constrained allowlist.** Only those tags, each with a fixed attribute allowlist
  (`a` → `href` / `target` / `rel`; `span` → `style` limited to `color` and `font-size`). The
  leaf's inline subtree serializes **canonically** when dirty and is byte-stable round-trip.
  Anything already inside a leaf that is *off-allowlist* is treated as passthrough — preserved,
  not edited.
- **Writeback preserves marks.** Committing an in-place `contenteditable` edit serializes the
  leaf's inline DOM back to allowlisted HTML instead of flattening to plain text. (This replaces
  the text-only writeback, which discarded inline markup on every commit.) Only the leaf's child
  subtree goes `dirty`; its open/close tag bytes and every sibling pass through untouched.
- **Sub-leaf nodes carry no `data-eid`.** Marks are content *within* a leaf, addressed by the
  leaf's eid plus a selection range — not independently selectable elements. (A link is the one
  mark that may instead wrap a *whole element*; see [Layout vocabulary](layout-vocabulary.md),
  [Canvas & interaction](canvas-interaction.md).)
- **Sanitization is mandatory.** `contenteditable` — and especially **paste** — can introduce
  arbitrary HTML; the serializer strips everything off-allowlist (scripts, event handlers,
  external resource URLs, `javascript:` hrefs) before it reaches the model. This is a security +
  offline invariant, not a nicety ([Principles & invariants](principles-and-invariants.md)).

## Serialization rules

- Deterministic output: same model → same bytes, every time.
- **Idempotent round-trip** is a tested invariant: load→save with no edits = no diff. See
  [Principles & invariants](principles-and-invariants.md).
- Output targets *machine legibility* (predictable, semantic) — not human formatting fidelity,
  since no human hand-edits the HTML (Claude Code does). Consistent indentation, attribute
  ordering, and `data-*` grouping.

## Concurrency

Human (canvas, in memory) and Claude Code (file on disk) both write. v1 uses **turn-taking +
reload**: editor autosaves per command; external change triggers SSE reload when not mid-
gesture; a dirty guard prompts on conflict. True concurrent merge is out of scope for v1. See
[Claude Code integration](claude-code-integration.md).

## Related

[Layout vocabulary](layout-vocabulary.md) · [Claude Code integration](claude-code-integration.md) · [Principles & invariants](principles-and-invariants.md)
