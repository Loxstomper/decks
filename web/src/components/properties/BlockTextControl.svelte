<script lang="ts">
  /**
   * BlockTextControl.svelte — Whole-leaf text alignment + list indent (P17-8).
   *
   * WHY THIS EXISTS (spec 04 rich text):
   * ====================================
   * Block-level text controls for the selected text leaf: a text-align strip
   * (left / center / right / justify, written as an inline `style="text-align"`
   * on the leaf) and — for `<ul>`/`<ol>` leaves — list indent / outdent (re-nest
   * the list). PURELY PRESENTATIONAL like AlignmentToolbar / TextColorControl: it
   * receives the current values and fires typed callbacks that route to
   * deckStore.applyTextAlign / indentList (one undo entry + one autosave each,
   * byte-stable). Svelte 5 runes; callback props (no dispatcher).
   */

  type Align = 'left' | 'center' | 'right' | 'justify';

  interface Props {
    /** Current inline `text-align` value, or null when none is set. */
    align: string | null;
    /** Whether the leaf is a list (`<ul>`/`<ol>`) — gates the indent controls. */
    isList: boolean;
    /** Fired with the new alignment, or null to clear (toggle off). */
    onAlign: (value: Align | null) => void;
    /** Fired to indent (`'in'`) or outdent (`'out'`) a list leaf. */
    onIndent: (dir: 'in' | 'out') => void;
  }

  let { align, isList, onAlign, onIndent }: Props = $props();

  const ALIGNS: ReadonlyArray<{ value: Align; title: string }> = [
    { value: 'left', title: 'Align left' },
    { value: 'center', title: 'Align center' },
    { value: 'right', title: 'Align right' },
    { value: 'justify', title: 'Justify' },
  ];

  /** Clicking the active alignment clears it (back to the theme default). */
  function handleAlign(value: Align): void {
    onAlign(align === value ? null : value);
  }
</script>

<div class="prop-section">
  <div class="section-sublabel">Text align</div>
  <div class="btn-row">
    {#each ALIGNS as a (a.value)}
      <button
        class="icon-btn"
        class:active={align === a.value}
        title={a.title}
        aria-label={a.title}
        aria-pressed={align === a.value}
        onclick={() => handleAlign(a.value)}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          {#if a.value === 'left'}
            <line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="12" y2="10" /><line x1="3" y1="15" x2="15" y2="15" />
          {:else if a.value === 'center'}
            <line x1="3" y1="5" x2="17" y2="5" /><line x1="6" y1="10" x2="14" y2="10" /><line x1="4" y1="15" x2="16" y2="15" />
          {:else if a.value === 'right'}
            <line x1="3" y1="5" x2="17" y2="5" /><line x1="8" y1="10" x2="17" y2="10" /><line x1="5" y1="15" x2="17" y2="15" />
          {:else}
            <line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" />
          {/if}
        </svg>
      </button>
    {/each}
  </div>

  {#if isList}
    <div class="section-sublabel indent-label">List indent</div>
    <div class="btn-row">
      <button class="icon-btn" title="Outdent" aria-label="Outdent list" onclick={() => onIndent('out')}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <line x1="8" y1="5" x2="17" y2="5" /><line x1="8" y1="10" x2="17" y2="10" /><line x1="8" y1="15" x2="17" y2="15" />
          <polyline points="6,7 3,10 6,13" />
        </svg>
      </button>
      <button class="icon-btn" title="Indent" aria-label="Indent list" onclick={() => onIndent('in')}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <line x1="8" y1="5" x2="17" y2="5" /><line x1="8" y1="10" x2="17" y2="10" /><line x1="8" y1="15" x2="17" y2="15" />
          <polyline points="3,7 6,10 3,13" />
        </svg>
      </button>
    </div>
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

  .indent-label {
    margin-top: 4px;
  }

  .btn-row {
    display: flex;
    flex-direction: row;
    gap: 3px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    padding: 0;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.9);
  }

  .icon-btn.active {
    background: rgba(var(--color-accent, 59 130 246) / 0.25);
    border-color: rgba(var(--color-accent, 59 130 246) / 0.5);
    color: rgba(255, 255, 255, 0.95);
  }

  .icon-btn svg {
    width: 16px;
    height: 16px;
  }
</style>
