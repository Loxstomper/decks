/**
 * link-editor.svelte.ts — Shared state for the href popover (P17-10).
 *
 * WHY THIS EXISTS (spec 04 "a UI surface over existing commands"):
 * ===============================================================
 * The link popover has TWO entry points that must not each grow their own
 * component: the floating selection toolbar (range link, mid-edit) and the
 * text-leaf context menu ("Add/Edit link…", whole-leaf). Rather than thread props
 * through both, this singleton store holds the popover's open state + the
 * caller-supplied apply/remove callbacks. LinkPopover.svelte renders it; the
 * openers wire the behaviour:
 *
 *   • context menu  → {@link openForLeaf} routes to deckStore.applyLinkToLeaf /
 *                      removeLinkFromLeaf (whole-leaf, one undo + one save);
 *   • selection toolbar → {@link openCustom} supplies range-scoped callbacks that
 *                      mutate the live DOM + commit via applyRichTextEdit.
 *
 * Href validation stays with the single sanitizer rule: callers and submit both
 * gate on `isSafeHref`, so a `javascript:`/`data:` URL never reaches a command.
 */

import { findByEid, getAttribute, isSafeHref } from '$lib/model';
import { deckStore } from '$lib/store/deck.svelte';
import type { ElementNode, SlideNode } from '$lib/model/types';

/** First `<a href>` found within a leaf's subtree, or '' (for edit prefill). */
function firstAnchorHref(el: ElementNode): string {
  let found = '';
  const walk = (n: SlideNode): void => {
    if (found || n.type !== 'element') return;
    if (n.tagName.toLowerCase() === 'a') {
      found = getAttribute(n, 'href') ?? '';
      return;
    }
    for (const c of n.children) {
      walk(c);
      if (found) return;
    }
  };
  walk(el);
  return found;
}

class LinkEditorStore {
  /** Whether the popover is visible. */
  open = $state(false);
  /** Current href in the input (prefilled when editing an existing link). */
  href = $state('');
  /** True when an existing link is being edited (enables the Remove button). */
  hasExisting = $state(false);

  #submit: (href: string) => void = () => {};
  #remove: (() => void) | null = null;

  /** Live validity of the current input (drives the OK button's disabled state). */
  get valid(): boolean {
    return isSafeHref(this.href);
  }

  /** Whether a Remove action is available for the current target. */
  get canRemove(): boolean {
    return this.#remove !== null;
  }

  /**
   * Open targeting a whole text leaf (context menu). Reads any existing anchor
   * href to prefill, and wires submit/remove to the whole-leaf deck commands.
   */
  openForLeaf(eid: string): void {
    let existing = '';
    const model = deckStore.model;
    if (model) {
      const el = findByEid(model, eid);
      if (el) existing = firstAnchorHref(el);
    }
    this.href = existing;
    this.hasExisting = existing !== '';
    this.#submit = (href) => void deckStore.applyLinkToLeaf(eid, href);
    this.#remove = existing ? () => void deckStore.removeLinkFromLeaf(eid) : null;
    this.open = true;
  }

  /**
   * Open with caller-supplied behaviour (the toolbar's range link). `submit`
   * receives the validated href; `remove` (when provided) unlinks the range.
   */
  openCustom(opts: {
    href: string;
    submit: (href: string) => void;
    remove?: (() => void) | null;
  }): void {
    this.href = opts.href;
    this.hasExisting = opts.href !== '';
    this.#submit = opts.submit;
    this.#remove = opts.remove ?? null;
    this.open = true;
  }

  /** Apply the typed href (no-op when unsafe) and close. */
  submit(): void {
    const href = this.href.trim();
    if (isSafeHref(href)) this.#submit(href);
    this.close();
  }

  /** Invoke the remove behaviour (if any) and close. */
  remove(): void {
    this.#remove?.();
    this.close();
  }

  /** Dismiss without applying. */
  close(): void {
    this.open = false;
    this.#submit = () => {};
    this.#remove = null;
    this.href = '';
    this.hasExisting = false;
  }
}

/** Singleton — one open deck, one link popover. */
export const linkEditorStore = new LinkEditorStore();
