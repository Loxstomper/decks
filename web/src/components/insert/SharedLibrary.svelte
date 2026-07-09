<script lang="ts">
  /**
   * SharedLibrary.svelte — P5-5: browse the shared/ image library and
   * copy-on-insert into the deck's assets/.
   *
   * WHY COPY-ON-INSERT (spec assets-and-media):
   *   The shared/ directory is an optional source library, NOT a shared asset
   *   store.  Inserting from it COPIES the file into decks/{name}/assets/ so
   *   that the deck remains self-contained and offline-capable.  No cross-deck
   *   reference is ever created.
   *
   * UI:
   *   • Fetches the shared library list on mount (GET /api/shared).
   *   • Shows a 3-column thumbnail grid (lazy-loaded <img> previews).
   *   • Empty state when shared/ is absent or empty.
   *   • Clicking a thumbnail copies it into the deck and calls onInsert().
   */

  import { onMount } from 'svelte';
  import { buildImageBlock } from '$lib/blocks/builders';
  import { listShared, copySharedAsset, type SharedFile } from '$lib/blocks/api';
  import type { ElementNode } from '$lib/model';

  interface Props {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  }

  const { deckName, onInsert, onCancel }: Props = $props();

  // ── State ─────────────────────────────────────────────────────────────────

  let files = $state<SharedFile[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let copying = $state<string | null>(null); // path of file being copied

  // ── Load on mount ─────────────────────────────────────────────────────────

  onMount(async () => {
    try {
      files = await listShared();
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  // ── Insert pipeline ───────────────────────────────────────────────────────

  async function insertSharedFile(file: SharedFile): Promise<void> {
    if (copying) return; // prevent double-click races
    copying = file.path;
    try {
      // The copy endpoint matches on the bare filename (shared/<name>), so pass
      // file.name, not the rel_src path.
      const src = await copySharedAsset(deckName, file.name);
      // Use the bare filename (no extension) as an alt text hint.
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const node = buildImageBlock(src, alt);
      onInsert(node);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      copying = null;
    }
  }
</script>

<div class="shared-library">
  <header class="lib-header">
    <h3 class="lib-title">Shared library</h3>
    {#if onCancel}
      <button type="button" class="cancel-btn" onclick={onCancel} aria-label="Close shared library">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </header>

  {#if loading}
    <div class="state-box">
      <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <p class="state-label">Loading shared library…</p>
    </div>
  {:else if loadError}
    <div class="state-box">
      <p class="error-label" role="alert">{loadError}</p>
    </div>
  {:else if files.length === 0}
    <div class="state-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="empty-icon">
        <rect x="2" y="7" width="20" height="15" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
      <p class="state-label">The <code>shared/</code> directory is empty.</p>
      <p class="state-hint">Drop image files into <code>shared/</code> in your workspace to make them available here.</p>
    </div>
  {:else}
    <div class="grid">
      {#each files as file (file.path)}
        <button
          type="button"
          class="thumb-btn"
          class:copying={copying === file.path}
          title={file.name}
          aria-label="Insert {file.name}"
          disabled={copying !== null}
          onclick={() => insertSharedFile(file)}
        >
          <img
            src={file.url}
            alt={file.name}
            loading="lazy"
            class="thumb-img"
          />
          <span class="thumb-name">{file.name}</span>
          {#if copying === file.path}
            <div class="thumb-overlay" aria-hidden="true">
              <svg class="spinner-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
              </svg>
            </div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .shared-library {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 180px;
  }

  .lib-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .lib-title {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255,255,255,0.85);
  }

  .cancel-btn {
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

  .cancel-btn:hover { color: #fff; }
  .cancel-btn svg { width: 1rem; height: 1rem; }

  /* Loading / empty / error */
  .state-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 0.5rem;
    padding: 2rem 1rem;
    text-align: center;
  }

  .state-label {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.5);
    margin: 0;
  }

  .state-hint {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.3);
    margin: 0;
  }

  .error-label {
    font-size: 0.75rem;
    color: #f87171;
    margin: 0;
  }

  .empty-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: rgba(255,255,255,0.2);
  }

  /* Thumbnail grid */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .thumb-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 0.375rem;
    padding: 0.375rem;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    overflow: hidden;
  }

  .thumb-btn:hover:not(:disabled) {
    background: rgba(74, 158, 255, 0.12);
    border-color: rgba(74, 158, 255, 0.4);
  }

  .thumb-btn:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .thumb-img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: 0.25rem;
  }

  .thumb-name {
    font-size: 0.6rem;
    color: rgba(255,255,255,0.4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  /* Spinner overlay while copying */
  .thumb-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.5);
    border-radius: inherit;
  }

  .spinner, .spinner-sm {
    color: rgba(255,255,255,0.6);
    animation: spin 1s linear infinite;
  }

  .spinner { width: 2rem; height: 2rem; }
  .spinner-sm { width: 1.25rem; height: 1.25rem; }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
