<script lang="ts">
  /**
   * NotesPanel.svelte — Per-slide speaker notes editor (P7-2 / spec 10).
   *
   * WHY A DEDICATED COMPONENT:
   * Speaker notes live as `<aside class="notes">` inside each `<section>` (spec
   * 10). The reveal speaker window (S key on the present route) reads them. This
   * panel gives the author a textarea that is always synced to the current slide's
   * notes and commits changes as undoable, autosaved deck commands.
   *
   * DESIGN:
   *   • `slideEid`     — the data-eid of the current slide (null = no slide).
   *   • `onSetNotes`   — callback that fires when the user commits a notes edit.
   *                      The integrator wires this to deckStore.setSlideNotes.
   *
   * SVELTE 5 (runes): state is fully derived from props; no local caching of
   * notes text to avoid stale-closure issues with the debounce.
   *
   * DEBOUNCE:
   * The textarea fires `oninput` on every keystroke. We debounce the commit so
   * we do not flood the undo stack with one entry per character. The debounce
   * timer is cancelled on blur so that the final value is always flushed
   * immediately when the user leaves the field.
   */

  import { deckStore } from '$lib/store/deck.svelte';

  // ── Props ────────────────────────────────────────────────────────────────────

  interface Props {
    /** data-eid of the current slide section, or null when nothing is selected. */
    slideEid: string | null;
    /** Called with (slideEid, text) when the user finishes editing notes. */
    onSetNotes: (slideEid: string, text: string) => void;
  }

  let { slideEid, onSetNotes }: Props = $props();

  // ── Derived ─────────────────────────────────────────────────────────────────

  /**
   * Current notes text derived from the model.  Refreshes whenever the slide
   * changes or the store's model is updated (e.g. undo/redo/external change).
   * We do NOT keep a local copy — the store is the single source of truth.
   */
  const savedNotes = $derived(deckStore.getSlideNotesText(slideEid));

  // ── Local debounce state ─────────────────────────────────────────────────────

  /**
   * Pending value from the textarea that has not yet been committed to the store.
   * Kept separately so the textarea stays responsive while the debounce is
   * ticking, without funnelling every keystroke through a full model round-trip.
   */
  let pendingText = $state<string | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** The value to display in the textarea: pending edit or last saved text. */
  const displayText = $derived(pendingText !== null ? pendingText : savedNotes);

  // When the active slide changes, clear any pending edit so we show the new
  // slide's notes immediately (the in-flight debounce is irrelevant now).
  $effect(() => {
    // Accessing slideEid in the effect body registers it as a dependency.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    slideEid;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingText = null;
  });

  // ── Interaction ──────────────────────────────────────────────────────────────

  const DEBOUNCE_MS = 600;

  function handleInput(e: Event): void {
    if (!slideEid) return;
    const text = (e.currentTarget as HTMLTextAreaElement).value;
    pendingText = text;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      pendingText = null; // let savedNotes take over after the commit
      onSetNotes(slideEid!, text);
    }, DEBOUNCE_MS);
  }

  function handleBlur(e: Event): void {
    if (!slideEid) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // Flush immediately: the user left the field.
    const text = (e.currentTarget as HTMLTextAreaElement).value;
    if (text !== savedNotes) {
      pendingText = null;
      onSetNotes(slideEid, text);
    } else {
      pendingText = null;
    }
  }
</script>

<section class="notes-panel" aria-label="Speaker notes">
  <header class="notes-header">
    <span class="notes-label">Speaker notes</span>
    {#if !slideEid}
      <span class="notes-hint">No slide selected</span>
    {:else if displayText === ''}
      <span class="notes-hint">S key in present mode opens speaker view</span>
    {/if}
  </header>

  <textarea
    class="notes-textarea"
    placeholder={slideEid ? 'Add speaker notes for this slide…' : 'Select a slide to add notes'}
    disabled={!slideEid}
    value={displayText}
    oninput={handleInput}
    onblur={handleBlur}
    aria-label="Speaker notes for current slide"
    spellcheck="true"
    rows={5}
  ></textarea>
</section>

<style>
  .notes-panel {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text, #e0e0e0);
  }

  .notes-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .notes-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .notes-hint {
    font-size: 0.7rem;
    color: var(--color-text-dim, #666);
    font-style: italic;
  }

  .notes-textarea {
    width: 100%;
    min-height: 5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    background: var(--color-input, #141414);
    color: var(--color-text, #e0e0e0);
    font-size: 0.8125rem;
    font-family: inherit;
    line-height: 1.5;
    resize: vertical;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }

  .notes-textarea:focus {
    outline: none;
    border-color: var(--color-accent, #6366f1);
  }

  .notes-textarea:disabled {
    opacity: 0.4;
    cursor: default;
    resize: none;
  }

  .notes-textarea::placeholder {
    color: var(--color-text-dim, #555);
    font-style: italic;
  }
</style>
