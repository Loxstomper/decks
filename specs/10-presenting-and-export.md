# 10 — Presenting & export

**Status:** decided

## Summary

Edit and present are separate entry points so you present the exact source file. Speaker view,
PDF, and HTML bundle are reveal-native and largely free.

## Edit vs present (separate entry points)

- **Present route** (`/present/<deck>`) loads the **pure `deck.html`** through reveal with no
  editor attached — you present *exactly the file*, guaranteeing fidelity, with reveal's normal
  keyboard nav and transitions.
- **Edit mode** is the editor with the overlay and reveal held in a static, non-navigating
  state.
- Clean separation: editor chrome can never leak into a presentation.

## Speaker view & notes (reveal-native)

- reveal's built-in **speaker window** (press **S**) works off the present route — notes,
  next-slide preview, timer.
- Notes are `<aside class="notes">`; the editor gives each slide a notes field that writes it.

## Offline presenting

It's a local file served by the local binary — works with no network ([12](12-principles-and-invariants.md)).

## Export

| Export | Mechanism |
|---|---|
| **PDF** | reveal's `?print-pdf`; the Go backend drives headless Chrome to produce the file on demand. |
| **HTML bundle** | Zip the deck folder — it's already self-contained (HTML + `assets/` + `custom.css`). |

## Related

[05](05-scaling-and-resolution.md) · [12](12-principles-and-invariants.md)
