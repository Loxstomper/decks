<script lang="ts">
  /**
   * RevealFrame.svelte — Sandboxed reveal.js iframe renderer (P1-2, P1-3).
   *
   * WHY THIS EXISTS (specs 01, 04, 05):
   * =====================================
   * reveal.js registers global keyboard listeners and injects global CSS. Running
   * it in a sandboxed <iframe> gives us two critical isolation properties:
   *
   *   1. CSS isolation  — the iframe has its own document; reveal's styles never
   *                       bleed into the editor chrome.
   *   2. Keyboard isolation — DOM keyboard events inside the iframe do not bubble
   *                       to the parent document, so reveal's Spacebar / arrow
   *                       navigation cannot conflict with editor hotkeys.
   *
   * Sandbox flags chosen:
   *   allow-scripts       — reveal.js and deck scripts must run.
   *   allow-same-origin   — reveal plugins use XHR/fetch to load resources
   *                         (speaker-notes, highlight.js, etc.) from the same
   *                         origin; also needed for localStorage (reveal state).
   *                         This re-enables the same-origin security model for the
   *                         iframe, which is acceptable because the deck is served
   *                         from our own Go backend — it is not untrusted content.
   *
   * Scaling strategy (spec 05 — WYSIWYG):
   *   The iframe is always sized at the LOGICAL canvas (default 1920×1080). CSS
   *   `transform: scale()` + translate shrinks/grows the whole iframe to fill the
   *   container, exactly mirroring what reveal.js does in present mode. From
   *   reveal's point of view its viewport is always 1920×1080 and it renders at
   *   scale 1 — no double-scaling. The overlay layer (in a future P2 lane) can
   *   use the same transform from coords.ts for pixel-perfect hit-testing.
   *
   * Route contract (integrator must honour):
   *   /decks/{name}/deck.html      — the reveal.js HTML entry point
   *   /decks/{name}/assets/...     — deck assets (images, fonts, etc.)
   *   Relative paths inside deck.html resolve against the above automatically
   *   because the iframe src IS /decks/{name}/deck.html.
   */

  import { computeZoomTransform, LOGICAL_WIDTH, LOGICAL_HEIGHT } from '$lib/coords.ts';

  // ── Props ─────────────────────────────────────────────────────────────────

  interface Props {
    /**
     * URL of the reveal.js deck to display.
     * Integrator serves decks at `/decks/{name}/deck.html`.
     * Leave empty (default) to show the empty/placeholder state.
     */
    deckUrl?: string;

    /**
     * Logical canvas width in px (spec 05 default: 1920).
     * Must match the reveal.js `width` config inside deck.html.
     */
    width?: number;

    /**
     * Logical canvas height in px (spec 05 default: 1080).
     * Must match the reveal.js `height` config inside deck.html.
     */
    height?: number;

    /**
     * User zoom multiplier applied on top of the fit-to-container scale.
     *   1.0  = fit (default) — logical canvas fills the container.
     *   2.0  = 200% — useful for fine-grained editing (spec 04 "editor-zoom").
     * This is NOT the same as reveal's present-scale (spec 05).
     */
    zoom?: number;
  }

  let {
    deckUrl = '',
    width = LOGICAL_WIDTH,
    height = LOGICAL_HEIGHT,
    zoom = 1,
  }: Props = $props();

  // ── State ─────────────────────────────────────────────────────────────────

  /** Root container element — observed by ResizeObserver. */
  let containerEl: HTMLDivElement | undefined = $state();

  /**
   * Container dimensions in CSS pixels, updated by ResizeObserver.
   * Start at 0 so we skip transform computation on the first micro-frame
   * before the element is measured (the iframe will be invisible anyway).
   */
  let containerWidth  = $state(0);
  let containerHeight = $state(0);

  /**
   * Incremented by `reload()` to force the {#key} block to destroy and
   * recreate the iframe (picks up disk changes for the same URL).
   */
  let reloadKey = $state(0);

  /**
   * True while the iframe is navigating to a new URL.
   * The iframe is kept visibility:hidden during loading to avoid a flash of
   * unstyled / partially-rendered reveal content.
   */
  let isLoading = $state(false);

  // ── Derived ───────────────────────────────────────────────────────────────

  /** True when no deck URL is provided — shows the empty placeholder. */
  const isEmpty = $derived(!deckUrl);

  /**
   * The fit+zoom transform: maps the logical 1920×1080 canvas into the
   * available container space at the current zoom level.
   * coords.ts owns this math (spec 04 "Two zoom concepts").
   */
  const transform = $derived(
    computeZoomTransform(containerWidth, containerHeight, zoom, width, height),
  );

  /**
   * A composite key that changes whenever the effective iframe content should
   * change.  Changing deckUrl or calling reload() bumps this key, which causes
   * the {#key} block to destroy and recreate the iframe — giving reveal.js a
   * fresh document while guaranteeing onload fires.
   */
  const frameKey = $derived(`${deckUrl}|${reloadKey}`);

  // ── Effects ───────────────────────────────────────────────────────────────

  /**
   * ResizeObserver — keep containerWidth/Height in sync with the DOM element.
   * Must run as an effect (not in onmount) so it re-observes if containerEl
   * is ever replaced (e.g., Svelte reuses the element after HMR).
   */
  $effect(() => {
    if (!containerEl) return;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        containerWidth  = rect.width;
        containerHeight = rect.height;
      }
    });

    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  /**
   * Loading gate — whenever the effective key changes and there IS a URL,
   * flip to loading state so the caller/parent can show a spinner and so we
   * hide the iframe until reveal has rendered at least one frame.
   */
  $effect(() => {
    // Read frameKey to create the reactive dependency.
    const _key = frameKey;
    if (deckUrl) {
      isLoading = true;
    }
  });

  // ── Methods ───────────────────────────────────────────────────────────────

  /**
   * Force the iframe to reload the current deck URL from the server.
   *
   * Useful when the Go backend emits an SSE "file changed" event for the deck
   * (spec 11 "External (Claude Code) → canvas" flow).  The integrator should
   * call this via `bind:this` on the component, e.g.:
   *
   *   let revealFrame: ReturnType<typeof RevealFrame>;
   *   // on SSE event:
   *   revealFrame.reload();
   */
  export function reload(): void {
    if (!deckUrl) return;
    isLoading = true;
    reloadKey++;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleLoad(): void {
    // The iframe fired its load event — reveal has parsed the document.
    // There may still be a brief flash as reveal initialises its scaling
    // transform, but hiding the iframe until this point already catches the
    // most jarring unstyled flicker.
    isLoading = false;
  }
</script>

<!--
  Root container — fills whatever space the parent gives it (the canvas pane
  from PaneLayout.svelte).  `overflow: hidden` clips the scaled iframe so
  letterbox bars do not spill outside the pane.
-->
<div
  bind:this={containerEl}
  class="reveal-frame-root"
  role="region"
  aria-label="Slide canvas"
>
  {#if isEmpty}
    <!-- ── Empty state ───────────────────────────────────────────────── -->
    <div class="reveal-frame-empty" aria-label="No deck open">
      <div class="reveal-frame-empty-icon">
        <!-- Simple slide icon -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </div>
      <p class="reveal-frame-empty-label">No deck open</p>
      <p class="reveal-frame-empty-hint">Open a deck to start editing</p>
    </div>
  {:else}
    <!--
      Loading overlay — shown over the invisible iframe while it navigates.
      pointer-events: none so it does not block future interaction.
    -->
    {#if isLoading}
      <div class="reveal-frame-loading" aria-live="polite" aria-label="Loading deck">
        <div class="reveal-frame-spinner" aria-hidden="true"></div>
        <span>Loading&hellip;</span>
      </div>
    {/if}

    <!--
      {#key frameKey} — destroys and recreates the <iframe> whenever the deck
      URL changes or reload() is called.  This guarantees:
        • A fresh reveal.js init for each deck (no leftover state).
        • onload fires reliably (assigning iframe.src on an existing element
          does not always trigger onload in all browsers).
        • The isLoading flag is always accurate.
    -->
    {#key frameKey}
      <!--
        Sandbox policy (see module-level script comment for full rationale):
        allow-scripts      — reveal.js must run.
        allow-same-origin  — reveal plugins use XHR; localStorage for reveal state.
        Absent intentionally: allow-forms, allow-top-navigation, allow-popups.
      -->
      <iframe
        src={deckUrl}
        title="Slide deck — {deckUrl}"
        sandbox="allow-scripts allow-same-origin"
        scrolling="no"
        class="reveal-frame-iframe"
        style:width="{width}px"
        style:height="{height}px"
        style:visibility={isLoading ? 'hidden' : 'visible'}
        style:transform="translate({transform.offsetX}px, {transform.offsetY}px) scale({transform.scale})"
        onload={handleLoad}
      ></iframe>
    {/key}
  {/if}
</div>

<style>
  /*
   * WHY position: relative + overflow: hidden on the root:
   * The iframe is absolutely positioned inside and scaled via CSS transform.
   * overflow: hidden clips the letterbox/pillarbox bars so they appear as
   * background colour rather than bleeding beyond the pane boundary.
   */
  .reveal-frame-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    /* Dark background for letterbox bars — matches the editor dark theme. */
    background-color: #111111;
  }

  /* ── Empty state ───────────────────────────────────────────────────────── */

  .reveal-frame-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    height: 100%;
    color: rgba(255, 255, 255, 0.25);
    user-select: none;
    pointer-events: none;
  }

  .reveal-frame-empty-icon {
    width: 3rem;
    height: 3rem;
    opacity: 0.4;
  }

  .reveal-frame-empty-icon svg {
    width: 100%;
    height: 100%;
  }

  .reveal-frame-empty-label {
    font-size: 0.875rem;
    font-weight: 500;
    margin: 0;
  }

  .reveal-frame-empty-hint {
    font-size: 0.75rem;
    opacity: 0.6;
    margin: 0;
  }

  /* ── Loading overlay ───────────────────────────────────────────────────── */

  .reveal-frame-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    z-index: 10;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.8125rem;
    pointer-events: none; /* Never intercept clicks from the rest of the editor. */
    user-select: none;
  }

  /*
   * Simple CSS-only spinner — no JS timer, no external library.
   * Two-colour border trick: solid top border rotates, giving a smooth arc.
   */
  .reveal-frame-spinner {
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.5);
    border-radius: 50%;
    animation: reveal-spin 0.7s linear infinite;
  }

  @keyframes reveal-spin {
    to { transform: rotate(360deg); }
  }

  /* ── iframe ────────────────────────────────────────────────────────────── */

  .reveal-frame-iframe {
    /*
     * WHY position: absolute + transform-origin: 0 0:
     *
     * The iframe is sized at the logical canvas dimensions (e.g. 1920×1080).
     * We then scale it with CSS transform to fit the container.  Using
     * transform-origin: 0 0 means the top-left corner of the iframe is the
     * anchor; the translate() component of the transform moves it to the
     * correct centred position (letterbox/pillarbox offset from coords.ts).
     *
     * Inline styles override:
     *   width / height  — set to the logical canvas dimensions via style:
     *   transform       — translate(offsetX, offsetY) scale(scale) via style:
     *   visibility      — hidden while loading, visible once onload fires
     *
     * This is deliberately NOT using CSS classes for width/height/transform
     * because those values are derived at runtime from the ResizeObserver
     * measurements and must re-render with each resize.
     */
    position: absolute;
    top: 0;
    left: 0;
    border: none;
    display: block;
    transform-origin: 0 0;
    /* Promote to GPU layer to avoid layout recalculations on every scale. */
    will-change: transform;
  }
</style>
