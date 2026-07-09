/**
 * panes.ts — Workspace-level pane layout persistence (P9-3/4/5).
 *
 * WHY THIS EXISTS (spec canvas-interaction "Collapsible & resizable chrome"):
 * ==========================================================
 * The editor shell is the user's workspace, so its pane sizes and collapse
 * state must survive a reload. One open workspace ⇒ a single localStorage key
 * holds the whole layout snapshot. This module is the pure source of truth for:
 *   - the layout shape ({@link PaneState}),
 *   - the min/max bounds + defaults for each draggable boundary,
 *   - clamping a raw value into its bounds,
 *   - (de)serializing the snapshot to/from localStorage, tolerating absent or
 *     corrupt storage (returns defaults; never throws).
 *
 * Kept DOM-free and side-effect-light so it is unit-testable headlessly. The
 * load/save helpers no-op gracefully when `localStorage` is unavailable (SSR,
 * private-mode quota errors), so callers never need to guard.
 */

/** Persisted layout snapshot for the three-zone editor shell. */
export interface PaneState {
  /** Left navigator width in CSS px (its last expanded width). */
  navWidth: number;
  /** Right panel width in CSS px (its last expanded width). */
  rightWidth: number;
  /** Outline/Properties height in CSS px (top of the right panel split). */
  rightTopHeight: number;
  /** Navigator collapsed to a rail. */
  navCollapsed: boolean;
  /** Right panel collapsed to a rail. */
  rightCollapsed: boolean;
  /** Source pane collapsed to just its header. */
  sourceCollapsed: boolean;
}

/** Inclusive bound + default for a single draggable dimension. */
export interface Bound {
  min: number;
  max: number;
  default: number;
}

/**
 * Min/max/default for each resizable boundary. The drag handlers clamp against
 * these; `rightTopHeight.max` is a generous soft cap — the live drag also
 * clamps it against the actual available panel height so the source pane keeps
 * a usable minimum.
 */
export const PANE_BOUNDS: {
  navWidth: Bound;
  rightWidth: Bound;
  rightTopHeight: Bound;
} = {
  navWidth: { min: 140, max: 500, default: 220 },
  rightWidth: { min: 200, max: 700, default: 380 },
  rightTopHeight: { min: 100, max: 2000, default: 300 },
};

/** The width (px) a collapsed side panel occupies as a rail. */
export const RAIL_WIDTH = 28;

/** localStorage key — versioned so a future schema change can invalidate cleanly. */
export const PANE_STORAGE_KEY = 'decks.paneLayout.v1';

/** Fresh defaults for a workspace that has never been customised. */
export function defaultPaneState(): PaneState {
  return {
    navWidth: PANE_BOUNDS.navWidth.default,
    rightWidth: PANE_BOUNDS.rightWidth.default,
    rightTopHeight: PANE_BOUNDS.rightTopHeight.default,
    navCollapsed: false,
    rightCollapsed: false,
    sourceCollapsed: false,
  };
}

/** Clamp `value` into `[bound.min, bound.max]`. Non-finite → bound.default. */
export function clamp(value: number, bound: Bound): number {
  if (!Number.isFinite(value)) return bound.default;
  return Math.min(bound.max, Math.max(bound.min, value));
}

/**
 * Coerce an arbitrary parsed object into a valid {@link PaneState}, clamping
 * numbers into bounds and falling back to defaults for missing/invalid fields.
 * Pure: never reads storage. Useful directly in tests.
 */
export function normalizePaneState(raw: unknown): PaneState {
  const d = defaultPaneState();
  if (raw === null || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;

  const num = (v: unknown, bound: Bound): number =>
    typeof v === 'number' ? clamp(v, bound) : bound.default;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;

  return {
    navWidth: num(o.navWidth, PANE_BOUNDS.navWidth),
    rightWidth: num(o.rightWidth, PANE_BOUNDS.rightWidth),
    rightTopHeight: num(o.rightTopHeight, PANE_BOUNDS.rightTopHeight),
    navCollapsed: bool(o.navCollapsed, d.navCollapsed),
    rightCollapsed: bool(o.rightCollapsed, d.rightCollapsed),
    sourceCollapsed: bool(o.sourceCollapsed, d.sourceCollapsed),
  };
}

/** Best-effort handle to localStorage (undefined when unavailable). */
function storage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    // Accessing localStorage can throw (e.g. blocked cookies). Treat as absent.
    return undefined;
  }
}

/**
 * Load the persisted layout. Returns defaults when storage is absent, empty, or
 * holds corrupt JSON. Never throws.
 */
export function loadPaneState(): PaneState {
  const s = storage();
  if (!s) return defaultPaneState();
  try {
    const raw = s.getItem(PANE_STORAGE_KEY);
    if (!raw) return defaultPaneState();
    return normalizePaneState(JSON.parse(raw));
  } catch {
    return defaultPaneState();
  }
}

/** Persist the layout snapshot. Best-effort; swallows quota/serialization errors. */
export function savePaneState(state: PaneState): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PANE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or serialization failure — non-fatal, layout is a convenience */
  }
}
