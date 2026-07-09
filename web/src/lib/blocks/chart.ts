/**
 * blocks/chart.ts — Register the Chart block type (P17-15) into the SINGLE
 * insert registry.
 *
 * Like the code / math blocks, a chart needs more than a one-shot inline form: the
 * user picks a chart type AND edits a JSON data/options config with validation
 * feedback. So it registers with a `panel` identifier (no `build`): the palette
 * opens `ChartBlockPanel` in a modal, the panel builds the <canvas> node (via
 * builders.buildChartBlock) and hands it back through `onInsert`, and the shared
 * insert seam places it — preserving the one-undo / autosave / select-new-block /
 * byte-stable contract every other insert follows.
 *
 * The emitted node is offline-first (spec principles-and-invariants): Chart.js + the chart plugin are
 * vendored into the deck by the scaffold (Lane GO / P17-14); the markup carries
 * zero external URLs.
 *
 * Icon is an SVG path `d` string (one path, drawn in a 0 0 24 24 viewBox) — a
 * simple bar-chart glyph — to match the registry's icon contract.
 */

import { registerBlock } from './registry';

registerBlock({
  id: 'chart',
  label: 'Chart',
  group: 'Chart',
  // Three ascending bars sitting on an L-shaped axis — the canonical chart glyph.
  icon: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-7',
  panel: 'ChartBlockPanel',
});
