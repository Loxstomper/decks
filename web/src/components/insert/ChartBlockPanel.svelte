<script lang="ts">
  /**
   * ChartBlockPanel.svelte — P17-15: configure and insert a Chart.js chart block.
   *
   * Output (handed to the insert seam via onInsert):
   *   <canvas width="600" height="400"
   *           data-chart="{type}"
   *           data-chart-data='{"type":"{type}","data":{…},"options":{…}}'></canvas>
   *
   * WHY A CONFIG PANEL (not instant insert):
   *   A chart needs a type AND a data/options config. The panel lets the user pick
   *   a type (seeding a sensible starter template) and edit the JSON config with
   *   live parse validation BEFORE the block lands in the deck, so we never insert
   *   a chart that won't render. After insertion, the inspector's chart-data
   *   control edits the same JSON.
   *
   * TYPE ↔ JSON SYNC: changing the type field rewrites the JSON's `type` field
   *   (and reseeds the starter template if the user has not diverged from it), so
   *   the `data-chart` attribute and the JSON `type` stay consistent — the
   *   contract the vendored plugin and `slides validate` both rely on.
   *
   * OFFLINE-FIRST (spec principles-and-invariants): the emitted markup carries zero external URLs;
   *   Chart.js + the plugin are vendored into the deck by the scaffold (P17-14).
   *   The block is inert (blank canvas) without them but never breaks the deck.
   */

  import { buildChartBlock } from '$lib/blocks/builders';
  import type { ElementNode } from '$lib/model';

  interface Props {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  }

  // deckName is passed by the host (palette) for API consistency — charts don't
  // need it locally (everything is offline + in-model).
  const { onInsert, onCancel }: Props = $props();

  // ── Chart types + starter templates ─────────────────────────────────────────

  const CHART_TYPES = [
    { value: 'bar', label: 'Bar' },
    { value: 'line', label: 'Line' },
    { value: 'pie', label: 'Pie' },
    { value: 'doughnut', label: 'Doughnut' },
    { value: 'radar', label: 'Radar' },
    { value: 'polarArea', label: 'Polar area' },
  ] as const;

  /** A sensible, self-contained starter config for a given chart type. Pretty-
   *  printed (2-space) so the textarea is readable; the bytes are preserved
   *  verbatim on insert. */
  function starterTemplate(type: string): string {
    const categorical = type === 'bar' || type === 'line' || type === 'radar';
    const cfg = categorical
      ? {
          type,
          data: {
            labels: ['Q1', 'Q2', 'Q3', 'Q4'],
            datasets: [{ label: 'Revenue', data: [12, 19, 8, 15] }],
          },
        }
      : {
          type,
          data: {
            labels: ['Red', 'Blue', 'Green'],
            datasets: [{ label: 'Votes', data: [12, 19, 8] }],
          },
        };
    return JSON.stringify(cfg, null, 2);
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let type = $state<string>('bar');
  let json = $state<string>(starterTemplate('bar'));
  /** True while the JSON shown matches the current type's pristine template, so
   *  switching type reseeds it; once the user edits, we stop clobbering. */
  let pristine = $state(true);

  /** Parse the JSON for validation feedback. null error = valid. */
  const parseError = $derived.by<string | null>(() => {
    try {
      const v = JSON.parse(json);
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'Top-level value must be a JSON object { type, data, options? }.';
      }
      if (!('data' in v)) return 'Missing required "data" field.';
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON.';
    }
  });

  const valid = $derived(parseError === null);

  // ── Type change: reseed template (pristine) + keep JSON.type in sync ──────────

  function onTypeChange(e: Event): void {
    type = (e.target as HTMLSelectElement).value;
    if (pristine) {
      json = starterTemplate(type);
      return;
    }
    // User has diverged from the template — only patch the `type` field so the
    // marker and the JSON stay consistent, preserving their data/options edits.
    try {
      const cfg = JSON.parse(json);
      if (cfg && typeof cfg === 'object') {
        cfg.type = type;
        json = JSON.stringify(cfg, null, 2);
      }
    } catch {
      // Leave the (malformed) JSON as-is; the user fixes it before inserting.
    }
  }

  function onJsonInput(e: Event): void {
    json = (e.target as HTMLTextAreaElement).value;
    pristine = false;
  }

  // ── Insert ─────────────────────────────────────────────────────────────────

  function handleInsert(): void {
    if (!valid) return;
    onInsert(buildChartBlock(type, json));
  }
</script>

<div class="chart-panel">
  <header class="panel-header">
    <h3 class="panel-title">Insert chart</h3>
    {#if onCancel}
      <button type="button" class="icon-btn" onclick={onCancel} aria-label="Cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </header>

  <div class="fields">
    <!-- Chart type -->
    <label class="field">
      <span class="field-label">Type</span>
      <select class="field-select" value={type} onchange={onTypeChange}>
        {#each CHART_TYPES as t (t.value)}
          <option value={t.value}>{t.label}</option>
        {/each}
      </select>
    </label>

    <!-- JSON data / options editor -->
    <label class="field">
      <span class="field-label">
        Data <span class="hint">(Chart.js config — <code>{'{ type, data, options? }'}</code>)</span>
      </span>
      <textarea
        class="field-textarea"
        class:invalid={!valid}
        rows={12}
        spellcheck={false}
        autocomplete="off"
        value={json}
        oninput={onJsonInput}
      ></textarea>
    </label>

    <!-- Validation feedback -->
    {#if parseError}
      <p class="validation error" aria-live="polite">⚠ {parseError}</p>
    {:else}
      <p class="validation ok" aria-live="polite">✓ Valid Chart.js config</p>
    {/if}
  </div>

  <footer class="panel-footer">
    {#if onCancel}
      <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
    {/if}
    <button type="button" class="btn-primary" onclick={handleInsert} disabled={!valid}>
      Insert chart
    </button>
  </footer>
</div>

<style>
  .chart-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .panel-title {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255,255,255,0.85);
  }

  .icon-btn {
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0;
  }
  .icon-btn:hover { color: #fff; }
  .icon-btn svg { width: 1rem; height: 1rem; }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.72rem;
    color: rgba(255,255,255,0.55);
    font-weight: 500;
  }

  .hint {
    font-weight: 400;
    color: rgba(255,255,255,0.3);
    font-size: 0.68rem;
  }
  .hint code {
    font-family: ui-monospace, monospace;
    color: rgba(255,255,255,0.5);
  }

  .field-select {
    width: 100%;
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.3);
    color: rgba(255,255,255,0.9);
    font-size: 0.8rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .field-select:focus { border-color: rgba(74, 158, 255, 0.6); }

  .field-textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.35);
    color: rgba(255,255,255,0.9);
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
    outline: none;
    resize: vertical;
    box-sizing: border-box;
    transition: border-color 0.12s;
    min-height: 180px;
  }
  .field-textarea:focus { border-color: rgba(74, 158, 255, 0.6); }
  .field-textarea.invalid { border-color: rgba(255, 90, 90, 0.6); }

  .validation {
    margin: 0;
    font-size: 0.68rem;
  }
  .validation.error { color: rgba(255, 130, 130, 0.95); }
  .validation.ok { color: rgba(120, 220, 150, 0.8); }

  .panel-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .btn-primary,
  .btn-secondary {
    padding: 0.4rem 0.85rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    border: none;
  }

  .btn-primary {
    background: #4a9eff;
    color: #fff;
    font-weight: 500;
  }
  .btn-primary:hover:not(:disabled) { background: #7ab8ff; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-secondary {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.65);
    border: 1px solid rgba(255,255,255,0.12);
  }
  .btn-secondary:hover {
    background: rgba(255,255,255,0.14);
    color: #fff;
  }
</style>
