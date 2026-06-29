/**
 * blocks/defaults.ts — Register Lane FE-A's structural block types (P5-2/11/12/13).
 *
 * Side-effect module: importing it registers the text / table / shape / embed
 * blocks into the palette registry. The `blocks/index.ts` barrel imports this,
 * so anything that imports `$lib/blocks` gets the defaults. FE-B registers their
 * blocks the same way from their own module (see types.ts REGISTRY CONTRACT).
 *
 * Icons are SVG path `d` strings drawn in a 0 0 24 24 viewBox by the palette.
 */

import { registerBlock } from './registry';
import { buildHeading, buildParagraph, buildList } from './text';
import { buildTable } from './table';
import { buildShape } from './shape';
import { buildEmbed } from './embed';
import type { BuildArgs } from './types';

/** Coerce a possibly-undefined BuildArgs value to a trimmed string. */
function argStr(args: BuildArgs | undefined, key: string): string {
  const v = args?.[key];
  return v === undefined || v === null ? '' : String(v);
}

/** Coerce a BuildArgs value to a number, or undefined if not parseable. */
function argNum(args: BuildArgs | undefined, key: string): number | undefined {
  const v = args?.[key];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── Text (P5-2) ─────────────────────────────────────────────────────────────
registerBlock({
  id: 'text-heading',
  label: 'Heading',
  group: 'Text',
  icon: 'M6 4v16M18 4v16M6 12h12',
  build: () => buildHeading('Heading', 2),
});
registerBlock({
  id: 'text-subheading',
  label: 'Subheading',
  group: 'Text',
  icon: 'M7 6v12M17 6v12M7 12h10',
  build: () => buildHeading('Subheading', 3),
});
registerBlock({
  id: 'text-paragraph',
  label: 'Paragraph',
  group: 'Text',
  icon: 'M4 6h16M4 12h16M4 18h10',
  build: () => buildParagraph(),
});
registerBlock({
  id: 'text-list',
  label: 'Bullet list',
  group: 'Text',
  icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  build: () => buildList(undefined, false),
});
registerBlock({
  id: 'text-list-ordered',
  label: 'Numbered list',
  group: 'Text',
  icon: 'M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2',
  build: () => buildList(undefined, true),
});

// ── Table (P5-11) ─────────────────────────────────────────────────────────────
registerBlock({
  id: 'table',
  label: 'Table',
  group: 'Table',
  icon: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  fields: [
    { name: 'rows', label: 'Rows', type: 'number', default: 2, placeholder: '2' },
    { name: 'cols', label: 'Columns', type: 'number', default: 3, placeholder: '3' },
  ],
  build: (args) => buildTable({ rows: argNum(args, 'rows'), cols: argNum(args, 'cols') }),
});

// ── Shapes (P5-12) ────────────────────────────────────────────────────────────
registerBlock({
  id: 'shape-rect',
  label: 'Rectangle',
  group: 'Shape',
  icon: 'M4 6h16v12H4z',
  placement: 'free',
  build: () => buildShape('rect'),
});
registerBlock({
  id: 'shape-ellipse',
  label: 'Ellipse',
  group: 'Shape',
  icon: 'M12 5a7 7 0 100 14 7 7 0 000-14z',
  placement: 'free',
  build: () => buildShape('ellipse'),
});
registerBlock({
  id: 'shape-line',
  label: 'Line',
  group: 'Shape',
  icon: 'M4 20L20 4',
  placement: 'free',
  build: () => buildShape('line'),
});
registerBlock({
  id: 'shape-arrow',
  label: 'Arrow',
  group: 'Shape',
  icon: 'M4 12h13M13 6l6 6-6 6',
  placement: 'free',
  build: () => buildShape('arrow'),
});

// ── Embed (P5-13) ─────────────────────────────────────────────────────────────
registerBlock({
  id: 'embed-iframe',
  label: 'Embed (iframe)',
  group: 'Embed',
  icon: 'M4 5h16v14H4zM10 9l5 3-5 3z',
  placement: 'free',
  fields: [
    {
      name: 'url',
      label: 'Embed URL',
      type: 'url',
      placeholder: 'https://www.youtube.com/embed/…',
      required: true,
    },
  ],
  build: (args) => buildEmbed(argStr(args, 'url')),
});
