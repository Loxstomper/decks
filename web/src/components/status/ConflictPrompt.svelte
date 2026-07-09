<script lang="ts">
  /**
   * ConflictPrompt.svelte — Dirty-guard conflict dialog (P8-6 / spec claude-code-integration §4).
   *
   * When an external (Claude Code) write arrives WHILE the editor has unsaved
   * edits, the deck store records a `conflict` instead of clobbering the user's
   * work. This component renders the prompt for that conflict and offers the
   * three turn-taking choices (spec claude-code-integration "prompt on conflict"):
   *
   *   • Keep mine   — reject the external write; my edits will overwrite on save.
   *   • Take theirs — discard my edits and adopt the external version.
   *   • View diff   — inspect a line diff of mine vs theirs before deciding.
   *
   * It renders nothing unless `deckStore.conflict` is set, so it can be mounted
   * unconditionally by the shell. All resolution logic lives in the store
   * (resolveKeepMine / resolveTakeTheirs); this is just the surface.
   */
  import { deckStore } from '$lib/store/deck.svelte.ts';

  // Local UI state: whether the inline diff view is expanded.
  let showDiff = $state(false);

  // Recompute the diff lazily only while the panel is open (it's O(n·m)).
  const diff = $derived(showDiff ? deckStore.conflictDiff : []);

  function keepMine(): void {
    showDiff = false;
    deckStore.resolveKeepMine();
  }
  function takeTheirs(): void {
    showDiff = false;
    deckStore.resolveTakeTheirs();
  }
</script>

{#if deckStore.hasConflict}
  <!-- Modal-style overlay; aria-modal so assistive tech traps focus here. -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="conflict-title"
  >
    <div
      class="w-full max-w-2xl rounded-lg border border-surface-overlay bg-surface-raised shadow-xl"
    >
      <div class="p-4 border-b border-surface-overlay">
        <h2 id="conflict-title" class="text-sm font-semibold text-fg">
          This deck changed on disk
        </h2>
        <p class="mt-1 text-xs text-fg/60">
          Claude Code (or another tool) edited <code class="text-accent">{deckStore.name}</code>
          while you have unsaved changes. Choose which version to keep — your work
          will not be overwritten until you decide.
        </p>
      </div>

      {#if showDiff}
        <!-- Line diff: mine (red, −) vs theirs (green, +). -->
        <div
          class="max-h-72 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed bg-black/30"
        >
          {#each diff as line (line.tag + line.text)}
            {#if line.tag === 'del'}
              <div class="text-red-400 whitespace-pre-wrap">- {line.text}</div>
            {:else if line.tag === 'add'}
              <div class="text-emerald-400 whitespace-pre-wrap">+ {line.text}</div>
            {:else}
              <div class="text-fg/40 whitespace-pre-wrap">&nbsp; {line.text}</div>
            {/if}
          {/each}
          {#if diff.length === 0}
            <div class="text-fg/40">No textual differences.</div>
          {/if}
        </div>
      {/if}

      <div class="flex items-center justify-between gap-2 p-4">
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs text-fg/70 hover:bg-white/5"
          onclick={() => (showDiff = !showDiff)}
        >
          {showDiff ? 'Hide diff' : 'View diff'}
        </button>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs text-fg/80 border border-surface-overlay hover:bg-white/5"
            onclick={takeTheirs}
          >
            Take theirs
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs font-medium text-white bg-accent/80 hover:bg-accent"
            onclick={keepMine}
          >
            Keep mine
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
