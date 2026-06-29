<script lang="ts">
  /**
   * WorkspaceThemePicker.svelte — P9-10 editor chrome theme switcher.
   *
   * Presents a compact <select> for the three workspace themes:
   *   Dark (default) · Light · Solarized
   *
   * On change it applies the chosen theme class to <html> and persists the
   * choice in localStorage under "workspace-theme".  This is an editor
   * preference only — it never touches deck files or exports.
   *
   * The class swap is the ONLY action needed to switch; all chrome tokens
   * are CSS custom properties (see app.css :root / .theme-light / .theme-solarized).
   */

  import { onMount } from 'svelte';

  type WorkspaceTheme = 'dark' | 'light' | 'solarized';

  const STORAGE_KEY = 'workspace-theme';
  const THEME_CLASS: Record<WorkspaceTheme, string> = {
    dark: '',                  // Default — no extra class on <html>.
    light: 'theme-light',
    solarized: 'theme-solarized',
  };

  const THEME_LABELS: Record<WorkspaceTheme, string> = {
    dark: 'Dark',
    light: 'Light',
    solarized: 'Solarized',
  };

  let current = $state<WorkspaceTheme>('dark');

  /** Apply a theme class to <html> and persist the choice. */
  function applyTheme(theme: WorkspaceTheme): void {
    // Remove all known theme classes, then add the new one (if any).
    const root = document.documentElement;
    for (const cls of Object.values(THEME_CLASS)) {
      if (cls) root.classList.remove(cls);
    }
    const cls = THEME_CLASS[theme];
    if (cls) root.classList.add(cls);

    current = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage may be unavailable in sandboxed contexts — ignore.
    }
  }

  onMount(() => {
    // Restore persisted preference.
    let stored: WorkspaceTheme = 'dark';
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'dark' || raw === 'light' || raw === 'solarized') {
        stored = raw;
      }
    } catch {
      // Ignore storage errors.
    }
    applyTheme(stored);
  });

  function handleChange(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as WorkspaceTheme;
    applyTheme(value);
  }
</script>

<div class="workspace-theme-picker">
  <label for="ws-theme-select" class="picker-label">Editor</label>
  <select
    id="ws-theme-select"
    class="picker-select"
    value={current}
    onchange={handleChange}
    title="Workspace theme"
    aria-label="Workspace theme"
  >
    {#each Object.entries(THEME_LABELS) as [value, label] (value)}
      <option {value}>{label}</option>
    {/each}
  </select>
</div>

<style>
  .workspace-theme-picker {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
  }

  .picker-label {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.35);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
  }

  .picker-select {
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.65rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.1s;
  }

  .picker-select:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }
</style>
