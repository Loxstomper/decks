<script lang="ts">
  /**
   * AltTextControl.svelte — Per-image alt text control (P17-11 / spec 08
   * "Assets and media" — accessibility alt attribute).
   *
   * PURELY PRESENTATIONAL (like TextColorControl): it receives the current alt
   * text and fires a typed callback. Svelte 5 runes + callback props — no
   * dispatcher.
   *
   * Commit on blur or Enter (not per-keystroke) so each committed change is
   * exactly one undo entry in the store command stack.
   *
   * Empty string is valid (`alt=""` = decorative image, per WCAG 2.1).
   */

  interface Props {
    /** Current `alt` attribute value, or null when the attribute is absent. */
    alt: string | null;
    /** Fired with the new alt text (including empty string). */
    onAltChange: (value: string) => void;
  }

  let { alt, onAltChange }: Props = $props();

  /** Local draft — avoids committing on every keystroke. Initialised (and
   *  re-synced on selection change) by the $effect below — never reference
   *  the `alt` prop directly in $state() to avoid Svelte's
   *  "captures the initial value" warning. */
  let draft = $state('');

  // Set initial value and re-sync whenever the selected image changes.
  $effect(() => {
    draft = alt ?? '';
  });

  function commit(): void {
    // Only commit when the value has actually changed, to avoid spurious undo
    // entries when the user clicks into and out of the field without editing.
    if (draft !== (alt ?? '')) {
      onAltChange(draft);
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }
</script>

<div class="prop-section">
  <div class="section-sublabel">Alt text</div>
  <input
    class="alt-input"
    type="text"
    placeholder="Describe the image…"
    aria-label="Image alt text"
    bind:value={draft}
    onblur={commit}
    onkeydown={onKeydown}
  />
  {#if draft === ''}
    <p class="hint">Empty = decorative (screen readers skip)</p>
  {/if}
</div>

<style>
  .prop-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 12px;
  }

  .section-sublabel {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 2px;
  }

  .alt-input {
    width: 100%;
    box-sizing: border-box;
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

  .alt-input:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }

  .hint {
    margin: 0;
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.25);
    font-style: italic;
    line-height: 1.3;
  }
</style>
