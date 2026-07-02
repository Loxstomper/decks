<script lang="ts">
  /**
   * QrBlockPanel.svelte — P19: configure and insert a QR code block.
   *
   * Output (handed to the insert seam via onInsert):
   *   <div data-qr="{payload}" data-qr-ec="M" data-qr-fg="#000000"
   *        data-qr-bg="#ffffff" data-qr-quiet="4"
   *        aria-label="QR code: {payload}" style="width:280px;height:280px"></div>
   *
   * WHY A CONFIG PANEL (not instant insert): a QR needs a payload AND encoding
   * options (error-correction level, colours, quiet zone). The panel collects
   * them and validates the payload BEFORE the block lands in the deck, so we
   * never insert an empty QR. After insertion, the inspector's QR control edits
   * the same attributes.
   *
   * CONTRAST GUARD: foreground/background contrast directly affects whether the
   * code scans, so we surface a warning (not a hard block) when it is too low.
   *
   * OFFLINE-FIRST (spec 12): the emitted markup carries zero external URLs; the
   * QR generator + plugin are vendored into the deck by the scaffold (P19-1).
   * The block is inert (empty div) without them but never breaks the deck.
   */

  import { buildQrBlock, QR_DEFAULTS } from '$lib/blocks/builders';
  import { qrContrastRatio, QR_MIN_CONTRAST } from '$lib/blocks/qr-util';
  import type { ElementNode } from '$lib/model';

  interface Props {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  }

  // deckName is passed by the host (palette) for API consistency — QR codes don't
  // need it locally (everything is offline + in-model).
  const { onInsert, onCancel }: Props = $props();

  const EC_LEVELS = [
    { value: 'L', label: 'L — Low (7%)' },
    { value: 'M', label: 'M — Medium (15%)' },
    { value: 'Q', label: 'Q — Quartile (25%)' },
    { value: 'H', label: 'H — High (30%)' },
  ] as const;

  // ── State ──────────────────────────────────────────────────────────────────

  let payload = $state<string>('');
  let ec = $state<string>(QR_DEFAULTS.ec);
  let fg = $state<string>(QR_DEFAULTS.fg);
  let bg = $state<string>(QR_DEFAULTS.bg);
  let quiet = $state<number>(QR_DEFAULTS.quiet);

  const valid = $derived(payload.trim() !== '');

  /** Contrast ratio (null when a colour isn't a parseable hex). */
  const contrast = $derived(qrContrastRatio(fg, bg));
  const lowContrast = $derived(contrast !== null && contrast < QR_MIN_CONTRAST);

  function handleInsert(): void {
    if (!valid) return;
    onInsert(buildQrBlock(payload.trim(), { ec, fg, bg, quiet }));
  }
</script>

<div class="qr-panel">
  <header class="panel-header">
    <h3 class="panel-title">Insert QR code</h3>
    {#if onCancel}
      <button type="button" class="icon-btn" onclick={onCancel} aria-label="Cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </header>

  <div class="fields">
    <!-- Payload -->
    <label class="field">
      <span class="field-label">Content <span class="hint">(URL or text)</span></span>
      <input
        class="field-input"
        class:invalid={!valid}
        type="text"
        placeholder="https://example.com"
        autocomplete="off"
        spellcheck={false}
        bind:value={payload}
      />
    </label>

    <div class="field-row">
      <!-- Error correction -->
      <label class="field">
        <span class="field-label">Error correction</span>
        <select class="field-select" bind:value={ec}>
          {#each EC_LEVELS as lvl (lvl.value)}
            <option value={lvl.value}>{lvl.label}</option>
          {/each}
        </select>
      </label>

      <!-- Quiet zone -->
      <label class="field quiet-field">
        <span class="field-label">Quiet zone</span>
        <input class="field-input" type="number" min="0" step="1" bind:value={quiet} />
      </label>
    </div>

    <div class="field-row">
      <!-- Foreground -->
      <label class="field">
        <span class="field-label">Foreground</span>
        <input class="field-color" type="color" bind:value={fg} aria-label="QR foreground colour" />
      </label>

      <!-- Background -->
      <label class="field">
        <span class="field-label">Background</span>
        <input class="field-color" type="color" bind:value={bg} aria-label="QR background colour" />
      </label>
    </div>

    <!-- Feedback -->
    {#if !valid}
      <p class="validation error" aria-live="polite">⚠ Enter a URL or text to encode.</p>
    {:else if lowContrast}
      <p class="validation warn" aria-live="polite">
        ⚠ Low contrast ({contrast?.toFixed(1)}:1) — the code may not scan reliably.
      </p>
    {:else}
      <p class="validation ok" aria-live="polite">✓ Ready</p>
    {/if}
  </div>

  <footer class="panel-footer">
    {#if onCancel}
      <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
    {/if}
    <button type="button" class="btn-primary" onclick={handleInsert} disabled={!valid}>
      Insert QR code
    </button>
  </footer>
</div>

<style>
  .qr-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .panel-title {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255,255,255,0.85);
  }

  .icon-btn {
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0;
  }
  .icon-btn:hover { color: #fff; }
  .icon-btn svg { width: 1rem; height: 1rem; }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .field-row {
    display: flex;
    gap: 0.6rem;
  }
  .field-row .field { flex: 1; }
  .quiet-field { flex: 0 0 6rem; }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.72rem;
    color: rgba(255,255,255,0.55);
    font-weight: 500;
  }

  .hint {
    font-weight: 400;
    color: rgba(255,255,255,0.3);
    font-size: 0.68rem;
  }

  .field-input,
  .field-select {
    width: 100%;
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.3);
    color: rgba(255,255,255,0.9);
    font-size: 0.8rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .field-input:focus,
  .field-select:focus { border-color: rgba(74, 158, 255, 0.6); }
  .field-input.invalid { border-color: rgba(255, 90, 90, 0.6); }

  .field-color {
    width: 100%;
    height: 2rem;
    padding: 0.15rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.3);
    cursor: pointer;
    box-sizing: border-box;
  }

  .validation {
    margin: 0;
    font-size: 0.68rem;
  }
  .validation.error { color: rgba(255, 130, 130, 0.95); }
  .validation.warn { color: rgba(255, 200, 110, 0.95); }
  .validation.ok { color: rgba(120, 220, 150, 0.8); }

  .panel-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .btn-primary,
  .btn-secondary {
    padding: 0.4rem 0.85rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    border: none;
  }

  .btn-primary {
    background: #4a9eff;
    color: #fff;
    font-weight: 500;
  }
  .btn-primary:hover:not(:disabled) { background: #7ab8ff; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-secondary {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.65);
    border: 1px solid rgba(255,255,255,0.12);
  }
  .btn-secondary:hover {
    background: rgba(255,255,255,0.14);
    color: #fff;
  }
</style>
