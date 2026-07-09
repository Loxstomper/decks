/**
 * blocks/media.ts — Register Lane FE-B's media / code / math block types
 * (P5-4, P5-5, P5-7, P5-8, P5-9, P5-10) into the SINGLE insert registry.
 *
 * WHY THIS FILE (integrator reconciliation):
 * ==========================================
 * FE-B originally shipped a parallel registry (`palette.ts` / `PALETTE_ENTRIES`)
 * plus standalone panel components. There is exactly ONE source of truth for the
 * insert palette — FE-A's `registry.ts` — so the integrator folds FE-B's blocks
 * into it here, the same way `defaults.ts` registers the structural blocks. The
 * `palette.ts` duplicate is removed.
 *
 * These blocks need more than a one-shot inline form: a local upload needs a
 * drag/drop/paste zone, the shared library and providers need network round-trips
 * with previews, code needs a language picker, math wants a live preview. So each
 * registers with a `panel` identifier (no `build`): InsertPalette opens the named
 * Svelte panel in a modal, the panel builds the node (via builders.ts) and hands
 * it back through `onInsert`, and the shared insert seam places it — preserving
 * the same one-undo / autosave / select-new-block / byte-stable contract as every
 * other insert.
 *
 * Icons are SVG path `d` strings (one path, drawn in a 0 0 24 24 viewBox), to
 * match the registry's icon contract used by the palette menu list.
 */

import { registerBlock } from './registry';

// ── Images (P5-4 local / P5-5 shared / P5-7+P5-8 providers) ───────────────────
// Grouped under "Media". Each opens a different acquisition panel but all emit a
// localized <img src="assets/…"> (the panels download/copy into the deck first),
// so the deck stays self-contained and offline-first (spec assets-and-media, principles-and-invariants).

registerBlock({
  id: 'image-local',
  label: 'Image (upload)',
  group: 'Media',
  // framed picture with a peak — the canonical "image" glyph
  icon: 'M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6',
  panel: 'ImageUploadZone',
});

registerBlock({
  id: 'image-shared',
  label: 'Shared library',
  group: 'Media',
  icon: 'M4 4h16v16H4zM4 9h16M9 9v11',
  panel: 'SharedLibrary',
});

registerBlock({
  id: 'image-provider',
  label: 'Search images',
  group: 'Media',
  icon: 'M10 4a6 6 0 104.47 10.03L20 19.5M10 4a6 6 0 010 12',
  panel: 'ProviderSearch',
});

// ── Code (P5-9) ───────────────────────────────────────────────────────────────
registerBlock({
  id: 'code',
  label: 'Code block',
  group: 'Code',
  icon: 'M9 8l-5 4 5 4M15 8l5 4-5 4',
  panel: 'CodeBlockPanel',
});

// ── Math (P5-10) ──────────────────────────────────────────────────────────────
registerBlock({
  id: 'math',
  label: 'Math (KaTeX)',
  group: 'Math',
  icon: 'M4 6h6l-4 12M14 8l6 8M20 8l-6 8',
  panel: 'MathBlockPanel',
});
