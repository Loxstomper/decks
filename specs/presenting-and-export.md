# Presenting & export

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

## Presenter tools (reveal plugins, offline)

Live aids during a presentation — vendored offline like every other plugin
([Principles & invariants](principles-and-invariants.md)) and active only on the present route:

- **Drawing / annotation** — a chalkboard / pen overlay to draw on slides while presenting
  (toggle, colours, erase). Annotations are **ephemeral**: never written back to `deck.html`, so
  byte-stability ([Document model](document-model.md)) is untouched. Persisting them is explicitly out of
  scope — they are a live aid, not deck content.
- **Laser pointer** — hold a key to turn the cursor into a highlighted pointer dot. Ephemeral,
  no deck mutation.
- **On-screen slide number** — reveal's `slideNumber` ([Theming & styles](theming-and-styles.md)); the same
  deck-level setting that shows page numbers in the editor.
- **Auto-advance** — the present route honors `data-autoslide` / loop
  ([Motion & transitions](motion-and-transitions.md)).

## Offline presenting

It's a local file served by the local binary — works with no network ([Principles & invariants](principles-and-invariants.md)).

## Export

| Export | Mechanism |
|---|---|
| **PDF** | reveal's `?print-pdf`; the Go backend drives headless Chrome to produce the file on demand. |
| **HTML bundle** | Zip the deck folder — it's already self-contained (HTML + `assets/` + `custom.css`). |

## Related

[Scaling & resolution](scaling-and-resolution.md) · [Principles & invariants](principles-and-invariants.md)
