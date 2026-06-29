/**
 * context-menu.ts — Pure helpers for ContextMenu.svelte (P13-1) + the context
 * menu action registry (P13-3).
 *
 * Extracted as pure functions so they are unit-testable without a DOM or
 * Svelte rendering environment.
 *
 * THE ACTION REGISTRY (P13-3, spec 04 "Context menu", spec 12):
 * ============================================================
 * `menuItemsFor(selection, lookup, opts)` is a PURE mapping from a selection +
 * its element classification to the list of `MenuItem`s the menu should show.
 * It is the single source of truth for *which* actions appear for *which* kind
 * of element — the menu component (ContextMenu.svelte) stays purely
 * presentational.
 *
 *   • The kind→items mapping is pure and unit-testable: the labels and the
 *     `disabled` flags are derivable WITHOUT executing any `run` callback.
 *   • Each `run` callback dispatches to an EXISTING `deckStore` command — the
 *     menu introduces no new mutation path (spec 04 "a UI surface over existing
 *     commands"). The single source of truth stays in the store.
 *   • Passthrough elements get ONLY Delete + Jump-to-source — never a structural
 *     edit (never-destroy, spec 12).
 */

import type { DeckModel } from '$lib/model';
import { classify, isTextLeaf, findByEid, isListLeaf } from '$lib/model';
import { deckStore } from '$lib/store/deck.svelte';
import { linkEditorStore } from '$lib/canvas/link-editor.svelte';
// Type-only import (erased at runtime — the menu component owns the descriptor
// shape; we import it so the registry and the renderer can never drift).
import type { MenuItem } from '../../components/canvas/ContextMenu.svelte';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Clamped (left, top) position in pane-local pixels. */
export interface FlipResult {
  left: number;
  top: number;
}

// ── Edge-flip ─────────────────────────────────────────────────────────────────

/**
 * Compute a clamped menu origin that keeps the menu within the pane bounds.
 *
 * If placing the menu at (x, y) would cause the right or bottom edge to exceed
 * the pane dimensions, the menu flips to the opposite side (left / above the
 * cursor). The result is additionally clamped to ≥ 0 so the menu never exits
 * the top-left corner either.
 *
 * @param x        - Requested X in pane-local pixels (e.g. from contextmenu event).
 * @param y        - Requested Y in pane-local pixels.
 * @param menuW    - Measured width of the menu element (after first render).
 * @param menuH    - Measured height of the menu element.
 * @param paneW    - Width of the canvas pane container.
 * @param paneH    - Height of the canvas pane container.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  paneW: number,
  paneH: number,
): FlipResult {
  // Flip horizontally if right edge overflows, then clamp to ≥ 0.
  const left = x + menuW > paneW ? Math.max(0, x - menuW) : x;
  // Flip vertically if bottom edge overflows, then clamp to ≥ 0.
  const top = y + menuH > paneH ? Math.max(0, y - menuH) : y;
  return { left, top };
}

// ── Keyboard focus movement ───────────────────────────────────────────────────

/**
 * Advance the focused item index by `direction`, skipping separators and
 * disabled items. Wraps around.
 *
 * @param items     - The menu item descriptors (only `separator` and `disabled`
 *                    are inspected — the full MenuItem type is not required so
 *                    this stays dependency-free).
 * @param current   - Currently focused index, or -1 when nothing is focused.
 * @param direction - +1 moves down, -1 moves up.
 * @returns The new focused index, or `current` if no navigable item exists.
 */
export function moveFocusIndex(
  items: ReadonlyArray<{ separator?: boolean; disabled?: boolean }>,
  current: number,
  direction: 1 | -1,
): number {
  const len = items.length;
  if (len === 0) return current;

  // When nothing is focused, treat the virtual start as just before index 0
  // (direction=1) or just after the last index (direction=-1).
  const start = current === -1 ? (direction === 1 ? -1 : len) : current;

  for (let i = 1; i <= len; i++) {
    const idx = ((start + direction * i) % len + len) % len;
    const item = items[idx];
    if (!item.separator && !item.disabled) return idx;
  }

  return current; // All items are separators/disabled — stay put.
}

// ── Action registry (P13-3) ─────────────────────────────────────────────────────

/**
 * The menu-relevant classification of a selected element. Extends the model's
 * four-class {@link import('$lib/model').ElementClass} with `text-leaf` — a leaf
 * whose content is directly-coloured text (it gets the extra Text-colour action).
 */
export type MenuElementKind = 'container' | 'leaf' | 'text-leaf' | 'free' | 'passthrough';

/** The current selection the menu acts on. `primary` is the anchor eid. */
export interface MenuSelection {
  /** The primary (anchor) eid — single-element actions target this one. */
  primary: string;
  /** The full selection set (includes `primary`). `length > 1` ⇒ multi. */
  eids: string[];
}

/**
 * How `menuItemsFor` learns each eid's kind. Either:
 *   • a {@link DeckModel} — the kind is derived via classify/isTextLeaf, or
 *   • a function `(eid) => MenuElementKind | null` — lets unit tests drive the
 *     mapping with zero model setup (and returns null for an unknown eid).
 */
export type KindLookup = DeckModel | ((eid: string) => MenuElementKind | null);

/** Optional wiring the menu needs that is NOT a deckStore command. */
export interface MenuItemsOptions {
  /**
   * Whether the session element clipboard holds anything — drives the Paste
   * item's `disabled` flag. Pass `deckStore.hasClipboard`. Default: false.
   */
  hasClipboard?: boolean;
  /**
   * Navigate the source pane to `eid` (Jump to source). Not a model mutation, so
   * it is injected by the integrating component rather than living in the store.
   */
  onJumpToSource?: (eid: string) => void;
}

/**
 * Text-colour presets offered in the Text-colour submenu (spec 09 "Text
 * appearance" — the single deliberate per-element appearance exception). The
 * first entry clears the inline colour (restores the theme default).
 */
const TEXT_COLOR_PRESETS: ReadonlyArray<{ label: string; value: string | null }> = [
  { label: 'Default (theme)', value: null },
  { label: 'White', value: '#ffffff' },
  { label: 'Black', value: '#000000' },
  { label: 'Red', value: '#e53e3e' },
  { label: 'Orange', value: '#dd6b20' },
  { label: 'Green', value: '#38a169' },
  { label: 'Blue', value: '#3182ce' },
  { label: 'Purple', value: '#805ad5' },
];

/** Cross-axis alignment presets for a container's quick-align submenu. */
const ALIGN_PRESETS: ReadonlyArray<{ label: string; value: 'start' | 'center' | 'end' }> = [
  { label: 'Align start', value: 'start' },
  { label: 'Align center', value: 'center' },
  { label: 'Align end', value: 'end' },
];

/** A horizontal divider row (label is unused for separators). */
function separator(): MenuItem {
  return { label: '', separator: true };
}

/**
 * Resolve a selected eid to its menu kind. `null` (unknown eid — e.g. a stale
 * selection after a reload) is treated as passthrough by the caller so we never
 * offer a structural edit against an element we cannot classify.
 */
function resolveKind(lookup: KindLookup, eid: string): MenuElementKind | null {
  if (typeof lookup === 'function') return lookup(eid);
  const el = findByEid(lookup, eid);
  if (!el) return null;
  if (isTextLeaf(el)) return 'text-leaf';
  const cls = classify(el);
  // Inline marks (P17) are never independently selected (selection resolves to
  // the owning leaf), so they have no menu kind of their own — treat as
  // passthrough (Delete + Jump only, never a structural edit).
  return cls === 'inline' ? 'passthrough' : cls; // 'container' | 'leaf' | 'free' | 'passthrough'
}

// ── Item builders (one per action; kept small + named for readability) ──────────

function deleteItem(eids: string[], multi: boolean): MenuItem {
  return {
    label: multi ? 'Delete all' : 'Delete',
    danger: true,
    run: () => void deckStore.deleteElements(eids),
  };
}

function duplicateItem(eid: string): MenuItem {
  return { label: 'Duplicate', run: () => void deckStore.duplicateElement(eid) };
}

function duplicateMultiItem(eids: string[]): MenuItem {
  return {
    label: 'Duplicate',
    run: async () => {
      for (const eid of eids) await deckStore.duplicateElement(eid);
    },
  };
}

function copyItem(eids: string[]): MenuItem {
  return { label: 'Copy', run: () => void deckStore.copyElements(eids) };
}

function cutItem(eids: string[]): MenuItem {
  return { label: 'Cut', run: () => void deckStore.cutElements(eids) };
}

function pasteItem(eid: string, hasClipboard: boolean): MenuItem {
  return {
    label: 'Paste',
    disabled: !hasClipboard,
    run: () => void deckStore.pasteClipboard(eid),
  };
}

function jumpToSourceItem(eid: string, onJumpToSource?: (eid: string) => void): MenuItem {
  return { label: 'Jump to source', run: () => onJumpToSource?.(eid) };
}

function textColorItem(eid: string): MenuItem {
  return {
    label: 'Text color',
    submenu: TEXT_COLOR_PRESETS.map((c) => ({
      label: c.label,
      run: () => void deckStore.applyTextColor(eid, c.value),
    })),
  };
}

/**
 * Link actions for a text leaf (P17-10). "Add/Edit link…" opens the shared href
 * popover (prefilled when the leaf already carries a link); "Remove link" unwraps
 * any anchors. Both route to existing whole-leaf deck commands — the offline
 * guard is unaffected by an external href (only external RESOURCE loads are
 * forbidden, spec 12).
 */
function linkItem(eid: string): MenuItem {
  return {
    label: 'Link',
    submenu: [
      { label: 'Add/Edit link…', run: () => linkEditorStore.openForLeaf(eid) },
      { label: 'Remove link', run: () => void deckStore.removeLinkFromLeaf(eid) },
    ],
  };
}

/**
 * Indent / outdent actions for a LIST leaf (P17-8) — only emitted when the model
 * lookup confirms the leaf is a `<ul>`/`<ol>` (a function lookup, used by unit
 * tests, never claims list-ness, so the generic text-leaf menu stays stable).
 */
function listIndentItems(lookup: KindLookup, eid: string): MenuItem[] {
  if (typeof lookup === 'function') return [];
  const el = findByEid(lookup, eid);
  if (!el || !isListLeaf(el)) return [];
  return [
    separator(),
    { label: 'Indent list', run: () => void deckStore.indentList(eid, 'in') },
    { label: 'Outdent list', run: () => void deckStore.indentList(eid, 'out') },
  ];
}

function equalColumnsItem(eid: string): MenuItem {
  return { label: 'Equal columns', run: () => void deckStore.applyEqualColumns(eid) };
}

function quickAlignItem(eid: string): MenuItem {
  return {
    label: 'Align',
    submenu: ALIGN_PRESETS.map((a) => ({
      label: a.label,
      run: () => void deckStore.applyLayoutChange(eid, { align: a.value }),
    })),
  };
}

function makeFreeItem(eid: string): MenuItem {
  return { label: 'Make free', run: () => void deckStore.toggleFree(eid) };
}

function makeStructuredItem(eid: string): MenuItem {
  return { label: 'Make structured', run: () => void deckStore.toggleFree(eid) };
}

function bringToFrontItem(eid: string): MenuItem {
  return { label: 'Bring to front', run: () => void deckStore.bringToFront(eid) };
}

function sendToBackItem(eid: string): MenuItem {
  return { label: 'Send to back', run: () => void deckStore.sendToBack(eid) };
}

/**
 * Build the context-menu items for `selection`, classified via `lookup`.
 *
 * PURE: given the same selection + lookup + options it always returns the same
 * descriptor list. The `run` callbacks dispatch to `deckStore`, but the LABELS
 * and `disabled` flags are computed up front (never require running `run`), so
 * the kind→items mapping is fully unit-testable.
 *
 * Item sets (spec 04):
 *   • multi (>1 selected): Delete all · Duplicate · Copy · Cut
 *       (single-element-only actions — Paste, z-order, Make free, Text colour,
 *        container actions — are hidden).
 *   • passthrough / unknown: Delete · Jump to source ONLY (never structural —
 *        never-destroy, spec 12).
 *   • any other single element: Delete · Duplicate · Copy · Cut · Paste, then
 *        kind-specific extras:
 *          - text-leaf : + Text color
 *          - container : + Equal columns · Align (quick align)
 *          - free      : + Make structured · Bring to front · Send to back
 *          - structured (non-free leaf/container) : + Make free
 */
export function menuItemsFor(
  selection: MenuSelection,
  lookup: KindLookup,
  opts: MenuItemsOptions = {},
): MenuItem[] {
  const { primary, eids } = selection;
  const hasClipboard = opts.hasClipboard ?? false;

  // ── Multi-selection: the kind-agnostic batch set. ──
  if (eids.length > 1) {
    return [
      deleteItem(eids, true),
      duplicateMultiItem(eids),
      separator(),
      copyItem(eids),
      cutItem(eids),
    ];
  }

  const kind = resolveKind(lookup, primary);

  // ── Passthrough (or unclassifiable): never-destroy → no structural edits. ──
  if (kind === 'passthrough' || kind === null) {
    return [deleteItem([primary], false), jumpToSourceItem(primary, opts.onJumpToSource)];
  }

  // ── Single managed element: the common "any" set + kind-specific extras. ──
  const items: MenuItem[] = [
    deleteItem([primary], false),
    duplicateItem(primary),
    separator(),
    copyItem([primary]),
    cutItem([primary]),
    pasteItem(primary, hasClipboard),
  ];

  if (kind === 'text-leaf') {
    items.push(
      separator(),
      textColorItem(primary),
      linkItem(primary),
      ...listIndentItems(lookup, primary),
    );
  }

  if (kind === 'container') {
    items.push(separator(), equalColumnsItem(primary), quickAlignItem(primary));
  }

  if (kind === 'free') {
    // Free elements paint in sibling order → offer z-order + return-to-flow.
    items.push(
      separator(),
      makeStructuredItem(primary),
      bringToFrontItem(primary),
      sendToBackItem(primary),
    );
  } else {
    // Structured (non-free leaf/container) → offer the free escape hatch.
    items.push(separator(), makeFreeItem(primary));
  }

  return items;
}
