<script lang="ts">
  /**
   * QrControl.svelte — Per-element QR code editor (P19).
   *
   * Shown in the inspector when a <div data-qr> QR leaf is selected. It edits the
   * payload (`data-qr`), error-correction level (`data-qr-ec`), foreground/
   * background colours (`data-qr-fg`/`data-qr-bg`), and quiet zone
   * (`data-qr-quiet`), committing via deckStore.applyQrData (one undo entry + one
   * autosave, byte-stable). Mirrors ChartDataControl's "self-wire to the store"
   * pattern so the shell needs no new props.
   *
   * CONTRAST GUARD: fg/bg contrast affects scannability, so a too-low ratio
   * surfaces a warning (not a hard block).
   *
   * SVELTE 5 runes; no createEventDispatcher.
   */

  import { deckStore } from '$lib/store/deck.svelte';
  import { qrContrastRatio, QR_MIN_CONTRAST } from '$lib/blocks/qr-util';
  import { QR_DEFAULTS } from '$lib/blocks/builders';
  import type { QrProps, QrEcLevel } from '$lib/model';

  interface Props {
    /** The selected QR div's data-eid. */
    eid: string;
    /** Current QR props snapshot (from getQrProps). */
    props: QrProps;
  }

  let { eid, props }: Props = $props();

  const EC_LEVELS: QrEcLevel[] = ['L', 'M', 'Q', 'H'];

  // Local editable buffers, seeded from the model props inside the sync effect
  // (NOT in $state initializers — referencing reactive props there only captures
  // the first value and warns). `syncedEid` guards the seed so we re-seed only
  // when the SELECTION changes (switching QR blocks), never clobbering an
  // in-progress edit on every model tick.
  let payloadBuf = $state<string>('');
  let ecBuf = $state<QrEcLevel>('M');
  let fgBuf = $state<string>(QR_DEFAULTS.fg);
  let bgBuf = $state<string>(QR_DEFAULTS.bg);
  let quietBuf = $state<number>(QR_DEFAULTS.quiet);
  let syncedEid: string | undefined;
  $effect(() => {
    if (syncedEid !== eid) {
      syncedEid = eid;
      payloadBuf = props.payload ?? '';
      ecBuf = props.ec ?? (QR_DEFAULTS.ec as QrEcLevel);
      fgBuf = props.fg ?? QR_DEFAULTS.fg;
      bgBuf = props.bg ?? QR_DEFAULTS.bg;
      quietBuf = props.quiet ?? QR_DEFAULTS.quiet;
    }
  });

  const contrast = $derived(qrContrastRatio(fgBuf, bgBuf));
  const lowContrast = $derived(contrast !== null && contrast < QR_MIN_CONTRAST);

  /** Commit the payload on blur/Enter. No-op when blank or unchanged. */
  function commitPayload(): void {
    const v = payloadBuf.trim();
    if (v === '' || v === (props.payload ?? '')) return;
    void deckStore.applyQrData(eid, { payload: v });
  }

  function onPayloadKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  }

  function onEcChange(e: Event): void {
    ecBuf = (e.target as HTMLSelectElement).value as QrEcLevel;
    if (ecBuf !== (props.ec ?? QR_DEFAULTS.ec)) {
      void deckStore.applyQrData(eid, { ec: ecBuf });
    }
  }

  function commitFg(): void {
    if (fgBuf !== (props.fg ?? QR_DEFAULTS.fg)) void deckStore.applyQrData(eid, { fg: fgBuf });
  }
  function commitBg(): void {
    if (bgBuf !== (props.bg ?? QR_DEFAULTS.bg)) void deckStore.applyQrData(eid, { bg: bgBuf });
  }

  function commitQuiet(): void {
    if (!Number.isFinite(quietBuf) || quietBuf < 0) return;
    const q = Math.floor(quietBuf);
    if (q !== (props.quiet ?? QR_DEFAULTS.quiet)) void deckStore.applyQrData(eid, { quiet: q });
  }
</script>

<div class="prop-section">
  <div class="section-sublabel">QR code</div>

  <label class="qr-field">
    <span class="qr-field-label">Content</span>
    <input
      class="qr-input"
      type="text"
      placeholder="https://example.com"
      autocomplete="off"
      spellcheck={false}
      aria-label="QR content (URL or text)"
      bind:value={payloadBuf}
      onblur={commitPayload}
      onkeydown={onPayloadKeydown}
    />
  </label>

  <div class="qr-row">
    <label class="qr-field">
      <span class="qr-field-label">Error correction</span>
      <select class="qr-select" value={ecBuf} onchange={onEcChange}>
        {#each EC_LEVELS as lvl (lvl)}
          <option value={lvl}>{lvl}</option>
        {/each}
      </select>
    </label>
    <label class="qr-field qr-quiet">
      <span class="qr-field-label">Quiet</span>
      <input
        class="qr-input"
        type="number"
        min="0"
        step="1"
        aria-label="QR quiet-zone width in modules"
        bind:value={quietBuf}
        onblur={commitQuiet}
      />
    </label>
  </div>

  <div class="qr-row">
    <label class="qr-field">
      <span class="qr-field-label">Foreground</span>
      <input class="qr-color" type="color" aria-label="QR foreground colour" bind:value={fgBuf} onchange={commitFg} />
    </label>
    <label class="qr-field">
      <span class="qr-field-label">Background</span>
      <input class="qr-color" type="color" aria-label="QR background colour" bind:value={bgBuf} onchange={commitBg} />
    </label>
  </div>

  {#if lowContrast}
    <p class="qr-validation warn" aria-live="polite">
      ⚠ Low contrast ({contrast?.toFixed(1)}:1) — may not scan.
    </p>
  {/if}
</div>

<style>
  .prop-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 12px;
  }

  .section-sublabel {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 2px;
  }

  .qr-row {
    display: flex;
    gap: 8px;
  }
  .qr-row .qr-field { flex: 1; }
  .qr-quiet { flex: 0 0 4.5rem; }

  .qr-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .qr-field-label {
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .qr-input,
  .qr-select {
    width: 100%;
    box-sizing: border-box;
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    outline: none;
  }
  .qr-input:focus,
  .qr-select:focus { border-color: rgba(59, 130, 246, 0.5); }

  .qr-color {
    width: 100%;
    height: 1.7rem;
    box-sizing: border-box;
    padding: 0.1rem;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
  }

  .qr-validation {
    margin: 0;
    font-size: 0.62rem;
  }
  .qr-validation.warn { color: rgba(255, 200, 110, 0.95); }
</style>
