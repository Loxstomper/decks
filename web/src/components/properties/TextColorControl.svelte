<script lang="ts">
  /**
   * TextColorControl.svelte — Per-element text colour control (P9-8 / spec theming-and-styles
   * "Text appearance").
   *
   * WHY THIS EXISTS:
   * ================
   * The one deliberate appearance exception to the editor's layout-only ownership
   * (spec theming-and-styles): a whole-element text colour for the selected text leaf. It writes
   * an inline `style="color: …"` via the parent's callback, which routes to
   * deckStore.applyTextColor (one undo entry + one autosave, byte-stable).
   *
   * PURELY PRESENTATIONAL (like AlignmentToolbar): it receives the current colour
   * and fires a typed callback. Svelte 5 runes + callback props — no dispatcher.
   */

  interface Props {
    /** Current inline `color` value, or null when none is set. */
    color: string | null;
    /** Fired with the new colour, or null to clear the inline colour. */
    onColorChange: (value: string | null) => void;
  }

  let { color, onColorChange }: Props = $props();

  /** The native <input type="color"> needs a hex value; default to black. */
  const swatch = $derived(color ?? '#000000');

  function onPick(e: Event): void {
    onColorChange((e.target as HTMLInputElement).value);
  }
</script>

<div class="prop-section">
  <div class="section-sublabel">Text color</div>
  <div class="color-row">
    <input
      class="color-swatch"
      type="color"
      value={swatch}
      title="Text color"
      aria-label="Text color"
      oninput={onPick}
    />
    <span class="color-value">{color ?? 'default'}</span>
    {#if color}
      <button class="clear-btn" title="Clear text color" onclick={() => onColorChange(null)}>
        Clear
      </button>
    {/if}
  </div>
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

  .color-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
  }

  .color-swatch::-webkit-color-swatch-wrapper {
    padding: 2px;
  }
  .color-swatch::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }

  .color-value {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono, monospace);
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clear-btn {
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .clear-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }
</style>
