/**
 * blocks/shape.ts — Shape / line / arrow builder (P5-12 / spec layout-vocabulary "Shape / line / arrow").
 *
 * Shapes are inline `<svg>` elements. They are inserted as FREE elements
 * (data-free + data-x/y/w/h in logical coords) so the Phase-4 resize/drag
 * machinery applies directly — the user grabs the handles and the svg viewBox
 * scales to fill its box (preserveAspectRatio="none").
 *
 * WHY currentColor + no fill for outlines:
 *   The deck owns styling (spec layout-vocabulary ownership split). Using `currentColor`/stroke
 *   means the shape adopts the slide's text colour and is themeable via CSS the
 *   user/Claude Code add, without the editor baking in a palette.
 *
 * WHY the arrowhead is an inline <polygon> (not an SVG <marker>):
 *   A <marker> needs a document-unique id; a pure, deterministic builder cannot
 *   mint one without breaking byte-stable round-trips. Drawing the head as an
 *   explicit polygon keeps the builder pure and id-free.
 *
 * All coordinates are LOGICAL (1920×1080 canvas, spec scaling-and-resolution). Defaults centre the
 * shape so it lands visibly on the slide.
 */

import { createElement, appendChild } from '$lib/model/edit';
import type { ElementNode } from '$lib/model/types';

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

/** Logical canvas size (spec scaling-and-resolution) used to centre the default shape rect. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

/** Default box for area shapes (square) vs. linear shapes (wide + short). */
function defaultRect(kind: ShapeKind): { x: number; y: number; w: number; h: number } {
  if (kind === 'line' || kind === 'arrow') {
    const w = 400;
    const h = 100;
    return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h };
  }
  const w = 400;
  const h = 400;
  return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h };
}

/**
 * Build the inner SVG child element for a shape kind, drawn in a 0..100 viewBox.
 * stroke-width is in viewBox units; preserveAspectRatio="none" on the parent
 * stretches it to the element's logical box.
 */
function buildShapeChild(kind: ShapeKind): ElementNode {
  switch (kind) {
    case 'rect':
      return createElement('rect', {
        x: '2', y: '2', width: '96', height: '96',
        fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
      });
    case 'ellipse':
      return createElement('ellipse', {
        cx: '50', cy: '50', rx: '48', ry: '48',
        fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
      });
    case 'line':
      return createElement('line', {
        x1: '2', y1: '50', x2: '98', y2: '50',
        stroke: 'currentColor', 'stroke-width': '2',
      });
    case 'arrow':
      // Shaft stops short of the head so they don't overlap awkwardly.
      return createElement('line', {
        x1: '2', y1: '50', x2: '88', y2: '50',
        stroke: 'currentColor', 'stroke-width': '2',
      });
  }
}

/**
 * Build a free-positioned SVG shape. The returned `<svg>` carries data-free and
 * a centred default rect so it is immediately selectable/resizable (Phase 4).
 */
export function buildShape(kind: ShapeKind): ElementNode {
  const rect = defaultRect(kind);
  const svg = createElement('svg', {
    viewBox: '0 0 100 100',
    // Non-uniform scale: the shape fills whatever box the user resizes it to.
    preserveAspectRatio: 'none',
    // Free escape-hatch (boolean attr) + logical geometry (spec layout-vocabulary / spec canvas-interaction).
    'data-free': null,
    'data-x': String(rect.x),
    'data-y': String(rect.y),
    'data-w': String(rect.w),
    'data-h': String(rect.h),
  });

  appendChild(svg, buildShapeChild(kind));

  // Arrow: add the triangular head at the shaft's end (filled with currentColor).
  if (kind === 'arrow') {
    appendChild(
      svg,
      createElement('polygon', {
        points: '88,42 98,50 88,58',
        fill: 'currentColor',
      }),
    );
  }

  return svg;
}
