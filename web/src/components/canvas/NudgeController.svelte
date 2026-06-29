<script lang="ts">
  /**
   * NudgeController.svelte — Keyboard nudge of the selection (P3-9 / spec 04
   * "Keyboard nudge: arrows = 1 logical unit; Shift+arrows = 10").
   *
   * WHY THIS EXISTS:
   * ================
   * Arrow keys move the current selection in LOGICAL units. Selection lives in the
   * PARENT document (selectionStore), so the listener lives here on the parent
   * window — NOT inside the keyboard-isolated iframe. For a FREE element this
   * adjusts data-x/data-y; for a STRUCTURED element it reorders ±1 among siblings
   * (structure-commands.nudgeCommand decides which, via classify()).
   *
   * GUARD (spec 04): we must NOT hijack arrow keys while the user is typing — in a
   * P2-5 in-place edit, a native form input, any contenteditable, or the
   * CodeMirror source pane. nudge.isEditingContext() encodes exactly that test.
   * When guarded, we let the event through so the caret moves normally.
   *
   * INTEGRATION: mount once anywhere in the editor shell (it renders nothing). It
   * reads selectionStore + deckStore directly, so no props are required.
   */

  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import { isArrowKey, isEditingContext } from '$lib/canvas/nudge.ts';
  import { nudgeCommand } from '$lib/canvas/structure-commands.ts';

  function onKeyDown(e: KeyboardEvent): void {
    if (!isArrowKey(e.key)) return;
    const eid = selectionStore.eid;
    if (!eid) return;

    // Don't steal arrows from text editing / inputs / CodeMirror.
    const target = (e.target instanceof Element ? e.target : null) ?? document.activeElement;
    if (isEditingContext(target, selectionStore.editing)) return;

    // A handled nudge consumes the event so the page/panes don't also scroll.
    const handled = nudgeCommand(eid, e.key, e.shiftKey);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });
</script>
