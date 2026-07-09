<script lang="ts">
  /**
   * PresentButton.svelte — "Present" action button (P7-1 / spec presenting-and-export).
   *
   * Opens the current deck in full presentation mode in a new browser tab.
   *
   * URL opened: `/present/{name}` (spec presenting-and-export canonical present route).
   * The Go backend serves the deck's raw `deck.html` byte-for-byte at this route
   * (handlePresent → os.DirFS, identical bytes to /decks/{name}/deck.html) and
   * resolves sibling assets under /present/{name}/{path...}. Reveal.js initialises
   * normally, keyboard nav and transitions work, and the speaker window (S key)
   * opens from there — with no editor chrome attached.
   *
   * WHY /present/{name} (not /decks/{name}/deck.html):
   * Spec presenting-and-export makes /present/<deck> the dedicated, bookmarkable present entry point,
   * clearly distinct from the editing iframe src (/decks/{name}/deck.html). Both
   * serve identical bytes, but converging on the canonical route keeps a single
   * contract between the FE and the Go server (integrator convergence, Phase 7).
   *
   * PROPS:
   *   deckName — name of the open deck, or null when no deck is open.
   */

  interface Props {
    /** Name of the currently open deck (null = button is disabled). */
    deckName: string | null;
  }

  let { deckName }: Props = $props();

  /**
   * The URL that will be opened in the new tab.
   *
   * Trailing slash is REQUIRED: the deck's asset hrefs are relative
   * (assets/…, custom.css), so the browser resolves them against the entry
   * document's base URL. /present/{name} (no slash) has base /present/ →
   * every asset 404s; /present/{name}/ has base /present/{name}/ → correct.
   * The backend also 308-redirects the bare form, but we link straight to the
   * canonical URL to skip the extra round-trip.
   */
  const presentUrl = $derived(
    deckName ? `/present/${encodeURIComponent(deckName)}/` : '',
  );

  function handlePresent(): void {
    if (!presentUrl) return;
    // Open in a new tab so the editor session is undisturbed.
    // rel="noopener" is enforced programmatically: the opened window has no
    // reference back to the editor (no cross-window scripting concerns).
    window.open(presentUrl, '_blank', 'noopener,noreferrer');
  }
</script>

<!--
  Present button — canvas-toolbar visual language (same class names as App.svelte
  so it slots in the toolbar without custom styles).

  Expose presentUrl as a data attribute so integrators can inspect the URL in
  tests or for copy-to-clipboard affordances.
-->
<button
  type="button"
  class="canvas-toolbar-btn present-btn"
  title={deckName
    ? `Present "${deckName}" (opens ${presentUrl} in a new tab; press S for speaker view)`
    : 'No deck open'}
  aria-label="Present deck in full-screen mode"
  disabled={!deckName}
  data-present-url={presentUrl}
  onclick={handlePresent}
>
  <!-- Play / present icon: circle with right-pointing triangle -->
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
  </svg>
</button>

<style>
  /*
   * The .canvas-toolbar-btn styles are defined in App.svelte's global <style>.
   * We only add the present-specific accent tint here so the button reads as
   * a primary action.
   */
  .present-btn:not(:disabled):hover {
    color: #fff;
  }

  .present-btn svg {
    width: 1rem;
    height: 1rem;
  }
</style>
