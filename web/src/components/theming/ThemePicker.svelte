<script lang="ts">
  /**
   * ThemePicker.svelte — P6-10 reveal.js theme selector.
   *
   * Renders a <select> that lists all bundled themes. On change it calls
   * onApply(themeName), which the integrator wires to deckStore.applyTheme().
   *
   * Props:
   *   currentTheme  — The currently active theme name (e.g. "black").
   *                   Derived from the deck source via parseTheme() below.
   *   disabled      — True when no deck is open.
   *   onApply       — Callback invoked with the new theme name on selection change.
   *
   * WHY NOT READ DECK SOURCE DIRECTLY:
   * The integrator already derives currentTheme from deckStore.source so this
   * component stays a pure presentational component (easily testable).
   */

  interface Props {
    /** Active reveal theme name (e.g. "black"). Empty string = unknown/custom. */
    currentTheme: string;
    /** Disable picker when no deck is open. */
    disabled?: boolean;
    /** Called when the user picks a new theme. Integrator wires to deckStore.applyTheme. */
    onApply?: (themeName: string) => void;
  }

  let { currentTheme, disabled = false, onApply }: Props = $props();

  /**
   * Bundled themes — mirrors deck.BundledThemes in Go (internal/deck/deck.go).
   * Loaded from /api/themes on mount; falls back to this static list when the
   * server is unreachable (e.g. running the SPA standalone in tests).
   */
  let themes = $state<string[]>([
    'black', 'white', 'league', 'beige', 'night', 'moon', 'solarized', 'dracula', 'sky',
  ]);

  // Attempt to refresh the list from the server (non-critical).
  import { onMount } from 'svelte';
  onMount(async () => {
    try {
      const res = await fetch('/api/themes');
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) themes = list;
      }
    } catch {
      // Server unreachable — keep the static fallback list above.
    }
  });

  function handleChange(e: Event): void {
    const sel = e.currentTarget as HTMLSelectElement;
    onApply?.(sel.value);
  }
</script>

<div class="theme-picker">
  <label for="theme-select" class="picker-label">Theme</label>
  <select
    id="theme-select"
    class="picker-select"
    {disabled}
    value={currentTheme}
    onchange={handleChange}
  >
    {#each themes as t (t)}
      <option value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
    {/each}
    {#if currentTheme && !themes.includes(currentTheme)}
      <!-- Custom / unknown theme not in the bundled list. -->
      <option value={currentTheme}>{currentTheme} (custom)</option>
    {/if}
  </select>
</div>

<style>
  .theme-picker {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
  }

  .picker-label {
    flex: 0 0 40px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
  }

  .picker-select {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.1s;
  }

  .picker-select:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }

  .picker-select:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
