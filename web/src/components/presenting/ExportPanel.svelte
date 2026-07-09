<script lang="ts">
  /**
   * ExportPanel.svelte — Export controls (P7-4 / spec presenting-and-export).
   *
   * Two export formats, both served by the Go backend on demand:
   *
   *   PDF  — GET /api/decks/{name}/export.pdf
   *           The backend drives headless Chrome with reveal's `?print-pdf` URL,
   *           waits for the page to render, and streams back a PDF.
   *           If Chrome is not installed the backend returns HTTP 503; we surface
   *           a friendly message instead of a broken download.
   *
   *   ZIP  — GET /api/decks/{name}/export.zip
   *           The backend zips the entire deck folder (deck.html + assets/ +
   *           custom.css) into a self-contained, offline-ready archive and streams
   *           it back. No Chrome required.
   *
   * DOWNLOAD MECHANISM:
   * We create a temporary `<a download>` element for each format so the browser's
   * native save-file dialog is used. For the PDF we first HEAD-check the endpoint
   * to distinguish "Chrome not found" (503) from other errors before downloading.
   *
   * PROPS:
   *   deckName — name of the open deck, or null when no deck is open.
   */

  interface Props {
    /** Name of the currently open deck (null = buttons are disabled). */
    deckName: string | null;
  }

  let { deckName }: Props = $props();

  // ── State ────────────────────────────────────────────────────────────────────

  /** True while a PDF export is in progress. */
  let pdfBusy = $state(false);
  /** True while a ZIP export is in progress. */
  let zipBusy = $state(false);

  /** User-visible error or info message. Cleared before each new attempt. */
  let message = $state<{ kind: 'error' | 'info'; text: string } | null>(null);

  // ── URL helpers ──────────────────────────────────────────────────────────────

  const pdfUrl = $derived(
    deckName ? `/api/decks/${encodeURIComponent(deckName)}/export.pdf` : '',
  );

  const zipUrl = $derived(
    deckName ? `/api/decks/${encodeURIComponent(deckName)}/export.zip` : '',
  );

  // ── Download helpers ─────────────────────────────────────────────────────────

  /**
   * Trigger a browser download by creating a temporary <a download> element.
   * `url` should already be an absolute path or blob URL.
   */
  function triggerDownload(url: string, filename: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── PDF export ───────────────────────────────────────────────────────────────

  async function handleExportPdf(): Promise<void> {
    if (!deckName || pdfBusy) return;
    message = null;
    pdfBusy = true;
    try {
      // Probe the endpoint first: a 503 means Chrome is not available on the
      // server. We use a HEAD request to avoid downloading an error body.
      const probe = await fetch(pdfUrl, { method: 'HEAD' });
      if (probe.status === 503) {
        message = {
          kind: 'error',
          text:
            'PDF export requires headless Chrome, which was not found on this server. ' +
            'Install Google Chrome or Chromium and restart the slides-builder server.',
        };
        return;
      }
      if (!probe.ok) {
        message = {
          kind: 'error',
          text: `PDF export failed (HTTP ${probe.status}). Try again or check the server logs.`,
        };
        return;
      }
      // Chrome is available — trigger the actual download.
      triggerDownload(pdfUrl, `${deckName}.pdf`);
      message = { kind: 'info', text: 'PDF download started.' };
    } catch {
      message = {
        kind: 'error',
        text: 'Could not reach the export endpoint. Is the slides-builder server running?',
      };
    } finally {
      pdfBusy = false;
    }
  }

  // ── ZIP export ────────────────────────────────────────────────────────────────

  async function handleExportZip(): Promise<void> {
    if (!deckName || zipBusy) return;
    message = null;
    zipBusy = true;
    try {
      // The ZIP endpoint does not require Chrome — it just zips the deck folder.
      // We probe first to surface any server error before opening the download.
      const probe = await fetch(zipUrl, { method: 'HEAD' });
      if (!probe.ok) {
        message = {
          kind: 'error',
          text: `HTML bundle export failed (HTTP ${probe.status}). Try again or check the server logs.`,
        };
        return;
      }
      triggerDownload(zipUrl, `${deckName}.zip`);
      message = { kind: 'info', text: 'HTML bundle download started.' };
    } catch {
      message = {
        kind: 'error',
        text: 'Could not reach the export endpoint. Is the slides-builder server running?',
      };
    } finally {
      zipBusy = false;
    }
  }
</script>

<section class="export-panel" aria-label="Export deck">
  <header class="export-header">
    <span class="export-label">Export</span>
  </header>

  <div class="export-buttons">
    <!--
      PDF export — requires Chrome on the server. The 503 path surfaces a
      friendly message (see handleExportPdf).
      Endpoint: GET /api/decks/{name}/export.pdf
    -->
    <button
      type="button"
      class="export-btn"
      disabled={!deckName || pdfBusy}
      onclick={handleExportPdf}
      title="Export to PDF via headless Chrome (reveal ?print-pdf)"
      aria-label="Download PDF"
      aria-busy={pdfBusy}
    >
      {#if pdfBusy}
        <span class="spinner" aria-hidden="true"></span>
        Generating PDF…
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        Download PDF
      {/if}
    </button>

    <!--
      HTML bundle export — zips the self-contained deck folder. No Chrome needed.
      Endpoint: GET /api/decks/{name}/export.zip
    -->
    <button
      type="button"
      class="export-btn"
      disabled={!deckName || zipBusy}
      onclick={handleExportZip}
      title="Export as self-contained HTML bundle (zip of deck folder)"
      aria-label="Download HTML bundle"
      aria-busy={zipBusy}
    >
      {#if zipBusy}
        <span class="spinner" aria-hidden="true"></span>
        Packaging…
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="21 15 21 21 3 21 3 15" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download HTML Bundle
      {/if}
    </button>
  </div>

  <!-- Feedback message: error (red) or info (muted) -->
  {#if message}
    <p class="export-message" class:is-error={message.kind === 'error'} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text}
    </p>
  {/if}

  <!-- Contextual help -->
  {#if !deckName}
    <p class="export-hint">Open a deck to enable exports.</p>
  {:else}
    <p class="export-hint">
      PDF requires Chrome on the server.
      The HTML bundle is self-contained and works offline.
    </p>
  {/if}
</section>

<style>
  .export-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text, #e0e0e0);
  }

  .export-header {
    display: flex;
    align-items: center;
  }

  .export-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Buttons ──────────────────────────────────────────────────────────── */
  .export-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--color-border, #444);
    border-radius: 5px;
    background: var(--color-surface, #242424);
    color: var(--color-text, #e0e0e0);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, opacity 0.12s;
    width: 100%;
    justify-content: center;
  }

  .export-btn:hover:not(:disabled) {
    background: var(--color-surface-hover, #333);
    color: #fff;
  }

  .export-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .export-btn svg {
    width: 0.95rem;
    height: 0.95rem;
    flex-shrink: 0;
  }

  /* ── Spinner (simple CSS-only ring) ──────────────────────────────────── */
  .spinner {
    display: inline-block;
    width: 0.85rem;
    height: 0.85rem;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Feedback message ─────────────────────────────────────────────────── */
  .export-message {
    margin: 0;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-dim, #aaa);
    line-height: 1.45;
  }

  .export-message.is-error {
    background: rgba(220, 50, 50, 0.15);
    color: #f87171;
  }

  /* ── Hint text ────────────────────────────────────────────────────────── */
  .export-hint {
    margin: 0;
    font-size: 0.7rem;
    color: var(--color-text-dim, #666);
    font-style: italic;
    line-height: 1.4;
  }
</style>
