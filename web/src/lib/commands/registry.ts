/**
 * registry.ts — Pure command registry (P17-12).
 *
 * A flat list of editor commands, each with a stable id, display label, a `run`
 * callback that dispatches to the existing deckStore / selectionStore / browser
 * APIs, an optional `when` predicate for contextual enabling, and optional group
 * and shortcut metadata consumed by the CommandPalette and ShortcutHelp overlays.
 *
 * DESIGN NOTES:
 *   • This is the SINGLE source of truth for "what commands exist". The palette,
 *     menus, and hotkeys all read from here — no new mutation paths.
 *   • `when` is checked at render time to decide if the item is enabled/disabled.
 *     A falsy `when` shows the item greyed rather than hiding it (discoverability).
 *   • `run` may be called even when `when` returns false — callers should guard,
 *     but the functions themselves are safe no-ops in that case (deckStore already
 *     handles empty selection gracefully).
 *   • Import paths use the `.js` extension that Vite / svelte-check expects for
 *     module resolution of `.svelte.ts` files.
 */

import { deckStore } from '../store/deck.svelte.js';
import { selectionStore } from '../canvas/selection.svelte.js';

// ── Context ────────────────────────────────────────────────────────────────────

/**
 * Snapshot of the application state that `when` predicates use to decide
 * whether a command is currently meaningful / enabled.
 *
 * Built from live stores by `buildContext()` in this module; callers (palette,
 * tests) can also construct it directly for testing.
 */
export interface CommandContext {
  /** Primary (anchor) selected eid, or null when nothing is selected. */
  primary: string | null;
  /** All currently selected eids. Empty array when nothing is selected. */
  eids: string[];
  /** True while a contenteditable in-place edit session is active. */
  editing: boolean;
  /** Name of the currently open deck, or null. */
  deckName: string | null;
}

/** Build a context snapshot from the live stores. */
export function buildContext(): CommandContext {
  return {
    primary: selectionStore.primary,
    eids: selectionStore.eids,
    editing: selectionStore.editing,
    deckName: deckStore.name,
  };
}

// ── Command type ───────────────────────────────────────────────────────────────

export interface Command {
  /** Stable identifier — used for deduplication and keyboard binding lookup. */
  id: string;
  /** Human-readable label shown in the palette and menus. */
  label: string;
  /** Executes the command. May be called regardless of `when` — implementations
   *  are safe no-ops when prerequisites are absent. */
  run: () => void;
  /**
   * Optional predicate: should the command appear enabled in the palette?
   * Returning `false` renders the item greyed (not hidden) for discoverability.
   * Omitting `when` means "always enabled".
   */
  when?: (ctx: CommandContext) => boolean;
  /** Optional group header shown as a section divider in the palette. */
  group?: string;
  /** Optional shortcut hint rendered on the right side of the palette row. */
  shortcut?: string;
}

// ── Theme names ───────────────────────────────────────────────────────────────

/** Bundled reveal.js themes available for the Apply Theme commands. */
const THEME_NAMES = [
  'black',
  'white',
  'league',
  'beige',
  'sky',
  'night',
  'serif',
  'simple',
  'solarized',
  'moon',
  'dracula',
] as const;

// ── Command definitions ────────────────────────────────────────────────────────

/**
 * Return the full command list, with `run` callbacks wired to the live stores.
 *
 * The list is rebuilt on every call so `run` always closes over the CURRENT
 * store state (selectionStore.eids / primary at call time, not at definition
 * time). Callers in the palette rebuild it on every keystroke filter pass.
 *
 * @param ctx - A snapshot used by `when` predicates. Pass `buildContext()` for
 *              live store values, or a custom object for tests.
 */
export function getCommands(_ctx?: CommandContext): Command[] {
  // We ignore _ctx here — `when` receives it from the caller. The `run`
  // callbacks read the stores directly at invocation time (always fresh).
  return [
    // ── File ──────────────────────────────────────────────────────────────────
    {
      id: 'file.save',
      label: 'Save',
      group: 'File',
      shortcut: 'Ctrl+S',
      run: () => void deckStore.save(),
      when: (ctx) => ctx.deckName !== null,
    },
    {
      id: 'file.present',
      label: 'Present',
      group: 'File',
      run: () => {
        if (deckStore.name) {
          window.open(`/present/${encodeURIComponent(deckStore.name)}`, '_blank');
        }
      },
      when: (ctx) => ctx.deckName !== null,
    },

    // ── Edit ──────────────────────────────────────────────────────────────────
    {
      id: 'edit.undo',
      label: 'Undo',
      group: 'Edit',
      shortcut: 'Cmd/Ctrl+Z',
      run: () => void deckStore.undo(),
      when: () => deckStore.canUndo,
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      group: 'Edit',
      shortcut: 'Cmd/Ctrl+Shift+Z',
      run: () => void deckStore.redo(),
      when: () => deckStore.canRedo,
    },
    {
      id: 'edit.copy',
      label: 'Copy',
      group: 'Edit',
      shortcut: 'Cmd/Ctrl+C',
      run: () => deckStore.copyElements(selectionStore.eids),
      when: (ctx) => ctx.eids.length > 0,
    },
    {
      id: 'edit.cut',
      label: 'Cut',
      group: 'Edit',
      shortcut: 'Cmd/Ctrl+X',
      run: () => void deckStore.cutElements(selectionStore.eids),
      when: (ctx) => ctx.eids.length > 0,
    },
    {
      id: 'edit.paste',
      label: 'Paste',
      group: 'Edit',
      shortcut: 'Cmd/Ctrl+V',
      run: () => void deckStore.pasteClipboard(),
      when: () => deckStore.hasClipboard,
    },

    // ── Slide ─────────────────────────────────────────────────────────────────
    {
      id: 'slide.add',
      label: 'Add Slide',
      group: 'Slide',
      run: () => void deckStore.addSlide(selectionStore.primary ?? undefined),
      when: (ctx) => ctx.deckName !== null,
    },
    {
      id: 'slide.duplicate',
      label: 'Duplicate Slide',
      group: 'Slide',
      run: () => {
        if (selectionStore.primary) void deckStore.duplicateSlide(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },
    {
      id: 'slide.delete',
      label: 'Delete Slide',
      group: 'Slide',
      run: () => {
        if (selectionStore.primary) void deckStore.deleteSlide(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },

    // ── Element ───────────────────────────────────────────────────────────────
    {
      id: 'element.delete',
      label: 'Delete Elements',
      group: 'Element',
      run: () => void deckStore.deleteElements(selectionStore.eids),
      when: (ctx) => ctx.eids.length > 0,
    },
    {
      id: 'element.duplicate',
      label: 'Duplicate Element',
      group: 'Element',
      run: () => {
        if (selectionStore.primary) void deckStore.duplicateElement(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },
    {
      id: 'element.equalColumns',
      label: 'Apply Equal Columns',
      group: 'Element',
      run: () => {
        if (selectionStore.primary) void deckStore.applyEqualColumns(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },
    {
      id: 'element.bringToFront',
      label: 'Bring to Front',
      group: 'Element',
      run: () => {
        if (selectionStore.primary) void deckStore.bringToFront(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },
    {
      id: 'element.sendToBack',
      label: 'Send to Back',
      group: 'Element',
      run: () => {
        if (selectionStore.primary) void deckStore.sendToBack(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },
    {
      id: 'element.toggleFree',
      label: 'Toggle Free Positioning',
      group: 'Element',
      run: () => {
        if (selectionStore.primary) void deckStore.toggleFree(selectionStore.primary);
      },
      when: (ctx) => ctx.primary !== null,
    },

    // ── Theme ─────────────────────────────────────────────────────────────────
    ...THEME_NAMES.map((name) => ({
      id: `theme.apply.${name}`,
      label: `Apply Theme: ${name.charAt(0).toUpperCase() + name.slice(1)}`,
      group: 'Theme',
      run: () => void deckStore.applyTheme(name),
      when: (ctx: CommandContext) => ctx.deckName !== null,
    })),
  ];
}
