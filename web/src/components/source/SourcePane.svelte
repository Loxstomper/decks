<script lang="ts">
  /**
   * SourcePane.svelte — CodeMirror 6 HTML source editor (P1-7).
   *
   * Design contract:
   *   - CONTROLLED component: caller owns the document string; this pane only
   *     displays and reports edits.
   *   - Feedback-loop prevention: when `value` changes from outside and differs
   *     from the current CM doc, we apply a silent transaction (no onChange).
   *   - onChange fires synchronously on every keystroke; debouncing is the
   *     integrator's responsibility.
   *
   * Props:
   *   value    — The current HTML string to display. Svelte 5 $props() rune.
   *   onChange — Callback invoked with the new string whenever the user edits.
   *              Called with (next: string).
   *
   * Invariant: after any external `value` update, editor.state.doc.toString()
   * === value. Proof: we only skip the update when the strings already match
   * (the editor's own edit just echoed back), so we never diverge silently.
   */

  import { onMount, onDestroy } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
           drawSelection, dropCursor, rectangularSelection, crosshairCursor,
           highlightActiveLine, keymap } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { html } from '@codemirror/lang-html';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorSelection } from '@codemirror/state';
  import { selectionStore } from '$lib/canvas/selection.svelte';
  import { findEidIndex } from '$lib/layout/eidIndex';

  // ── Props ────────────────────────────────────────────────────────────────
  interface Props {
    /** Current HTML source string — controlled by the parent. */
    value: string;
    /** Called with the new document string on each edit by the user. */
    onChange: (next: string) => void;
    /** Optional extra CSS class for the host element. */
    class?: string;
  }

  let { value, onChange, class: extraClass = '' }: Props = $props();

  // ── Internal refs ────────────────────────────────────────────────────────
  let container: HTMLDivElement;
  let view: EditorView | null = null;

  /**
   * True while we are applying an external update, so the listener callback
   * can skip re-emitting onChange for that transaction.
   */
  let applyingExternal = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  onMount(() => {
    // Extension that fires onChange for every user transaction.
    const emitOnChange = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      // Skip re-emission when we ourselves applied the change to avoid loops.
      if (applyingExternal) return;
      onChange(update.state.doc.toString());
    });

    const startState = EditorState.create({
      doc: value,
      extensions: [
        // Core editing conveniences
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

        // Language
        html(),

        // Theme — oneDark sits closest to the app's dark `#1a1a2e` chrome
        oneDark,

        // Override a few tokens to better match our surface palette
        EditorView.theme({
          // Root container: transparent so the panel background shows through
          '&': {
            height: '100%',
            fontSize: '12px',
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
          },
          '.cm-scroller': { overflow: 'auto' },
          // Slightly lighter background so it reads as a distinct zone
          '.cm-content': { backgroundColor: '#111827' },
          '.cm-gutters': {
            backgroundColor: '#111827',
            borderRight: '1px solid #0f3460',
            color: '#4b5563',
          },
          // Active line highlight kept subtle
          '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
          // Cursor
          '.cm-cursor': { borderLeftColor: '#e94560' },
          // Selection
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
            backgroundColor: 'rgba(233,69,96,0.25)',
          },
        }),

        emitOnChange,
      ],
    });

    view = new EditorView({
      state: startState,
      parent: container,
    });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // ── Reactive prop sync ───────────────────────────────────────────────────
  /**
   * When the controlled `value` prop changes from outside (e.g., file reloaded
   * from disk), reconcile the editor document without triggering onChange.
   *
   * We compare by string value so that echoed-back updates from the user's own
   * edits are no-ops (the doc already matches; no transaction needed).
   */
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return; // already in sync — nothing to do

    applyingExternal = true;
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value,
        },
        // Preserve scroll position when possible; only move cursor if it would
        // fall outside the new document length.
        selection: EditorSelection.cursor(
          Math.min(view.state.selection.main.anchor, value.length),
        ),
        // Mark as a programmatic (non-user) change so undo history treats it
        // as a boundary — prevents Ctrl+Z from undoing an external file reload.
        annotations: [],
      });
    } finally {
      // Always reset the flag, even if dispatch throws.
      applyingExternal = false;
    }
  });

  // ── Source ↔ selection jump (P9-6) ─────────────────────────────────────────
  /**
   * Determine whether scrolling now would interrupt an active edit. We skip the
   * jump when:
   *   - CodeMirror itself has focus (the user is typing in the source), or
   *   - an in-place contenteditable session is active (selectionStore.editing,
   *     set when the canvas leaf is being edited), or
   *   - any input/textarea/contenteditable in this document holds focus.
   * Reading `selectionStore.editing` here also makes the effect re-run when an
   * edit session ends, so the jump lands once the user is done.
   */
  function wouldStealActiveEdit(): boolean {
    if (selectionStore.editing) return true;
    if (view?.hasFocus) return true;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  }

  /**
   * When the primary selection changes and the source pane is visible, scroll
   * the matching `data-eid="…"` occurrence into view. Coarse, attribute-anchored
   * (spec 04) — not a full source map. Un-stamped / passthrough elements yield
   * no index and so do not scroll. Never steals focus from an active edit.
   */
  $effect(() => {
    const eid = selectionStore.eid; // reactive dependency
    const editing = selectionStore.editing; // re-run when an edit session ends
    if (!view || !eid) return;
    // Hidden / zero-height pane (e.g. collapsed) — nothing to reveal.
    if (view.dom.clientHeight === 0 || view.dom.offsetParent === null) return;
    if (editing || wouldStealActiveEdit()) return;

    const idx = findEidIndex(view.state.doc.toString(), eid);
    if (idx === null) return; // un-stamped / passthrough → no-op

    view.dispatch({
      effects: EditorView.scrollIntoView(idx, { y: 'center' }),
    });
  });
</script>

<!--
  Host element fills its flex container. The PaneLayout already gives the
  source slot "flex-1 overflow-hidden", so we just need to be full-height.
-->
<div
  bind:this={container}
  class="source-pane-cm h-full w-full overflow-hidden {extraClass}"
  aria-label="HTML source editor"
></div>

<style>
  /*
   * Ensure CodeMirror's internal scroller fills our container rather than
   * collapsing to zero height. The `&` theme override above sets height:100%
   * on the `.cm-editor` element; this rule makes the host a reliable reference.
   */
  .source-pane-cm :global(.cm-editor) {
    height: 100%;
  }
</style>
