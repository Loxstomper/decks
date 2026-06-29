<script lang="ts">
  /**
   * CssVarControls.svelte — P6-12 CSS custom property pickers.
   *
   * Provides color and font-size controls that write directly into the deck's
   * custom.css via customCssStore.applyVar(). Each control maps to a reveal.js
   * CSS custom property:
   *
   *   --r-background-color → background-color picker
   *   --r-main-color       → body text color picker
   *   --r-heading-color    → heading text color picker
   *   --r-link-color       → link color picker
   *   --r-main-font-size   → font size slider
   *
   * WHY NOT TRACK CURRENT VALUES FROM CSS:
   * Parsing CSS reliably (with cascade, defaults, overrides) requires a CSS
   * parser. Instead we read the current values from custom.css via the store's
   * source and parse the :root block with a simple regex. This is sufficient
   * because applyVar always writes its own :root section.
   *
   * Props:
   *   cssSource    — Current custom.css text (from customCssStore.source).
   *   onApplyVar   — Called with (varName, value) when a control changes.
   *                  Integrator wires to customCssStore.applyVar.
   *   disabled     — True when no deck is open.
   */

  interface Props {
    cssSource: string;
    onApplyVar?: (varName: string, value: string) => void;
    disabled?: boolean;
  }

  let { cssSource, onApplyVar, disabled = false }: Props = $props();

  /** CSS variable definitions we expose as controls. */
  const COLOR_VARS = [
    { varName: '--r-background-color', label: 'Background' },
    { varName: '--r-main-color',        label: 'Body text'   },
    { varName: '--r-heading-color',     label: 'Headings'    },
    { varName: '--r-link-color',        label: 'Links'       },
  ] as const;

  /**
   * Parse the current value of a CSS variable from the :root block in cssSource.
   * Returns the value string (e.g. "#fff", "42px") or '' if not found.
   *
   * WHY A FUNCTION NOT A DERIVED:
   * Svelte 5's $derived.by() with a captured array causes type-inference
   * issues similar to those noted in PropertiesPanel; extracted functions avoid
   * the cycle.
   */
  function getCssVarValue(varName: string): string {
    const re = new RegExp(
      `${varName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}\\s*:\\s*([^;]+);`,
    );
    const m = re.exec(cssSource);
    return m ? m[1].trim() : '';
  }

  /**
   * Convert a CSS color value to a hex string for <input type="color">.
   * The color picker requires "#RRGGBB". We attempt to map common formats:
   *   - Already #xxx or #xxxxxx  → return as-is (normalise to 6-digit)
   *   - rgb(r, g, b)             → convert to hex
   *   - rgba(r, g, b, a)        → convert to hex (ignore alpha)
   *   - Anything else            → fallback to #000000 (picker shows black)
   */
  function toPickerColor(css: string): string {
    if (!css) return '#000000';
    const trimmed = css.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      // Expand 3-digit hex to 6-digit.
      const [, r, g, b] = trimmed.match(/^#(.)(.)(.)$/)!;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const rgbM = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbM) {
      const [, rv, gv, bv] = rgbM;
      return (
        '#' +
        [rv, gv, bv]
          .map((n) => parseInt(n, 10).toString(16).padStart(2, '0'))
          .join('')
      );
    }
    return '#000000';
  }

  function handleColorChange(varName: string, e: Event): void {
    const val = (e.currentTarget as HTMLInputElement).value;
    onApplyVar?.(varName, val);
  }

  // Font size: the raw CSS value might be "42px". We parse the numeric part.
  function getFontSizePx(): number {
    const raw = getCssVarValue('--r-main-font-size');
    const m = raw.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 40;
  }

  function handleFontSizeChange(e: Event): void {
    const val = (e.currentTarget as HTMLInputElement).value;
    onApplyVar?.('--r-main-font-size', `${val}px`);
  }
</script>

<div class="css-var-controls" class:disabled>
  <div class="section-title">Colors</div>

  {#each COLOR_VARS as { varName, label }}
    <div class="control-row">
      <label class="control-label" for="cssvar-{varName}">{label}</label>
      <input
        id="cssvar-{varName}"
        type="color"
        class="color-swatch"
        {disabled}
        value={toPickerColor(getCssVarValue(varName))}
        onchange={(e) => handleColorChange(varName, e)}
        title="{label}: {varName}"
        aria-label="{label} color"
      />
    </div>
  {/each}

  <div class="separator"></div>
  <div class="section-title">Font size</div>

  <div class="control-row">
    <label class="control-label" for="cssvar-fontsize">Body</label>
    <input
      id="cssvar-fontsize"
      type="range"
      class="size-slider"
      {disabled}
      min="24"
      max="72"
      step="2"
      value={getFontSizePx()}
      onchange={handleFontSizeChange}
      aria-label="Body font size"
    />
    <span class="size-label">{getFontSizePx()}px</span>
  </div>
</div>

<style>
  .css-var-controls {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .css-var-controls.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .section-title {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 2px;
  }

  .separator {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 0;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .control-label {
    flex: 0 0 72px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
  }

  /* Color swatch — rendered as a native color picker. */
  .color-swatch {
    width: 28px;
    height: 20px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    background: none;
    cursor: pointer;
  }

  .size-slider {
    flex: 1;
    accent-color: #4a9eff;
  }

  .size-label {
    width: 36px;
    text-align: right;
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.4);
    font-variant-numeric: tabular-nums;
  }
</style>
