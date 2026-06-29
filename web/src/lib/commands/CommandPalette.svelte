<script lang="ts">
  /**
   * CommandPalette.svelte — Searchable command palette (P17-12).
   *
   * Opens on Cmd/Ctrl+K (wired in App.svelte). Presents a filtered, keyboard-
   * navigable list of all registered commands. Dispatching a command runs the
   * same deckStore method that context menus / hotkeys use — no new mutation path.
   *
   * INTERACTION MODEL:
   *   • Type to fuzzy-filter by label (case-insensitive substring).
   *   • ArrowUp / ArrowDown navigate the list, skipping disabled items.
   *   • Enter runs the focused (enabled) command and closes.
   *   • Escape closes without action.
   *   • Pointer-down on the backdrop closes.
   *   • Disabled items are shown greyed and are not keyboard-selectable.
   *   • Group headers appear above the first item of each group in the filtered list.
   */

  import { getCommands, buildContext, type Command } from './registry.js';

  // ── Props ───────────────────────────────────────────────────────────────────

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  // ── State ────────────────────────────────────────────────────────────────────

  /** Current search query typed by the user. */
  let query = $state('');

  /** Keyboard-focused item index in `filteredCommands`, or -1 when none. */
  let focusIndex = $state(-1);

  /** DOM ref for the search input — used to grab focus on open. */
  let inputEl = $state<HTMLInputElement | undefined>();

  // ── Derived: filtered + grouped command list ─────────────────────────────────

  /**
   * Commands filtered by the current query. The context snapshot is rebuilt on
   * every derivation so `when` reflects the live selection / deckName.
   */
  const filteredCommands = $derived.by<Command[]>(() => {
    const ctx = buildContext();
    const all = getCommands(ctx);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((cmd) => cmd.label.toLowerCase().includes(q));
  });

  /**
   * Group names present in the current filtered list, in insertion order.
   * Used to render section headers.
   */
  const groupsInOrder = $derived.by<string[]>(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const cmd of filteredCommands) {
      const g = cmd.group ?? '';
      if (!seen.has(g)) {
        seen.add(g);
        order.push(g);
      }
    }
    return order;
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** True if this command is currently enabled (when predicate passes). */
  function isEnabled(cmd: Command): boolean {
    if (!cmd.when) return true;
    return cmd.when(buildContext());
  }

  /** Find the next navigable (enabled) index starting from `from`, wrapping. */
  function nextNavigable(from: number, dir: 1 | -1): number {
    const len = filteredCommands.length;
    if (len === 0) return -1;
    for (let i = 1; i <= len; i++) {
      const idx = ((from + dir * i) % len + len) % len;
      if (isEnabled(filteredCommands[idx])) return idx;
    }
    return -1; // all disabled
  }

  // ── Effects ──────────────────────────────────────────────────────────────────

  $effect(() => {
    if (open) {
      // Reset state when opened.
      query = '';
      focusIndex = -1;
      // Defer focus so the element is visible in the DOM.
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  // Reset focus index when the filtered list changes (query changed).
  $effect(() => {
    void filteredCommands; // track dependency
    focusIndex = -1;
  });

  // ── Event handlers ────────────────────────────────────────────────────────────

  function handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onclose();
        break;

      case 'ArrowDown':
        e.preventDefault();
        focusIndex = nextNavigable(focusIndex, 1);
        break;

      case 'ArrowUp':
        e.preventDefault();
        focusIndex = nextNavigable(focusIndex, -1);
        break;

      case 'Enter':
        e.preventDefault();
        if (focusIndex >= 0) {
          const cmd = filteredCommands[focusIndex];
          if (cmd && isEnabled(cmd)) {
            cmd.run();
            onclose();
          }
        }
        break;
    }
  }

  function handleItemClick(cmd: Command): void {
    if (!isEnabled(cmd)) return;
    cmd.run();
    onclose();
  }

  function handleBackdropPointerdown(e: PointerEvent): void {
    // Close when clicking the backdrop itself (not the dialog).
    if (e.target === e.currentTarget) onclose();
  }
</script>

{#if open}
  <!--
    Full-viewport backdrop — semi-transparent dark overlay. Pointer-down on it
    (but not on the dialog box) closes the palette.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="cp-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerdown}
  >
    <!--
      Dialog box — centered, fixed width.
      role="dialog" with aria-modal so assistive technologies treat it as a modal.
    -->
    <div
      class="cp-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <!-- Search input -->
      <div class="cp-search-row">
        <svg class="cp-search-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          class="cp-input"
          type="text"
          placeholder="Search commands…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls="cp-list"
        />
        <kbd class="cp-esc-hint">Esc</kbd>
      </div>

      <!-- Command list -->
      <ul
        id="cp-list"
        class="cp-list"
        role="listbox"
        aria-label="Commands"
      >
        {#if filteredCommands.length === 0}
          <li class="cp-empty">No commands match "{query}"</li>
        {:else}
          {#each groupsInOrder as group (group)}
            {#if group}
              <li class="cp-group-header" role="presentation" aria-hidden="true">{group}</li>
            {/if}
            {#each filteredCommands.filter(cmd => (cmd.group ?? '') === group) as cmd, _i (cmd.id)}
              {@const globalIdx = filteredCommands.indexOf(cmd)}
              {@const enabled = isEnabled(cmd)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <li
                class="cp-item"
                class:cp-item--focused={focusIndex === globalIdx}
                class:cp-item--disabled={!enabled}
                role="option"
                aria-selected={focusIndex === globalIdx}
                aria-disabled={!enabled}
                onpointerenter={() => { if (enabled) focusIndex = globalIdx; }}
                onclick={() => handleItemClick(cmd)}
              >
                <span class="cp-label">{cmd.label}</span>
                {#if cmd.shortcut}
                  <kbd class="cp-shortcut">{cmd.shortcut}</kbd>
                {/if}
              </li>
            {/each}
          {/each}
        {/if}
      </ul>
    </div>
  </div>
{/if}

<style>
  /* ── Backdrop ──────────────────────────────────────────────────────────── */

  .cp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 500;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
  }

  /* ── Dialog ─────────────────────────────────────────────────────────────── */

  .cp-dialog {
    width: 560px;
    max-width: calc(100vw - 2rem);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: rgba(22, 22, 26, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    box-shadow:
      0 4px 8px rgba(0, 0, 0, 0.4),
      0 16px 40px rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    overflow: hidden;
    outline: none;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Search row ─────────────────────────────────────────────────────────── */

  .cp-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .cp-search-icon {
    color: rgba(255, 255, 255, 0.38);
    flex-shrink: 0;
  }

  .cp-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: rgba(255, 255, 255, 0.9);
    font-size: 14px;
    line-height: 1.5;
    caret-color: rgba(255, 255, 255, 0.7);
  }

  .cp-input::placeholder {
    color: rgba(255, 255, 255, 0.32);
  }

  .cp-esc-hint {
    flex-shrink: 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    pointer-events: none;
  }

  /* ── List ────────────────────────────────────────────────────────────────── */

  .cp-list {
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 4px;
    overscroll-behavior: contain;
  }

  .cp-empty {
    padding: 16px 14px;
    color: rgba(255, 255, 255, 0.38);
    font-size: 13px;
    text-align: center;
    list-style: none;
  }

  /* ── Group header ────────────────────────────────────────────────────────── */

  .cp-group-header {
    padding: 6px 10px 3px 12px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.32);
    list-style: none;
    user-select: none;
  }

  /* ── Item ────────────────────────────────────────────────────────────────── */

  .cp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px 7px 12px;
    border-radius: 6px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.82);
    font-size: 13px;
    line-height: 1.45;
    list-style: none;
    user-select: none;
    transition:
      background 0.07s ease,
      color 0.07s ease;
  }

  .cp-item--focused:not(.cp-item--disabled),
  .cp-item:hover:not(.cp-item--disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: #fff;
  }

  .cp-item--disabled {
    color: rgba(255, 255, 255, 0.28);
    cursor: default;
  }

  /* ── Label + shortcut ────────────────────────────────────────────────────── */

  .cp-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-shortcut {
    flex-shrink: 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    white-space: nowrap;
  }

  .cp-item--disabled .cp-shortcut {
    opacity: 0.5;
  }
</style>
