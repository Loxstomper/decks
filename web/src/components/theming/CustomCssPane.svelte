<script lang="ts">
  /**
   * CustomCssPane.svelte — P6-11 CodeMirror 6 editor for per-deck custom.css.
   *
   * Mirrors the pattern of SourcePane.svelte but uses the CSS language instead
   * of HTML. The controlled-value pattern prevents echo-back loops: when `value`
   * changes from outside (e.g. applyVar from CssVarControls) we sync the editor
   * without re-emitting onChange.
   *
   * Props:
   *   value    — Current CSS string. Controlled by the parent / store.
   *   onChange — Invoked with the new CSS string on every user keystroke.
   *   class    — Optional extra CSS class for the host element.
   */

  import { onMount, onDestroy } from 'svelte';
  import { EditorState, EditorSelection } from '@codemirror/state';
  import {
    EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
    drawSelection, dropCursor, rectangularSelection, crosshairCursor,
    highlightActiveLine, keymap,
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { css } from '@codemirror/lang-css';
  import { oneDark } from '@codemirror/theme-one-dark';

  interface Props {
    value: string;
    onChange: (next: string) => void;
    class?: string;
  }

  let { value, onChange, class: extraClass = '' }: Props = $props();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let applyingExternal = false;

  onMount(() => {
    const emitOnChange = EditorView.updateListener.of((update) => {
      if (!update.docChanged || applyingExternal) return;
      onChange(update.state.doc.toString());
    });

    const startState = EditorState.create({
      doc: value,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // CSS language — property completion, colour hints, etc.
        css(),
        oneDark,
        // Match SourcePane's visual language.
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '12px',
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
          },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { backgroundColor: '#111827' },
          '.cm-gutters': {
            backgroundColor: '#111827',
            borderRight: '1px solid #0f3460',
            color: '#4b5563',
          },
          '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
          '.cm-cursor': { borderLeftColor: '#e94560' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
            backgroundColor: 'rgba(233,69,96,0.25)',
          },
        }),
        emitOnChange,
      ],
    });

    view = new EditorView({ state: startState, parent: container });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // Sync external changes (e.g. applyVar from CssVarControls) without echo.
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    applyingExternal = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: EditorSelection.cursor(
          Math.min(view.state.selection.main.anchor, value.length),
        ),
        annotations: [],
      });
    } finally {
      applyingExternal = false;
    }
  });
</script>

<div
  bind:this={container}
  class="custom-css-cm h-full w-full overflow-hidden {extraClass}"
  aria-label="Custom CSS editor"
></div>

<style>
  .custom-css-cm :global(.cm-editor) {
    height: 100%;
  }
</style>
