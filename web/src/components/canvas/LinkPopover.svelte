<script lang="ts">
  /**
   * LinkPopover.svelte — Href add/edit/remove popover (P17-10).
   *
   * WHY THIS EXISTS (spec canvas-interaction rich text, spec principles-and-invariants security):
   * ======================================================
   * The single href editor shared by the floating selection toolbar (range link)
   * and the text-leaf context menu (whole-leaf link). It is purely presentational
   * over {@link linkEditorStore}: it reads the open state + prefilled href and
   * calls submit/remove/close. The store routes those to existing deck commands /
   * range ops — no new mutation path. The OK button is disabled for an unsafe href
   * (`isSafeHref`), mirroring the sanitizer so a `javascript:`/`data:` URL can
   * never be applied; external http(s)/mailto/tel navigation is allowed.
   *
   * Centered over the canvas-stack (it is mounted inside CanvasInteraction's
   * overlay). Escape / backdrop click dismiss; Enter submits.
   */

  import { linkEditorStore } from '$lib/canvas/link-editor.svelte.ts';

  let inputEl = $state<HTMLInputElement | undefined>();

  // Focus + select the URL field whenever the popover opens.
  $effect(() => {
    if (linkEditorStore.open && inputEl) {
      const el = inputEl;
      queueMicrotask(() => {
        el.focus();
        el.select();
      });
    }
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (linkEditorStore.valid) linkEditorStore.submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      linkEditorStore.close();
    }
  }
</script>

{#if linkEditorStore.open}
  <!-- Backdrop intercepts outside clicks (incl. the iframe) → close. -->
  <div class="lp-backdrop" aria-hidden="true" onpointerdown={() => linkEditorStore.close()}></div>

  <div class="lp-popover" role="dialog" aria-label="Edit link">
    <label class="lp-label" for="lp-href">Link URL</label>
    <input
      id="lp-href"
      class="lp-input"
      type="text"
      placeholder="https://… or #slide or mailto:…"
      bind:this={inputEl}
      bind:value={linkEditorStore.href}
      onkeydown={onKeydown}
      spellcheck="false"
      autocomplete="off"
    />
    {#if !linkEditorStore.valid && linkEditorStore.href.trim() !== ''}
      <p class="lp-warn">Unsafe or unsupported URL scheme.</p>
    {/if}
    <div class="lp-actions">
      {#if linkEditorStore.canRemove}
        <button class="lp-btn lp-btn--danger" type="button" onclick={() => linkEditorStore.remove()}>
          Remove
        </button>
      {/if}
      <span class="lp-spacer"></span>
      <button class="lp-btn" type="button" onclick={() => linkEditorStore.close()}>Cancel</button>
      <button
        class="lp-btn lp-btn--primary"
        type="button"
        disabled={!linkEditorStore.valid}
        onclick={() => linkEditorStore.submit()}
      >
        OK
      </button>
    </div>
  </div>
{/if}

<style>
  .lp-backdrop {
    position: absolute;
    inset: 0;
    background: transparent;
    z-index: 210;
    pointer-events: auto;
  }

  .lp-popover {
    position: absolute;
    left: 50%;
    top: 32%;
    transform: translateX(-50%);
    z-index: 211;
    width: 320px;
    max-width: calc(100% - 24px);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(22, 22, 26, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.3),
      0 12px 32px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    pointer-events: auto;
  }

  .lp-label {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }

  .lp-input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 13px;
    font-family: var(--font-mono, monospace);
    outline: none;
  }

  .lp-input:focus {
    border-color: rgba(59, 130, 246, 0.7);
  }

  .lp-warn {
    margin: 0;
    font-size: 0.66rem;
    color: rgb(252, 165, 165);
  }

  .lp-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .lp-spacer {
    flex: 1;
  }

  .lp-btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.82);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .lp-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .lp-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .lp-btn--primary {
    background: rgba(59, 130, 246, 0.3);
    border-color: rgba(59, 130, 246, 0.55);
    color: #fff;
  }

  .lp-btn--primary:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.45);
  }

  .lp-btn--danger {
    color: rgb(252, 165, 165);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .lp-btn--danger:hover {
    background: rgba(239, 68, 68, 0.18);
  }
</style>
