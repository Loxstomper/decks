<script lang="ts">
  /**
   * ChartDataControl.svelte — Per-element chart data editor (P17-15).
   *
   * Shown in the inspector when a <canvas data-chart> chart leaf is selected. It
   * edits the chart's type (`data-chart`) + JSON config (`data-chart-data`) and
   * commits on blur via deckStore.applyChartData (one undo entry + one autosave,
   * byte-stable). Mirrors TextColorControl's "self-wire to the store" pattern so
   * the shell needs no new props.
   *
   * VALIDATION: the JSON is parse-checked live; an invalid config disables commit
   * and never reaches the store (which also guards), so the deck never receives
   * malformed JSON — the chart simply keeps its last good data.
   *
   * SVELTE 5 runes; no createEventDispatcher.
   */

  import { deckStore } from '$lib/store/deck.svelte';

  interface Props {
    /** The selected chart canvas's data-eid. */
    eid: string;
    /** Current chart type (`data-chart`), or null. */
    type: string | null;
    /** Current chart JSON config (`data-chart-data` literal), or null. */
    data: string | null;
  }

  let { eid, type, data }: Props = $props();

  const CHART_TYPES = ['bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea'] as const;

  // Local editable buffers. They are seeded from the model props inside the sync
  // effect below (NOT in the $state initializers — referencing reactive props
  // there would only capture the first value and warns). `syncedEid` guards the
  // seed so we re-seed only when the SELECTION changes (switching charts), never
  // clobbering an in-progress edit on every model tick.
  let typeBuf = $state<string>('bar');
  let jsonBuf = $state<string>('');
  let syncedEid: string | undefined;
  $effect(() => {
    if (syncedEid !== eid) {
      syncedEid = eid;
      typeBuf = type ?? 'bar';
      jsonBuf = data ?? '';
    }
  });

  const parseError = $derived.by<string | null>(() => {
    try {
      const v = JSON.parse(jsonBuf);
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'Top-level value must be a JSON object.';
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON.';
    }
  });
  const valid = $derived(parseError === null);

  /** Commit the current buffers (on blur / type change). No-op when invalid or
   *  unchanged — applyChartData also guards, so a bad edit never persists. */
  function commit(): void {
    if (!valid) return;
    if (typeBuf === (type ?? 'bar') && jsonBuf === (data ?? '')) return;
    void deckStore.applyChartData(eid, typeBuf, jsonBuf);
  }

  function onTypeChange(e: Event): void {
    typeBuf = (e.target as HTMLSelectElement).value;
    // Keep the JSON's `type` field in sync with the marker, then commit.
    try {
      const cfg = JSON.parse(jsonBuf);
      if (cfg && typeof cfg === 'object') {
        cfg.type = typeBuf;
        jsonBuf = JSON.stringify(cfg, null, 2);
      }
    } catch {
      // leave malformed JSON for the user to fix
    }
    commit();
  }
</script>

<div class="prop-section">
  <div class="section-sublabel">Chart</div>

  <div class="chart-row">
    <label class="chart-type-label" for="chart-type">Type</label>
    <select id="chart-type" class="chart-select" value={typeBuf} onchange={onTypeChange}>
      {#each CHART_TYPES as t (t)}
        <option value={t}>{t}</option>
      {/each}
    </select>
  </div>

  <textarea
    class="chart-json"
    class:invalid={!valid}
    rows={10}
    spellcheck={false}
    autocomplete="off"
    aria-label="Chart data (JSON)"
    bind:value={jsonBuf}
    onblur={commit}
  ></textarea>

  {#if parseError}
    <p class="chart-validation error" aria-live="polite">⚠ {parseError}</p>
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

  .chart-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .chart-type-label {
    flex: 0 0 40px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .chart-select {
    flex: 1;
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    outline: none;
  }
  .chart-select:focus { border-color: rgba(59, 130, 246, 0.5); }

  .chart-json {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.65rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    outline: none;
    resize: vertical;
    min-height: 120px;
  }
  .chart-json:focus { border-color: rgba(59, 130, 246, 0.5); }
  .chart-json.invalid { border-color: rgba(255, 90, 90, 0.6); }

  .chart-validation {
    margin: 0;
    font-size: 0.62rem;
  }
  .chart-validation.error { color: rgba(255, 130, 130, 0.95); }
</style>
