/**
 * alignment-guides.ts — Smart alignment guides for free-element drag (P4-4).
 *
 * WHY THIS EXISTS (spec 04 "Smart guides"):
 * ==========================================
 * While dragging a `data-free` element, snap lines appear when the element's
 * edges or center align with sibling edges/centers OR the slide center/edges.
 * Snapping nudges the element to land exactly on the guide within `threshold`
 * logical units, giving effortless pixel-perfect placement.
 *
 * Pure function: no DOM, no side effects → unit-testable headlessly.
 * All coordinates and thresholds are in LOGICAL space (spec 04, spec 05).
 *
 * Guide anatomy:
 *   axis='x' → a VERTICAL line rendered at x=position (shows horizontal alignment)
 *   axis='y' → a HORIZONTAL line rendered at y=position (shows vertical alignment)
 *
 * Snap priority: on each axis the candidate with the smallest absolute
 * displacement wins. Ties (same displacement, multiple alignment targets) cause
 * multiple guide lines to render simultaneously — this happens when two elements
 * of equal width have both left edges AND right edges aligned at the same time.
 */

import type { Rect } from './overlay-geometry.ts';

/** A guide line to render over the canvas. */
export interface AlignGuide {
  /**
   * 'x': a VERTICAL line at this x position (shows horizontal / left-right alignment).
   * 'y': a HORIZONTAL line at this y position (shows vertical / top-bottom alignment).
   */
  axis: 'x' | 'y';
  /** Position in logical coordinates. */
  position: number;
}

/** Result of guide computation: the (possibly snapped) rect and active guides. */
export interface GuidesResult {
  /** movingRect nudged to the nearest snap within threshold (or unchanged if none). */
  snappedRect: Rect;
  /** Guide lines to render — only lines that triggered snapping are included. */
  guides: AlignGuide[];
}

/**
 * Compute smart alignment guides for a dragging free element.
 *
 * Checks all combinations of (moving edge × sibling/canvas target) on each axis:
 *   • edge-to-edge:   left↔left, right↔right, top↔top, bottom↔bottom
 *   • edge-to-center: left/right↔sibling-center, top/bottom↔sibling-center
 *   • center-to-edge: center↔sibling-left/right, center↔sibling-top/bottom
 *   • center-to-center: cx↔cx, cy↔cy
 *   • slide center:   any moving edge ↔ canvas center (960, 540 for 16:9)
 *   • slide edges:    any moving edge ↔ canvas edges (0/W, 0/H)
 *
 * On each axis the snap with the SMALLEST absolute displacement (if ≤ threshold)
 * wins. When multiple (movingEdge, target) pairs produce the same winning
 * displacement the target position of each is recorded as a guide line.
 *
 * @param movingRect  Current logical rect of the dragging element (pre-snap).
 * @param otherRects  Logical rects of OTHER free elements on the slide.
 * @param canvasSize  Logical canvas dimensions (for slide center + edge alignment).
 * @param threshold   Snap distance in logical units (inclusive, e.g. 8).
 */
export function computeGuides(
  movingRect: Rect,
  otherRects: Rect[],
  canvasSize: { width: number; height: number },
  threshold: number,
): GuidesResult {
  const { left, top, width, height } = movingRect;
  const right = left + width;
  const cx = left + width / 2;
  const bottom = top + height;
  const cy = top + height / 2;

  // The three x-positions and three y-positions the moving rect exposes.
  // Each can snap to any target, producing delta = target - movingEdge.
  const mxEdges = [left, cx, right];
  const myEdges = [top, cy, bottom];

  // Snap candidate: applying `delta` to the rect's x (or y) offset makes
  // `movingEdge` land on `target`, revealing a guide at `target`.
  interface Candidate {
    target: number;
    delta: number;
  }

  const xCandidates: Candidate[] = [];
  const yCandidates: Candidate[] = [];

  /** Push all (movingEdge × target) combinations for the x-axis. */
  function addXTargets(targets: number[]): void {
    for (const t of targets) {
      for (const m of mxEdges) {
        xCandidates.push({ target: t, delta: t - m });
      }
    }
  }

  /** Push all (movingEdge × target) combinations for the y-axis. */
  function addYTargets(targets: number[]): void {
    for (const t of targets) {
      for (const m of myEdges) {
        yCandidates.push({ target: t, delta: t - m });
      }
    }
  }

  // Slide edges and center (spec 04: "slide center and optionally slide edges").
  addXTargets([0, canvasSize.width / 2, canvasSize.width]);
  addYTargets([0, canvasSize.height / 2, canvasSize.height]);

  // Sibling rects: left edge, center, right edge (and same for y-axis).
  for (const r of otherRects) {
    addXTargets([r.left, r.left + r.width / 2, r.left + r.width]);
    addYTargets([r.top, r.top + r.height / 2, r.top + r.height]);
  }

  // ── Find the best snap per axis ───────────────────────────────────────────

  /**
   * Among all candidates, pick the one(s) with the smallest absolute delta that
   * falls within `threshold`. Returns null when nothing qualifies.
   *
   * All candidates that share the exact winning delta are returned — their target
   * positions become active guide lines (multiple can coincide, e.g. same-width
   * elements snapping left↔left and right↔right simultaneously).
   */
  function bestSnap(candidates: Candidate[]): { delta: number; targets: number[] } | null {
    // Find the minimum |delta| within threshold.
    let bestAbs = threshold + 1; // sentinel: one unit past threshold means "no snap"
    let bestDelta = 0;

    for (const { delta } of candidates) {
      const abs = Math.abs(delta);
      if (abs <= threshold && abs < bestAbs) {
        bestAbs = abs;
        bestDelta = delta;
      }
    }

    if (bestAbs > threshold) return null; // nothing close enough

    // Collect all unique target positions that produced this exact winning delta.
    const targets = [
      ...new Set(
        candidates.filter((c) => c.delta === bestDelta).map((c) => c.target),
      ),
    ];

    return { delta: bestDelta, targets };
  }

  const xSnap = bestSnap(xCandidates);
  const ySnap = bestSnap(yCandidates);

  const snappedRect: Rect = {
    left: left + (xSnap?.delta ?? 0),
    top: top + (ySnap?.delta ?? 0),
    width,
    height,
  };

  const guides: AlignGuide[] = [
    ...(xSnap?.targets.map((pos) => ({ axis: 'x' as const, position: pos })) ?? []),
    ...(ySnap?.targets.map((pos) => ({ axis: 'y' as const, position: pos })) ?? []),
  ];

  return { snappedRect, guides };
}

/** Default snap threshold in logical units for smart guides. */
export const DEFAULT_GUIDE_THRESHOLD = 8;
