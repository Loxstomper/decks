/**
 * eidIndex.ts — Locate a `data-eid` occurrence inside an HTML source string (P9-6).
 *
 * WHY THIS EXISTS (spec canvas-interaction "Source ↔ selection sync"):
 * ===================================================
 * Jump-to-source is a *coarse, attribute-anchored* scroll — not a full source
 * map. When an element is selected on the canvas/outline and the source pane is
 * visible, we reveal that element's `data-eid="…"` occurrence in the CodeMirror
 * document. The only computation needed is "where does `data-eid="<eid>"` start
 * in the document string?" — which is a pure string search, isolated here so it
 * is unit-testable without a CodeMirror instance.
 *
 * Rules:
 *   - Match `data-eid="<eid>"` or `data-eid='<eid>'` (reveal/saved HTML uses
 *     double quotes, but we tolerate either).
 *   - Return the document index of the start of the match (the `d` of
 *     `data-eid`), or null when the eid is empty or not present (un-stamped /
 *     passthrough element → caller no-ops, never scrolls).
 *   - First occurrence wins; eids are unique by contract, so there is only one.
 */

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Index (0-based, into `source`) of the `data-eid="<eid>"` occurrence, or null
 * when `eid` is empty/whitespace or not found.
 */
export function findEidIndex(source: string, eid: string | null | undefined): number | null {
  if (!source || !eid || !eid.trim()) return null;
  const re = new RegExp(`data-eid=["']${escapeRegExp(eid)}["']`);
  const m = re.exec(source);
  return m ? m.index : null;
}
