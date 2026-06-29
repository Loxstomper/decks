# 02 — Document model

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
  HTML5 tag-omission. `slides validate` ([11](11-claude-code-integration.md)) gates malformed
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
| **Container** | Has a `data-lay` layout primitive (see [03](03-layout-vocabulary.md)) | Full layout editing |
| **Leaf** | A known content block (text, image, code, math, table, shape, embed) | Full content + style editing |
| **Free** | Any element with `data-free` | Absolute positioning editing |
| **Passthrough** | Anything else | Preserved verbatim; flagged "source only" in UI |

## `data-eid` scheme

- Stable, unique per deck (e.g., short slug + counter: `t1`, `p1`, `img1`).
- Assigned on first edit / insert; preserved across save/load.
- Used by: canvas selection, Claude Code targeting, auto-animate `data-id` derivation
  (see [07](07-motion-and-transitions.md)), and "highlight what Claude changed".

## Serialization rules

- Deterministic output: same model → same bytes, every time.
- **Idempotent round-trip** is a tested invariant: load→save with no edits = no diff. See
  [12](12-principles-and-invariants.md).
- Output targets *machine legibility* (predictable, semantic) — not human formatting fidelity,
  since no human hand-edits the HTML (Claude Code does). Consistent indentation, attribute
  ordering, and `data-*` grouping.

## Concurrency

Human (canvas, in memory) and Claude Code (file on disk) both write. v1 uses **turn-taking +
reload**: editor autosaves per command; external change triggers SSE reload when not mid-
gesture; a dirty guard prompts on conflict. True concurrent merge is out of scope for v1. See
[11](11-claude-code-integration.md).

## Related

[03](03-layout-vocabulary.md) · [11](11-claude-code-integration.md) · [12](12-principles-and-invariants.md)
