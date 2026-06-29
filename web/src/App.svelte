<script lang="ts">
  /**
   * App.svelte — editor shell wiring (Phase 1 integration).
   *
   * Responsibilities:
   *   • Discover decks (GET /api/decks) on startup and open the first one.
   *   • Bind the deck store to the three Phase-1 surfaces:
   *       Navigator → deck list + sync status
   *       Canvas    → RevealFrame (iframe), reloaded when on-disk bytes change
   *       Source    → SourcePane (CodeMirror), edits funnel through the store
   *   • Bridge SSE external-change events into the store (P1-9 turn-taking).
   *
   * The store (deckStore) owns all data-flow rules; this component is pure glue.
   */

  import { onMount, onDestroy } from 'svelte';
  import PaneLayout from './components/layout/PaneLayout.svelte';
  import RevealFrame from './components/canvas/RevealFrame.svelte';
  import SourcePane from './components/source/SourcePane.svelte';
  import { createSseClient } from '$lib/sse';
  import { deckStore, type DeckStatus } from '$lib/store/deck.svelte.ts';

  // RevealFrame instance (exposes reload()); bound via the canvas snippet.
  let frame = $state<{ reload: () => void } | undefined>();

  // Available deck names (from GET /api/decks).
  let decks = $state<string[]>([]);

  // ── SSE: external (Claude Code) writes → reload model + canvas (P1-9) ───────
  const sse = createSseClient();
  // Wildcard subscription: filter to the open deck inside the handler so that
  // opening a different deck does not require re-subscribing.
  const offDeckChanged = sse.onDeckChanged(null, (ev) => {
    if (ev.deck === deckStore.name) void deckStore.onExternalChange();
  });

  onMount(async () => {
    try {
      const res = await fetch('/api/decks');
      if (res.ok) decks = await res.json();
    } catch {
      // Backend unreachable (e.g. running the SPA without the Go server).
      // The empty state is the correct fallback.
    }
    if (decks.length > 0) await deckStore.load(decks[0]);
  });

  onDestroy(() => {
    offDeckChanged();
    sse.close();
  });

  // ── Canvas reload bridge ────────────────────────────────────────────────────
  // The store bumps reloadNonce whenever the on-disk file changes (initial load,
  // successful save, adopted external change). Translate that into an explicit
  // iframe reload so the canvas always mirrors persisted bytes. We track the last
  // handled value to avoid reacting to unrelated re-renders.
  let lastNonce = 0;
  $effect(() => {
    const n = deckStore.reloadNonce;
    if (n !== lastNonce) {
      lastNonce = n;
      frame?.reload();
    }
  });

  async function openDeck(name: string): Promise<void> {
    if (name === deckStore.name) return;
    await deckStore.load(name);
  }

  // Human-readable status label + colour for the indicator (spec 11 §5).
  const STATUS_META: Record<DeckStatus, { label: string; class: string }> = {
    empty:    { label: 'No deck',        class: 'text-white/30' },
    synced:   { label: 'Synced',         class: 'text-emerald-400/80' },
    unsaved:  { label: 'Unsaved…',  class: 'text-amber-400/80' },
    saving:   { label: 'Saving…',   class: 'text-sky-400/80' },
    external: { label: 'External change', class: 'text-accent' },
    error:    { label: 'Error',          class: 'text-red-400' },
  };
  const statusMeta = $derived(STATUS_META[deckStore.status]);
</script>

<PaneLayout>
  {#snippet navigator()}
    <div class="flex flex-col gap-3">
      <!-- Sync status indicator (spec 11 §5) -->
      <div class="flex items-center gap-2 px-1">
        <span class="inline-block w-2 h-2 rounded-full {statusMeta.class}" style="background-color: currentColor;"></span>
        <span class="text-xs {statusMeta.class}">{statusMeta.label}</span>
      </div>

      <!-- Deck list -->
      {#if decks.length === 0}
        <p class="text-xs text-white/30 mt-2 text-center">No decks yet</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each decks as name (name)}
            <li>
              <button
                type="button"
                class="w-full text-left px-2 py-1 rounded text-xs truncate transition-colors
                       {name === deckStore.name
                         ? 'bg-accent/20 text-white'
                         : 'text-white/60 hover:bg-white/5 hover:text-white'}"
                onclick={() => openDeck(name)}
              >
                {name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/snippet}

  {#snippet canvas()}
    <RevealFrame bind:this={frame} deckUrl={deckStore.deckUrl} />
  {/snippet}

  {#snippet source()}
    <SourcePane
      value={deckStore.source}
      onChange={(next) => deckStore.updateFromSource(next)}
    />
  {/snippet}
</PaneLayout>
