/**
 * grid.svelte.ts — Snap-to-grid toggle + spacing store (P3-8 / spec 04).
 *
 * WHY THIS EXISTS (spec 04 "Snap-to-grid: optional grid … with toggle"):
 * ======================================================================
 * The grid is a single piece of editor-wide UI state: a toggle (on/off) and a
 * spacing in LOGICAL units (default 8). Both the grid OVERLAY renderer
 * (GridOverlay.svelte) and the drag/nudge SNAPPING math read it, so it lives in
 * one module-level `$state` store rather than being threaded as props.
 *
 * `effectiveSize` is the value callers pass to snapToGrid(): the spacing when the
 * grid is on, or 0 (meaning "no snap") when off — so a single getter encodes the
 * whole "snap or not" decision.
 */

import { DEFAULT_GRID_SIZE } from './snap-grid.ts';

class GridStore {
  /** Whether snapping + the grid overlay are active. Off by default (opt-in). */
  enabled = $state(false);
  /** Grid spacing in LOGICAL units (spec 04 default 8). */
  size = $state(DEFAULT_GRID_SIZE);
  /** Whether to draw the visual grid overlay when enabled. */
  showOverlay = $state(true);

  /** Flip the grid on/off (wired to a toolbar button / hotkey by the integrator). */
  toggle(): void {
    this.enabled = !this.enabled;
  }

  /** Set the grid spacing, clamped to a sane minimum of 1 logical unit. */
  setSize(size: number): void {
    if (Number.isFinite(size) && size >= 1) this.size = size;
  }

  /**
   * The grid size to feed into snapToGrid(): the configured spacing when enabled,
   * or 0 when disabled (snapToGrid treats 0 as "pass through unchanged").
   */
  get effectiveSize(): number {
    return this.enabled ? this.size : 0;
  }
}

/** Singleton — one editor, one grid setting. */
export const gridStore = new GridStore();
