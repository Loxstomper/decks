/**
 * blocks/qr.ts — Register the QR code block type (P19) into the SINGLE insert
 * registry.
 *
 * Like the chart block, a QR needs more than a one-shot inline form: the user
 * supplies a payload (URL/text) AND picks an error-correction level + colours.
 * So it registers with a `panel` identifier (no `build`): the palette opens
 * `QrBlockPanel` in a modal, the panel builds the <div data-qr> node (via
 * builders.buildQrBlock) and hands it back through `onInsert`, and the shared
 * insert seam places it — preserving the one-undo / autosave / select-new-block
 * / byte-stable contract every other insert follows.
 *
 * The emitted node is offline-first (spec 12): the QR generator + plugin are
 * vendored into the deck by the scaffold (P19-1); the markup carries zero
 * external URLs.
 *
 * Icon is an SVG path `d` string (drawn in a 0 0 24 24 viewBox) — a simplified
 * QR glyph (two finder squares + a few modules) — to match the registry's icon
 * contract.
 */

import { registerBlock } from './registry';

registerBlock({
  id: 'qr',
  label: 'QR code',
  group: 'QR',
  // Two finder squares (top-left, top-right) + a bottom-left square + a couple
  // of data modules — a recognisable QR glyph.
  icon: 'M3 3h6v6H3V3M5 5v2h2V5H5M15 3h6v6h-6V3M17 5v2h2V5h-2M3 15h6v6H3v-6M5 17v2h2v-2H5M13 13h3v3h-3v-3M19 13h2v2h-2v-2M17 18h4v3h-4v-3',
  // FREE placement: a QR is a fixed-size graphic the user positions on the slide
  // (like a shape/image/embed), so the insert seam drops it into the slide section
  // with its own data-free coords — never as a flow child that overflows a layout
  // slot off the bottom edge (buildQrBlock emits the data-free + coords).
  placement: 'free',
  panel: 'QrBlockPanel',
});
