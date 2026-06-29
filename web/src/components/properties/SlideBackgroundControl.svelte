<script lang="ts">
  /**
   * SlideBackgroundControl.svelte — P16-3a: Slide background editor in the
   * Properties panel.
   *
   * WHY THIS EXISTS:
   * ================
   * Lets the user set or clear the slide background directly from the Properties
   * panel whenever a Slide container is selected. Supports four mutually-exclusive
   * background types: Color (solid), Image (upload/shared/search), Gradient
   * (two-color builder or raw CSS), and Video (upload + loop/mute flags).
   *
   * COMMAND PATTERN:
   * Every change calls `deckStore.applySlideBackground(slideEid, delta)` — one
   * undo entry + autosave. Asset localization (upload, copy-from-shared, provider
   * fetch) runs first so the stored src is always a deck-relative path (offline-
   * first; spec 08 / 12).
   *
   * EXCLUSIVE TYPES:
   * Switching to Color clears image / gradient / video. Switching to Image /
   * Gradient / Video clears the others (buildBackgroundProps in the store enforces
   * gradient/video exclusivity; Color clearing is done explicitly here). The "Clear
   * all" button removes everything.
   *
   * STORE READS:
   * Current values are read via getThemeProps(el) which is derived from
   * deckStore.model. No local copy is kept; every re-render reads the model.
   *
   * SVELTE 5: runes ($state, $derived, named-function $derived pattern to avoid
   * circular type-inference — same convention as PropertiesPanel).
   */

  import { untrack } from 'svelte';
  import { deckStore } from '$lib/store/deck.svelte';
  import { findByEid } from '$lib/model';
  import { getThemeProps } from '$lib/model/theme';
  import {
    uploadAsset,
    listShared,
    copySharedAsset,
    listProviders,
    searchProvider,
    fetchProviderImage,
    type SharedFile,
    type Provider,
    type ProviderResult,
  } from '$lib/blocks/api';
  import type { SlideBackgroundDelta } from '$lib/store/deck.svelte';

  // ── Component props ────────────────────────────────────────────────────────

  interface Props {
    /** data-eid of the currently selected slide `<section>`. */
    slideEid: string;
  }

  let { slideEid }: Props = $props();

  // ── Model derivations (named functions — avoids $derived type-inference issues) ──

  function resolveThemeProps() {
    if (!slideEid || !deckStore.model) return null;
    const el = findByEid(deckStore.model, slideEid);
    return el ? getThemeProps(el) : null;
  }

  const themeProps = $derived(resolveThemeProps());

  type BgType = 'color' | 'image' | 'gradient' | 'video';

  function deriveSlideType(): BgType | 'none' {
    if (!themeProps) return 'none';
    if (themeProps.backgroundVideo) return 'video';
    if (themeProps.backgroundGradient) return 'gradient';
    if (themeProps.backgroundImage) return 'image';
    if (themeProps.backgroundColor) return 'color';
    return 'none';
  }

  const slideType = $derived(deriveSlideType());

  // ── UI state ──────────────────────────────────────────────────────────────

  /**
   * The type panel the user has chosen to edit. null → track slideType.
   * Reset to null whenever the slide (eid) changes so the panel reflects the
   * incoming slide's actual background rather than a stale tab choice.
   */
  let uiType = $state<BgType | 'none' | null>(null);
  const activeType = $derived(uiType ?? slideType);

  $effect(() => {
    // Access slideEid to register it as a reactive dependency.
    // All other reads are wrapped in untrack so only a slide-change triggers
    // this reset (not every model update after the user sets a background).
    void slideEid;
    untrack(() => {
      uiType = null;
      imgTab = 'upload';
      imgError = null;
      videoError = null;
    });
  });

  // ── Apply helper ──────────────────────────────────────────────────────────

  async function apply(delta: SlideBackgroundDelta): Promise<void> {
    await deckStore.applySlideBackground(slideEid, delta);
  }

  /** Clear ALL background attributes (color + type + modifiers). */
  async function clearAll(): Promise<void> {
    await apply({
      color: null,
      image: null,
      size: null,
      position: null,
      repeat: null,
      opacity: null,
      gradient: null,
      video: null,
      videoLoop: null,
      videoMuted: null,
    });
    uiType = 'none';
  }

  // ── Type selector ─────────────────────────────────────────────────────────

  function selectType(t: BgType): void {
    uiType = t;
    if (t === 'color') {
      // Immediately clear the competing background types. If there's already a
      // color, keep it; otherwise set a tasteful default.
      const col = themeProps?.backgroundColor ?? '#1a1a2e';
      void apply({
        color: col,
        image: null,
        size: null,
        position: null,
        repeat: null,
        opacity: null,
        gradient: null,
        video: null,
        videoLoop: null,
        videoMuted: null,
      });
    }
  }

  // ── Color ─────────────────────────────────────────────────────────────────

  function onColorPick(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    void apply({
      color: v,
      image: null,
      gradient: null,
      video: null,
      videoLoop: null,
      videoMuted: null,
    });
  }

  // ── Image ─────────────────────────────────────────────────────────────────

  let imgUploading = $state(false);
  let imgError = $state<string | null>(null);
  let imgDragOver = $state(false);
  let imgTab = $state<'upload' | 'library' | 'search'>('upload');
  let imgFileInput: HTMLInputElement | undefined = $state();

  async function processImageFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      imgError = `"${file.name}" is not an image.`;
      return;
    }
    if (!deckStore.name) return;
    imgError = null;
    imgUploading = true;
    try {
      const src = await uploadAsset(deckStore.name, file);
      await apply({ color: null, image: src, gradient: null, video: null, videoLoop: null, videoMuted: null });
    } catch (err) {
      imgError = err instanceof Error ? err.message : String(err);
    } finally {
      imgUploading = false;
    }
  }

  function onImgDragOver(e: DragEvent): void { e.preventDefault(); imgDragOver = true; }
  function onImgDragLeave(): void { imgDragOver = false; }

  async function onImgDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    imgDragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) await processImageFile(file);
  }

  async function onImgPaste(e: ClipboardEvent): Promise<void> {
    const item = Array.from(e.clipboardData?.items ?? []).find(
      (i) => i.type.startsWith('image/'),
    );
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) await processImageFile(file);
  }

  async function onImgFileChange(e: Event): Promise<void> {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) await processImageFile(file);
  }

  // ── Shared library ─────────────────────────────────────────────────────────

  let sharedFiles = $state<SharedFile[]>([]);
  let sharedLoading = $state(false);
  let sharedLoaded = $state(false);
  let sharedCopying = $state<string | null>(null);

  async function loadShared(): Promise<void> {
    if (sharedLoaded || sharedLoading) return;
    sharedLoading = true;
    try {
      sharedFiles = await listShared();
      sharedLoaded = true;
    } catch {
      sharedLoaded = true;
    } finally {
      sharedLoading = false;
    }
  }

  async function onSharedClick(file: SharedFile): Promise<void> {
    if (!deckStore.name || sharedCopying) return;
    sharedCopying = file.path;
    imgError = null;
    try {
      const src = await copySharedAsset(deckStore.name, file.name);
      await apply({ color: null, image: src, gradient: null, video: null, videoLoop: null, videoMuted: null });
    } catch (err) {
      imgError = err instanceof Error ? err.message : String(err);
    } finally {
      sharedCopying = null;
    }
  }

  function onLibTab(): void {
    imgTab = 'library';
    void loadShared();
  }

  // ── Provider search ────────────────────────────────────────────────────────

  let providers = $state<Provider[]>([]);
  let activeProvider = $state('');
  let searchQuery = $state('');
  let searchResults = $state<ProviderResult[]>([]);
  let searching = $state(false);
  let fetching = $state<string | null>(null);
  let searchError = $state<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let providersLoaded = $state(false);

  async function loadProviders(): Promise<void> {
    if (providersLoaded) return;
    try {
      providers = await listProviders();
      const first = providers.find((p) => p.enabled);
      if (first) activeProvider = first.name;
    } catch {
      // degrade gracefully
    } finally {
      providersLoaded = true;
    }
  }

  function onSearchTab(): void {
    imgTab = 'search';
    void loadProviders();
  }

  function onSearchInput(e: Event): void {
    searchQuery = (e.currentTarget as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    if (!searchQuery.trim() || !activeProvider) {
      searchResults = [];
      searching = false;
      return;
    }
    searching = true;
    searchError = null;
    searchTimer = setTimeout(() => {
      void runSearch();
    }, 350);
  }

  async function runSearch(): Promise<void> {
    if (!searchQuery.trim() || !activeProvider) { searching = false; return; }
    try {
      searchResults = await searchProvider(activeProvider, searchQuery);
    } catch {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function onResultClick(result: ProviderResult): Promise<void> {
    if (!deckStore.name || fetching) return;
    fetching = result.id;
    searchError = null;
    try {
      const src = await fetchProviderImage(deckStore.name, activeProvider, result);
      await apply({ color: null, image: src, gradient: null, video: null, videoLoop: null, videoMuted: null });
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err);
    } finally {
      fetching = null;
    }
  }

  // ── Image modifiers ────────────────────────────────────────────────────────

  function onFitChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    void apply({ size: v || null });
  }

  function onPositionChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim();
    void apply({ position: v || null });
  }

  function onOpacityChange(e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    const n = parseFloat(raw);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
    void apply({ opacity: clamped !== null ? String(clamped) : null });
  }

  // ── Gradient ───────────────────────────────────────────────────────────────

  /**
   * Detect a "simple" two-stop linear gradient we can render as two color pickers.
   * Non-matching existing gradients fall back to the raw text input.
   */
  function parseSimpleGradient(
    g: string | null,
  ): { dir: string; c1: string; c2: string } | null {
    if (!g) return null;
    const m = g.match(
      /^linear-gradient\(([^,]+),\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)$/,
    );
    if (!m) return null;
    return { dir: m[1].trim(), c1: m[2], c2: m[3] };
  }

  const parsedGrad = $derived(parseSimpleGradient(themeProps?.backgroundGradient ?? null));

  // UI state for the simple gradient builder — kept in sync with parsedGrad on
  // slide changes (via prevEid effect above), but not re-synced after user edits
  // so in-progress editing is not clobbered by intermediate model updates.
  let gradDir = $state('to bottom right');
  let gradColor1 = $state('#1a1a2e');
  let gradColor2 = $state('#16213e');
  let gradMode = $state<'simple' | 'raw'>('simple');

  // Initialize gradient local state when the slide changes.
  // Only slideEid is tracked; themeProps/parsedGrad are read via untrack so
  // the effect does NOT re-run when the model updates after the user edits the
  // gradient (which would clobber in-progress color-picker edits).
  $effect(() => {
    void slideEid;
    untrack(() => {
      if (parsedGrad) {
        gradDir = parsedGrad.dir;
        gradColor1 = parsedGrad.c1;
        gradColor2 = parsedGrad.c2;
        gradMode = 'simple';
      } else if (themeProps?.backgroundGradient) {
        gradMode = 'raw';
      } else {
        gradDir = 'to bottom right';
        gradColor1 = '#1a1a2e';
        gradColor2 = '#16213e';
        gradMode = 'simple';
      }
    });
  });

  function buildGradient(): string {
    return `linear-gradient(${gradDir}, ${gradColor1}, ${gradColor2})`;
  }

  function applyGradient(): void {
    void apply({
      color: null,
      image: null,
      gradient: buildGradient(),
      video: null,
      videoLoop: null,
      videoMuted: null,
    });
  }

  function onGradColor1(e: Event): void {
    gradColor1 = (e.target as HTMLInputElement).value;
    applyGradient();
  }

  function onGradColor2(e: Event): void {
    gradColor2 = (e.target as HTMLInputElement).value;
    applyGradient();
  }

  function onGradDirChange(e: Event): void {
    gradDir = (e.target as HTMLSelectElement).value;
    applyGradient();
  }

  function onRawGradientChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim();
    void apply({ color: null, image: null, gradient: v || null, video: null, videoLoop: null, videoMuted: null });
  }

  // ── Video ──────────────────────────────────────────────────────────────────

  let videoUploading = $state(false);
  let videoError = $state<string | null>(null);
  let videoFileInput: HTMLInputElement | undefined = $state();

  async function onVideoFileChange(e: Event): Promise<void> {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !deckStore.name) return;
    if (!file.type.startsWith('video/')) {
      videoError = 'Not a video file.';
      return;
    }
    videoError = null;
    videoUploading = true;
    try {
      const src = await uploadAsset(deckStore.name, file);
      await apply({ color: null, image: null, gradient: null, video: src });
    } catch (err) {
      videoError = err instanceof Error ? err.message : String(err);
    } finally {
      videoUploading = false;
    }
  }

  function onVideoLoopChange(e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    void apply({ videoLoop: checked ? 'true' : null });
  }

  function onVideoMutedChange(e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    void apply({ videoMuted: checked ? 'true' : null });
  }

  // ── Derived display helpers ────────────────────────────────────────────────

  function basename(path: string): string {
    return path.split('/').pop() ?? path;
  }
</script>

<!-- ── Section header ─────────────────────────────────────────────────────── -->
<div class="bg-section">
  <div class="section-sublabel">Slide background</div>

  <!-- ── Type selector ──────────────────────────────────────────────────── -->
  <div class="type-selector" role="group" aria-label="Background type">
    {#each (['color', 'image', 'gradient', 'video'] as const) as t}
      <button
        type="button"
        class="type-btn"
        class:active={activeType === t}
        onclick={() => selectType(t)}
      >{t}</button>
    {/each}
  </div>

  <!-- ── Color ──────────────────────────────────────────────────────────── -->
  {#if activeType === 'color'}
    <div class="sub-panel">
      <div class="color-row">
        <input
          class="color-swatch"
          type="color"
          value={themeProps?.backgroundColor ?? '#1a1a2e'}
          title="Background color"
          aria-label="Background color"
          oninput={onColorPick}
        />
        <span class="color-value">{themeProps?.backgroundColor ?? 'not set'}</span>
      </div>
    </div>
  {/if}

  <!-- ── Image ──────────────────────────────────────────────────────────── -->
  {#if activeType === 'image'}
    <div class="sub-panel">
      {#if themeProps?.backgroundImage}
        <div class="current-asset">
          <span class="asset-path" title={themeProps.backgroundImage}>
            {basename(themeProps.backgroundImage)}
          </span>
        </div>
      {/if}

      <!-- Sub-tab bar -->
      <div class="sub-tabs" role="tablist">
        <button
          type="button" role="tab" class="sub-tab"
          class:active={imgTab === 'upload'}
          aria-selected={imgTab === 'upload'}
          onclick={() => (imgTab = 'upload')}
        >Upload</button>
        <button
          type="button" role="tab" class="sub-tab"
          class:active={imgTab === 'library'}
          aria-selected={imgTab === 'library'}
          onclick={onLibTab}
        >Library</button>
        <button
          type="button" role="tab" class="sub-tab"
          class:active={imgTab === 'search'}
          aria-selected={imgTab === 'search'}
          onclick={onSearchTab}
        >Search</button>
      </div>

      <!-- Upload tab -->
      {#if imgTab === 'upload'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="drop-zone"
          class:drag-over={imgDragOver}
          class:busy={imgUploading}
          tabindex="0"
          role="region"
          aria-label="Drop image or paste"
          ondragover={onImgDragOver}
          ondragleave={onImgDragLeave}
          ondrop={onImgDrop}
          onpaste={onImgPaste}
        >
          {#if imgUploading}
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          {:else}
            <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="m21 15-5-5L5 21"/>
            </svg>
            <span class="drop-label">
              Drop / paste, or
              <button type="button" class="pick-link" onclick={() => imgFileInput?.click()}>browse</button>
            </span>
          {/if}
        </div>
        <input
          bind:this={imgFileInput}
          type="file" accept="image/*"
          class="sr-only" aria-hidden="true" tabindex="-1"
          onchange={onImgFileChange}
        />
      {/if}

      <!-- Library tab -->
      {#if imgTab === 'library'}
        {#if sharedLoading}
          <div class="state-box">
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
            </svg>
          </div>
        {:else if sharedFiles.length === 0}
          <p class="state-note">No files in <code>shared/</code>.</p>
        {:else}
          <div class="thumb-grid">
            {#each sharedFiles as file (file.path)}
              <button
                type="button"
                class="thumb-btn"
                class:busy={sharedCopying === file.path}
                title={file.name}
                aria-label="Set background: {file.name}"
                disabled={sharedCopying !== null}
                onclick={() => onSharedClick(file)}
              >
                <img src={file.url} alt={file.name} loading="lazy" class="thumb-img" />
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- Search tab -->
      {#if imgTab === 'search'}
        {#if !providersLoaded}
          <div class="state-box">
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
            </svg>
          </div>
        {:else if providers.filter(p => p.enabled).length === 0}
          <p class="state-note">No providers enabled. Set <code>UNSPLASH_ACCESS_KEY</code> or <code>GIPHY_API_KEY</code>.</p>
        {:else}
          <div class="search-row">
            {#if providers.filter(p => p.enabled).length > 1}
              <select
                class="provider-select"
                value={activeProvider}
                aria-label="Provider"
                onchange={(e) => { activeProvider = (e.target as HTMLSelectElement).value; if (searchQuery.trim()) void runSearch(); }}
              >
                {#each providers.filter(p => p.enabled) as p (p.name)}
                  <option value={p.name}>{p.label}</option>
                {/each}
              </select>
            {/if}
            <div class="search-wrap">
              <input
                type="search" class="search-input"
                placeholder="Search images…"
                value={searchQuery}
                oninput={onSearchInput}
                aria-label="Search query"
                autocomplete="off" spellcheck="false"
              />
              {#if searching}
                <svg class="input-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                </svg>
              {/if}
            </div>
          </div>
          {#if searchError}<p class="error-note">{searchError}</p>{/if}
          {#if searchResults.length > 0}
            <div class="thumb-grid">
              {#each searchResults as result (result.id)}
                <button
                  type="button"
                  class="thumb-btn"
                  class:busy={fetching === result.id}
                  title={result.description || result.id}
                  aria-label="Set background: {result.description || result.id}"
                  disabled={fetching !== null}
                  onclick={() => onResultClick(result)}
                >
                  <img src={result.thumb_url} alt={result.description ?? ''} loading="lazy" class="thumb-img" />
                </button>
              {/each}
            </div>
          {:else if !searching && searchQuery.trim()}
            <p class="state-note">No results.</p>
          {:else if !searchQuery.trim()}
            <p class="state-note">Type to search.</p>
          {/if}
        {/if}
      {/if}

      {#if imgError}<p class="error-note">{imgError}</p>{/if}

      <!-- Modifiers (shown when an image is set) -->
      {#if themeProps?.backgroundImage}
        <div class="modifiers">
          <div class="mod-row">
            <label class="mod-label" for="bg-fit">Fit</label>
            <select
              id="bg-fit"
              class="mod-select"
              value={themeProps.backgroundSize ?? 'cover'}
              onchange={onFitChange}
            >
              <option value="cover">cover</option>
              <option value="contain">contain</option>
              <option value="auto">auto</option>
              <option value="100% 100%">stretch</option>
            </select>
          </div>
          <div class="mod-row">
            <label class="mod-label" for="bg-pos">Position</label>
            <input
              id="bg-pos"
              class="mod-input"
              type="text"
              placeholder="center"
              value={themeProps.backgroundPosition ?? ''}
              onchange={onPositionChange}
            />
          </div>
          <div class="mod-row">
            <label class="mod-label" for="bg-op">Opacity</label>
            <input
              id="bg-op"
              class="mod-input mod-input--short"
              type="number"
              min="0" max="1" step="0.05"
              placeholder="1"
              value={themeProps.backgroundOpacity ?? ''}
              onchange={onOpacityChange}
            />
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Gradient ────────────────────────────────────────────────────────── -->
  {#if activeType === 'gradient'}
    <div class="sub-panel">
      <div class="grad-mode-row">
        <button
          type="button"
          class="mode-btn"
          class:active={gradMode === 'simple'}
          onclick={() => (gradMode = 'simple')}
        >Simple</button>
        <button
          type="button"
          class="mode-btn"
          class:active={gradMode === 'raw'}
          onclick={() => (gradMode = 'raw')}
        >CSS</button>
      </div>

      {#if gradMode === 'simple'}
        <div class="grad-builder">
          <div class="mod-row">
            <label class="mod-label" for="grad-c1">From</label>
            <input
              id="grad-c1"
              class="color-swatch color-swatch--sm"
              type="color"
              value={gradColor1}
              title="Start color"
              oninput={onGradColor1}
            />
            <span class="color-value color-value--sm">{gradColor1}</span>
          </div>
          <div class="mod-row">
            <label class="mod-label" for="grad-c2">To</label>
            <input
              id="grad-c2"
              class="color-swatch color-swatch--sm"
              type="color"
              value={gradColor2}
              title="End color"
              oninput={onGradColor2}
            />
            <span class="color-value color-value--sm">{gradColor2}</span>
          </div>
          <div class="mod-row">
            <label class="mod-label" for="grad-dir">Dir</label>
            <select id="grad-dir" class="mod-select" value={gradDir} onchange={onGradDirChange}>
              <option value="to bottom">↓ top → bottom</option>
              <option value="to right">→ left → right</option>
              <option value="to bottom right">↘ diagonal ↘</option>
              <option value="to bottom left">↙ diagonal ↙</option>
              <option value="45deg">45°</option>
              <option value="135deg">135°</option>
            </select>
          </div>
        </div>
        {#if themeProps?.backgroundGradient}
          <div class="grad-preview" style="background:{themeProps.backgroundGradient}"></div>
        {/if}
      {:else}
        <input
          class="mod-input mod-input--full"
          type="text"
          placeholder="linear-gradient(to right, #1a1a2e, #16213e)"
          value={themeProps?.backgroundGradient ?? ''}
          onchange={onRawGradientChange}
        />
        {#if themeProps?.backgroundGradient}
          <div class="grad-preview" style="background:{themeProps.backgroundGradient}"></div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- ── Video ──────────────────────────────────────────────────────────── -->
  {#if activeType === 'video'}
    <div class="sub-panel">
      {#if themeProps?.backgroundVideo}
        <div class="current-asset">
          <span class="asset-path" title={themeProps.backgroundVideo}>
            {basename(themeProps.backgroundVideo)}
          </span>
        </div>
      {/if}

      <button
        type="button"
        class="upload-btn"
        class:busy={videoUploading}
        disabled={videoUploading}
        onclick={() => videoFileInput?.click()}
      >
        {#if videoUploading}
          <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          Uploading…
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="btn-icon">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          Upload video…
        {/if}
      </button>
      <input
        bind:this={videoFileInput}
        type="file" accept="video/*"
        class="sr-only" aria-hidden="true" tabindex="-1"
        onchange={onVideoFileChange}
      />

      {#if videoError}<p class="error-note">{videoError}</p>{/if}

      {#if themeProps?.backgroundVideo}
        <div class="modifiers">
          <label class="checkbox-row">
            <input
              type="checkbox"
              class="check"
              checked={themeProps.backgroundVideoLoop === 'true'}
              onchange={onVideoLoopChange}
            />
            <span>Loop</span>
          </label>
          <label class="checkbox-row">
            <input
              type="checkbox"
              class="check"
              checked={themeProps.backgroundVideoMuted === 'true'}
              onchange={onVideoMutedChange}
            />
            <span>Muted</span>
          </label>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Clear button ────────────────────────────────────────────────────── -->
  {#if activeType !== 'none'}
    <div class="clear-row">
      <button type="button" class="clear-btn" onclick={clearAll}>
        Clear background
      </button>
    </div>
  {/if}
</div>

<style>
  .bg-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 12px;
  }

  .section-sublabel {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 2px;
  }

  /* ── Type selector ─────────────────────────────────────────────────────── */
  .type-selector {
    display: flex;
    gap: 3px;
  }

  .type-btn {
    flex: 1;
    padding: 3px 0;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: capitalize;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .type-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
  }

  .type-btn.active {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(59, 130, 246, 0.45);
    color: rgba(147, 197, 253, 0.95);
  }

  /* ── Sub-panels ────────────────────────────────────────────────────────── */
  .sub-panel {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  /* ── Color ─────────────────────────────────────────────────────────────── */
  .color-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }

  .color-swatch--sm {
    width: 22px;
    height: 22px;
  }

  .color-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
  .color-swatch::-webkit-color-swatch { border: none; border-radius: 3px; }

  .color-value {
    font-family: var(--font-mono, monospace);
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.55);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-value--sm {
    font-size: 0.6rem;
  }

  /* ── Image sub-tabs ────────────────────────────────────────────────────── */
  .sub-tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    padding-bottom: 4px;
  }

  .sub-tab {
    padding: 2px 7px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .sub-tab:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
  }

  .sub-tab.active {
    background: rgba(59, 130, 246, 0.14);
    color: rgba(147, 197, 253, 0.9);
  }

  /* ── Drop zone ─────────────────────────────────────────────────────────── */
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 72px;
    border: 1.5px dashed rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    padding: 8px;
    cursor: default;
    transition: border-color 0.12s, background 0.12s;
    outline: none;
  }

  .drop-zone:focus-visible {
    border-color: rgba(59, 130, 246, 0.6);
  }

  .drop-zone.drag-over {
    border-color: rgba(59, 130, 246, 0.7);
    background: rgba(59, 130, 246, 0.07);
  }

  .drop-zone.busy {
    opacity: 0.5;
    pointer-events: none;
  }

  .drop-icon {
    width: 22px;
    height: 22px;
    color: rgba(255, 255, 255, 0.25);
  }

  .drop-label {
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
  }

  .pick-link {
    background: none;
    border: none;
    color: #4a9eff;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }
  .pick-link:hover { color: #7ab8ff; }

  /* ── Thumbnail grid ────────────────────────────────────────────────────── */
  .thumb-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    max-height: 160px;
    overflow-y: auto;
  }

  .thumb-btn {
    position: relative;
    display: block;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    transition: border-color 0.1s;
  }

  .thumb-btn:hover:not(:disabled) { border-color: rgba(59, 130, 246, 0.5); }
  .thumb-btn:disabled { opacity: 0.6; cursor: default; }
  .thumb-btn.busy { opacity: 0.7; }

  .thumb-img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    display: block;
  }

  /* ── Provider search ────────────────────────────────────────────────────── */
  .search-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .provider-select {
    height: 24px;
    padding: 0 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.62rem;
    flex-shrink: 0;
  }

  .search-wrap {
    position: relative;
    flex: 1;
  }

  .search-input {
    width: 100%;
    height: 24px;
    padding: 0 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.65rem;
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus { border-color: rgba(59, 130, 246, 0.5); }
  .search-input::placeholder { color: rgba(255, 255, 255, 0.2); }

  .input-spinner {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 10px;
    color: rgba(255, 255, 255, 0.4);
    animation: spin 1s linear infinite;
    pointer-events: none;
  }

  /* ── Image modifiers + gradient builder ─────────────────────────────────── */
  .modifiers {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-top: 2px;
  }

  .mod-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mod-label {
    flex: 0 0 44px;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
    user-select: none;
  }

  .mod-select,
  .mod-input {
    flex: 1;
    height: 22px;
    padding: 0 5px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.65rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.1s;
  }

  .mod-select:focus,
  .mod-input:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }

  .mod-input--short {
    flex: 0 0 52px;
  }

  .mod-input--full {
    flex: 1;
    font-family: var(--font-mono, monospace);
    font-size: 0.6rem;
  }

  /* Hide number spinners */
  .mod-input[type="number"]::-webkit-inner-spin-button,
  .mod-input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; appearance: none; }
  .mod-input[type="number"] { -moz-appearance: textfield; appearance: textfield; }

  /* ── Gradient ──────────────────────────────────────────────────────────── */
  .grad-mode-row {
    display: flex;
    gap: 3px;
  }

  .mode-btn {
    padding: 2px 10px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .mode-btn.active {
    background: rgba(59, 130, 246, 0.14);
    color: rgba(147, 197, 253, 0.85);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .grad-builder {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .grad-preview {
    height: 24px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 2px;
  }

  /* ── Video ─────────────────────────────────────────────────────────────── */
  .upload-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .upload-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  .upload-btn.busy { opacity: 0.6; cursor: default; }

  .btn-icon { width: 12px; height: 12px; }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    user-select: none;
  }

  .check {
    accent-color: #3b82f6;
    width: 13px;
    height: 13px;
    cursor: pointer;
  }

  /* ── Common ─────────────────────────────────────────────────────────────── */
  .current-asset {
    padding: 3px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .asset-path {
    font-family: var(--font-mono, monospace);
    font-size: 0.58rem;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  .state-box {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
  }

  .state-note {
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.35);
    text-align: center;
    margin: 4px 0;
    line-height: 1.4;
  }

  .state-note code {
    font-family: var(--font-mono, monospace);
    background: rgba(255, 255, 255, 0.07);
    padding: 0.1em 0.3em;
    border-radius: 2px;
    font-size: 0.9em;
  }

  .error-note {
    font-size: 0.62rem;
    color: #f87171;
    margin: 2px 0;
  }

  /* ── Clear button ───────────────────────────────────────────────────────── */
  .clear-row {
    padding-top: 2px;
  }

  .clear-btn {
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(239, 68, 68, 0.25);
    background: rgba(239, 68, 68, 0.06);
    color: rgba(252, 165, 165, 0.7);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .clear-btn:hover {
    background: rgba(239, 68, 68, 0.14);
    color: rgba(252, 165, 165, 0.95);
  }

  /* ── Spinner ────────────────────────────────────────────────────────────── */
  .spinner {
    width: 16px;
    height: 16px;
    color: rgba(255, 255, 255, 0.5);
    animation: spin 1s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Utility ────────────────────────────────────────────────────────────── */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
