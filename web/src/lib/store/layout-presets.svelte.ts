/**
 * layout-presets.svelte.ts — Reactive cache for GET /api/templates presets (P14-6).
 *
 * Fetches once and shares the result across all components. Call `ensurePresets()`
 * early (e.g. in App.svelte onMount) so the list is ready by the time a user
 * opens a picker or context menu.
 */

export interface LayoutPreset {
  name: string;
  label: string;
  html: string;
}

let _presets = $state<LayoutPreset[]>([]);
let _loading = $state(false);
let _fetched = false;

/**
 * Trigger a one-time fetch of /api/templates. Safe to call multiple times —
 * subsequent calls are no-ops once the fetch is underway.
 */
export function ensurePresets(): void {
  if (_fetched) return;
  _fetched = true;
  _loading = true;
  fetch('/api/templates')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<LayoutPreset[]>;
    })
    .then((data) => {
      _presets = data;
    })
    .catch(() => {
      // Leave _presets empty; UIs can fall back to plain-blank.
      _fetched = false; // allow retry
    })
    .finally(() => {
      _loading = false;
    });
}

/** Reactive list of presets (empty array until loaded). */
export const layoutPresets = {
  get value(): LayoutPreset[] {
    return _presets;
  },
};

/** True while the initial fetch is in flight. */
export const layoutPresetsLoading = {
  get value(): boolean {
    return _loading;
  },
};
