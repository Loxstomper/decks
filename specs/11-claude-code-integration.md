# 11 — Claude Code integration

**Status:** decided (skill + CLI first; MCP later)

## Summary

Claude Code is the AI authoring layer. It edits `deck.html` files directly, guided by a
**skill** that documents the conventions and a small **CLI** for structural ops + validation.
The human↔AI handoff is coordinated by turn-taking over SSE.

## v1: a Claude Code skill

A skill is low-build and leans on the clean `data-*` contract. It contains:

- **Conventions doc** — the `data-eid` / `data-lay` vocabulary ([03](03-layout-vocabulary.md)),
  folder layout ([13](13-project-structure.md)), turn-taking model, and offline rules
  ([12](12-principles-and-invariants.md)). This teaches Claude Code to edit decks correctly by
  hand.
- **A CLI** (subcommands on the same Go binary):
  - `slides new <name>` — scaffold a deck folder.
  - `slides add-slide <deck>` — append a starter `<section>`.
  - `slides validate <deck>` — well-formedness check (see below).
- Claude Code edits HTML directly for content; calls the CLI for structural ops + validation.

## `slides validate` (the sleeper feature)

Checks a deck is well-formed:

- valid `data-lay` values and attribute combinations,
- unique `data-eid`s,
- referenced assets exist,
- HTML parses and round-trips.

Run by **both** Claude Code *and* the editor's save path, so malformed decks are caught instead
of silently breaking the canvas.

## Targeting & change visibility

- Stable `data-eid`s let Claude Code target precisely ("rewrite slide 4 body, eid `p1`").
- The editor can **highlight what Claude changed** after an external write.

## Turn-taking handshake

1. Editor autosaves on each command.
2. Claude Code writes the file.
3. `fsnotify` detects it → server pushes an **SSE** "file changed" event.
4. Editor re-parses (guarded if mid-gesture / dirty — prompt on conflict).
5. A **status indicator** shows `synced / external change / unsaved` so the handoff is legible.

True concurrent merge is out of scope for v1.

## Later: MCP

The CLI ops (`add_slide`, `set_layout`, `insert_image`, …) become MCP tools with no redesign,
letting Claude manipulate decks via structured tools rather than raw HTML edits.

## Related

[02](02-document-model.md) · [03](03-layout-vocabulary.md) · [12](12-principles-and-invariants.md) · [13](13-project-structure.md)
