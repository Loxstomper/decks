import { describe, it, expect, beforeEach } from 'vitest';
import {
  PANE_BOUNDS,
  PANE_STORAGE_KEY,
  clamp,
  defaultPaneState,
  normalizePaneState,
  loadPaneState,
  savePaneState,
} from './panes';

describe('clamp', () => {
  it('clamps below min and above max', () => {
    expect(clamp(10, PANE_BOUNDS.navWidth)).toBe(PANE_BOUNDS.navWidth.min);
    expect(clamp(9999, PANE_BOUNDS.navWidth)).toBe(PANE_BOUNDS.navWidth.max);
  });
  it('passes through in-range values', () => {
    expect(clamp(300, PANE_BOUNDS.navWidth)).toBe(300);
  });
  it('falls back to default for non-finite input', () => {
    expect(clamp(NaN, PANE_BOUNDS.rightWidth)).toBe(PANE_BOUNDS.rightWidth.default);
    expect(clamp(Infinity, PANE_BOUNDS.rightWidth)).toBe(PANE_BOUNDS.rightWidth.default);
  });
});

describe('normalizePaneState', () => {
  it('returns defaults for non-object input', () => {
    expect(normalizePaneState(null)).toEqual(defaultPaneState());
    expect(normalizePaneState(42)).toEqual(defaultPaneState());
    expect(normalizePaneState('x')).toEqual(defaultPaneState());
  });
  it('clamps numeric fields into bounds', () => {
    const s = normalizePaneState({ navWidth: 5, rightWidth: 5000, rightTopHeight: 1 });
    expect(s.navWidth).toBe(PANE_BOUNDS.navWidth.min);
    expect(s.rightWidth).toBe(PANE_BOUNDS.rightWidth.max);
    expect(s.rightTopHeight).toBe(PANE_BOUNDS.rightTopHeight.min);
  });
  it('preserves valid booleans and falls back otherwise', () => {
    const s = normalizePaneState({ navCollapsed: true, rightCollapsed: 'yes' });
    expect(s.navCollapsed).toBe(true);
    expect(s.rightCollapsed).toBe(false); // invalid type → default
    expect(s.sourceCollapsed).toBe(false);
  });
});

/** Minimal Map-backed localStorage stub (the vitest env is 'node', no DOM). */
function installStorage(): void {
  const map = new Map<string, string>();
  const stub: Partial<Storage> = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = stub as Storage;
}

describe('persistence round-trip', () => {
  beforeEach(() => installStorage());

  it('loads defaults when storage is empty', () => {
    expect(loadPaneState()).toEqual(defaultPaneState());
  });

  it('saves and reloads a snapshot', () => {
    const snap = {
      ...defaultPaneState(),
      navWidth: 260,
      rightCollapsed: true,
      sourceCollapsed: true,
    };
    savePaneState(snap);
    expect(loadPaneState()).toEqual(snap);
  });

  it('returns defaults when storage holds corrupt JSON', () => {
    localStorage.setItem(PANE_STORAGE_KEY, '{not json');
    expect(loadPaneState()).toEqual(defaultPaneState());
  });
});
