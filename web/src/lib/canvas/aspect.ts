/**
 * aspect.ts — Pure aspect-ratio → logical-size mapping + free-element reposition
 * math (P4-7, spec 05 "Scaling & resolution").
 *
 * WHY THIS EXISTS (spec 05 "Aspect-ratio change behavior"):
 * =========================================================
 * Slides are authored against a fixed LOGICAL canvas. Changing the aspect ratio
 * (e.g. 16:9 → 4:3) changes that canvas's width/height. Two consequences, both
 * spec 05:
 *
 *   1. STRUCTURED content reflows automatically — it is laid out with flex/grid
 *      RELATIVE to the canvas, so a smaller/larger canvas just re-wraps. Nothing
 *      to compute here (verified: layout uses no absolute logical coords).
 *   2. FREE elements are pinned to absolute logical coordinates that assumed the
 *      OLD canvas, so they can fall off-canvas or bunch up. Spec 05 says we must
 *      NOT silently move them — we FLAG them and OFFER a reposition. This module
 *      computes the suggested repositioned rects; the UI accepts/declines.
 *
 * Everything here is PURE (plain numbers, no DOM/store/model) → unit-testable and
 * usable from both the offer computation and tests. The model/DOM adapters live in
 * aspect-commands.ts; the reactive state lives in aspect.svelte.ts.
 */

/** A logical canvas size in logical pixels. */
export interface LogicalSize {
  width: number;
  height: number;
}

/**
 * A free element's logical rectangle: position (data-x/data-y) and OPTIONAL size
 * (data-w/data-h). Size is optional because a free element may rely on its content
 * for size; in that case we rescale only its position.
 */
export interface FreeRect {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * How to remap a free element from the old canvas to the new one.
 *   • 'proportional' — independent X/Y scaling: the element keeps the SAME
 *                      fractional position and fractional size of the canvas. May
 *                      distort its aspect (a square becomes a rectangle) but never
 *                      drifts off-canvas. This is the default offer.
 *   • 'uniform'      — scale size by the SMALLER axis factor (preserves the
 *                      element's own aspect ratio) while keeping its CENTRE at the
 *                      proportionally-scaled position. Better for images/logos.
 */
export type RepositionMode = 'proportional' | 'uniform';

/**
 * Aspect PRESETS (spec 05 table). The key is the canonical preset id; the value is
 * the absolute logical canvas size. These are an explicit table — NOT derived from
 * the ratio — because the chosen logical sizes are deliberate (e.g. 16:10 is
 * 1920×1200, not 1728×1080) to keep the coordinate numbers intuitive.
 */
export const ASPECT_PRESETS: Record<string, LogicalSize> = {
  '16:9': { width: 1920, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '16:10': { width: 1920, height: 1200 },
  '9:16': { width: 1080, height: 1920 }, // portrait
  '1:1': { width: 1080, height: 1080 },  // square
};

/** The default aspect when none is configured (spec 05). */
export const DEFAULT_ASPECT = '16:9';

/** Round to 2 decimals so derived coords stay clean (avoids 0.30000000004). */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Map an aspect descriptor to its logical canvas size.
 *
 * Accepts, in priority order:
 *   1. A known preset id ("16:9", "4:3", "16:10", "9:16") → the exact table value.
 *   2. Explicit dimensions "WxH" (e.g. "1600x900") → those numbers verbatim, so a
 *      Custom preset can carry absolute dims.
 *   3. A bare ratio "W:H" not in the table → derived size: the larger axis is
 *      anchored to 1080 (landscape) or the width to 1080 (portrait), preserving the
 *      ratio. Lets unusual ratios still produce a sane canvas.
 * Anything unparseable falls back to the 16:9 default rather than throwing — an
 * aspect change must never crash the editor.
 */
export function aspectToLogicalSize(aspect: string): LogicalSize {
  const key = aspect.trim();

  // 1. Known preset.
  if (key in ASPECT_PRESETS) return { ...ASPECT_PRESETS[key] };

  // 2. Explicit "WxH" dimensions.
  const dims = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(key);
  if (dims) {
    const w = parseFloat(dims[1]);
    const h = parseFloat(dims[2]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }

  // 3. Bare "W:H" ratio → derive, anchoring the canvas to a 1080 base dimension.
  const ratio = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(key);
  if (ratio) {
    const a = parseFloat(ratio[1]);
    const b = parseFloat(ratio[2]);
    if (a > 0 && b > 0) {
      if (a >= b) {
        // Landscape / square: height = 1080, width follows the ratio.
        return { width: round2((1080 * a) / b), height: 1080 };
      }
      // Portrait: width = 1080, height follows the ratio.
      return { width: 1080, height: round2((1080 * b) / a) };
    }
  }

  // 4. Unrecognised → safe default.
  return { ...ASPECT_PRESETS[DEFAULT_ASPECT] };
}

/**
 * Compute the suggested repositioned rect for a single free element when the
 * canvas changes from `oldSize` to `newSize`.
 *
 * Pure proportional rescale (spec 05 "offer to reposition/rescale"). See
 * {@link RepositionMode} for the two strategies. Size keys absent on input stay
 * absent on output (we never invent a size for a content-sized element).
 */
export function repositionFreeRect(
  rect: FreeRect,
  oldSize: LogicalSize,
  newSize: LogicalSize,
  mode: RepositionMode = 'proportional',
): FreeRect {
  const sx = newSize.width / oldSize.width;
  const sy = newSize.height / oldSize.height;

  if (mode === 'proportional') {
    const out: FreeRect = { x: round2(rect.x * sx), y: round2(rect.y * sy) };
    if (rect.w !== undefined) out.w = round2(rect.w * sx);
    if (rect.h !== undefined) out.h = round2(rect.h * sy);
    return out;
  }

  // 'uniform': preserve the element's own aspect ratio. Scale size by the smaller
  // factor and keep the element's CENTRE at the proportionally-scaled position so
  // it stays in the same region of the slide without distorting.
  const s = Math.min(sx, sy);
  const w = rect.w;
  const h = rect.h;
  // Centre in old coords (fall back to position when size is unknown).
  const cx = rect.x + (w ?? 0) / 2;
  const cy = rect.y + (h ?? 0) / 2;
  const ncx = cx * sx;
  const ncy = cy * sy;
  const nw = w !== undefined ? round2(w * s) : undefined;
  const nh = h !== undefined ? round2(h * s) : undefined;
  const out: FreeRect = {
    x: round2(ncx - (nw ?? 0) / 2),
    y: round2(ncy - (nh ?? 0) / 2),
  };
  if (nw !== undefined) out.w = nw;
  if (nh !== undefined) out.h = nh;
  return out;
}

// ── Dimension helpers for consumers (P4-7 plumbing) ─────────────────────────

/**
 * Return the logical canvas dimensions for the given aspect string, or the
 * default 1920×1080 when the string is absent or cannot be parsed.
 *
 * This is the safe, no-throw wrapper that application code (RevealFrame,
 * coords callers) should use. It delegates to `aspectToLogicalSize` which
 * handles presets, explicit "WxH" forms, and bare "W:H" ratios.
 *
 * WHY no-throw here:
 *   An aspect string comes from an external config file (config.toml). We must
 *   never crash the editor due to a typo in user configuration. Invalid strings
 *   silently fall back to the default and the editor remains usable.
 *
 * @example
 *   logicalDimensions()         // { width: 1920, height: 1080 } (default)
 *   logicalDimensions('4:3')    // { width: 1440, height: 1080 }
 *   logicalDimensions('1:1')    // { width: 1080, height: 1080 }
 *   logicalDimensions('3:2')    // { width: 1620, height: 1080 } (custom ratio)
 *   logicalDimensions('bogus')  // { width: 1920, height: 1080 } (fallback)
 */
export function logicalDimensions(aspect?: string): LogicalSize {
  if (!aspect) return { ...ASPECT_PRESETS[DEFAULT_ASPECT] };
  // aspectToLogicalSize already never throws (falls back to default internally).
  return aspectToLogicalSize(aspect);
}

/**
 * Reverse map a logical size back to an aspect descriptor (load-time seeding).
 *
 * On deck load the integrator reads the reveal init width/height (the spec-05
 * source of truth) and needs the matching aspect id to show in the picker. If the
 * size matches a known preset exactly we return that preset id; otherwise we return
 * an explicit "WxH" custom descriptor (which aspectToLogicalSize round-trips).
 */
export function logicalSizeToAspect(size: LogicalSize): string {
  for (const [id, preset] of Object.entries(ASPECT_PRESETS)) {
    if (preset.width === size.width && preset.height === size.height) return id;
  }
  return `${size.width}x${size.height}`;
}

/** A free element flagged for the reposition offer (current + suggested rects). */
export interface RepositionOffer {
  eid: string;
  current: FreeRect;
  suggested: FreeRect;
}

/**
 * Build the full set of reposition offers for every free element. Elements whose
 * suggested rect is identical to the current one (e.g. an element pinned at the
 * origin under a pure stretch) are still included so the UI can show the complete
 * "these N free elements were affected" list — the spec wants them FLAGGED, and
 * the user may still want to confirm. Callers that prefer to hide no-ops can
 * filter on `current`≠`suggested`.
 */
export function computeRepositionOffers(
  freeRects: { eid: string; rect: FreeRect }[],
  oldSize: LogicalSize,
  newSize: LogicalSize,
  mode: RepositionMode = 'proportional',
): RepositionOffer[] {
  return freeRects.map(({ eid, rect }) => ({
    eid,
    current: rect,
    suggested: repositionFreeRect(rect, oldSize, newSize, mode),
  }));
}
