<script lang="ts">
  /**
   * ShortcutHelp.svelte — Keyboard shortcut cheat-sheet overlay (P17-13).
   *
   * Opens on `?` (wired in App.svelte, guarded against text-editing focus).
   * Shows a read-only table of the editor's shortcuts grouped by category.
   * Dismiss with Escape or by clicking the backdrop.
   */

  // ── Props ───────────────────────────────────────────────────────────────────

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  // ── Data ─────────────────────────────────────────────────────────────────────

  const GROUPS: Array<{
    title: string;
    rows: Array<{ keys: string; description: string }>;
  }> = [
    {
      title: 'Navigation & Selection',
      rows: [
        { keys: '↑ ↓ ← →', description: 'Nudge 1px' },
        { keys: 'Shift+Arrow', description: 'Nudge 10px' },
        { keys: 'Click', description: 'Select element' },
        { keys: 'Drag', description: 'Marquee select' },
        { keys: 'Double-click', description: 'Edit text' },
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: 'Backspace / Delete', description: 'Delete selected' },
        { keys: 'Cmd/Ctrl+Z', description: 'Undo' },
        { keys: 'Cmd/Ctrl+Shift+Z', description: 'Redo' },
        { keys: 'Cmd/Ctrl+C', description: 'Copy' },
        { keys: 'Cmd/Ctrl+X', description: 'Cut' },
        { keys: 'Cmd/Ctrl+V', description: 'Paste' },
        { keys: 'Cmd/Ctrl+S', description: 'Save' },
      ],
    },
    {
      title: 'View & Present',
      rows: [
        { keys: '/', description: 'Insert palette' },
        { keys: 'Cmd/Ctrl+K', description: 'Command palette' },
        { keys: '?', description: 'Shortcut help (this)' },
        { keys: 'Enter', description: 'Confirm edit' },
        { keys: 'Escape', description: 'Cancel / close' },
      ],
    },
  ];

  // ── DOM ref ──────────────────────────────────────────────────────────────────

  let dialogEl = $state<HTMLElement | undefined>();

  // ── Effects ──────────────────────────────────────────────────────────────────

  $effect(() => {
    if (open) {
      // Grab focus so Escape is captured immediately.
      setTimeout(() => dialogEl?.focus(), 0);
    }
  });

  // ── Event handlers ────────────────────────────────────────────────────────────

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }

  function handleBackdropPointerdown(e: PointerEvent): void {
    if (e.target === e.currentTarget) onclose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="sh-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerdown}
  >
    <div
      bind:this={dialogEl}
      class="sh-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <!-- Header -->
      <div class="sh-header">
        <h2 class="sh-title">Keyboard Shortcuts</h2>
        <button
          class="sh-close"
          type="button"
          aria-label="Close"
          onclick={onclose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <!-- Shortcut groups -->
      <div class="sh-body">
        {#each GROUPS as group (group.title)}
          <section class="sh-group">
            <h3 class="sh-group-title">{group.title}</h3>
            <table class="sh-table">
              <tbody>
                {#each group.rows as row (row.keys)}
                  <tr class="sh-row">
                    <td class="sh-keys">
                      {#each row.keys.split(' / ') as keyPart, i (keyPart)}
                        {#if i > 0}<span class="sh-separator">/</span>{/if}
                        <kbd class="sh-kbd">{keyPart}</kbd>
                      {/each}
                    </td>
                    <td class="sh-desc">{row.description}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/each}
      </div>

      <!-- Footer hint -->
      <div class="sh-footer">Press <kbd class="sh-kbd sh-kbd--inline">?</kbd> or <kbd class="sh-kbd sh-kbd--inline">Esc</kbd> to close</div>
    </div>
  </div>
{/if}

<style>
  /* ── Backdrop ──────────────────────────────────────────────────────────── */

  .sh-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Dialog ─────────────────────────────────────────────────────────────── */

  .sh-dialog {
    width: 480px;
    max-width: calc(100vw - 2rem);
    max-height: 80vh;
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

  /* ── Header ─────────────────────────────────────────────────────────────── */

  .sh-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .sh-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.01em;
  }

  .sh-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .sh-close:hover {
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.8);
  }

  /* ── Body / scroll area ─────────────────────────────────────────────────── */

  .sh-body {
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    overscroll-behavior: contain;
  }

  /* ── Group ───────────────────────────────────────────────────────────────── */

  .sh-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sh-group-title {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.32);
  }

  /* ── Table ───────────────────────────────────────────────────────────────── */

  .sh-table {
    width: 100%;
    border-collapse: collapse;
  }

  .sh-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .sh-row:last-child {
    border-bottom: none;
  }

  .sh-keys {
    padding: 5px 0;
    white-space: nowrap;
    width: 52%;
    vertical-align: middle;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .sh-desc {
    padding: 5px 0 5px 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    vertical-align: middle;
  }

  .sh-separator {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.28);
    padding: 0 1px;
  }

  /* ── Keyboard badge ─────────────────────────────────────────────────────── */

  .sh-kbd {
    display: inline-block;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    padding: 1px 5px 2px;
    font-family: inherit;
    white-space: nowrap;
    line-height: 1.45;
  }

  /* ── Footer ─────────────────────────────────────────────────────────────── */

  .sh-footer {
    flex-shrink: 0;
    padding: 10px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 11px;
    color: rgba(255, 255, 255, 0.25);
    text-align: center;
  }

  .sh-kbd--inline {
    font-size: 10px;
    padding: 0px 4px 1px;
  }
</style>
