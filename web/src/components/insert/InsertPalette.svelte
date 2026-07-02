<script lang="ts">
  /**
   * InsertPalette.svelte — Insert palette / block menu (P5-1).
   *
   * WHY THIS EXISTS (spec 03 "Leaf block types are insertable"):
   * ===========================================================
   * The single UI seam for adding content. It lists every block type in the
   * REGISTRY (blocks/registry.ts) — never a hard-coded list — so Lane FE-B's
   * image/code/math blocks appear automatically once registered (see
   * blocks/types.ts REGISTRY CONTRACT). Importing `$lib/blocks` triggers the
   * default registrations.
   *
   * INSERTION FLOW:
   *   1. The user opens the palette (the "+ Insert" button, or the `/` key while
   *      the canvas is focused and no text field is active).
   *   2. Choosing a block with no `fields` inserts immediately; a block WITH
   *      fields (e.g. the embed URL, table size) shows a tiny inline form first.
   *   3. We resolve WHERE to drop it from the current selection + the block's
   *      placement (blocks/target.ts), then call the insert seam:
   *        deckStore.insertBlock(parentEid, node)   — into a container
   *        deckStore.insertAfter(eid, node)          — after a leaf
   *      The seam stamps the eid, makes it one undo entry + autosave, and selects
   *      the new block.
   *
   * SELF-CONTAINED: it reads deckStore + selectionStore directly (like the other
   * panels), so the integrator can drop `<InsertPalette />` into the toolbar with
   * no props/wiring.
   *
   * Svelte 5 runes; no createEventDispatcher.
   */

  import type { Component } from 'svelte';
  import { deckStore } from '$lib/store/deck.svelte';
  import { selectionStore } from '$lib/canvas/selection.svelte';
  import type { ElementNode } from '$lib/model';
  import {
    getInsertRegistryByGroup,
    resolveInsertTarget,
    type InsertBlockDef,
    type BuildArgs,
  } from '$lib/blocks';
  import ImageUploadZone from './ImageUploadZone.svelte';
  import SharedLibrary from './SharedLibrary.svelte';
  import ProviderSearch from './ProviderSearch.svelte';
  import CodeBlockPanel from './CodeBlockPanel.svelte';
  import MathBlockPanel from './MathBlockPanel.svelte';
  import ChartBlockPanel from './ChartBlockPanel.svelte';
  import QrBlockPanel from './QrBlockPanel.svelte';

  /**
   * Props every panel-driven block component accepts. The palette owns placement;
   * the panel only acquires/builds the node and calls onInsert with it.
   */
  type PanelProps = {
    deckName: string;
    onInsert: (node: ElementNode) => void;
    onCancel?: () => void;
  };

  /**
   * Resolve a block def's `panel` string (kept Svelte-free in the registry) to the
   * concrete component. This is the single place that couples panel ids to their
   * implementations, so the registry and FE-B's modules stay import-light.
   */
  const PANELS: Record<string, Component<PanelProps>> = {
    ImageUploadZone,
    SharedLibrary,
    ProviderSearch,
    CodeBlockPanel,
    MathBlockPanel,
    ChartBlockPanel,
    QrBlockPanel,
  };

  // ── Local UI state ───────────────────────────────────────────────────────────

  /** Whether the dropdown menu is open. */
  let open = $state(false);
  /**
   * The block awaiting field input. When non-null the menu shows that block's
   * form instead of the type list. null = show the type list.
   */
  let pendingDef = $state<InsertBlockDef | null>(null);
  /**
   * The panel-driven block (image/code/math) whose modal is currently open, or
   * null. Non-null mounts {@link PANELS}[panelDef.panel] in a modal overlay.
   */
  let panelDef = $state<InsertBlockDef | null>(null);
  /** Current values for the pending block's fields, keyed by field name. */
  let fieldValues = $state<Record<string, string>>({});
  /** Root element — used to detect outside clicks so the menu closes. */
  let root: HTMLElement | undefined;

  /** Grouped registry, recomputed when the menu opens (registrations are static
   *  after load, but reading lazily keeps FE-B's late registrations visible). */
  const groups = $derived(open ? getInsertRegistryByGroup() : []);

  /** Disabled when no deck is open — there is nowhere to insert. */
  const canInsert = $derived(!!deckStore.model);

  // ── Open / close ─────────────────────────────────────────────────────────────

  function openMenu(): void {
    if (!canInsert) return;
    open = true;
    pendingDef = null;
  }

  function closeMenu(): void {
    open = false;
    pendingDef = null;
    fieldValues = {};
  }

  /** The currently-open panel component (or null when no panel is open). */
  const panelComponent = $derived(panelDef?.panel ? PANELS[panelDef.panel] : null);
  /** Deck name handed to panels for their upload / search / fetch API calls. */
  const deckName = $derived(deckStore.name ?? '');

  function closePanel(): void {
    panelDef = null;
  }

  function toggleMenu(): void {
    if (open) closeMenu();
    else openMenu();
  }

  // ── Choosing a block type ────────────────────────────────────────────────────

  function chooseBlock(def: InsertBlockDef): void {
    if (def.panel) {
      // Panel-driven block (image/code/math): hand off to its modal. Close the
      // dropdown so only the modal is visible; placement happens on its callback.
      panelDef = def;
      open = false;
      return;
    }
    if (def.fields && def.fields.length > 0) {
      // Seed the form with each field's default so the user can just hit Insert.
      const seed: Record<string, string> = {};
      for (const f of def.fields) seed[f.name] = f.default === undefined ? '' : String(f.default);
      fieldValues = seed;
      pendingDef = def;
      return;
    }
    void insert(def, {});
  }

  /** True when every `required` field of the pending block has a value. */
  const pendingValid = $derived.by(() => {
    if (!pendingDef) return false;
    for (const f of pendingDef.fields ?? []) {
      if (f.required && (fieldValues[f.name] ?? '').trim() === '') return false;
    }
    return true;
  });

  function submitPending(): void {
    if (!pendingDef || !pendingValid) return;
    const args: BuildArgs = { ...fieldValues };
    void insert(pendingDef, args);
  }

  // ── The insert itself ────────────────────────────────────────────────────────

  async function insert(def: InsertBlockDef, args: BuildArgs): Promise<void> {
    if (!deckStore.model || !def.build) return;
    // Build the model subtree (pure) and hand it to the shared placement path.
    await placeNode(def.build(args), def.placement ?? 'flow');
    closeMenu();
  }

  /**
   * Shared placement tail for BOTH inline-built and panel-built nodes: resolve
   * where the block lands from the current selection + placement, then call the
   * insert seam (one undo entry + autosave + select-new). A degenerate deck with
   * no host section is a safe no-op.
   */
  async function placeNode(node: ElementNode, placement: 'flow' | 'free'): Promise<void> {
    const model = deckStore.model;
    if (!model) return;
    const target = resolveInsertTarget(model, selectionStore.eid, placement);
    if (!target) return;
    if (target.mode === 'into') {
      await deckStore.insertBlock(target.parentEid, node);
    } else {
      await deckStore.insertAfter(target.eid, node);
    }
  }

  /** A panel finished building its node: place it, then close the modal. */
  async function onPanelInsert(node: ElementNode): Promise<void> {
    const placement = panelDef?.placement ?? 'flow';
    await placeNode(node, placement);
    closePanel();
  }

  // ── Keyboard + outside-click affordances ─────────────────────────────────────

  /** `/` opens the palette — but only when the user is not typing somewhere. */
  function onWindowKeydown(e: KeyboardEvent): void {
    if (panelDef) {
      // A panel modal owns the screen; only Escape (to dismiss) is ours.
      if (e.key === 'Escape') closePanel();
      return;
    }
    if (open) {
      if (e.key === 'Escape') {
        closeMenu();
      }
      return;
    }
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!canInsert) return;
    const t = e.target as HTMLElement | null;
    if (isTextEntry(t)) return; // don't hijack `/` while typing
    e.preventDefault();
    openMenu();
  }

  /** True if the element is a text-entry context where `/` is literal input. */
  function isTextEntry(el: HTMLElement | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      el.isContentEditable ||
      // CodeMirror editors render a contenteditable host with this class.
      el.closest('.cm-editor') !== null
    );
  }

  function onWindowPointerdown(e: PointerEvent): void {
    if (!open || !root) return;
    if (!root.contains(e.target as Node)) closeMenu();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} />

<div class="insert-palette" bind:this={root}>
  <button
    class="insert-trigger"
    type="button"
    disabled={!canInsert}
    aria-haspopup="menu"
    aria-expanded={open}
    title="Insert a block ( / )"
    onclick={toggleMenu}
  >
    <svg class="trigger-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
    Insert
  </button>

  {#if open}
    <div class="insert-menu" role="menu">
      {#if pendingDef}
        <!-- ── Field form for a block that needs input (embed URL, table size) ── -->
        <div class="form-header">
          <button class="back-btn" type="button" title="Back" onclick={() => (pendingDef = null)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <span>{pendingDef.label}</span>
        </div>

        {#each pendingDef.fields ?? [] as field (field.name)}
          <label class="field-row">
            <span class="field-label">{field.label}</span>
            <input
              class="field-input"
              type={field.type === 'number' ? 'number' : 'text'}
              placeholder={field.placeholder ?? ''}
              bind:value={fieldValues[field.name]}
              onkeydown={(e) => {
                if (e.key === 'Enter') submitPending();
              }}
            />
          </label>
        {/each}

        <button class="form-submit" type="button" disabled={!pendingValid} onclick={submitPending}>
          Insert {pendingDef.label}
        </button>
      {:else}
        <!-- ── Block type list, grouped ──────────────────────────────────────── -->
        {#each groups as { group, blocks } (group)}
          <div class="menu-group-label">{group}</div>
          {#each blocks as def (def.id)}
            <button class="menu-item" type="button" role="menuitem" onclick={() => chooseBlock(def)}>
              <svg class="item-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={def.icon} />
              </svg>
              <span class="item-label">{def.label}</span>
              {#if def.fields && def.fields.length > 0}
                <span class="item-more" aria-hidden="true">…</span>
              {/if}
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</div>

<!--
  Panel modal for richer block types (image upload / shared library / provider
  search / code / math). Rendered at the palette root (portal-free) as a fixed
  overlay so it floats above the editor. The panel component owns its own form;
  we only supply deckName + onInsert/onCancel and place the node it returns.
-->
{#if panelDef && panelComponent}
  {@const PanelComponent = panelComponent}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel-backdrop" onclick={closePanel}>
    <div class="panel-modal" onclick={(e) => e.stopPropagation()}>
      <PanelComponent {deckName} onInsert={onPanelInsert} onCancel={closePanel} />
    </div>
  </div>
{/if}

<style>
  .insert-palette {
    position: relative;
    display: inline-block;
  }

  /* ── Trigger button ───────────────────────────────────────────────────────── */
  .insert-trigger {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .insert-trigger:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.95);
  }
  .insert-trigger:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .trigger-icon {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
    stroke-linecap: round;
  }

  /* ── Dropdown menu ────────────────────────────────────────────────────────── */
  .insert-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 200px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(28, 28, 34, 0.98);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
  }

  .menu-group-label {
    padding: 6px 8px 2px;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.75rem;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover {
    background: rgba(59, 130, 246, 0.18);
    color: #fff;
  }
  .item-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .item-label {
    flex: 1;
  }
  .item-more {
    color: rgba(255, 255, 255, 0.35);
    font-size: 0.8rem;
  }

  /* ── Field form ───────────────────────────────────────────────────────────── */
  .form-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 6px;
    font-size: 0.72rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }
  .back-btn {
    display: inline-flex;
    padding: 2px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    border-radius: 4px;
  }
  .back-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  .back-btn svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .field-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
  }
  .field-label {
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }
  .field-input {
    padding: 4px 7px;
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.72rem;
    font-family: inherit;
    outline: none;
  }
  .field-input:focus {
    border-color: rgba(59, 130, 246, 0.6);
  }

  .form-submit {
    margin: 6px 4px 4px;
    padding: 5px 10px;
    border-radius: 5px;
    border: 1px solid rgba(59, 130, 246, 0.5);
    background: rgba(59, 130, 246, 0.25);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }
  .form-submit:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.4);
  }
  .form-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Panel modal (image / shared / provider / code / math) ─────────────────── */
  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }
  .panel-modal {
    width: 100%;
    max-width: 460px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 1rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(28, 28, 34, 0.99);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  }
</style>
