<script lang="ts">
  /**
   * MathBlockPanel.svelte — P5-10: configure and insert a KaTeX math block.
   *
   * Output:
   *   <div class="math-block">\[ {latex} \]</div>
   *
   * The reveal.js math plugin (RevealMath.KaTeX, vendored offline by Lane GO)
   * processes `\[...\]` display-math delimiters anywhere in a slide and renders
   * them with KaTeX.  Without the plugin, the raw LaTeX is visible as text —
   * valid graceful degradation (spec 12).
   *
   * UI DESIGN:
   *   A LaTeX text area with a live-rendered preview using an inline <script>
   *   approach that references KaTeX if it is available in the window (injected
   *   by the reveal math plugin in the iframe, not in this host page). Since we
   *   are in the editor shell (NOT inside the reveal iframe), we cannot render
   *   KaTeX inline here without bundling KaTeX into the editor itself.
   *
   *   Decision: show the LaTeX source as-is in the preview (monospaced, no
   *   rendering).  This avoids bundling KaTeX twice (once in the deck, once in
   *   the editor) and keeps the editor lightweight.  The rendered result is
   *   always visible in the canvas iframe immediately after insert.
   *
   *   A future iteration can add an `<iframe>` preview that loads a minimal
   *   KaTeX page, but that is out of scope for P5-10 v1.
   */

  import { buildMathBlock } from '$lib/blocks/builders';
  import type { ElementNode } from '$lib/model';

  interface Props {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  }

  // deckName not used here (math blocks are pure client-side model mutations).
  const { onInsert, onCancel }: Props = $props();

  // ── State ─────────────────────────────────────────────────────────────────

  let latex = $state('');

  // ── Example snippets for quick insertion ─────────────────────────────────

  const EXAMPLES = [
    { label: 'Fraction',     latex: '\\frac{a}{b}' },
    { label: 'Integral',     latex: '\\int_0^\\infty e^{-x}\\,dx' },
    { label: 'Sum',          latex: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}' },
    { label: 'Matrix',       latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
    { label: 'Einstein',     latex: 'E = mc^2' },
    { label: 'Euler',        latex: 'e^{i\\pi} + 1 = 0' },
  ] as const;

  // ── Insert ────────────────────────────────────────────────────────────────

  function handleInsert(): void {
    if (!latex.trim()) return; // don't insert an empty math block
    const node = buildMathBlock(latex);
    onInsert(node);
  }

  function insertExample(example: string): void {
    latex = example;
  }

  // Allow Ctrl/Cmd+Enter to insert without clicking the button.
  function onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleInsert();
    }
  }
</script>

<div class="math-panel">
  <header class="panel-header">
    <h3 class="panel-title">Insert math block</h3>
    {#if onCancel}
      <button type="button" class="icon-btn" onclick={onCancel} aria-label="Cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </header>

  <div class="fields">
    <!-- LaTeX input -->
    <label class="field">
      <span class="field-label">
        LaTeX
        <span class="hint">— display math; rendered by KaTeX in the deck</span>
      </span>
      <textarea
        class="field-textarea"
        placeholder="e.g.  \frac&#123;a&#125;&#123;b&#125;"
        rows={4}
        spellcheck={false}
        autocomplete="off"
        bind:value={latex}
        onkeydown={onKeydown}
      ></textarea>
    </label>

    <!-- Preview (raw LaTeX — see component comment re: not bundling KaTeX) -->
    {#if latex.trim()}
      <div class="preview" aria-label="LaTeX preview">
        <p class="preview-header">Output (rendered in the canvas after insert)</p>
        <div class="preview-body">
          <span class="preview-delim">\[</span>
          <span class="preview-latex">{latex}</span>
          <span class="preview-delim">\]</span>
        </div>
      </div>
    {/if}

    <!-- Quick examples -->
    <div class="examples">
      <p class="examples-label">Quick examples</p>
      <div class="examples-grid">
        {#each EXAMPLES as ex (ex.label)}
          <button
            type="button"
            class="example-btn"
            onclick={() => insertExample(ex.latex)}
            title={ex.latex}
          >
            {ex.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <footer class="panel-footer">
    <span class="kbd-hint">
      <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to insert
    </span>
    {#if onCancel}
      <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
    {/if}
    <button
      type="button"
      class="btn-primary"
      disabled={!latex.trim()}
      onclick={handleInsert}
    >
      Insert math block
    </button>
  </footer>
</div>

<style>
  .math-panel {
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

  .field-textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.375rem;
    background: rgba(0,0,0,0.35);
    color: rgba(255,255,255,0.9);
    font-size: 0.78rem;
    font-family: ui-monospace, monospace;
    outline: none;
    resize: vertical;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }

  .field-textarea:focus {
    border-color: rgba(74, 158, 255, 0.6);
  }

  .field-textarea::placeholder {
    color: rgba(255,255,255,0.2);
  }

  /* Preview box */
  .preview {
    padding: 0.5rem 0.65rem;
    background: rgba(0,0,0,0.25);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 0.375rem;
  }

  .preview-header {
    margin: 0 0 0.3rem;
    font-size: 0.65rem;
    color: rgba(255,255,255,0.3);
  }

  .preview-body {
    display: flex;
    gap: 0.3rem;
    align-items: baseline;
    flex-wrap: wrap;
  }

  .preview-delim {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: rgba(255,255,255,0.3);
  }

  .preview-latex {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: rgba(255,255,255,0.75);
    word-break: break-all;
  }

  /* Examples */
  .examples {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .examples-label {
    margin: 0;
    font-size: 0.68rem;
    color: rgba(255,255,255,0.3);
  }

  .examples-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .example-btn {
    padding: 0.2rem 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.55);
    font-size: 0.7rem;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .example-btn:hover {
    background: rgba(74, 158, 255, 0.12);
    color: rgba(255,255,255,0.85);
    border-color: rgba(74, 158, 255, 0.3);
  }

  /* Footer */
  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .kbd-hint {
    font-size: 0.65rem;
    color: rgba(255,255,255,0.25);
    margin-right: auto;
  }

  kbd {
    display: inline-block;
    padding: 0.05em 0.3em;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 0.2rem;
    font-size: 0.65rem;
    color: rgba(255,255,255,0.4);
    font-family: inherit;
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

  .btn-primary:hover:not(:disabled) {
    background: #7ab8ff;
  }

  .btn-primary:disabled {
    opacity: 0.4;
    cursor: default;
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
