<script lang="ts">
  /**
   * ValidationBanner.svelte — Save-blocked validation surface (P8-3 / spec claude-code-integration).
   *
   * When validate-on-save rejects the editor's bytes (parse failure, unstable
   * round-trip, or a layout-contract violation), the deck store does NOT persist
   * and records the problems in `validationErrors`. This banner makes that
   * legible: it lists each problem so the user can see WHY the deck stopped
   * saving and fix it — "show the errors and let the user decide; don't clobber"
   * (spec claude-code-integration). It renders nothing when there are no problems.
   *
   * Resolution is implicit: once the user fixes the source the next debounced
   * save validates clean and the banner disappears. A dismiss button hides it
   * without saving (the problems remain in the source until corrected).
   */
  import { deckStore } from '$lib/store/deck.svelte.ts';

  const errors = $derived(deckStore.validationErrors);
</script>

{#if errors.length > 0}
  <div
    class="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
    role="alert"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="font-semibold">
        Save blocked — {errors.length} problem{errors.length === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        class="text-red-200/60 hover:text-red-100"
        title="Dismiss"
        aria-label="Dismiss validation errors"
        onclick={() => deckStore.dismissValidation()}
      >
        ✕
      </button>
    </div>
    <ul class="mt-1 space-y-0.5 list-disc list-inside">
      {#each errors as err (err.code + (err.eid ?? '') + err.message)}
        <li>
          {err.message}
          {#if err.eid}<span class="text-red-200/50">({err.eid})</span>{/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
