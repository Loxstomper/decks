/**
 * blocks/table.ts — Table block builder (P5-11 / spec layout-vocabulary "Table").
 *
 * Builds a standard `<table><thead?><tbody>` subtree. Every cell holds a text
 * node so each is individually editable via the Phase-2 contenteditable surface
 * (th/td/tr/thead/tbody are all leaves → they receive eids on insert).
 *
 * Sane defaults: a header row plus two body rows of three columns. The palette
 * lets the user override rows/cols before inserting.
 */

import { createElement, createText, appendChild } from '$lib/model/edit';
import type { ElementNode } from '$lib/model/types';

export interface TableSpec {
  /** Number of BODY rows (excludes the optional header row). */
  rows?: number;
  /** Number of columns. */
  cols?: number;
  /** Emit a `<thead>` header row. */
  header?: boolean;
}

/** Clamp a possibly-NaN user value into a sane integer range. */
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Build one `<tr>` of `cells`, each cell created by `make(index)`. */
function buildRow(cols: number, make: (col: number) => ElementNode): ElementNode {
  const tr = createElement('tr');
  for (let c = 0; c < cols; c++) appendChild(tr, make(c));
  return tr;
}

/**
 * Build an editable table. Defaults: 1 header row + 2 body rows × 3 cols.
 * Rows/cols are clamped to 1..20 so a stray input can't generate a huge table.
 */
export function buildTable(spec: TableSpec = {}): ElementNode {
  const rows = clampInt(spec.rows, 1, 20, 2);
  const cols = clampInt(spec.cols, 1, 20, 3);
  const header = spec.header ?? true;

  const table = createElement('table');

  if (header) {
    const thead = createElement('thead');
    appendChild(
      thead,
      buildRow(cols, (c) => {
        const th = createElement('th');
        appendChild(th, createText(`Column ${c + 1}`));
        return th;
      }),
    );
    appendChild(table, thead);
  }

  const tbody = createElement('tbody');
  for (let r = 0; r < rows; r++) {
    appendChild(
      tbody,
      buildRow(cols, () => {
        const td = createElement('td');
        appendChild(td, createText('Cell'));
        return td;
      }),
    );
  }
  appendChild(table, tbody);

  return table;
}
