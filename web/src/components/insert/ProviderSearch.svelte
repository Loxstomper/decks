<script lang="ts">
  /**
   * ProviderSearch.svelte — P5-7 / P5-8: search Unsplash and Giphy (and any
   * future provider) for images, then localize the chosen one into the deck.
   *
   * WHY ONE PANEL FOR ALL PROVIDERS:
   *   The provider interface is uniform (search → result grid → fetch/localize).
   *   A single panel with a provider picker avoids N separate panels and makes
   *   adding a future provider (Gemini, etc.) a zero-UI-work change.
   *
   * EMPTY STATE: when no provider has an API key configured (enabled: false for
   * all), we show a friendly "set UNSPLASH_ACCESS_KEY / GIPHY_API_KEY" message
   * instead of a broken search box.  Keys live in the server env, never the
   * frontend (spec 12 §5).
   *
   * OFFLINE-FIRST: the "fetch" step (POST /api/providers/{name}/fetch)
   * downloads the image into decks/{name}/assets/ so the inserted src is always
   * a local relative path (spec 08, 12).
   *
   * DEBOUNCE: search fires 350 ms after the user stops typing to avoid
   * hammering the API on every keystroke.
   */

  import { onMount } from 'svelte';
  import { buildImageBlock } from '$lib/blocks/builders';
  import {
    listProviders,
    searchProvider,
    fetchProviderImage,
    type Provider,
    type ProviderResult,
  } from '$lib/blocks/api';
  import type { ElementNode } from '$lib/model';

  interface Props {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  }

  const { deckName, onInsert, onCancel }: Props = $props();

  // ── State ─────────────────────────────────────────────────────────────────

  let providers = $state<Provider[]>([]);
  let activeProvider = $state<string>('');
  let query = $state('');
  let results = $state<ProviderResult[]>([]);
  let loadingProviders = $state(true);
  let searching = $state(false);
  let fetching = $state<string | null>(null); // id of result being fetched
  let searchError = $state<string | null>(null);

  const enabledProviders = $derived(providers.filter((p) => p.enabled));
  const noProvidersEnabled = $derived(!loadingProviders && enabledProviders.length === 0);

  // ── Load providers on mount ───────────────────────────────────────────────

  onMount(async () => {
    try {
      providers = await listProviders();
      // Auto-select the first enabled provider.
      const first = providers.find((p) => p.enabled);
      if (first) activeProvider = first.name;
    } catch {
      // Non-fatal: show empty state.
    } finally {
      loadingProviders = false;
    }
  });

  // ── Debounced search ──────────────────────────────────────────────────────

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function onQueryChange(e: Event): void {
    query = (e.currentTarget as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    if (!query.trim() || !activeProvider) {
      results = [];
      searching = false;
      return;
    }
    searching = true; // show spinner before the debounce fires
    searchTimer = setTimeout(() => {
      void runSearch();
    }, 350);
  }

  async function runSearch(): Promise<void> {
    if (!query.trim() || !activeProvider) {
      results = [];
      searching = false;
      return;
    }
    searching = true;
    searchError = null;
    try {
      results = await searchProvider(activeProvider, query);
    } catch (e) {
      searchError = e instanceof Error ? e.message : String(e);
      results = [];
    } finally {
      searching = false;
    }
  }

  function onProviderChange(e: Event): void {
    activeProvider = (e.currentTarget as HTMLSelectElement).value;
    // Re-run the current query with the new provider.
    if (query.trim()) void runSearch();
  }

  // ── Localize + insert ─────────────────────────────────────────────────────

  async function insertResult(result: ProviderResult): Promise<void> {
    if (fetching) return; // prevent races
    fetching = result.id;
    searchError = null;
    try {
      const src = await fetchProviderImage(deckName, activeProvider, result);
      const node = buildImageBlock(src, result.description ?? '');
      onInsert(node);
    } catch (e) {
      searchError = e instanceof Error ? e.message : String(e);
    } finally {
      fetching = null;
    }
  }
</script>

<div class="provider-search">
  <header class="ps-header">
    <h3 class="ps-title">Search images</h3>
    {#if onCancel}
      <button type="button" class="cancel-btn" onclick={onCancel} aria-label="Close image search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </header>

  {#if loadingProviders}
    <div class="state-box">
      <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
      </svg>
    </div>
  {:else if noProvidersEnabled}
    <!-- ── Empty state: no API keys configured ────────────────────────────── -->
    <div class="state-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="empty-icon">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
      <p class="state-label">No image providers enabled.</p>
      <p class="state-hint">
        Set one or more environment variables before starting the server:
      </p>
      <ul class="key-list">
        <li><code>UNSPLASH_ACCESS_KEY</code> — Unsplash photos</li>
        <li><code>GIPHY_API_KEY</code> — Giphy GIFs</li>
      </ul>
      <p class="state-hint">Keys are read server-side only and never sent to the browser.</p>
    </div>
  {:else}
    <!-- ── Search UI ─────────────────────────────────────────────────────── -->
    <div class="search-row">
      <!-- Provider selector (hidden when only one enabled provider) -->
      {#if enabledProviders.length > 1}
        <select
          class="provider-select"
          value={activeProvider}
          aria-label="Image provider"
          onchange={onProviderChange}
        >
          {#each enabledProviders as p (p.name)}
            <option value={p.name}>{p.label}</option>
          {/each}
        </select>
      {/if}

      <div class="search-input-wrap">
        <input
          type="search"
          class="search-input"
          placeholder="Search {enabledProviders.find(p => p.name === activeProvider)?.label ?? 'images'}…"
          value={query}
          oninput={onQueryChange}
          aria-label="Search query"
          autocomplete="off"
          spellcheck="false"
        />
        {#if searching}
          <svg class="input-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
          </svg>
        {/if}
      </div>
    </div>

    {#if searchError}
      <p class="error-label" role="alert">{searchError}</p>
    {/if}

    {#if results.length === 0 && !searching && query.trim()}
      <div class="state-box compact">
        <p class="state-label">No results for "{query}"</p>
      </div>
    {:else if results.length > 0}
      <div class="results-grid">
        {#each results as result (result.id)}
          <button
            type="button"
            class="result-btn"
            class:fetching-item={fetching === result.id}
            title={result.description || 'Insert image'}
            aria-label="Insert: {result.description || result.id}"
            disabled={fetching !== null}
            onclick={() => insertResult(result)}
          >
            <img
              src={result.thumb_url}
              alt={result.description ?? ''}
              loading="lazy"
              class="result-img"
            />
            {#if fetching === result.id}
              <div class="result-overlay" aria-hidden="true">
                <svg class="spinner-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                </svg>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {:else if !query.trim()}
      <div class="state-box compact">
        <p class="state-label">Type to search for images</p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .provider-search {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .ps-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .ps-title {
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

  /* State boxes */
  .state-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1rem;
    gap: 0.5rem;
    text-align: center;
  }

  .state-box.compact { padding: 1rem; }

  .state-label {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.5);
    margin: 0;
  }

  .state-hint {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.35);
    margin: 0;
  }

  .empty-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: rgba(255,255,255,0.2);
    margin-bottom: 0.25rem;
  }

  .key-list {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .key-list li {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.45);
  }

  .key-list code {
    font-family: ui-monospace, monospace;
    color: rgba(255,255,255,0.7);
    background: rgba(255,255,255,0.07);
    padding: 0.1em 0.3em;
    border-radius: 0.2rem;
  }

  .error-label {
    font-size: 0.7rem;
    color: #f87171;
  }

  /* Search row */
  .search-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .provider-select {
    flex-shrink: 0;
    height: 2rem;
    padding: 0 0.4rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.3);
    color: rgba(255,255,255,0.7);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .search-input-wrap {
    position: relative;
    flex: 1;
  }

  .search-input {
    width: 100%;
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.3);
    color: rgba(255,255,255,0.9);
    font-size: 0.8rem;
    outline: none;
    transition: border-color 0.12s;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: rgba(74, 158, 255, 0.6);
  }

  .search-input::placeholder {
    color: rgba(255,255,255,0.25);
  }

  .input-spinner {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1rem;
    height: 1rem;
    color: rgba(255,255,255,0.4);
    animation: spin 1s linear infinite;
    pointer-events: none;
  }

  /* Results grid */
  .results-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
    max-height: 320px;
    overflow-y: auto;
  }

  .result-btn {
    position: relative;
    display: block;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 0.375rem;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    transition: border-color 0.12s;
  }

  .result-btn:hover:not(:disabled) {
    border-color: rgba(74, 158, 255, 0.5);
  }

  .result-btn:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .result-img {
    width: 100%;
    aspect-ratio: 4/3;
    object-fit: cover;
    display: block;
  }

  .result-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.55);
  }

  .spinner, .spinner-sm {
    color: rgba(255,255,255,0.7);
    animation: spin 1s linear infinite;
  }

  .spinner { width: 2rem; height: 2rem; }
  .spinner-sm { width: 1.25rem; height: 1.25rem; }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
