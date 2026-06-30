<script lang="ts">
  /**
   * ContextMenu.svelte — Cursor-positioned context menu for the canvas (P13-1).
   *
   * WHY THIS EXISTS (spec 13 "Right-click context menu"):
   * ======================================================
   * Presentational component that renders a right-click menu at arbitrary
   * canvas-pane-relative coordinates with:
   *   • Edge-flip: after first render it measures its own bounding box and
   *     re-positions so it stays within the canvas pane, flipping to the
   *     left/above the cursor when near the right/bottom edge.
   *   • Full keyboard navigation: ArrowUp/Down moves focus, Enter/Space runs
   *     the focused item, ArrowRight opens a submenu, ArrowLeft closes it,
   *     Escape closes the whole menu.
   *   • Dismissal on Escape, click-outside (including clicks inside the
   *     reveal.js iframe via an inset backdrop), and blur.
   *   • Separators, disabled items, danger items, and submenus are all
   *     supported through the MenuItem descriptor.
   *
   * DESIGN NOTES:
   *   • Purely presentational — zero business logic. All actions are provided
   *     by callers via `run` callbacks on each MenuItem.
   *   • An opaque-background backdrop (z-index 200) covers the canvas pane
   *     including the iframe, preventing unintended iframe interactions while
   *     the menu is open, and acting as the click-outside target. The menu
   *     itself sits above it (z-index 201).
   *   • Submenus are rendered recursively (same component, `_isSubmenu` flag
   *     suppresses the backdrop so only the root menu owns it).
   *   • Pure helper functions (`clampMenuPosition`, `moveFocusIndex`) live in
   *     `$lib/canvas/context-menu.ts` and are unit-tested separately.
   *
   * INTEGRATION CONTRACT:
   *   Mount anywhere inside the `position: relative` canvas-pane wrapper that
   *   also contains RevealFrame. Pass `x`/`y` from the `contextmenu` event
   *   translated to pane-local coordinates. Unmount (or set a visibility flag)
   *   when `onClose` fires.
   */

  import { clampMenuPosition, moveFocusIndex } from '$lib/canvas/context-menu.ts';
  // Self-import for recursive submenu rendering (replaces deprecated <svelte:self>).
  import ContextMenu from './ContextMenu.svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  /**
   * Descriptor for one row in the context menu.
   *
   * Exactly one of the following determines the row type:
   *   • `separator: true`          — renders a horizontal divider (all other
   *     fields are ignored).
   *   • `submenu: MenuItem[]`      — renders a submenu trigger (arrow indicator
   *     on the right; ArrowRight/hover reveals the child menu).
   *   • `run: () => void`          — normal action item.
   *   • (none of the above)        — label-only item, non-interactive.
   */
  export type MenuItem = {
    label: string;
    run?: () => void;
    disabled?: boolean;
    danger?: boolean;
    separator?: boolean;
    submenu?: MenuItem[];
  };

  // ── Props ───────────────────────────────────────────────────────────────────

  interface Props {
    /** Flat list of menu items/separators to render. */
    items: MenuItem[];
    /**
     * Requested X in canvas-pane-local pixels. The component may adjust this
     * leftward after measuring its own width (edge-flip).
     */
    x: number;
    /**
     * Requested Y in canvas-pane-local pixels. The component may adjust this
     * upward after measuring its own height (edge-flip).
     */
    y: number;
    /**
     * Called when the menu should dismiss itself. The caller is responsible
     * for unmounting the component (or toggling visibility) in response.
     */
    onClose: () => void;
    /**
     * Internal — set to `true` by the parent ContextMenu when rendering a
     * nested submenu. Suppresses the backdrop (only the root menu renders
     * one) and adjusts z-index layering.
     */
    _isSubmenu?: boolean;
  }

  let { items, x, y, onClose, _isSubmenu = false }: Props = $props();

  // ── DOM refs ─────────────────────────────────────────────────────────────────

  /** The menu box element — used for edge-flip measurement and focus. */
  let menuEl = $state<HTMLElement | undefined>();

  /**
   * Per-item button elements — used to measure vertical offset for submenu
   * positioning. Indexed parallel to `items`; separators leave their slot as
   * undefined.
   */
  let itemEls: (HTMLElement | undefined)[] = $state([]);

  // ── Position state ────────────────────────────────────────────────────────

  /**
   * Edge-flip result (pane-local px), set once after measurement. Until then
   * the menu renders at the raw cursor (x, y). Kept as a single nullable state
   * so `left`/`top` can be derived from the live `x`/`y` props (avoids
   * capturing only their initial values).
   */
  let flip = $state<{ left: number; top: number } | null>(null);
  /** Clamped left offset (pane-local px); raw `x` until edge-flip measures. */
  const left = $derived(flip?.left ?? x);
  /** Clamped top offset (pane-local px); raw `y` until edge-flip measures. */
  const top = $derived(flip?.top ?? y);

  // ── Navigation state ──────────────────────────────────────────────────────

  /** Currently keyboard-focused item index, or -1 when nothing is focused. */
  let focusIndex = $state(-1);

  /** Index of the item whose submenu is currently open, or null. */
  let openSubmenu = $state<number | null>(null);

  // ── Edge-flip (runs once after first mount) ───────────────────────────────

  $effect(() => {
    if (!menuEl) return;

    const menuRect = menuEl.getBoundingClientRect();

    // Locate the canvas-pane container by attribute, falling back to the
    // immediate parent. The pane must have `position: relative` so our
    // `position: absolute` children are placed relative to it.
    const pane =
      menuEl.closest('[data-canvas-pane]') ??
      menuEl.closest('[data-pane]') ??
      menuEl.parentElement;
    if (!pane) return;

    const paneRect = pane.getBoundingClientRect();
    const clamped = clampMenuPosition(
      x,
      y,
      menuRect.width,
      menuRect.height,
      paneRect.width,
      paneRect.height,
    );
    flip = clamped;

    // Grab keyboard focus so arrow keys work immediately.
    menuEl.focus();
  });

  // ── Submenu position helper ───────────────────────────────────────────────

  /**
   * Return the pane-local (x, y) origin for a submenu anchored to the item
   * at `itemIndex`. Positions the submenu immediately to the right and aligned
   * to the top of the item row.
   */
  function getSubmenuPos(itemIndex: number): { x: number; y: number } {
    const el = itemEls[itemIndex];
    if (!el || !menuEl) {
      // Fallback: place to the right with a fixed offset.
      return { x: left + 180, y: top };
    }
    return {
      x: left + menuEl.offsetWidth,
      y: top + el.offsetTop,
    };
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;

      case 'ArrowDown':
        e.preventDefault();
        openSubmenu = null;
        focusIndex = moveFocusIndex(items, focusIndex, 1);
        break;

      case 'ArrowUp':
        e.preventDefault();
        openSubmenu = null;
        focusIndex = moveFocusIndex(items, focusIndex, -1);
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusIndex >= 0) {
          const item = items[focusIndex];
          if (item.separator || item.disabled) break;
          if (item.submenu?.length) {
            openSubmenu = openSubmenu === focusIndex ? null : focusIndex;
          } else if (item.run) {
            item.run();
            onClose();
          }
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (focusIndex >= 0 && items[focusIndex]?.submenu?.length) {
          openSubmenu = focusIndex;
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        openSubmenu = null;
        break;
    }
  }

  // ── Item interaction ──────────────────────────────────────────────────────

  function handleItemClick(item: MenuItem, idx: number): void {
    if (item.separator || item.disabled) return;
    if (item.submenu?.length) {
      openSubmenu = openSubmenu === idx ? null : idx;
      focusIndex = idx;
    } else if (item.run) {
      item.run();
      onClose();
    }
  }

  function handleItemPointerEnter(idx: number): void {
    const item = items[idx];
    if (!item || item.separator || item.disabled) return;
    focusIndex = idx;
    // Open submenu on hover; close any other open submenu.
    openSubmenu = item.submenu?.length ? idx : null;
  }
</script>

<!--
  Root-level backdrop + menu box.

  Structure (for the root menu):
    <div.cm-backdrop>          ← transparent, covers full pane incl. iframe;
                                  click on it → onClose.
    <div.cm-menu>              ← the interactive menu box; position: absolute.
      <button.cm-item> …
      (nested submenu, rendered inline beside its trigger)
      <ContextMenu _isSubmenu />

  For submenu instances (_isSubmenu=true) only the .cm-menu is rendered —
  the root's backdrop already covers the pane.
-->

{#if !_isSubmenu}
  <!--
    Backdrop: transparent overlay covering the entire canvas pane. Sits between
    the canvas content (z 0–199) and the menu (z 201). Its sole job is to:
      1. Intercept pointer-down events outside the menu → close the menu.
      2. Block unintended interactions with the iframe while the menu is open.
    It must NOT have a visible background (transparency preserves readability).
  -->
  <div
    class="cm-backdrop"
    aria-hidden="true"
    onpointerdown={onClose}
  ></div>
{/if}

<div
  bind:this={menuEl}
  class="cm-menu"
  class:cm-menu--sub={_isSubmenu}
  role="menu"
  tabindex="-1"
  aria-label="Context menu"
  style:left="{left}px"
  style:top="{top}px"
  onkeydown={handleKeyDown}
>
  {#each items as item, idx (idx)}
    {#if item.separator}
      <!-- Horizontal divider — not focusable, purely visual. -->
      <div class="cm-separator" role="separator" aria-hidden="true"></div>
    {:else}
      <button
        bind:this={itemEls[idx]}
        class="cm-item"
        class:cm-item--danger={item.danger}
        class:cm-item--focused={focusIndex === idx}
        class:cm-item--has-sub={!!item.submenu?.length}
        disabled={item.disabled}
        role="menuitem"
        aria-haspopup={item.submenu?.length ? 'menu' : undefined}
        aria-expanded={item.submenu?.length ? openSubmenu === idx : undefined}
        aria-disabled={item.disabled ?? undefined}
        tabindex="-1"
        onclick={() => handleItemClick(item, idx)}
        onpointerenter={() => handleItemPointerEnter(idx)}
      >
        <span class="cm-label">{item.label}</span>
        {#if item.submenu?.length}
          <!-- Chevron indicates a submenu. Unicode › is widely supported. -->
          <span class="cm-chevron" aria-hidden="true">›</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

<!--
  Submenu: rendered as a true sibling of the menu box (NOT nested inside it) so
  its offset parent is the canvas pane, matching the pane-local coordinates that
  `getSubmenuPos` produces. Nesting it inside `.cm-menu` (a `position: absolute`
  ancestor) would double-count the parent menu's pane offset and push the
  submenu away from its trigger. Only one submenu is open at a time, so it is
  driven by `openSubmenu` outside the item loop.
-->
{#if openSubmenu !== null && items[openSubmenu]?.submenu?.length}
  {@const subPos = getSubmenuPos(openSubmenu)}
  <ContextMenu
    items={items[openSubmenu].submenu ?? []}
    x={subPos.x}
    y={subPos.y}
    {onClose}
    _isSubmenu={true}
  />
{/if}

<style>
  /* ── Backdrop ──────────────────────────────────────────────────────────── */

  .cm-backdrop {
    position: absolute;
    inset: 0;
    /* Fully transparent — does not obscure the slide behind the menu. */
    background: transparent;
    /* Below the menu box but above all canvas overlays. */
    z-index: 200;
    cursor: default;
  }

  /* ── Menu box ──────────────────────────────────────────────────────────── */

  .cm-menu {
    position: absolute;
    min-width: 168px;
    max-width: 280px;
    padding: 4px;
    /* Dark glass surface — matches FreeAlignBar's palette. */
    background: rgba(22, 22, 26, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.3),
      0 8px 24px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    /*
     * Menu is interactive — pointer events are explicitly ON.
     * (The parent canvas wrapper may have pointer-events:none for overlay
     * layers, so we re-enable here.)
     */
    pointer-events: auto;
    /* Above the backdrop (200) and all canvas overlays. */
    z-index: 201;
    outline: none;
    user-select: none;
    /* Sub-pixel rendering. */
    -webkit-font-smoothing: antialiased;
  }

  /* Submenus share the same visual style but stack above the parent. */
  .cm-menu--sub {
    z-index: 202;
  }

  /* ── Items ─────────────────────────────────────────────────────────────── */

  .cm-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 10px 6px 12px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    font-size: 13px;
    line-height: 1.45;
    text-align: left;
    cursor: pointer;
    gap: 8px;
    transition:
      background 0.07s ease,
      color 0.07s ease;
  }

  /*
   * Disabled: muted appearance, no interactions.
   * We use both :disabled (native) and [aria-disabled="true"] for robustness.
   */
  .cm-item:disabled,
  .cm-item[aria-disabled='true'] {
    color: rgba(255, 255, 255, 0.28);
    cursor: default;
    pointer-events: none;
  }

  /* Hover + keyboard-focus share the same highlight style. */
  .cm-item:hover:not(:disabled),
  .cm-item.cm-item--focused:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: #fff;
  }

  /* Danger items — destructive action (e.g. Delete). */
  .cm-item.cm-item--danger {
    color: rgba(252, 129, 129, 0.88); /* red-300-ish */
  }

  .cm-item.cm-item--danger:hover:not(:disabled),
  .cm-item.cm-item--danger.cm-item--focused:not(:disabled) {
    background: rgba(239, 68, 68, 0.16);
    color: rgb(252, 165, 165); /* red-300 */
  }

  /* Label: takes all available space and truncates on overflow. */
  .cm-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Submenu chevron (›). */
  .cm-chevron {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.38);
    font-size: 15px;
    line-height: 1;
    /* Optical alignment. */
    margin-right: -2px;
  }

  .cm-item.cm-item--danger .cm-chevron {
    color: rgba(252, 129, 129, 0.45);
  }

  /* ── Separator ─────────────────────────────────────────────────────────── */

  .cm-separator {
    height: 1px;
    margin: 4px 8px;
    background: rgba(255, 255, 255, 0.09);
  }
</style>
