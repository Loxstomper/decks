<script lang="ts">
  /**
   * CodeBlockPanel.svelte — P5-9: configure and insert a reveal.js code block.
   *
   * Output:
   *   <pre><code class="language-{lang}" [data-line-numbers[="{range}"]]>
   *     {userCode}
   *   </code></pre>
   *
   * WHY A CONFIG PANEL (not instant insert):
   *   Code blocks need at minimum a language selection, and optionally initial
   *   code and line-number configuration.  A panel lets the user configure these
   *   before the block lands in the deck, reducing empty placeholders.  After
   *   insertion, fine-grained editing happens in the source pane.
   *
   * REVEAL DEPENDENCY:
   *   Line numbering requires the reveal `highlight` plugin and highlight.js to be
   *   vendored + enabled in the deck.  Lane GO is responsible for vendoring these
   *   (offline-first, spec principles-and-invariants).  The generated block is inert (unstyled) without
   *   them, but the deck remains valid HTML — safe graceful degradation.
   *
   * LINE-NUMBER STEPPING (reveal feature):
   *   `data-line-numbers` supports fragment-step syntax, e.g. "1-3|5|7-9" steps
   *   through groups of highlighted lines as the user advances the presentation.
   *   We expose a text input for this; the user can leave it blank for all-lines
   *   or type a range.
   */

  import { buildCodeBlock } from '$lib/blocks/builders';
  import type { ElementNode } from '$lib/model';

  interface Props {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  }

  // deckName is passed by the host (palette) for API calls — code blocks don't
  // need it locally, but the contract requires it for consistency.
  const { onInsert, onCancel }: Props = $props();

  // ── Common languages (ordered by popularity for quick scanning) ───────────

  const LANGUAGES = [
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'python', label: 'Python' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'java', label: 'Java' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
    { value: 'bash', label: 'Bash / Shell' },
    { value: 'sql', label: 'SQL' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
    { value: 'json', label: 'JSON' },
    { value: 'yaml', label: 'YAML' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'plaintext', label: 'Plain text (no highlighting)' },
  ] as const;

  // ── State ─────────────────────────────────────────────────────────────────

  let lang = $state('javascript');
  let code = $state('');
  let lineNumbersEnabled = $state(false);
  let lineNumberRange = $state('');

  // Derived: the actual data-line-numbers value to pass to buildCodeBlock.
  // - false         → omit the attribute
  // - true          → boolean attribute (all lines)
  // - "1-3|5"       → range string
  const lineNumbers = $derived<boolean | string>(
    !lineNumbersEnabled
      ? false
      : lineNumberRange.trim()
        ? lineNumberRange.trim()
        : true,
  );

  // ── Insert ────────────────────────────────────────────────────────────────

  function handleInsert(): void {
    const node = buildCodeBlock(lang, code, lineNumbers);
    onInsert(node);
  }
</script>

<div class="code-panel">
  <header class="panel-header">
    <h3 class="panel-title">Insert code block</h3>
    {#if onCancel}
      <button type="button" class="icon-btn" onclick={onCancel} aria-label="Cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </header>

  <div class="fields">
    <!-- Language -->
    <label class="field">
      <span class="field-label">Language</span>
      <select class="field-select" bind:value={lang}>
        {#each LANGUAGES as l (l.value)}
          <option value={l.value}>{l.label}</option>
        {/each}
      </select>
    </label>

    <!-- Starter code (optional) -->
    <label class="field">
      <span class="field-label">Code <span class="hint">(optional — edit in source pane after insert)</span></span>
      <textarea
        class="field-textarea"
        placeholder="// paste or type starter code…"
        rows={6}
        spellcheck={false}
        autocomplete="off"
        bind:value={code}
      ></textarea>
    </label>

    <!-- Line numbers toggle -->
    <div class="field field-row">
      <label class="toggle-label">
        <input type="checkbox" class="toggle-input" bind:checked={lineNumbersEnabled} />
        <span>Enable line numbers</span>
      </label>
    </div>

    <!-- Line number range (only when enabled) -->
    {#if lineNumbersEnabled}
      <label class="field">
        <span class="field-label">
          Highlight range
          <span class="hint">(optional — e.g. <code>1-3|5</code> for reveal step-through)</span>
        </span>
        <input
          type="text"
          class="field-input"
          placeholder="e.g. 1-3|5|7-9 — leave blank to number all lines"
          bind:value={lineNumberRange}
          spellcheck={false}
        />
      </label>
    {/if}
  </div>

  <!-- Preview summary -->
  <div class="preview-summary" aria-live="polite">
    <code class="preview-code"
      >&lt;pre&gt;&lt;code class="language-{lang}"{lineNumbersEnabled
        ? ` data-line-numbers${lineNumberRange.trim() ? `="${lineNumberRange.trim()}"` : ''}`
        : ''}&gt;…&lt;/code&gt;&lt;/pre&gt;</code
    >
  </div>

  <footer class="panel-footer">
    {#if onCancel}
      <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
    {/if}
    <button type="button" class="btn-primary" onclick={handleInsert}>
      Insert code block
    </button>
  </footer>
</div>

<style>
  .code-panel {
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

  .field-row {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
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

  .field-select,
  .field-input {
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

  .field-select:focus,
  .field-input:focus {
    border-color: rgba(74, 158, 255, 0.6);
  }

  .field-textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.35);
    color: rgba(255,255,255,0.9);
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    outline: none;
    resize: vertical;
    box-sizing: border-box;
    transition: border-color 0.12s;
    min-height: 120px;
  }

  .field-textarea:focus {
    border-color: rgba(74, 158, 255, 0.6);
  }

  .field-textarea::placeholder {
    color: rgba(255,255,255,0.2);
  }

  /* Toggle */
  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: rgba(255,255,255,0.65);
    cursor: pointer;
    user-select: none;
  }

  .toggle-input {
    accent-color: #4a9eff;
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }

  /* Preview summary */
  .preview-summary {
    padding: 0.5rem 0.6rem;
    background: rgba(0,0,0,0.25);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 0.375rem;
    overflow-x: auto;
  }

  .preview-code {
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    color: rgba(255,255,255,0.45);
    white-space: pre;
  }

  /* Footer */
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

  .btn-primary:hover {
    background: #7ab8ff;
  }

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
