<script lang="ts">
  /**
   * SelectionToolbar.svelte — Floating format toolbar over a text selection
   * (P17-7).
   *
   * WHY THIS EXISTS (spec 04 rich text):
   * ====================================
   * When the user selects text inside an active in-place edit, a small toolbar
   * appears at the selection with Bold / Italic / Underline / Strike, a font-size
   * picker, a text-colour swatch, and a Link button. It is PURELY presentational:
   * CanvasInteraction computes the selection's screen rect and passes it in, and
   * the buttons fire typed callbacks. Every button uses `onmousedown` +
   * preventDefault so clicking it does NOT blur the contenteditable / collapse the
   * selection — the parent then mutates the live DOM and commits via
   * applyRichTextEdit (one undo + one save per action).
   *
   * Svelte 5 runes; callback props (no createEventDispatcher).
   */

  import type { Rect } from '$lib/canvas/overlay-geometry.ts';

  interface Props {
    /** Selection bounding box in overlay-local screen pixels. */
    rect: Rect;
    /** Toggle a bare inline mark over the selection. */
    onToggle: (tag: 'strong' | 'em' | 'u' | 's') => void;
    /** Apply a font-size run (e.g. "1.5em"); '' clears. */
    onFontSize: (value: string) => void;
    /** Apply a colour run (hex). */
    onColor: (value: string) => void;
    /** Open the link popover for the current selection. */
    onLink: () => void;
  }

  let { rect, onToggle, onFontSize, onColor, onLink }: Props = $props();

  /** Font-size presets offered in the picker (em units, resolution-independent). */
  const FONT_SIZES: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Size', value: '' },
    { label: 'Small', value: '0.75em' },
    { label: 'Normal', value: '1em' },
    { label: 'Large', value: '1.5em' },
    { label: 'XL', value: '2em' },
  ];

  // Horizontal centre + vertical anchor of the selection (overlay-local px).
  const centerX = $derived(rect.left + rect.width / 2);
  // Prefer placing the bar ABOVE the selection; flip below when too close to top.
  const placeBelow = $derived(rect.top < 44);
  const anchorY = $derived(placeBelow ? rect.top + rect.height : rect.top);

  /** Keep the selection alive: never let a toolbar press blur the editor. */
  function hold(e: MouseEvent): void {
    e.preventDefault();
  }

  function onColorInput(e: Event): void {
    onColor((e.target as HTMLInputElement).value);
  }

  function onSizeChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    (e.target as HTMLSelectElement).selectedIndex = 0; // reset to "Size"
    if (v) onFontSize(v);
  }
</script>

<div
  class="sel-toolbar"
  class:below={placeBelow}
  style:left="{centerX}px"
  style:top="{anchorY}px"
  role="toolbar"
  tabindex="-1"
  aria-label="Text formatting"
  onmousedown={hold}
>
  <button class="st-btn" title="Bold (Cmd/Ctrl+B)" aria-label="Bold" onmousedown={hold} onclick={() => onToggle('strong')}>
    <span style="font-weight:800">B</span>
  </button>
  <button class="st-btn" title="Italic (Cmd/Ctrl+I)" aria-label="Italic" onmousedown={hold} onclick={() => onToggle('em')}>
    <span style="font-style:italic">I</span>
  </button>
  <button class="st-btn" title="Underline (Cmd/Ctrl+U)" aria-label="Underline" onmousedown={hold} onclick={() => onToggle('u')}>
    <span style="text-decoration:underline">U</span>
  </button>
  <button class="st-btn" title="Strikethrough" aria-label="Strikethrough" onmousedown={hold} onclick={() => onToggle('s')}>
    <span style="text-decoration:line-through">S</span>
  </button>

  <span class="st-sep"></span>

  <select class="st-select" title="Font size" aria-label="Font size" onmousedown={hold} onchange={onSizeChange}>
    {#each FONT_SIZES as size (size.label)}
      <option value={size.value}>{size.label}</option>
    {/each}
  </select>

  <label class="st-color" title="Text color">
    <span class="st-color-glyph">A</span>
    <input type="color" aria-label="Text color" onmousedown={hold} oninput={onColorInput} />
  </label>

  <span class="st-sep"></span>

  <button class="st-btn" title="Link" aria-label="Add or edit link" onmousedown={hold} onclick={onLink}>
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M8 11a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24L9.5 5.5" />
      <path d="M12 9a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24L10.5 14.5" />
    </svg>
  </button>
</div>

<style>
  .sel-toolbar {
    position: absolute;
    /* Centre horizontally on the selection; sit just ABOVE it. */
    transform: translate(-50%, calc(-100% - 8px));
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px;
    background: rgba(22, 22, 26, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.3),
      0 8px 24px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    /* Re-enable pointer events (the canvas overlay layer is pointer-events:none). */
    pointer-events: auto;
    z-index: 50;
    user-select: none;
    white-space: nowrap;
  }

  /* Flip below the selection when there is no room above. */
  .sel-toolbar.below {
    transform: translate(-50%, 8px);
  }

  .st-btn {
    min-width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.07s ease;
  }

  .st-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .st-btn svg {
    width: 16px;
    height: 16px;
  }

  .st-sep {
    width: 1px;
    height: 18px;
    margin: 0 2px;
    background: rgba(255, 255, 255, 0.12);
  }

  .st-select {
    height: 26px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
    outline: none;
  }

  .st-select option {
    background: #16161a;
    color: #fff;
  }

  .st-color {
    position: relative;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    cursor: pointer;
  }

  .st-color:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .st-color-glyph {
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.85);
    border-bottom: 2px solid #e53e3e;
    line-height: 1;
    pointer-events: none;
  }

  /* The native colour input fills the swatch but stays invisible (the glyph is
     the affordance); clicking anywhere on the swatch opens the picker. */
  .st-color input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: none;
    padding: 0;
    cursor: pointer;
  }
</style>
