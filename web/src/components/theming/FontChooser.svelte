<script lang="ts">
  /**
   * FontChooser.svelte — P6-13 Google Font localizer.
   *
   * Provides a text input + "Download & Apply" button that triggers font
   * localization on the server. The server downloads the chosen Google Font
   * family (woff2 files + @font-face CSS) into the deck's assets/fonts/ folder
   * so the deck renders the font offline after the one-time download.
   *
   * After a successful download the component calls onFontApplied with the
   * local CSS path and family name. The integrator:
   *   1. Adds @import url(cssPath) at the top of custom.css.
   *   2. Updates --r-main-font / --r-heading-font CSS variables.
   *
   * Props:
   *   deckName       — Name of the open deck. Required to POST /api/decks/{name}/fonts.
   *   disabled       — True when no deck is open.
   *   onFontApplied  — Called after a successful localization with:
   *                      { cssPath, family }
   *                    where cssPath is like "assets/fonts/inter/font-face.css".
   */

  interface FontResult {
    cssPath: string;
    family: string;
  }

  interface Props {
    deckName: string | null;
    disabled?: boolean;
    onFontApplied?: (result: FontResult) => void;
  }

  let { deckName, disabled = false, onFontApplied }: Props = $props();

  let familyInput = $state('');
  let weightsInput = $state('400;700');
  let pending = $state(false);
  let lastError = $state<string | null>(null);
  let lastSuccess = $state<string | null>(null);

  async function handleDownload(): Promise<void> {
    const family = familyInput.trim();
    if (!family || !deckName) return;

    pending = true;
    lastError = null;
    lastSuccess = null;

    try {
      const res = await fetch(
        `/api/decks/${encodeURIComponent(deckName)}/fonts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ family, weights: weightsInput.trim() || '400;700' }),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        // 503 = offline / Google Fonts unreachable — surface a friendly message.
        if (res.status === 503) {
          throw new Error('Cannot reach Google Fonts (offline or unavailable).');
        }
        throw new Error(`Server error ${res.status}: ${text}`);
      }

      const result: FontResult = await res.json();
      lastSuccess = `${result.family} downloaded`;
      onFontApplied?.(result);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      pending = false;
    }
  }

  const isDisabled = $derived(disabled || !deckName || pending || !familyInput.trim());
</script>

<div class="font-chooser">
  <div class="section-title">Google Fonts</div>

  <div class="input-row">
    <label for="font-family-input" class="control-label">Family</label>
    <input
      id="font-family-input"
      type="text"
      class="text-input"
      placeholder="e.g. Inter"
      bind:value={familyInput}
      disabled={disabled || pending}
      onkeydown={(e) => { if (e.key === 'Enter') void handleDownload(); }}
    />
  </div>

  <div class="input-row">
    <label for="font-weights-input" class="control-label">Weights</label>
    <input
      id="font-weights-input"
      type="text"
      class="text-input"
      placeholder="400;700"
      bind:value={weightsInput}
      disabled={disabled || pending}
    />
  </div>

  <button
    type="button"
    class="download-btn"
    disabled={isDisabled}
    onclick={() => void handleDownload()}
  >
    {#if pending}
      Downloading…
    {:else}
      Download &amp; Apply
    {/if}
  </button>

  {#if lastSuccess}
    <p class="status-ok">{lastSuccess}</p>
  {/if}
  {#if lastError}
    <p class="status-err">{lastError}</p>
  {/if}

  <p class="hint">
    Requires internet once. Font is saved locally in
    <code>assets/fonts/</code> and works offline afterwards.
  </p>
</div>

<style>
  .font-chooser {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 2px;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .control-label {
    flex: 0 0 56px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
  }

  .text-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.1s;
  }

  .text-input:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }

  .text-input:disabled {
    opacity: 0.4;
  }

  .download-btn {
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid rgba(74, 158, 255, 0.4);
    background: rgba(74, 158, 255, 0.15);
    color: rgba(147, 197, 253, 0.9);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    align-self: flex-start;
    margin-top: 2px;
    transition: background 0.1s, color 0.1s;
  }

  .download-btn:hover:not(:disabled) {
    background: rgba(74, 158, 255, 0.25);
    color: #fff;
  }

  .download-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .status-ok {
    font-size: 0.65rem;
    color: rgba(52, 211, 153, 0.9);
  }

  .status-err {
    font-size: 0.65rem;
    color: rgba(248, 113, 113, 0.9);
    word-break: break-word;
  }

  .hint {
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.25);
    margin-top: 4px;
    line-height: 1.5;
  }

  .hint code {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.55rem;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 3px;
    border-radius: 2px;
  }
</style>
