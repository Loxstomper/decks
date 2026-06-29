<script lang="ts">
  /**
   * OutlineTreeNode.svelte — Recursive outline tree row (P3-3 / spec 04).
   *
   * WHY RECURSIVE:
   * The document hierarchy has unbounded depth (containers nesting containers).
   * Svelte 5 handles circular component imports cleanly at build time (Vite
   * resolves the cycle), so each node renders its children by importing itself.
   * This is the idiomatic Svelte 5 replacement for `<svelte:self>` (deprecated).
   *
   * PROPS CONTRACT (see OutlinePanel for how they are wired):
   *  node       — the OutlineNode to render for this row
   *  depth      — nesting depth (controls left-padding; 0 = top-level slide)
   *  selection  — the live SelectionStore; drives highlight + click-to-select
   *  expanded   — $state proxy Record<eid, boolean> shared by the whole tree
   *  onToggle   — callback to flip the expanded state for a given eid
   *
   * INTERACTION MODEL:
   *  Click row   → select the element on canvas (sets selection.eid)
   *  Click arrow → expand / collapse that subtree (no selection change)
   *  Passthrough → not selectable (no eid); clicking on one does nothing
   *
   * ACCESSIBILITY:
   *  The tree follows the ARIA Treeview pattern: role="treeitem" on each row,
   *  aria-selected, aria-expanded, keyboard Enter to select.  Passthrough rows
   *  use role="presentation" (not interactive).
   */

  import type { OutlineNode } from './buildOutlineTree';
  // Svelte 5: import self for recursion (the bundler handles the cycle).
  import OutlineTreeNode from './OutlineTreeNode.svelte';

  // Structural interface so the prop stays decoupled from the concrete class.
  interface ISelectionStore {
    readonly eid: string | null;
    select(eid: string): void;
  }

  interface Props {
    node: OutlineNode;
    depth?: number;
    selection: ISelectionStore;
    /** Shared expand state: $state proxy Record mapping eid → boolean. */
    expanded: Record<string, boolean>;
    /** Called with the eid to toggle expand / collapse. */
    onToggle: (eid: string) => void;
    /**
     * Right-click on a row (P13-4). Selects this node then asks the host to open
     * the SAME cursor-positioned context menu used on the canvas, at the given
     * viewport (client) coordinates.
     */
    onContextMenu?: (eid: string, clientX: number, clientY: number) => void;
  }

  let { node, depth = 0, selection, expanded, onToggle, onContextMenu }: Props = $props();

  // ── Derived state ───────────────────────────────────────────────────────────

  const hasChildren = $derived(node.children.length > 0);

  /** Only managed nodes with children can be toggled. */
  const canToggle = $derived(node.eid !== null && hasChildren);

  /**
   * Expanded state for this node:
   *   - Passthrough nodes are always shown expanded (no toggle affordance).
   *   - Managed nodes default to expanded (true) if not yet recorded in the
   *     expanded map, so the initial render shows everything open.
   */
  const isExpanded = $derived(
    node.eid === null ? true : (expanded[node.eid] ?? true),
  );

  const isSelected = $derived(node.eid !== null && selection.eid === node.eid);

  const isPassthrough = $derived(node.klass === 'passthrough');

  // ── Scroll-into-view ────────────────────────────────────────────────────────

  /** Bound to the row element so we can scroll it into view on selection. */
  let rowEl: HTMLElement | undefined = $state();

  /**
   * Scroll the selected row into view whenever selection.eid changes to match
   * this node.  `block: 'nearest'` avoids scrolling when the row is already
   * visible — it only fires when the row is outside the scroll viewport.
   */
  $effect(() => {
    if (isSelected && rowEl) {
      rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  // ── Interaction ─────────────────────────────────────────────────────────────

  function handleRowClick() {
    // Passthrough elements have no eid and are not selectable.
    if (node.eid && !isPassthrough) {
      selection.select(node.eid);
    }
  }

  function handleRowContextMenu(e: MouseEvent) {
    // Passthrough rows are not selectable / actionable — no menu.
    if (!node.eid || isPassthrough) return;
    e.preventDefault();
    // Select the right-clicked node first so the menu acts on it, then open the
    // shared context menu at the cursor.
    selection.select(node.eid);
    onContextMenu?.(node.eid, e.clientX, e.clientY);
  }

  function handleToggleClick(e: MouseEvent | KeyboardEvent) {
    // Prevent the row click handler from also running.
    e.stopPropagation();
    if (node.eid) onToggle(node.eid);
  }

  function handleRowKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick();
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && canToggle) {
      e.preventDefault();
      // ArrowRight expands, ArrowLeft collapses (ARIA treeview convention).
      if (e.key === 'ArrowRight' && !isExpanded) onToggle(node.eid!);
      if (e.key === 'ArrowLeft' && isExpanded) onToggle(node.eid!);
    }
  }

  // ── Icon colours ────────────────────────────────────────────────────────────

  // Each class gets a distinct colour so you can parse the tree at a glance.
  const iconColorClass: Record<string, string> = {
    container: 'text-sky-400',
    leaf:      'text-emerald-400',
    free:      'text-amber-400',
    passthrough: 'text-fg/25',
  };
  const iconColor = $derived(iconColorClass[node.klass] ?? 'text-fg/50');
</script>

<!--
  Wrapper div carries no visual chrome; it is the structural parent for
  a) the clickable row and b) the nested children (collapsed via display:none
  equivalent through the {#if} guard).
-->
<div class="outline-node" role="none">

  <!-- ── Row ────────────────────────────────────────────────────────────────── -->
  <!--
    role="treeitem" IS an interactive widget role in the ARIA spec and requires
    a positive tabindex for keyboard navigation.  Svelte's a11y checker does not
    include it in its built-in interactive-role allowlist (a known gap), so we
    suppress the false-positive warning here.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={rowEl}
    class="node-row group flex items-center gap-1 py-0.5 pr-2 cursor-default select-none rounded-sm text-xs leading-5 min-w-0"
    class:bg-accent={isSelected}
    class:text-white={isSelected}
    class:hover:bg-white={!isSelected}
    class:hover:bg-opacity-5={!isSelected}
    class:opacity-40={isPassthrough}
    style:padding-left="{4 + depth * 12}px"
    role={isPassthrough ? 'presentation' : 'treeitem'}
    aria-selected={isPassthrough ? undefined : isSelected}
    aria-expanded={hasChildren && !isPassthrough ? isExpanded : undefined}
    tabindex={isPassthrough ? -1 : 0}
    onclick={handleRowClick}
    oncontextmenu={handleRowContextMenu}
    onkeydown={handleRowKeydown}
  >

    <!-- Expand / collapse toggle arrow (12×12 touch-target) -->
    {#if canToggle}
      <button
        class="toggle-btn flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-white/10 focus:outline-none"
        onclick={handleToggleClick}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleToggleClick(e)}
        tabindex="-1"
        aria-label={isExpanded ? 'Collapse' : 'Expand'}
        type="button"
      >
        <!--
          Triangle indicator: ▾ (down) when expanded, ▸ (right) when collapsed.
          Inline SVG so we can animate the rotation without an extra class.
        -->
        <svg
          class="w-2 h-2 transition-transform duration-100 {isExpanded ? 'rotate-0' : '-rotate-90'}"
          viewBox="0 0 8 8"
          fill="currentColor"
          aria-hidden="true"
        >
          <!-- Down-pointing triangle -->
          <polygon points="1,2 7,2 4,6" />
        </svg>
      </button>
    {:else}
      <!-- Placeholder so labels stay aligned regardless of whether there's a toggle -->
      <span class="flex-shrink-0 w-3 h-3" aria-hidden="true"></span>
    {/if}

    <!-- Class icon — a small SVG symbol unique to each klass -->
    <span class="flex-shrink-0 w-3 h-3 {iconColor}" aria-hidden="true" title={node.klass}>
      {#if node.klass === 'container'}
        <!--
          Container: a small box with an inner grid line — signals "layout wrapper".
        -->
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
          <line x1="1.5" y1="6" x2="10.5" y2="6" />
          <line x1="6" y1="6" x2="6" y2="10.5" />
        </svg>
      {:else if node.klass === 'leaf'}
        <!--
          Leaf: three horizontal lines — signals "text / content block".
        -->
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="2" y1="3" x2="10" y2="3" />
          <line x1="2" y1="6" x2="10" y2="6" />
          <line x1="2" y1="9" x2="7" y2="9" />
        </svg>
      {:else if node.klass === 'free'}
        <!--
          Free: crosshair with dot — signals "absolute positioned element".
        -->
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="6" cy="6" r="1.5" fill="currentColor" stroke="none" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="6" y1="8" x2="6" y2="11" />
          <line x1="1" y1="6" x2="4" y2="6" />
          <line x1="8" y1="6" x2="11" y2="6" />
        </svg>
      {:else}
        <!--
          Passthrough: X mark — signals "source only; editor does not manage this".
          (spec cross-cutting X-3: "never-destroy badge")
        -->
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
          <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
        </svg>
      {/if}
    </span>

    <!-- Label text — truncated with ellipsis to prevent overflow.
         WHY inline class expression (not class: directive): Svelte's class:
         directive tokenises the `/` in Tailwind opacity modifiers (e.g.
         text-white/60) as a punctuation character and fails to parse them.
         A template-literal class value avoids the issue entirely. -->
    <span
      class="node-label flex-1 truncate font-mono {isPassthrough
        ? 'text-fg/25'
        : !isSelected
          ? 'text-fg/60'
          : ''}"
    >
      {node.label}
    </span>

    <!--
      "Source only" badge for passthrough nodes (spec cross-cutting X-3).
      Uses title attribute for tooltip to keep the row compact.
    -->
    {#if isPassthrough}
      <span
        class="flex-shrink-0 ml-1 px-1 py-px text-[9px] font-semibold uppercase tracking-wide rounded bg-white/10 text-fg/30"
        title="Source-only — the editor never modifies this element; it round-trips byte-identically (spec 12 #4)"
        aria-label="source only"
      >
        src
      </span>
    {/if}

  </div><!-- /node-row -->

  <!-- ── Children ──────────────────────────────────────────────────────────── -->
  {#if hasChildren && isExpanded}
    <div role="group">
      {#each node.children as child (child.eid ?? child.tag + '_' + child.label)}
        <OutlineTreeNode
          node={child}
          depth={depth + 1}
          {selection}
          {expanded}
          {onToggle}
          {onContextMenu}
        />
      {/each}
    </div>
  {/if}

</div>
