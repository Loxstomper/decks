<script lang="ts">
  /**
   * StatusIndicator.svelte — Turn-taking status badge (P8-5 / spec 11 §5).
   *
   * Spec 11 requires a legible indicator of the human↔Claude handoff state:
   * "synced / external change / unsaved". This is the proper, accessible version
   * of the basic badge the deck store already drove: a coloured dot + label, with
   * a `role="status"` live region so screen readers announce transitions.
   *
   * It reads the deckStore singleton directly (one deck open at a time), deriving
   * the displayed state from `status`, plus the two P8 conditions that layer on
   * top of the coarse status:
   *   • a pending CONFLICT (P8-6) → "External change" needing a decision,
   *   • VALIDATION errors (P8-3) → "Save blocked" so the user knows why the deck
   *     stopped persisting.
   *
   * Pure presentation: it dispatches no actions (the ConflictPrompt /
   * ValidationBanner own resolution); it only makes the handoff legible.
   */
  import { deckStore } from '$lib/store/deck.svelte.ts';

  interface Meta {
    label: string;
    /** Tailwind text colour class (also drives the dot via currentColor). */
    class: string;
    /** Whether the dot should pulse (in-flight / needs-attention states). */
    pulse?: boolean;
  }

  // Derive the indicator state. Order matters: a conflict or validation failure
  // is more urgent than the coarse store status and takes precedence.
  const meta = $derived.by<Meta>(() => {
    if (deckStore.hasConflict) {
      return { label: 'External change — resolve', class: 'text-accent', pulse: true };
    }
    if (deckStore.validationErrors.length > 0) {
      return { label: 'Save blocked', class: 'text-red-400', pulse: true };
    }
    switch (deckStore.status) {
      case 'empty':
        return { label: 'No deck', class: 'text-white/30' };
      case 'synced':
        return { label: 'Synced', class: 'text-emerald-400/80' };
      case 'unsaved':
        return { label: 'Unsaved…', class: 'text-amber-400/80' };
      case 'saving':
        return { label: 'Saving…', class: 'text-sky-400/80', pulse: true };
      case 'external':
        return { label: 'External change', class: 'text-accent', pulse: true };
      case 'error':
        return { label: 'Error', class: 'text-red-400' };
    }
  });
</script>

<div
  class="flex items-center gap-2 px-1 {meta.class}"
  role="status"
  aria-live="polite"
  title={meta.label}
>
  <span
    class="inline-block w-2 h-2 rounded-full {meta.pulse ? 'animate-pulse' : ''}"
    style="background-color: currentColor;"
  ></span>
  <span class="text-xs">{meta.label}</span>
</div>
