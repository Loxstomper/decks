/**
 * registry.test.ts — Unit tests for the command registry (P17-12).
 *
 * Verifies command ids, `when` predicates, and that `run` delegates to the
 * correct deckStore / selectionStore methods without executing real I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCommands, buildContext, type CommandContext } from './registry.js';

// ── Store mocks ────────────────────────────────────────────────────────────────
//
// We mock the two store modules so `run` callbacks never hit real network/DOM.
// Each mock exposes the full surface used by the registry; spies let us assert
// which method was called after running a command.

vi.mock('../store/deck.svelte.js', () => ({
  deckStore: {
    name: 'test-deck',
    canUndo: true,
    canRedo: true,
    hasClipboard: true,
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    addSlide: vi.fn(),
    duplicateSlide: vi.fn(),
    deleteSlide: vi.fn(),
    deleteElements: vi.fn(),
    duplicateElement: vi.fn(),
    applyEqualColumns: vi.fn(),
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    toggleFree: vi.fn(),
    copyElements: vi.fn(),
    cutElements: vi.fn(),
    pasteClipboard: vi.fn(),
    applyTheme: vi.fn(),
  },
}));

vi.mock('../canvas/selection.svelte.js', () => ({
  selectionStore: {
    primary: null as string | null,
    eids: [] as string[],
    editing: false,
  },
}));

// Helper to import the (possibly-cached) mock instances.
async function getMocks() {
  const { deckStore } = await import('../store/deck.svelte.js');
  const { selectionStore } = await import('../canvas/selection.svelte.js');
  return { deckStore, selectionStore };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    primary: null,
    eids: [],
    editing: false,
    deckName: 'test-deck',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('getCommands', () => {
  it('returns a non-empty array', () => {
    const cmds = getCommands(makeCtx());
    expect(cmds.length).toBeGreaterThan(0);
  });

  it('includes expected core command ids', () => {
    const cmds = getCommands(makeCtx());
    const ids = cmds.map((c) => c.id);

    // File group
    expect(ids).toContain('file.save');
    expect(ids).toContain('file.present');

    // Edit group
    expect(ids).toContain('edit.undo');
    expect(ids).toContain('edit.redo');
    expect(ids).toContain('edit.copy');
    expect(ids).toContain('edit.cut');
    expect(ids).toContain('edit.paste');

    // Slide group
    expect(ids).toContain('slide.add');
    expect(ids).toContain('slide.duplicate');
    expect(ids).toContain('slide.delete');

    // Element group
    expect(ids).toContain('element.delete');
    expect(ids).toContain('element.duplicate');
    expect(ids).toContain('element.equalColumns');
    expect(ids).toContain('element.bringToFront');
    expect(ids).toContain('element.sendToBack');
    expect(ids).toContain('element.toggleFree');

    // At least one theme command
    expect(ids).toContain('theme.apply.black');
  });

  it('has unique ids', () => {
    const cmds = getCommands(makeCtx());
    const ids = cmds.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every command has a non-empty label', () => {
    const cmds = getCommands(makeCtx());
    for (const cmd of cmds) {
      expect(cmd.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('every command has a run function', () => {
    const cmds = getCommands(makeCtx());
    for (const cmd of cmds) {
      expect(typeof cmd.run).toBe('function');
    }
  });

  it('commands have group strings', () => {
    const cmds = getCommands(makeCtx());
    const withGroup = cmds.filter((c) => c.group);
    expect(withGroup.length).toBeGreaterThan(0);
  });
});

describe('when predicates — no deck open', () => {
  const ctx = makeCtx({ deckName: null, primary: null, eids: [] });

  it('file.save is disabled when no deck is open', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'file.save')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('file.present is disabled when no deck is open', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'file.present')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('slide.add is disabled when no deck is open', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'slide.add')!;
    expect(cmd.when!(ctx)).toBe(false);
  });
});

describe('when predicates — deck open, no selection', () => {
  const ctx = makeCtx({ deckName: 'my-deck', primary: null, eids: [] });

  it('file.save is enabled', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'file.save')!;
    expect(cmd.when!(ctx)).toBe(true);
  });

  it('edit.copy is disabled (no selection)', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.copy')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('edit.cut is disabled (no selection)', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.cut')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('element.delete is disabled (no selection)', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'element.delete')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('slide.duplicate is disabled (no primary)', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'slide.duplicate')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('element.duplicate is disabled (no primary)', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'element.duplicate')!;
    expect(cmd.when!(ctx)).toBe(false);
  });

  it('element.bringToFront is disabled (no primary)', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'element.bringToFront')!;
    expect(cmd.when!(ctx)).toBe(false);
  });
});

describe('when predicates — deck open, with selection', () => {
  const ctx = makeCtx({ deckName: 'my-deck', primary: 'eid-1', eids: ['eid-1'] });

  it('edit.copy is enabled with selection', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.copy')!;
    expect(cmd.when!(ctx)).toBe(true);
  });

  it('edit.cut is enabled with selection', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.cut')!;
    expect(cmd.when!(ctx)).toBe(true);
  });

  it('element.delete is enabled with selection', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'element.delete')!;
    expect(cmd.when!(ctx)).toBe(true);
  });

  it('slide.duplicate is enabled with primary', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'slide.duplicate')!;
    expect(cmd.when!(ctx)).toBe(true);
  });

  it('element.duplicate is enabled with primary', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'element.duplicate')!;
    expect(cmd.when!(ctx)).toBe(true);
  });

  it('element.bringToFront is enabled with primary', () => {
    const cmd = getCommands(ctx).find((c) => c.id === 'element.bringToFront')!;
    expect(cmd.when!(ctx)).toBe(true);
  });
});

describe('run callbacks dispatch to deckStore', () => {
  beforeEach(async () => {
    const { deckStore, selectionStore } = await getMocks();
    // Reset all spies.
    vi.clearAllMocks();
    // Set up selection state.
    (selectionStore as { primary: string | null }).primary = 'eid-42';
    (selectionStore as { eids: string[] }).eids = ['eid-42'];
    (deckStore as { name: string | null }).name = 'test-deck';
  });

  it('file.save calls deckStore.save()', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx({ deckName: 'test-deck' });
    const cmd = getCommands(ctx).find((c) => c.id === 'file.save')!;
    cmd.run();
    expect(deckStore.save).toHaveBeenCalledOnce();
  });

  it('edit.undo calls deckStore.undo()', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx();
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.undo')!;
    cmd.run();
    expect(deckStore.undo).toHaveBeenCalledOnce();
  });

  it('edit.redo calls deckStore.redo()', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx();
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.redo')!;
    cmd.run();
    expect(deckStore.redo).toHaveBeenCalledOnce();
  });

  it('edit.copy calls deckStore.copyElements() with current eids', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx({ eids: ['eid-42'] });
    const cmd = getCommands(ctx).find((c) => c.id === 'edit.copy')!;
    cmd.run();
    expect(deckStore.copyElements).toHaveBeenCalledWith(['eid-42']);
  });

  it('element.bringToFront calls deckStore.bringToFront() with primary', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx({ primary: 'eid-42' });
    const cmd = getCommands(ctx).find((c) => c.id === 'element.bringToFront')!;
    cmd.run();
    expect(deckStore.bringToFront).toHaveBeenCalledWith('eid-42');
  });

  it('element.sendToBack calls deckStore.sendToBack() with primary', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx({ primary: 'eid-42' });
    const cmd = getCommands(ctx).find((c) => c.id === 'element.sendToBack')!;
    cmd.run();
    expect(deckStore.sendToBack).toHaveBeenCalledWith('eid-42');
  });

  it('theme.apply.moon calls deckStore.applyTheme("moon")', async () => {
    const { deckStore } = await getMocks();
    const ctx = makeCtx();
    const cmd = getCommands(ctx).find((c) => c.id === 'theme.apply.moon')!;
    cmd.run();
    expect(deckStore.applyTheme).toHaveBeenCalledWith('moon');
  });
});

describe('buildContext', () => {
  it('returns an object with the expected shape', async () => {
    const { selectionStore, deckStore } = await getMocks();
    (selectionStore as { primary: string | null }).primary = 'eid-1';
    (selectionStore as { eids: string[] }).eids = ['eid-1', 'eid-2'];
    (selectionStore as { editing: boolean }).editing = false;
    (deckStore as { name: string | null }).name = 'my-deck';

    const ctx = buildContext();
    expect(ctx.primary).toBe('eid-1');
    expect(ctx.eids).toEqual(['eid-1', 'eid-2']);
    expect(ctx.editing).toBe(false);
    expect(ctx.deckName).toBe('my-deck');
  });
});
