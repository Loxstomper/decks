/**
 * conflict.ts — Turn-taking decision + line diff (P8-6 / spec 11 §4-5, spec 02).
 *
 * WHY THIS EXISTS:
 * ================
 * v1 concurrency is "turn-taking + reload" (spec 02 "Concurrency"): the human
 * edits in memory, Claude Code edits the file on disk. When an external write
 * arrives via SSE the editor must decide what to do WITHOUT a true merge:
 *
 *   • echo     — the disk bytes already equal our in-memory source. This is the
 *                fsnotify echo of OUR OWN save; just resync the baseline.
 *   • adopt    — we have NO unsaved edits, so the external version is the new
 *                truth: reload it and highlight what changed (P8-7).
 *   • conflict — we DO have unsaved edits; adopting would clobber them. Surface a
 *                prompt (keep mine / take theirs / view diff) and let the user
 *                decide (spec 11 "prompt on conflict"; spec 02 "dirty guard").
 *
 * Keeping this decision PURE (no store, no DOM, no fetch) makes the core
 * turn-taking rule unit-testable (conflict.test.ts) independently of the Svelte
 * store that drives it.
 */

/** The three ways a deck conflict can be resolved by the user (P8-6). */
export type ConflictResolution = 'keep-mine' | 'take-theirs' | 'view-diff';

/** The decision produced for an incoming external change. */
export type ExternalChangeDecision =
  | { kind: 'echo' }
  | { kind: 'adopt'; html: string }
  | { kind: 'conflict'; html: string };

/**
 * Decide how to handle an external (on-disk) change, given:
 *   • current  — the editor's in-memory source (what the user sees),
 *   • saved    — the last bytes we know are persisted (our baseline),
 *   • incoming — the freshly-read disk bytes.
 *
 * Rules (order matters):
 *   1. incoming === current → echo (no real divergence; our own save bouncing
 *      back, or an idempotent external write that matches us).
 *   2. current !== saved (DIRTY) → conflict (we must not destroy local edits).
 *   3. otherwise (clean) → adopt the incoming bytes.
 */
export function decideExternalChange(args: {
  current: string;
  saved: string;
  incoming: string;
}): ExternalChangeDecision {
  const { current, saved, incoming } = args;
  if (incoming === current) return { kind: 'echo' };
  const dirty = current !== saved;
  if (dirty) return { kind: 'conflict', html: incoming };
  return { kind: 'adopt', html: incoming };
}

// ─── Line diff for the "view diff" affordance ───────────────────────────────

/** One line of a unified-style diff. */
export interface DiffLine {
  /** 'eq' unchanged, 'del' only in mine, 'add' only in theirs. */
  tag: 'eq' | 'del' | 'add';
  text: string;
}

/**
 * Compute a minimal line-level diff between `mine` and `theirs` via a classic
 * Longest-Common-Subsequence walk. Used by the conflict prompt's "view diff"
 * view so the user can see exactly what Claude changed before choosing a side.
 *
 * Pure and deterministic. O(n·m) in line counts — deck files are small (a few
 * hundred lines), so this is comfortably fast for the interactive prompt.
 */
export function lineDiff(mine: string, theirs: string): DiffLine[] {
  const a = mine.split('\n');
  const b = theirs.split('\n');
  const n = a.length;
  const m = b.length;

  // LCS length table: lcs[i][j] = LCS length of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Backtrack to emit the edit script.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ tag: 'eq', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ tag: 'del', text: a[i] });
      i++;
    } else {
      out.push({ tag: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ tag: 'del', text: a[i++] });
  while (j < m) out.push({ tag: 'add', text: b[j++] });
  return out;
}
