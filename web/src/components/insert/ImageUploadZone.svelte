<script lang="ts">
  /**
   * ImageUploadZone.svelte — P5-4: local image insert via drag-drop, paste,
   * or file-picker upload.
   *
   * WHY THREE PATHS:
   *   • Drag-drop: natural for users who already have a file manager open.
   *   • Paste (Ctrl+V): fastest path for screenshots or copied images.
   *   • File-picker: accessible fallback when the other two feel awkward.
   *
   * All three paths funnel through the SAME pipeline:
   *   File → uploadAsset() → relative src → buildImageBlock() → onInsert()
   *
   * The caller (FE-A InsertPalette, or App.svelte once wired) calls
   * deckStore.insertBlock(node) with the returned node.  This component
   * does NOT import deckStore directly — it stays pure of store coupling so
   * the integrator can test it in isolation.
   *
   * OFFLINE-FIRST (spec 08, 12): the upload sends the file to the Go backend,
   * which copies it into decks/{name}/assets/.  The returned src is always a
   * relative "assets/..." path — never an external URL.
   */

  import { buildImageBlock } from '$lib/blocks/builders';
  import { uploadAsset } from '$lib/blocks/api';
  import type { ElementNode } from '$lib/model';

  interface Props {
    /** Name of the currently open deck (passed in by the palette host). */
    deckName: string;
    /** Called with the ready-to-insert ElementNode after a successful upload. */
    onInsert: (node: ElementNode) => void;
    /** Called when the user explicitly cancels (e.g. clicks Cancel button). */
    onCancel?: () => void;
  }

  const { deckName, onInsert, onCancel }: Props = $props();

  // ── State ────────────────────────────────────────────────────────────────

  let uploading = $state(false);
  let error = $state<string | null>(null);
  let dragOver = $state(false);

  // ── Core pipeline ────────────────────────────────────────────────────────

  /**
   * Upload a File to the deck's assets/ and call onInsert with the built node.
   * Validates that the file is an image before sending.
   */
  async function processFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      error = `"${file.name}" is not an image (got ${file.type || 'unknown type'}).`;
      return;
    }
    error = null;
    uploading = true;
    try {
      const src = await uploadAsset(deckName, file);
      // Use the original filename as the alt text default; the user can refine
      // in the source pane.
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const node = buildImageBlock(src, alt);
      onInsert(node);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = false;
    }
  }

  // ── Drag-drop ─────────────────────────────────────────────────────────────

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    dragOver = true;
  }

  function onDragLeave(): void {
    dragOver = false;
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) await processFile(file);
  }

  // ── Paste ─────────────────────────────────────────────────────────────────

  async function onPaste(e: ClipboardEvent): Promise<void> {
    // Iterate clipboard items: find the first image.
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((it) => it.type.startsWith('image/'));
    if (!imageItem) return; // not an image paste — let it bubble normally
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) await processFile(file);
  }

  // ── File picker ───────────────────────────────────────────────────────────

  let fileInput: HTMLInputElement;

  async function onFileChange(e: Event): Promise<void> {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) await processFile(file);
  }
</script>

<!--
  The zone listens for paste events on itself (focused via tabindex=0) and for
  drag events on the whole drop zone.  File picker opens via a hidden <input>.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="upload-zone"
  class:drag-over={dragOver}
  class:uploading
  role="region"
  aria-label="Image upload zone — drag, paste, or click to upload"
  tabindex="0"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  onpaste={onPaste}
>
  {#if uploading}
    <div class="zone-body">
      <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <p class="zone-label">Uploading…</p>
    </div>
  {:else}
    <div class="zone-body">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="zone-icon">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="m21 15-5-5L5 21"/>
      </svg>
      <p class="zone-label">
        Drag an image here, paste from clipboard,<br>or
        <button
          type="button"
          class="pick-link"
          onclick={() => fileInput.click()}
        >browse files</button>
      </p>
      <p class="zone-hint">PNG, JPG, GIF, SVG, WebP</p>
    </div>
  {/if}

  {#if error}
    <p class="zone-error" role="alert">{error}</p>
  {/if}

  <!-- Hidden file input — triggered by the "browse files" button. -->
  <input
    bind:this={fileInput}
    type="file"
    accept="image/*"
    class="sr-only"
    aria-hidden="true"
    tabindex="-1"
    onchange={onFileChange}
  />
</div>

{#if onCancel}
  <div class="zone-footer">
    <button type="button" class="cancel-btn" onclick={onCancel}>Cancel</button>
  </div>
{/if}

<style>
  .upload-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 180px;
    border: 2px dashed rgba(255,255,255,0.15);
    border-radius: 0.5rem;
    padding: 1.5rem;
    cursor: default;
    transition: border-color 0.15s, background-color 0.15s;
    outline: none;
  }

  .upload-zone:focus-visible {
    border-color: rgba(74, 158, 255, 0.7);
  }

  .upload-zone.drag-over {
    border-color: rgba(74, 158, 255, 0.8);
    background-color: rgba(74, 158, 255, 0.08);
  }

  .upload-zone.uploading {
    opacity: 0.6;
    pointer-events: none;
  }

  .zone-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .zone-icon {
    width: 3rem;
    height: 3rem;
    color: rgba(255,255,255,0.3);
  }

  .zone-label {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.6);
    text-align: center;
    line-height: 1.5;
    margin: 0;
  }

  .zone-hint {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.3);
    margin: 0;
  }

  .pick-link {
    background: none;
    border: none;
    color: #4a9eff;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }

  .pick-link:hover {
    color: #7ab8ff;
  }

  .zone-error {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: #f87171;
    text-align: center;
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    color: rgba(255,255,255,0.5);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .zone-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  .cancel-btn {
    padding: 0.35rem 0.75rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(255,255,255,0.15);
    background: transparent;
    color: rgba(255,255,255,0.6);
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .cancel-btn:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }

  /* Utility for hidden file input */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
