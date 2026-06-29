<script lang="ts">
  /**
   * Navigator.svelte — 2D slide filmstrip (P6-1..P6-6, spec 06).
   *
   * Lives in the left "Navigator" zone of PaneLayout. Shows every top-level slide
   * as a thumbnail, with any vertical stack's nested slides indented below it
   * (reveal is 2D — a `<section>` containing `<section>`s is a vertical stack).
   *
   *   • Click a slide        → select it + jump the canvas there (Reveal.slide).
   *   • Current slide        → reflected from reveal's `slidechanged` events.
   *   • Toolbar              → add / duplicate / delete (P6-3).
   *   • Drag within a list   → reorder (P6-4 top-level, P6-5 within a stack).
   *   • Per-slide actions    → hide (P6-6), nest/promote (P6-5).
   *
   * State ownership: the slide TREE and all mutations live in deckStore (model
   * ops are byte-stable + undoable + autosaved). This component is a thin view +
   * controller; it holds only transient UI state (drag + hover).
   */

  import { deckStore } from '$lib/store/deck.svelte';
  import { selectionStore } from '$lib/canvas/selection.svelte';
  import { buildSlideTree, navigateToSlide, onSlideChanged } from '$lib/slides';
  import { hasThemeOverride } from '$lib/model/theme-badge';
  import SlideThumbnail from './SlideThumbnail.svelte';

  interface Props {
    /**
     * The live canvas <iframe> (bound from RevealFrame by the shell). Used to
     * drive reveal navigation and to reflect the current slide. Optional: when
     * absent (no canvas mounted) clicking still selects the slide, it just can't
     * move the canvas.
     */
    iframeEl?: HTMLIFrameElement | null;
    /**
     * P9-12: Called after a new deck is successfully created via the "＋ New deck"
     * affordance. The shell should refresh the deck list and open the new deck.
     */
    onDeckCreated?: (name: string) => Promise<void>;
  }

  let { iframeEl = null, onDeckCreated }: Props = $props();

  // ── Derived slide tree ──────────────────────────────────────────────────────

  // Recomputed whenever the model changes (each re-parse yields a fresh model
  // object) so the filmstrip + thumbnails track edits live.
  const tree = $derived(buildSlideTree(deckStore.model));
  const deckName = $derived(deckStore.name ?? '');

  // ── Current slide reflection (P6-1) ─────────────────────────────────────────

  // reveal's (h, v) indices, updated by its slidechanged events. We map these
  // back to a slide eid for highlighting. Reset implicitly when the iframe or the
  // on-disk copy (reloadNonce) changes — the effect below re-subscribes.
  let currentH = $state(-1);
  let currentV = $state(-1);

  $effect(() => {
    // Re-subscribe when the iframe is recreated OR the deck reloads (reloadNonce
    // bump → reveal re-inits with a fresh event bus).
    void deckStore.reloadNonce;
    const iframe = iframeEl;
    if (!iframe) return;
    const unsub = onSlideChanged(iframe, ({ h, v }) => {
      currentH = h;
      currentV = v;
    });
    return unsub;
  });

  /** eid of the slide reveal is currently presenting (null when unknown). */
  const currentEid = $derived.by(() => {
    const top = tree[currentH];
    if (!top) return null;
    if (top.verticals.length > 0) {
      // In a stack, v selects the nested slide; v=0 is the first vertical slide.
      return top.verticals[currentV]?.eid ?? top.verticals[0]?.eid ?? null;
    }
    return top.eid;
  });

  /** A slide row is "active" when it is the current canvas slide or the selection. */
  function isActive(eid: string | null): boolean {
    if (!eid) return false;
    return eid === currentEid || eid === selectionStore.eid;
  }

  // ── Navigation (P6-1 / P6-5) ────────────────────────────────────────────────

  /** Select a slide and jump the canvas to (h, v). */
  function jump(eid: string | null, h: number, v: number): void {
    if (eid) selectionStore.select(eid);
    navigateToSlide(iframeEl, h, v);
  }

  // ── Toolbar / per-slide commands (P6-3, P6-5, P6-6) ─────────────────────────

  /** The currently-selected slide eid, if the selection is a slide in the tree. */
  const selectedSlideEid = $derived.by(() => {
    const sel = selectionStore.eid;
    if (!sel) return null;
    for (const t of tree) {
      if (t.eid === sel) return sel;
      for (const vert of t.verticals) if (vert.eid === sel) return sel;
    }
    return null;
  });

  async function addSlide(): Promise<void> {
    // Add after the selected slide when one is selected, else append.
    await deckStore.addSlide(selectedSlideEid ?? undefined);
  }

  async function duplicate(eid: string | null): Promise<void> {
    if (eid) await deckStore.duplicateSlide(eid);
  }

  async function remove(eid: string | null): Promise<void> {
    if (eid) await deckStore.deleteSlide(eid);
  }

  async function toggleHidden(eid: string | null, hidden: boolean): Promise<void> {
    if (eid) await deckStore.setSlideHidden(eid, hidden);
  }

  async function nest(eid: string | null): Promise<void> {
    if (eid) await deckStore.nestSlide(eid);
  }

  async function promote(eid: string | null): Promise<void> {
    if (eid) await deckStore.promoteSlide(eid);
  }

  // ── Create-deck affordance (P9-12) ───────────────────────────────────────────
  //
  // Three states: idle → entering (name input visible) → creating (POST in flight).
  // Errors are surfaced inline so the user can correct the name without a dialog.

  let createState = $state<'idle' | 'entering' | 'creating'>('idle');
  let newDeckName = $state('');
  let createError = $state<string | null>(null);
  let nameInputEl = $state<HTMLInputElement | undefined>();

  function beginCreate(): void {
    newDeckName = '';
    createError = null;
    createState = 'entering';
    // Focus the input on the next tick after it mounts.
    setTimeout(() => nameInputEl?.focus(), 0);
  }

  function cancelCreate(): void {
    createState = 'idle';
    newDeckName = '';
    createError = null;
  }

  async function submitCreate(): Promise<void> {
    const name = newDeckName.trim();
    if (!name) {
      createError = 'Name is required.';
      return;
    }
    createState = 'creating';
    createError = null;
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(name)}`, { method: 'POST' });
      if (!res.ok) {
        const msg = await res.text();
        createError = res.status === 409 ? `"${name}" already exists.` : (msg || `Error ${res.status}`);
        createState = 'entering';
        return;
      }
      createState = 'idle';
      newDeckName = '';
      await onDeckCreated?.(name);
    } catch (err) {
      createError = err instanceof Error ? err.message : 'Network error.';
      createState = 'entering';
    }
  }

  function onNameKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') { e.preventDefault(); void submitCreate(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
  }

  // ── Drag-to-reorder (P6-4 / P6-5) ───────────────────────────────────────────
  //
  // Native HTML5 DnD. Reordering is scoped to a single list: the top-level slide
  // track, or one vertical stack (identified by its stack eid). Cross-list moves
  // (between a stack and the top level) are done with the nest/promote buttons,
  // which keeps the drag logic simple and unambiguous.

  type DragState =
    | { kind: 'top'; fromIndex: number }
    | { kind: 'vertical'; stackEid: string; fromIndex: number }
    | null;

  let drag = $state<DragState>(null);
  // Gap the drop would land in (index in the target list, 0..length). -1 = none.
  let dropGap = $state(-1);
  // Identifies which list the dropGap belongs to ('' = top level, else stackEid).
  let dropList = $state<string>(' '); // sentinel "no list"

  function onDragStart(state: NonNullable<DragState>, ev: DragEvent): void {
    drag = state;
    // Required for Firefox to start a drag; the payload itself is unused.
    ev.dataTransfer?.setData('text/plain', String(state.fromIndex));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  /**
   * While dragging over a row, decide whether the drop goes above or below it
   * (pointer in the row's top vs bottom half) and record the resulting gap.
   * listId: '' for the top-level track, or the stack eid for a vertical list.
   */
  function onRowDragOver(
    listId: string,
    rowIndex: number,
    ev: DragEvent & { currentTarget: HTMLElement },
  ): void {
    if (!drag) return;
    // Only allow dropping within the SAME list the drag started in.
    const sameList =
      (drag.kind === 'top' && listId === '') ||
      (drag.kind === 'vertical' && listId === drag.stackEid);
    if (!sameList) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    const rect = ev.currentTarget.getBoundingClientRect();
    const after = ev.clientY - rect.top > rect.height / 2;
    dropGap = after ? rowIndex + 1 : rowIndex;
    dropList = listId;
  }

  async function onDrop(listId: string): Promise<void> {
    const state = drag;
    const gap = dropGap;
    resetDrag();
    if (!state || gap < 0) return;

    // Convert the gap (insertion point in the full list) to moveChild's target
    // index, which is measured in the list WITHOUT the dragged element.
    let to = gap;
    if (state.fromIndex < gap) to -= 1;
    if (to === state.fromIndex) return; // no-op move

    if (state.kind === 'top' && listId === '') {
      await deckStore.moveSlide(state.fromIndex, to);
    } else if (state.kind === 'vertical' && listId === state.stackEid) {
      await deckStore.moveVerticalSlide(state.stackEid, state.fromIndex, to);
    }
  }

  function resetDrag(): void {
    drag = null;
    dropGap = -1;
    dropList = ' ';
  }
</script>

<div class="navigator-root" role="listbox" aria-label="Slides">
  <!-- ── Toolbar (P6-3) ──────────────────────────────────────────────────── -->
  <div class="nav-toolbar">
    <button class="nav-btn" title="Add slide" aria-label="Add slide" onclick={addSlide}>
      + Slide
    </button>
    <button
      class="nav-btn"
      title="Duplicate selected slide"
      aria-label="Duplicate slide"
      disabled={!selectedSlideEid}
      onclick={() => duplicate(selectedSlideEid)}
    >
      Duplicate
    </button>
    <button
      class="nav-btn danger"
      title="Delete selected slide"
      aria-label="Delete slide"
      disabled={!selectedSlideEid}
      onclick={() => remove(selectedSlideEid)}
    >
      Delete
    </button>
    {#if onDeckCreated}
      <!-- ── + New deck affordance (P9-12) ─────────────────────────────── -->
      <button
        class="nav-btn new-deck-btn"
        title="Create a new deck"
        aria-label="New deck"
        disabled={createState === 'creating'}
        onclick={beginCreate}
      >
        + Deck
      </button>
    {/if}
  </div>

  <!-- ── New-deck inline form (P9-12) ──────────────────────────────────── -->
  {#if createState !== 'idle'}
    <div class="new-deck-form" role="group" aria-label="Create new deck">
      <input
        bind:this={nameInputEl}
        class="new-deck-input"
        type="text"
        placeholder="deck-name"
        aria-label="New deck name"
        bind:value={newDeckName}
        onkeydown={onNameKeydown}
        disabled={createState === 'creating'}
      />
      <div class="new-deck-actions">
        <button
          class="nav-btn"
          title="Create deck"
          aria-label="Confirm create deck"
          disabled={createState === 'creating' || !newDeckName.trim()}
          onclick={() => void submitCreate()}
        >
          {createState === 'creating' ? '…' : 'Create'}
        </button>
        <button
          class="nav-btn"
          title="Cancel"
          aria-label="Cancel create deck"
          disabled={createState === 'creating'}
          onclick={cancelCreate}
        >
          Cancel
        </button>
      </div>
      {#if createError}
        <p class="new-deck-error" role="alert">{createError}</p>
      {/if}
    </div>
  {/if}

  {#if tree.length === 0}
    <p class="nav-empty">No slides yet</p>
  {/if}

  <!-- ── Filmstrip ───────────────────────────────────────────────────────── -->
  <ol class="nav-list" ondrop={() => onDrop('')} ondragover={(e) => e.preventDefault()}>
    {#each tree as slide (slide.eid ?? slide.h)}
      <li class="nav-item">
        <!-- Top-level slide row -->
        {#if dropList === '' && dropGap === slide.h}
          <div class="drop-line" aria-hidden="true"></div>
        {/if}
        <div
          class="slide-row"
          class:active={isActive(slide.eid)}
          class:hidden-slide={slide.hidden}
          role="option"
          aria-selected={isActive(slide.eid)}
          tabindex="0"
          draggable="true"
          ondragstart={(e) => onDragStart({ kind: 'top', fromIndex: slide.h }, e)}
          ondragover={(e) => onRowDragOver('', slide.h, e)}
          ondrop={() => onDrop('')}
          ondragend={resetDrag}
          onclick={() => jump(slide.eid, slide.h, 0)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              jump(slide.eid, slide.h, 0);
            }
          }}
        >
          <span class="slide-index">{slide.h + 1}</span>
          <div class="slide-thumb-wrap">
            {#if deckName}
              <SlideThumbnail {deckName} section={slide.section} />
            {/if}
            {#if slide.verticals.length > 0}
              <span class="stack-badge" title="Vertical stack">⫶</span>
            {/if}
            {#if slide.hidden}
              <span class="hidden-badge" title="Hidden when presenting">🚫</span>
            {/if}
            {#if hasThemeOverride(slide.section)}
              <span class="theme-badge" title="Per-slide theme override">◑</span>
            {/if}
          </div>
          <!-- Per-slide actions -->
          <div class="slide-actions">
            <button
              class="mini-btn"
              title={slide.hidden ? 'Show slide' : 'Hide slide'}
              aria-label={slide.hidden ? 'Show slide' : 'Hide slide'}
              onclick={(e) => {
                e.stopPropagation();
                toggleHidden(slide.eid, !slide.hidden);
              }}
            >
              {slide.hidden ? '👁' : '🚫'}
            </button>
            {#if slide.h > 0}
              <button
                class="mini-btn"
                title="Nest under previous slide (make vertical)"
                aria-label="Nest slide"
                onclick={(e) => {
                  e.stopPropagation();
                  nest(slide.eid);
                }}
              >
                ↘
              </button>
            {/if}
            <button
              class="mini-btn"
              title="Duplicate slide"
              aria-label="Duplicate slide"
              onclick={(e) => {
                e.stopPropagation();
                duplicate(slide.eid);
              }}
            >
              ⧉
            </button>
            <button
              class="mini-btn danger"
              title="Delete slide"
              aria-label="Delete slide"
              onclick={(e) => {
                e.stopPropagation();
                remove(slide.eid);
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Vertical stack children (P6-5) -->
        {#if slide.verticals.length > 0}
          <ol
            class="nav-vertical-list"
            ondrop={() => onDrop(slide.eid ?? '')}
            ondragover={(e) => e.preventDefault()}
          >
            {#each slide.verticals as vert (vert.eid ?? vert.v)}
              <li class="nav-item">
                {#if dropList === slide.eid && dropGap === vert.v}
                  <div class="drop-line" aria-hidden="true"></div>
                {/if}
                <div
                  class="slide-row vertical"
                  class:active={isActive(vert.eid)}
                  class:hidden-slide={vert.hidden}
                  role="option"
                  aria-selected={isActive(vert.eid)}
                  tabindex="0"
                  draggable="true"
                  ondragstart={(e) =>
                    onDragStart(
                      { kind: 'vertical', stackEid: slide.eid ?? '', fromIndex: vert.v },
                      e,
                    )}
                  ondragover={(e) => onRowDragOver(slide.eid ?? '', vert.v, e)}
                  ondrop={() => onDrop(slide.eid ?? '')}
                  ondragend={resetDrag}
                  onclick={() => jump(vert.eid, slide.h, vert.v)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      jump(vert.eid, slide.h, vert.v);
                    }
                  }}
                >
                  <span class="slide-index">{slide.h + 1}.{vert.v + 1}</span>
                  <div class="slide-thumb-wrap">
                    {#if deckName}
                      <SlideThumbnail {deckName} section={vert.section} width={132} />
                    {/if}
                    {#if vert.hidden}
                      <span class="hidden-badge" title="Hidden when presenting">🚫</span>
                    {/if}
                    {#if hasThemeOverride(vert.section)}
                      <span class="theme-badge" title="Per-slide theme override">◑</span>
                    {/if}
                  </div>
                  <div class="slide-actions">
                    <button
                      class="mini-btn"
                      title={vert.hidden ? 'Show slide' : 'Hide slide'}
                      aria-label={vert.hidden ? 'Show slide' : 'Hide slide'}
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleHidden(vert.eid, !vert.hidden);
                      }}
                    >
                      {vert.hidden ? '👁' : '🚫'}
                    </button>
                    <button
                      class="mini-btn"
                      title="Promote to top-level slide"
                      aria-label="Promote slide"
                      onclick={(e) => {
                        e.stopPropagation();
                        promote(vert.eid);
                      }}
                    >
                      ↖
                    </button>
                    <button
                      class="mini-btn"
                      title="Duplicate slide"
                      aria-label="Duplicate slide"
                      onclick={(e) => {
                        e.stopPropagation();
                        duplicate(vert.eid);
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      class="mini-btn danger"
                      title="Delete slide"
                      aria-label="Delete slide"
                      onclick={(e) => {
                        e.stopPropagation();
                        remove(vert.eid);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            {/each}
            <!-- Drop target for appending at the end of the stack. -->
            {#if dropList === slide.eid && dropGap === slide.verticals.length}
              <div class="drop-line" aria-hidden="true"></div>
            {/if}
          </ol>
        {/if}
      </li>
    {/each}
    <!-- Drop target for appending at the end of the top-level track. -->
    {#if dropList === '' && dropGap === tree.length}
      <div class="drop-line" aria-hidden="true"></div>
    {/if}
  </ol>
</div>

<style>
  .navigator-root {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    height: 100%;
  }

  .nav-toolbar {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem 0;
    position: sticky;
    top: 0;
    z-index: 2;
    background: inherit;
  }

  .nav-btn {
    font-size: 0.6875rem;
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
  }
  .nav-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }
  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .nav-btn.danger:hover:not(:disabled) {
    background: rgba(220, 60, 60, 0.4);
  }
  .nav-btn.new-deck-btn {
    margin-left: auto; /* push to the right within the toolbar */
  }

  /* ── New-deck inline form (P9-12) ────────────────────────────────────── */
  .new-deck-form {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.25rem 0;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 4px;
    padding: 0.35rem 0.4rem;
  }

  .new-deck-input {
    width: 100%;
    font-size: 0.6875rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    outline: none;
  }
  .new-deck-input:focus {
    border-color: var(--color-accent, #4f8cff);
  }
  .new-deck-input::placeholder {
    color: rgba(255, 255, 255, 0.25);
  }
  .new-deck-input:disabled {
    opacity: 0.5;
  }

  .new-deck-actions {
    display: flex;
    gap: 0.25rem;
  }

  .new-deck-error {
    font-size: 0.625rem;
    color: rgba(255, 120, 120, 0.9);
    margin: 0;
    padding: 0.1rem 0;
  }

  .nav-empty {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.3);
    text-align: center;
    margin-top: 1rem;
  }

  .nav-list,
  .nav-vertical-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .nav-vertical-list {
    margin-left: 0.85rem;
    padding-left: 0.4rem;
    border-left: 2px solid rgba(255, 255, 255, 0.1);
    margin-top: 0.3rem;
  }

  .slide-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem;
    border-radius: 5px;
    border: 1px solid transparent;
    cursor: pointer;
    user-select: none;
  }
  .slide-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .slide-row.active {
    border-color: var(--color-accent, #4f8cff);
    background: rgba(79, 140, 255, 0.12);
  }
  .slide-row.hidden-slide .slide-thumb-wrap {
    opacity: 0.4;
  }

  .slide-index {
    font-size: 0.625rem;
    color: rgba(255, 255, 255, 0.4);
    min-width: 1.6rem;
    text-align: right;
    flex-shrink: 0;
  }

  .slide-thumb-wrap {
    position: relative;
    flex: 1;
    display: flex;
    justify-content: center;
  }

  .stack-badge,
  .hidden-badge,
  .theme-badge {
    position: absolute;
    top: 2px;
    font-size: 0.7rem;
    line-height: 1;
    background: rgba(0, 0, 0, 0.55);
    border-radius: 3px;
    padding: 1px 2px;
  }
  .stack-badge {
    right: 2px;
  }
  .hidden-badge {
    left: 2px;
  }
  .theme-badge {
    /* Position below stack-badge so they don't overlap when both present. */
    right: 2px;
    top: 18px;
    color: rgba(139, 195, 255, 0.9);
    font-size: 0.65rem;
  }

  .slide-actions {
    display: none;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }
  .slide-row:hover .slide-actions,
  .slide-row:focus-within .slide-actions {
    display: flex;
  }

  .mini-btn {
    font-size: 0.625rem;
    line-height: 1;
    width: 1.1rem;
    height: 1.1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
    border: none;
    cursor: pointer;
  }
  .mini-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .mini-btn.danger:hover {
    background: rgba(220, 60, 60, 0.5);
  }

  .drop-line {
    height: 2px;
    background: var(--color-accent, #4f8cff);
    border-radius: 1px;
    margin: 1px 0;
  }
</style>
