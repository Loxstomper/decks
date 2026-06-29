/**
 * undo.test.ts — Snapshot undo/redo history (P2-8) + autosave-per-command (P2-7).
 *
 * Coverage:
 *  1. push() / stepBack() / stepForward() restore exact serialized bytes.
 *  2. redo stack is cleared when a new command is committed after an undo.
 *  3. canUndo / canRedo transition correctly at history boundaries.
 *  4. Stack is bounded to MAX_HISTORY; oldest entries are dropped.
 *  5. Idempotent push: identical consecutive snapshots are not duplicated.
 *  6. reset() seeds the stack and clears previous history.
 *  7. deckStore.commitCommand() calls PUT (mock fetch) — autosave per command.
 *  8. deckStore.undo() and deckStore.redo() also persist (mock fetch PUT).
 *  9. SSE echo of our own write is not treated as an external change (no-op).
 *
 * Tests 1-6 use UndoHistory (pure class, no Svelte runes) so they run in the
 * `node` environment without any browser/Svelte dependencies.
 *
 * Tests 7-9 import deck.svelte.ts which uses $state runes; those are processed
 * by @sveltejs/vite-plugin-svelte through the Vite transform pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UndoHistory, MAX_HISTORY } from './undo-history';

// ────────────────────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────────────────────

function snap(n: number): string {
  // Minimal but unique byte sequence that looks like a serialised slide.
  return `<!doctype html><html><body><!-- snap ${n} --></body></html>`;
}

// ────────────────────────────────────────────────────────────────────────────
// 1–6: Pure UndoHistory (no Svelte runes)
// ────────────────────────────────────────────────────────────────────────────

describe('UndoHistory — pure stack algorithm', () => {
  let h: UndoHistory;

  beforeEach(() => {
    h = new UndoHistory();
  });

  // ── 3: initial state ──────────────────────────────────────────────────────
  it('starts with canUndo=false and canRedo=false before reset', () => {
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.stepBack()).toBeUndefined();
    expect(h.stepForward()).toBeUndefined();
  });

  // ── 6: reset ─────────────────────────────────────────────────────────────
  it('reset() seeds the stack at cursor 0, canUndo=false', () => {
    h.reset(snap(0));
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.snapshots).toHaveLength(1);
    expect(h.cursor).toBe(0);
  });

  it('reset() clears previous history', () => {
    h.reset(snap(0));
    h.push(snap(1));
    h.push(snap(2));
    h.reset(snap(99));
    expect(h.snapshots).toHaveLength(1);
    expect(h.cursor).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  // ── 1: push / stepBack / stepForward restore exact bytes ─────────────────
  it('push() advances cursor; stepBack() restores exact bytes', () => {
    const s0 = snap(0);
    const s1 = snap(1);
    const s2 = snap(2);

    h.reset(s0);
    h.push(s1);
    h.push(s2);

    expect(h.cursor).toBe(2);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    // Undo once → restore s1
    const restored1 = h.stepBack();
    expect(restored1).toBe(s1);
    expect(h.cursor).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(true);

    // Undo again → restore s0
    const restored0 = h.stepBack();
    expect(restored0).toBe(s0);
    expect(h.cursor).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it('stepForward() reapplies exact bytes after undo', () => {
    const s0 = snap(0);
    const s1 = snap(1);
    h.reset(s0);
    h.push(s1);

    h.stepBack(); // undo → cursor=0
    const reapplied = h.stepForward(); // redo → cursor=1
    expect(reapplied).toBe(s1);
    expect(h.canRedo).toBe(false);
  });

  // ── 3: canUndo/canRedo at boundaries ─────────────────────────────────────
  it('canUndo/canRedo reflect history boundaries correctly', () => {
    h.reset(snap(0));
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);

    h.push(snap(1));
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    h.stepBack(); // undo
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    h.stepForward(); // redo
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('stepBack() is a no-op (returns undefined) when canUndo=false', () => {
    h.reset(snap(0));
    expect(h.stepBack()).toBeUndefined();
    expect(h.cursor).toBe(0);
  });

  it('stepForward() is a no-op (returns undefined) when canRedo=false', () => {
    h.reset(snap(0));
    h.push(snap(1));
    expect(h.stepForward()).toBeUndefined();
    expect(h.cursor).toBe(1);
  });

  // ── 2: redo cleared on new command after undo ─────────────────────────────
  it('redo stack is cleared when a new command is committed after undo', () => {
    h.reset(snap(0));
    h.push(snap(1));
    h.push(snap(2));

    h.stepBack(); // undo → cursor=1, redo available
    expect(h.canRedo).toBe(true);

    // New command: clears forward history
    h.push(snap(3));
    expect(h.canRedo).toBe(false);
    expect(h.snapshots).toHaveLength(3); // [s0, s1, s3]
    expect(h.snapshots[2]).toBe(snap(3));

    // Undo goes to s1, not s2 (which was discarded)
    const restored = h.stepBack();
    expect(restored).toBe(snap(1));
  });

  // ── 5: idempotent push ────────────────────────────────────────────────────
  it('push() with the same bytes as current snapshot is a no-op', () => {
    h.reset(snap(0));
    h.push(snap(1));
    const lenBefore = h.snapshots.length;
    const cursorBefore = h.cursor;

    // Same bytes again
    h.push(snap(1));
    expect(h.snapshots).toHaveLength(lenBefore);
    expect(h.cursor).toBe(cursorBefore);
  });

  // ── 4: stack bound ────────────────────────────────────────────────────────
  it(`stack never exceeds MAX_HISTORY (${MAX_HISTORY}) entries`, () => {
    h.reset(snap(0));
    // Push MAX_HISTORY more entries (cursor should sit at MAX_HISTORY - 1)
    for (let i = 1; i <= MAX_HISTORY + 5; i++) {
      h.push(snap(i));
    }
    expect(h.snapshots.length).toBe(MAX_HISTORY);
    expect(h.cursor).toBe(MAX_HISTORY - 1);
  });

  it('oldest snapshot is evicted when the cap is hit', () => {
    h.reset(snap(0));
    for (let i = 1; i < MAX_HISTORY; i++) {
      h.push(snap(i));
    }
    // One more push exceeds the cap
    h.push(snap(MAX_HISTORY));
    // snap(0) should be gone; the oldest surviving entry should be snap(1)
    expect(h.snapshots[0]).toBe(snap(1));
    expect(h.snapshots[h.snapshots.length - 1]).toBe(snap(MAX_HISTORY));
  });

  it('canUndo works correctly after eviction', () => {
    h.reset(snap(0));
    for (let i = 1; i <= MAX_HISTORY; i++) {
      h.push(snap(i));
    }
    // cursor points to the newest entry, which is still > 0 → canUndo
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7-9: Integrated deckStore tests — autosave per command (P2-7)
//
// These tests import deck.svelte.ts (which uses $state runes). The Svelte vite
// plugin transforms .svelte.ts files in the vitest pipeline.  fetch is stubbed
// so no real HTTP is made.
//
// ISOLATION: deckStore and undoStore are module-level singletons.  vi.resetModules()
// in beforeEach() clears the module cache so each test gets a fresh pair of
// singletons with clean state.  Each test then re-imports via a dynamic import
// inside the test body.
//
// INITIALIZATION: tests call store.load() (with a mocked GET) rather than
// manually poking internal fields.  load() → #adoptDisk() → undoStore.reset()
// seeds the undo history with the baseline snapshot, matching production behaviour.
// ────────────────────────────────────────────────────────────────────────────

describe('deckStore — commitCommand / undo / redo persist (P2-7)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    // Reset module cache so each test gets fresh singletons (deckStore, undoStore).
    vi.resetModules();
  });

  /**
   * Build a fetch mock that handles both GET (load / SSE re-read) and PUT (save).
   * `diskState` is a 1-element array so the PUT handler can mutate it and the
   * GET handler reads the latest value (shared reference).
   */
  function makeFetch(initialHtml: string) {
    const disk = { html: initialHtml };
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        disk.html = opts.body as string;
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      // GET (load or SSE re-read)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(disk.html),
      } as unknown as Response);
    });
    return { mockFetch, disk };
  }

  async function freshStore(s0: string) {
    const { mockFetch, disk } = makeFetch(s0);
    vi.stubGlobal('fetch', mockFetch);
    // Fresh import after vi.resetModules() in beforeEach
    const { deckStore } = await import('./deck.svelte');
    // load() → #adoptDisk(s0) → undoStore.reset(s0): baseline is seeded
    await deckStore.load('test-deck');
    mockFetch.mockClear(); // don't count the initial load GET in assertions
    return { store: deckStore, mockFetch, disk };
  }

  it('commitCommand() fires a PUT and keeps canUndo=true', async () => {
    const s0 = snap(0);
    const s1 = snap(1);
    const { store, mockFetch } = await freshStore(s0);

    // Change source and commit as a command.
    store.source = s1;
    await store.commitCommand();

    // Verify PUT was called with s1.
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/decks/test-deck');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBe(s1);

    // canUndo=true (s0 baseline is the previous entry); canRedo=false (at tip).
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
  });

  it('undo() restores exact bytes and fires a PUT', async () => {
    const s0 = snap(10);
    const s1 = snap(11);
    const { store, mockFetch } = await freshStore(s0);

    // Commit s1.
    store.source = s1;
    await store.commitCommand();
    mockFetch.mockClear();

    // Undo → should restore s0 and PUT it.
    await store.undo();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBe(s0);
    expect(store.source).toBe(s0);

    // Back at the baseline: canUndo=false, canRedo=true.
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it('redo() reapplies exact bytes and fires a PUT', async () => {
    const s0 = snap(20);
    const s1 = snap(21);
    const { store, mockFetch } = await freshStore(s0);

    store.source = s1;
    await store.commitCommand();
    await store.undo(); // back to s0
    mockFetch.mockClear();

    await store.redo();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBe(s1);
    expect(store.source).toBe(s1);
    expect(store.canRedo).toBe(false);
  });

  it('redo cleared on new command committed after undo', async () => {
    const s0 = snap(30);
    const s1 = snap(31);
    const s2 = snap(32);
    const { store } = await freshStore(s0);

    store.source = s1;
    await store.commitCommand();
    await store.undo(); // back to s0; canRedo=true

    expect(store.canRedo).toBe(true);

    // New command after undo → redo stack cleared.
    store.source = s2;
    await store.commitCommand();

    expect(store.canRedo).toBe(false);
    expect(store.canUndo).toBe(true);
  });

  it('SSE echo of own PUT is ignored (no-op external change)', async () => {
    // After a commitCommand() the SSE fires with the same bytes we just PUT.
    // onExternalChange() must treat html === source as our own echo and not
    // increment reloadNonce a second time or touch the undo stack.
    const s0 = snap(40);
    const s1 = snap(41);
    const { store, mockFetch } = await freshStore(s0);

    store.source = s1;
    await store.commitCommand();
    const nonceAfterCommit = store.reloadNonce;

    // SSE fires: the server now holds s1 (our own write); GET returns s1.
    await store.onExternalChange();

    // reloadNonce must NOT increment again — it's just our own echo.
    expect(store.reloadNonce).toBe(nonceAfterCommit);
    expect(store.source).toBe(s1);
    // Undo stack must remain valid after the echo (no spurious reset).
    expect(store.canUndo).toBe(true);

    // Confirm the GET was called (the SSE handler does re-fetch from disk)
    // The last mockFetch call should be the GET from onExternalChange.
    const lastCall = mockFetch.mock.calls.at(-1) as [string, RequestInit | undefined];
    expect(lastCall[0]).toContain('/api/decks/test-deck');
    expect(lastCall[1]?.method).toBeUndefined(); // GET has no explicit method
  });
});
