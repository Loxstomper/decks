<script lang="ts">
  /**
   * ChangeHighlightOverlay.svelte — Flash externally-changed elements (P8-7).
   *
   * After the editor adopts an external (Claude Code) write, the deck store
   * diffs the previous model against the reloaded one and pushes the changed
   * eids into `highlightStore`. This component paints those eids INSIDE the
   * reveal iframe: it injects a one-off stylesheet and toggles a `data-sb-flash`
   * attribute on each changed/added element so the user can instantly see what
   * Claude changed (spec 11 "highlight what Claude changed").
   *
   * WHY PAINT INSIDE THE IFRAME (vs an absolute overlay box like SelectionOverlay):
   * the changed set can be many elements scattered across the slide; a CSS
   * outline that flows with the element's own box is far simpler and needs no
   * per-element geometry/transform math. It is purely decorative — pointer-events
   * are untouched, so it never interferes with selection/drag.
   *
   * The highlight auto-clears (highlightStore's timer empties `marks`), which
   * re-runs the effect and strips the attributes. It also re-applies after an
   * iframe reload (reloadNonce) because the adopted document is freshly rendered.
   */
  import { highlightStore } from '$lib/store/highlight.svelte.ts';

  interface Props {
    /** The live reveal.js iframe (same-origin → reachable contentDocument). */
    iframe: HTMLIFrameElement | null | undefined;
    /** Bumped on iframe reload (deckStore.reloadNonce) → re-apply after reload. */
    reloadNonce?: number;
  }

  let { iframe, reloadNonce = 0 }: Props = $props();

  const STYLE_ID = 'sb-ext-highlight-style';
  const FLASH_ATTR = 'data-sb-flash';

  /** The flash stylesheet, injected once per document. Scoped to our attribute. */
  const FLASH_CSS = `
    @keyframes sb-ext-flash-kf {
      0%   { outline-color: var(--sb-flash-color); box-shadow: 0 0 0 9999px transparent; background-color: color-mix(in srgb, var(--sb-flash-color) 22%, transparent); }
      100% { outline-color: transparent; background-color: transparent; }
    }
    [${FLASH_ATTR}] {
      outline: 2px solid var(--sb-flash-color);
      outline-offset: 2px;
      border-radius: 3px;
      animation: sb-ext-flash-kf 2.4s ease-out forwards;
    }
    [${FLASH_ATTR}="added"]   { --sb-flash-color: #34d399; } /* emerald — new */
    [${FLASH_ATTR}="changed"] { --sb-flash-color: #fbbf24; } /* amber — edited */
  `;

  function getDoc(): Document | null {
    try {
      return iframe?.contentDocument ?? null;
    } catch {
      return null; // defensive: cross-origin (shouldn't happen for same-origin decks)
    }
  }

  function ensureStyle(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = FLASH_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }

  /** Remove flash attributes from every element that currently carries one. */
  function clearAll(doc: Document): void {
    for (const el of Array.from(doc.querySelectorAll(`[${FLASH_ATTR}]`))) {
      el.removeAttribute(FLASH_ATTR);
    }
  }

  /** Apply the current highlightStore marks into the iframe document. */
  function apply(): void {
    const doc = getDoc();
    if (!doc) return;
    ensureStyle(doc);
    clearAll(doc);
    for (const [eid, kind] of highlightStore.marks) {
      // Restart the CSS animation: removing+re-adding the attribute forces it.
      const el = doc.querySelector(`[data-eid="${cssEscape(eid)}"]`);
      if (el) el.setAttribute(FLASH_ATTR, kind);
    }
  }

  function cssEscape(eid: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid.replace(/"/g, '\\"');
  }

  // Re-apply whenever the highlight set changes (nonce/marks), or the iframe
  // reloads (reloadNonce), or the iframe element itself is swapped. If the fresh
  // document is still loading, defer to its 'load' event so the eids exist.
  $effect(() => {
    // Touch reactive deps so the effect re-runs on any of them.
    void highlightStore.nonce;
    void highlightStore.marks;
    void reloadNonce;
    const frame = iframe;
    if (!frame) return;

    const doc = frame.contentDocument;
    if (doc && doc.readyState === 'complete') {
      apply();
      return;
    }
    // Document not ready yet (mid-reload) — apply once it finishes loading.
    const onLoad = (): void => apply();
    frame.addEventListener('load', onLoad, { once: true });
    return () => frame.removeEventListener('load', onLoad);
  });
</script>

<!-- No DOM of its own: it decorates the iframe document imperatively. -->
