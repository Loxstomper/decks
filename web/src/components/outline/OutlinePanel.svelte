<script lang="ts">
  /**
   * OutlinePanel.svelte — Outline / layers tree panel (P3-3 / spec 04).
   *
   * This is the top-level outline component mounted in PaneLayout's `outline`
   * snippet zone.  It:
   *
   *   1. Builds the view-tree from the model via `buildOutlineTree()` (pure,
   *      no side effects) so Svelte's fine-grained reactivity can diff it.
   *
   *   2. Maintains expand/collapse state in a `$state` proxy object.  On first
   *      render (and whenever new eids appear after a model update) all nodes
   *      with children are auto-expanded so the user sees the full structure
   *      immediately.  Collapse state is preserved across incremental updates.
   *
   *   3. Bridges selection bidirectionally:
   *        Canvas → panel:  OutlineTreeNode scrolls itself into view when
   *                         selection.eid matches and highlights the row.
   *        Panel → canvas:  clicking a row calls selection.select(eid), which
   *                         the canvas overlay already listens to via the
   *                         selectionStore singleton.
   *
   * DECOUPLING:
   *   The component is a pure consumer of `model` and `selection`; it never
   *   imports deckStore or selectionStore directly.  The integrator (App.svelte)
   *   wires those in:
   *
   *     <OutlinePanel model={deckStore.model} selection={selectionStore} />
   *
   *   This keeps OutlinePanel testable and reusable (e.g., in Storybook or a
   *   second panel for a split view), and matches the decoupling requirement
   *   from the spec task description.
   *
   * PROPS:
   *   model     — The live DeckModel (or null when no deck is open).  Passed
   *               as a reactive value so the panel rebuilds when the model
   *               changes (deckStore.model is $state, so Svelte tracks it).
   *   selection — An ISelectionStore providing `.eid` and `.select()`.  The
   *               selectionStore singleton satisfies this interface.
   */

  import type { DeckModel } from '$lib/model';
  import {
    buildOutlineTree,
    collectExpandableEids,
    type OutlineNode,
  } from './buildOutlineTree';
  import OutlineTreeNode from './OutlineTreeNode.svelte';

  // ── Structural interface for the selection store ───────────────────────────

  /**
   * Minimum surface the panel needs from the selection store.  Keeping it as
   * a structural interface (not the concrete class) avoids coupling to the
   * store implementation and makes future testing with a mock trivial.
   */
  interface ISelectionStore {
    readonly eid: string | null;
    select(eid: string): void;
    clear(): void;
  }

  // ── Props ─────────────────────────────────────────────────────────────────

  interface Props {
    /**
     * The live deck model, or null when no deck is open.
     * Pass `deckStore.model` — it is `$state` so Svelte tracks changes.
     */
    model: DeckModel | null;
    /**
     * The canvas selection store.  Pass the `selectionStore` singleton.
     * The panel reads `.eid` for highlight + calls `.select()` on click.
     */
    selection: ISelectionStore;
  }

  let { model, selection }: Props = $props();

  // ── View-tree ─────────────────────────────────────────────────────────────

  /**
   * Derive the outline view-tree from the model.  `$derived` re-runs whenever
   * `model` (or any reactive value it reads) changes — no manual subscription
   * needed.  If the model is null or has no slides, the tree is empty and the
   * empty-state placeholder is shown.
   */
  const tree = $derived(buildOutlineTree(model));

  // ── Expand / collapse state ────────────────────────────────────────────────

  /**
   * Shared expand state: maps eid → boolean (true = expanded).
   *
   * Using a `$state` plain object (Svelte 5 Proxy) means mutations like
   *   `expanded[eid] = !expanded[eid]`
   * are fine-grained reactive — only the one row re-evaluates, not the whole
   * tree.  Because we share this object by reference with every OutlineTreeNode
   * (passing it as a prop), the proxy's reads inside children are also tracked.
   */
  let expanded = $state<Record<string, boolean>>({});

  /**
   * Auto-expand newly seen container eids whenever the tree changes.
   *
   * Strategy: for each eid collected from the new tree, if it has NOT been
   * seen before (key absent from expanded), default it to `true` (open).
   * If the user previously collapsed a node and the model updates without
   * removing that node's eid, the collapse state is preserved.
   *
   * WHY $effect AND NOT $derived:
   * We need to mutate `expanded` (side effect of the tree derivation), which
   * rules out $derived.  $effect is the right tool for "react to derived data
   * and update local state".
   */
  $effect(() => {
    const newEids = collectExpandableEids(tree);
    for (const eid of newEids) {
      if (!(eid in expanded)) {
        expanded[eid] = true; // auto-expand nodes seen for the first time
      }
    }
  });

  function toggleExpand(eid: string): void {
    expanded[eid] = !expanded[eid];
  }

  // ── Expand / collapse all ─────────────────────────────────────────────────

  function expandAll(): void {
    const eids = collectExpandableEids(tree);
    for (const eid of eids) expanded[eid] = true;
  }

  function collapseAll(): void {
    const eids = collectExpandableEids(tree);
    for (const eid of eids) expanded[eid] = false;
  }

  // ── Counts for the header ─────────────────────────────────────────────────

  const slideCount = $derived(tree.length);

  /** Count of all managed (non-passthrough) nodes in the tree. */
  function countManaged(nodes: OutlineNode[]): number {
    let total = 0;
    for (const n of nodes) {
      if (n.klass !== 'passthrough') total++;
      total += countManaged(n.children);
    }
    return total;
  }
  const managedCount = $derived(countManaged(tree));
</script>

<!--
  OutlinePanel root — takes full height of the containing zone (flex-1 in
  PaneLayout's outline-props div).  Uses flex-column so the header toolbar
  stays at the top and the scrolling tree fills the rest.
-->
<div class="outline-panel flex flex-col h-full min-h-0" role="none">

  <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
  {#if tree.length > 0}
    <div class="flex items-center gap-1 px-2 py-1 border-b border-white/10 flex-shrink-0">
      <!-- Slide / element counts -->
      <span class="text-[10px] text-fg/40 flex-1 truncate">
        {slideCount} slide{slideCount !== 1 ? 's' : ''} · {managedCount} elements
      </span>

      <!-- Expand all -->
      <button
        class="px-1.5 py-0.5 text-[10px] text-fg/40 hover:text-fg/70 hover:bg-white/5 rounded transition-colors"
        onclick={expandAll}
        title="Expand all"
        type="button"
      >
        ↓ all
      </button>

      <!-- Collapse all -->
      <button
        class="px-1.5 py-0.5 text-[10px] text-fg/40 hover:text-fg/70 hover:bg-white/5 rounded transition-colors"
        onclick={collapseAll}
        title="Collapse all"
        type="button"
      >
        ↑ all
      </button>
    </div>
  {/if}

  <!-- ── Tree ────────────────────────────────────────────────────────────── -->
  <div
    class="tree-scroll flex-1 overflow-y-auto min-h-0 py-1"
    role="tree"
    aria-label="Document outline"
  >
    {#if tree.length === 0}
      <!--
        Empty state: shown when no deck is open (model === null) or when the
        deck has no .slides content (malformed deck).
      -->
      <p class="text-[11px] text-fg/30 text-center mt-4 px-2">
        {#if model === null}
          No deck open
        {:else}
          No slides found
        {/if}
      </p>
    {:else}
      <!--
        Render one OutlineTreeNode per top-level slide.  The key is the slide
        eid so Svelte can efficiently diff individual slides without re-rendering
        siblings when only one changes.
      -->
      {#each tree as node (node.eid ?? node.tag)}
        <OutlineTreeNode
          {node}
          depth={0}
          {selection}
          {expanded}
          onToggle={toggleExpand}
        />
      {/each}
    {/if}
  </div>

</div>

<style>
  /*
   * Smooth hover background: Tailwind's hover: prefix doesn't compose cleanly
   * with the bg-opacity pattern we need here, so a small CSS rule handles it.
   * The component is the only consumer so scoping is fine.
   */
  :global(.node-row:not(.bg-accent):hover) {
    background-color: rgba(255, 255, 255, 0.05);
  }

  /*
   * Ensure the tree scroll region fills the available space in the right-panel
   * inner split and doesn't push the Source pane off-screen.
   */
  .tree-scroll {
    overflow-x: hidden;
  }
</style>
