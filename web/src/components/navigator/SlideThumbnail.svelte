<script lang="ts">
  /**
   * SlideThumbnail.svelte — Scaled, offline visual of a single slide (P6-2).
   *
   * Renders the slide's `<section>` inside a sandboxed iframe whose `srcdoc` links
   * the deck's own stylesheets and statically lays the slide out at the logical
   * 1920×1080 canvas (see $lib/slides/thumbnail.ts for the full rationale). We
   * then shrink that iframe with a CSS `transform: scale()` to the requested
   * thumbnail width — exactly the WYSIWYG scaling strategy RevealFrame uses, so
   * the proportions match the canvas.
   *
   * The thumbnail updates automatically on edit: `srcdoc` is derived from the
   * live `section` node, which is a fresh object after each re-parse, so Svelte
   * recomputes it and the iframe reloads.
   *
   * LAZY RENDERING (perf): each thumbnail is its own sandboxed iframe that links
   * all ~7 of the deck's stylesheets. Every opaque-origin srcdoc iframe fetches
   * its OWN copy, so eagerly mounting a big deck's filmstrip fires 7 × N requests
   * up front (≈350 for a 50-slide deck) — a cache stampede before any entry warms.
   * We instead gate the srcdoc behind an IntersectionObserver: the iframe stays
   * empty until it scrolls near the viewport, then loads once. Only the visible
   * slice loads initially; the rest stagger in on scroll, by which point the
   * shared vendor CSS is cached. `rootMargin` preloads a screenful ahead so
   * thumbnails are ready before they're scrolled into view.
   */

  import { buildThumbnailSrcdoc } from '$lib/slides';
  import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from '$lib/coords';
  import type { ElementNode } from '$lib/model';
  import { deckStore } from '$lib/store/deck.svelte';

  interface Props {
    /** Open deck name — for the `/decks/<name>/…` stylesheet + asset URLs. */
    deckName: string;
    /** The slide's `<section>` model node. */
    section: ElementNode;
    /** Thumbnail width in CSS px (height derives from the 16:9 logical canvas). */
    width?: number;
  }

  let { deckName, section, width = 168 }: Props = $props();

  // Derive the active reveal theme from the deck's raw HTML source.
  // The theme link tag looks like: assets/vendor/reveal/theme/<name>.css
  // Fall back to "black" when no theme link is found.
  const theme = $derived(
    deckStore.source.match(/assets\/vendor\/reveal\/theme\/([\w-]+)\.css/)?.[1] ?? 'black',
  );

  // Scale the logical canvas down to the thumbnail width; height follows the
  // logical aspect ratio so it never distorts.
  const scale = $derived(width / LOGICAL_WIDTH);
  const height = $derived((width * LOGICAL_HEIGHT) / LOGICAL_WIDTH);

  // Lazy gate: stays false until the thumbnail nears the viewport, then latches
  // true (load-once — we don't tear the iframe down again on scroll-away, which
  // would re-fetch on return). `container` is the observed element.
  let container = $state<HTMLDivElement | null>(null);
  let loaded = $state(false);

  $effect(() => {
    if (loaded || !container) return;
    // Fallback for environments without IntersectionObserver (e.g. jsdom): load
    // eagerly so the thumbnail still renders.
    if (typeof IntersectionObserver === 'undefined') {
      loaded = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loaded = true;
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' }, // preload a screenful ahead of scroll
    );
    io.observe(container);
    return () => io.disconnect();
  });

  // Only build the (potentially large) srcdoc once the thumbnail is due to load;
  // it stays reactive to edits thereafter (fresh `section` on re-parse).
  const srcdoc = $derived(loaded ? buildThumbnailSrcdoc(deckName, section, { theme }) : undefined);
</script>

<div class="thumb" style="width: {width}px; height: {height}px;" bind:this={container}>
  <!--
    Gated on `loaded` (IntersectionObserver, see <script>) so offscreen thumbnails
    issue no requests until they near the viewport. Until then the .thumb's dark
    background is the placeholder.

    sandbox="" (no flags) → opaque origin, NO scripts. The srcdoc's <base href>
    is NOT honoured here (an opaque-origin about:srcdoc has no base to resolve a
    path-absolute href against), so buildThumbnailSrcdoc emits every asset URL —
    its own stylesheets AND the slide's relative `<img src>`/`poster` refs —
    fully qualified as `/decks/<name>/…`. Absolute paths resolve against the
    origin regardless, so no relative ref leaks to the editor root (`/assets/…`),
    which would 301-loop → ERR_TOO_MANY_REDIRECTS × every slide.
    aria-hidden: the thumbnail is decorative; the surrounding button is labelled.
  -->
  {#if srcdoc !== undefined}
    <iframe
      class="thumb-frame"
      title="Slide preview"
      aria-hidden="true"
      tabindex="-1"
      sandbox=""
      scrolling="no"
      {srcdoc}
      style:width="{LOGICAL_WIDTH}px"
      style:height="{LOGICAL_HEIGHT}px"
      style:transform="scale({scale})"
    ></iframe>
  {/if}
</div>

<style>
  .thumb {
    position: relative;
    overflow: hidden;
    border-radius: 3px;
    background: #191919;
    /* Block pointer events so clicks reach the parent slide button, not the
       iframe (which would otherwise swallow them). */
    pointer-events: none;
  }

  .thumb-frame {
    position: absolute;
    top: 0;
    left: 0;
    border: none;
    display: block;
    transform-origin: 0 0;
    pointer-events: none;
  }
</style>
