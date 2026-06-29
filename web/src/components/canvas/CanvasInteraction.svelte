<script lang="ts">
  /**
   * CanvasInteraction.svelte — Selection / overlay / in-place editing controller
   * (P2-3, P2-4, P2-5, P2-6).
   *
   * WHY THIS EXISTS (spec 04 "edit-in-place for content, overlay for geometry"):
   * ============================================================================
   * This is the parent-side controller that turns clicks inside the reveal.js
   * iframe into editor selection + editing, and draws the tracking overlay. It is
   * deliberately a SIBLING of RevealFrame (it does not own the iframe): it takes
   * the iframe element + the current coords.ts transform as props, reaches into
   * the same-origin iframe document to attach listeners and measure geometry, and
   * renders an overlay layer over (but outside) the iframe.
   *
   * The four behaviours:
   *   P2-3  Click → resolve nearest leaf eid (eid.ts) → selectionStore.
   *   P2-4  Draw a bounding box from the element's LOGICAL rect × transform
   *         (overlay-geometry.ts), tracking it at any zoom (transform-reactive)
   *         and on content reflow (ResizeObserver).
   *   P2-5  Double-click a text leaf → contenteditable in place, focus, select.
   *   P2-6/P17-3  On commit → applyRichTextEdit via the store (onRichTextCommit),
   *         passing the leaf's innerHTML; the model sanitises + canonicalises the
   *         inline marks, re-serializes, and persists — source + canvas stay in sync.
   *
   * INTEGRATION CONTRACT (see integration_notes):
   *   • Place this as a sibling of <RevealFrame> inside ONE `position: relative`
   *     wrapper that both fill (inset:0). The overlay's coordinate origin must be
   *     the same box the iframe is scaled within, so the transform offsets line up.
   *   • Pass the live iframe element (RevealFrame must expose it) and the SAME
   *     transform RevealFrame uses. Pass `reloadNonce` (deckStore.reloadNonce) so
   *     the overlay re-acquires the selection after a save/reload recreates the
   *     iframe document.
   */

  import { logicalToScreen, type Transform } from '$lib/coords.ts';
  import { deckStore } from '$lib/store/deck.svelte.ts';
  import { selectionStore } from '$lib/canvas/selection.svelte.ts';
  import { resolveSelectable, type ElementLike } from '$lib/canvas/eid.ts';
  import { serializeInlineHtml } from '$lib/model/inline.ts';
  import { uploadAsset } from '$lib/blocks/api.ts';
  import {
    domRectToLogical,
    logicalRectToScreen,
    type Rect,
  } from '$lib/canvas/overlay-geometry.ts';
  import SelectionOverlay from './SelectionOverlay.svelte';

  // ── Props ─────────────────────────────────────────────────────────────────

  interface Props {
    /**
     * The live reveal.js iframe element. Same-origin, so we can reach its
     * `contentDocument`. RevealFrame recreates this on reload, so the integrator
     * must pass the CURRENT element (reactively) — when it changes, we re-attach.
     */
    iframe: HTMLIFrameElement | null | undefined;

    /**
     * The active logical→screen transform (the SAME one RevealFrame applies to
     * the iframe). Drives overlay positioning; changing it (zoom/pan/resize)
     * re-renders the box from the cached logical rect — no DOM re-measure needed.
     */
    transform: Transform;

    /**
     * Bumped whenever the iframe content reloads (e.g. deckStore.reloadNonce).
     * Triggers a re-acquire so the overlay re-finds the selected eid in the fresh
     * document and the box reappears after a save.
     */
    reloadNonce?: number;

    /**
     * Commit hook for a finished RICH-text edit (P2-6 / P17-3). Receives the
     * leaf's `innerHTML`; defaults to the deck store's `applyRichTextEdit(eid,
     * html)` contract, which sanitises + canonicalises the HTML to the inline
     * allowlist and replaces only the edited leaf's children (just that subtree
     * goes dirty) before re-serializing. Overridable for tests / alt wiring.
     */
    onRichTextCommit?: (eid: string, html: string) => void;

    /**
     * Right-click (P13-2). Fired after we have resolved + selected the element
     * under the cursor (or cleared the selection on empty-space). The position
     * is in canvas-stack-local pixels (the same overlay coordinate space the
     * selection box uses), ready to hand to the cursor-positioned ContextMenu.
     * The parent decides which menu to show by reading the (now-updated)
     * selectionStore — a non-empty selection → element menu, empty → slide menu.
     */
    onContextMenu?: (detail: { x: number; y: number }) => void;
  }

  let {
    iframe,
    transform,
    reloadNonce = 0,
    onRichTextCommit = (eid, html) => deckStore.applyRichTextEdit(eid, html),
    onContextMenu,
  }: Props = $props();

  // ── Reactive geometry ───────────────────────────────────────────────────────

  /**
   * The selected element's rect in LOGICAL space (1920×1080). Cached because it
   * is invariant under editor zoom/pan — only selection, reflow, or reload change
   * it. The screen box is derived from this × the (possibly changing) transform.
   */
  let logicalRect = $state<Rect | null>(null);

  /** Screen-space (overlay-local) box. Recomputes on logicalRect OR transform. */
  const screenRect = $derived<Rect | null>(
    logicalRect ? logicalRectToScreen(logicalRect, transform) : null,
  );

  // ── Non-reactive controller state ───────────────────────────────────────────
  // (plain refs — these are imperative DOM bookkeeping, not render inputs)

  /** Element currently in a contenteditable session, or null. */
  let editingEl: HTMLElement | null = null;
  /** innerHTML captured at edit start, for Escape-to-cancel restore. */
  let editOriginalHtml = '';
  /** Set by Escape so the blur-driven commit is skipped. */
  let skipCommit = false;
  /** Watches the selected element for reflow so the box follows size changes. */
  let elementRO: ResizeObserver | null = null;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** The iframe's document, or null if not yet available / cross-origin. */
  function getDoc(): Document | null {
    try {
      return iframe?.contentDocument ?? null;
    } catch {
      return null; // defensive: cross-origin (shouldn't happen, same-origin deck)
    }
  }

  /** Build a safe `[data-eid="…"]` selector (eids can in theory contain quotes). */
  function eidSelector(eid: string): string {
    // CSS.escape exists in the parent window; fall back to a manual escape.
    const esc =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eid) : eid.replace(/"/g, '\\"');
    return `[data-eid="${esc}"]`;
  }

  /** Find the rendered element for an eid in the current iframe document. */
  function findEl(eid: string): HTMLElement | null {
    const doc = getDoc();
    if (!doc) return null;
    return doc.querySelector<HTMLElement>(eidSelector(eid));
  }

  /**
   * Re-measure the selected element's logical rect and (re)attach the reflow
   * observer. Sets logicalRect to null when there is no selection or the element
   * is not present (e.g. removed by an external edit).
   */
  function measure(): void {
    elementRO?.disconnect();
    const eid = selectionStore.eid;
    if (!eid) {
      logicalRect = null;
      return;
    }
    const el = findEl(eid);
    if (!el) {
      logicalRect = null;
      return;
    }
    logicalRect = domRectToLogical(el.getBoundingClientRect());

    // P2-4: track size changes (content reflow) without re-measuring on zoom.
    if (typeof ResizeObserver !== 'undefined') {
      elementRO ??= new ResizeObserver(() => {
        // Re-read on reflow. Guard: element may have detached.
        const live = selectionStore.eid ? findEl(selectionStore.eid) : null;
        logicalRect = live ? domRectToLogical(live.getBoundingClientRect()) : null;
      });
      elementRO.observe(el);
    }
  }

  // ── Click / selection (P2-3, P4-6 multi-select) ────────────────────────────

  function handleClick(e: MouseEvent): void {
    // While editing, a click inside the editing element just moves the caret —
    // do not re-run selection (which could exit the session). Clicks elsewhere
    // fall through: the element's blur commits, then we select the new target.
    if (editingEl && e.target instanceof Node && editingEl.contains(e.target)) {
      return;
    }
    const sel = resolveSelectable(e.target as unknown as ElementLike | null);
    if (sel) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        // Shift/Cmd/Ctrl+click: toggle this element in the multi-selection
        // (P4-6: multi-select accumulation via modifier keys).
        selectionStore.toggle(sel.eid);
      } else {
        // Plain click: single-select (clears any multi-selection).
        selectionStore.select(sel.eid);
      }
    } else {
      selectionStore.clear(); // click on empty space → deselect all
    }
  }

  // ── Right-click → context menu (P13-2) ──────────────────────────────────────

  function handleContextMenu(e: MouseEvent): void {
    // Suppress the browser's native menu — we render our own.
    e.preventDefault();

    const sel = resolveSelectable(e.target as unknown as ElementLike | null);
    if (sel) {
      // Right-clicking an element that is NOT already part of the current
      // (possibly multi-) selection makes it the sole selection, so the menu
      // acts on what was clicked. Right-clicking inside an existing
      // multi-selection preserves it (so "Delete all" etc. stay meaningful).
      if (!selectionStore.eids.includes(sel.eid)) {
        selectionStore.select(sel.eid);
      }
    } else {
      // Empty slide background → no element selection; the parent opens the
      // slide-level menu (P13-8).
      selectionStore.clear();
    }

    // Map the in-iframe (logical) cursor point to overlay/canvas-stack-local
    // pixels via the SAME transform the overlays use, so the menu opens exactly
    // under the cursor at any zoom/pan.
    const pt = logicalToScreen({ x: e.clientX, y: e.clientY }, transform);
    onContextMenu?.({ x: pt.x, y: pt.y });
  }

  // ── Double-click → edit (P2-5) ──────────────────────────────────────────────

  function handleDblClick(e: MouseEvent): void {
    const sel = resolveSelectable(e.target as unknown as ElementLike | null);
    if (!sel || !sel.editable) return;
    selectionStore.select(sel.eid);
    startEdit(sel.eid);
  }

  function startEdit(eid: string): void {
    const el = findEl(eid);
    if (!el) return;
    editingEl = el;
    editOriginalHtml = el.innerHTML;
    skipCommit = false;

    el.setAttribute('contenteditable', 'true');
    el.addEventListener('blur', handleEditBlur);
    el.addEventListener('keydown', handleEditKeydown);
    el.addEventListener('paste', handleEditPaste);
    selectionStore.setEditing(true);

    el.focus();
    // Select all contents so the first keystroke replaces — common edit UX.
    try {
      const doc = getDoc();
      const win = iframe?.contentWindow;
      const winSel = win?.getSelection?.();
      if (doc && winSel) {
        const range = doc.createRange();
        range.selectNodeContents(el);
        winSel.removeAllRanges();
        winSel.addRange(range);
      }
    } catch {
      /* selection placement is best-effort */
    }
  }

  function handleEditBlur(): void {
    commitEdit();
  }

  function handleEditKeydown(e: KeyboardEvent): void {
    // Enter commits (Shift+Enter inserts a newline — let it through).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      editingEl?.blur(); // triggers handleEditBlur → commitEdit
      return;
    }
    // Escape cancels: restore original markup, then blur (commit is skipped).
    if (e.key === 'Escape') {
      e.preventDefault();
      skipCommit = true;
      if (editingEl) editingEl.innerHTML = editOriginalHtml;
      editingEl?.blur();
    }
  }

  /**
   * Paste sanitization (P17-2 / spec 12 security). The browser would otherwise
   * drop raw clipboard HTML — `<script>`, `on*` handlers, `javascript:` hrefs,
   * external resource URLs, style soup — straight into the contenteditable DOM.
   * We intercept, run it through the inline allowlist serializer (the same gate
   * the commit path uses) BEFORE it lands, and localize pasted image files via
   * the asset pipeline so no external/data URL is ever introduced (offline-first).
   */
  function handleEditPaste(e: ClipboardEvent): void {
    const doc = getDoc();
    if (!doc) return;
    const dt = e.clipboardData;
    if (!dt) return;
    e.preventDefault();

    // Pasted image FILES → upload to the deck's assets, insert a LOCAL <img>.
    // Never embed the external/data source (spec 08 / X-1 offline-first).
    const images = Array.from(dt.files).filter((f) => f.type.startsWith('image/'));
    if (images.length > 0) {
      const deck = deckStore.name;
      if (deck) void localizePastedImages(doc, deck, images);
      return;
    }

    // HTML/text → sanitize to the inline allowlist, then insert.
    const html = dt.getData('text/html');
    if (html) {
      doc.execCommand('insertHTML', false, serializeInlineHtml(html));
    } else {
      // Plain text only — insert verbatim (insertText escapes for us).
      doc.execCommand('insertText', false, dt.getData('text/plain'));
    }
  }

  /** Upload each pasted image and insert a LOCAL <img> at the caret (best-effort;
   *  an upload failure is skipped so a paste never injects an external URL).
   *
   *  Note: the inline allowlist (P17-1) is text marks only, so a pure text leaf
   *  (<p>, <h*>) does not retain <img> on commit — but the asset is localized
   *  regardless (offline-first), and rich/figure leaves keep it. Block-image paste
   *  handling proper is Lane B/C's concern; here we only guarantee the offline
   *  invariant: the source is always a local deck-relative path, never external. */
  async function localizePastedImages(doc: Document, deck: string, files: File[]): Promise<void> {
    for (const file of files) {
      try {
        const src = await uploadAsset(deck, file);
        const safeSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        doc.execCommand('insertHTML', false, `<img src="${safeSrc}" alt="">`);
      } catch {
        /* offline / upload failed → skip this image (no external ref introduced) */
      }
    }
  }

  /** Tear down the contenteditable session and, unless cancelled, write back. */
  function commitEdit(): void {
    const el = editingEl;
    if (!el) return;
    editingEl = null;

    el.removeEventListener('blur', handleEditBlur);
    el.removeEventListener('keydown', handleEditKeydown);
    el.removeEventListener('paste', handleEditPaste);
    el.removeAttribute('contenteditable');
    selectionStore.setEditing(false);

    if (!skipCommit) {
      const eid = el.getAttribute('data-eid');
      if (eid) {
        // contenteditable gives us the leaf's full innerHTML (inline marks
        // intact). The model's rich-text path (P17-3) sanitises + canonicalises
        // it to the inline allowlist, so `<strong>` survives and hostile markup
        // is stripped before it reaches the source.
        onRichTextCommit(eid, el.innerHTML);
      }
    }
    skipCommit = false;

    // Re-measure (text may have reflowed). After a write-back the store will also
    // reload the iframe, which re-acquires via the load effect below.
    measure();
  }

  // ── Document attach / detach ────────────────────────────────────────────────

  function attachDoc(doc: Document): void {
    // Capture phase so we see the click before reveal's own handlers can stop it.
    doc.addEventListener('click', handleClick, true);
    doc.addEventListener('dblclick', handleDblClick, true);
    doc.addEventListener('contextmenu', handleContextMenu, true);
  }

  function detachDoc(doc: Document): void {
    doc.removeEventListener('click', handleClick, true);
    doc.removeEventListener('dblclick', handleDblClick, true);
    doc.removeEventListener('contextmenu', handleContextMenu, true);
  }

  // ── Effects ─────────────────────────────────────────────────────────────────

  /**
   * Attach listeners to the iframe document and re-attach when the iframe element
   * itself changes (RevealFrame recreates it on reload). Handles both the
   * already-loaded case (element reused / loaded before this effect ran) and the
   * future 'load' event.
   */
  $effect(() => {
    const frame = iframe;
    if (!frame) return;

    let attached: Document | null = null;

    const attachIfReady = () => {
      const doc = frame.contentDocument;
      if (doc && doc !== attached) {
        if (attached) detachDoc(attached);
        attachDoc(doc);
        attached = doc;
        measure(); // re-acquire the selection box in the (possibly new) document
      }
    };

    const onLoad = () => attachIfReady();
    frame.addEventListener('load', onLoad);

    // Element may already be loaded by the time this effect runs.
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete') {
      attachIfReady();
    }

    return () => {
      frame.removeEventListener('load', onLoad);
      if (attached) detachDoc(attached);
      // Leaving the frame: drop any half-finished edit session and observers.
      editingEl?.removeEventListener('blur', handleEditBlur);
      editingEl?.removeEventListener('keydown', handleEditKeydown);
      editingEl?.removeEventListener('paste', handleEditPaste);
      editingEl = null;
      elementRO?.disconnect();
    };
  });

  /** Re-measure whenever the selection changes (P2-4 follows selection). */
  $effect(() => {
    selectionStore.eid; // dependency
    measure();
  });

  /**
   * Re-acquire after an explicit reload signal (save → reloadNonce++). The iframe
   * may keep the same element identity across a same-URL reload, in which case
   * the load effect's 'load' handler fires; this is the belt-and-braces path for
   * when the integrator drives reloads via the nonce.
   */
  $effect(() => {
    reloadNonce; // dependency
    measure();
  });
</script>

<!--
  Overlay layer. Fills the wrapper (which must exactly overlap the iframe's
  scaled container — see integration_notes). pointer-events:none so every click
  passes through to the iframe document where our listeners live; the box is
  purely visual.
-->
<div class="canvas-interaction-overlay" aria-hidden="true">
  <SelectionOverlay rect={screenRect} editing={selectionStore.editing} />
</div>

<style>
  .canvas-interaction-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden; /* clip the box to the canvas, matching the iframe clip */
    pointer-events: none;
  }
</style>
