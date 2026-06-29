/**
 * inline-marks.ts — Live-DOM range mark commands for in-place rich text
 * (P17-6 range marks, P17-9 links).
 *
 * WHY THIS EXISTS (spec 04 rich text, spec 12 byte-stability):
 * ===========================================================
 * The floating selection toolbar (P17-7) and link UI (P17-10) format the user's
 * CURRENT selection while a leaf is in a contenteditable session. The way Lane A
 * intends a mark to be applied is: mutate the live selection DOM inside the iframe
 * (wrap / unwrap the Range in `<strong>` / `<a href>` / `<span style>`), then let
 * the normal commit path (`applyRichTextEdit`) canonicalise whatever DOM we
 * produced through the single inline sanitizer. So this module never emits
 * canonical markup itself — it only has to produce a DOM that *means* the right
 * thing; `inline.ts` defines the bytes.
 *
 * It is therefore deliberately a thin, dependency-free set of Range/DOM
 * operations. Pure enough to unit-test against a jsdom `Document` (no Svelte, no
 * iframe, no store): build a contenteditable root, place a Range, toggle a mark,
 * assert the innerHTML.
 *
 * The hard browser cases it must handle (constraint "the fiddly browser parts"):
 *   • partial / crossing selections  → split + rewrap (surroundContents throws
 *     on a Range that partially selects a non-Text node), so we extract+insert.
 *   • toggle idempotency             → a selection already fully inside a <tag>
 *     ancestor is UNWRAPPED instead of double-wrapped; a sub-range of a larger
 *     mark is unwrapped by splitting the mark into before / middle / after.
 *   • adjacent same-tag siblings     → merged so `<strong>a</strong><strong>b…`
 *     collapses to one run (kept tidy even before the sanitizer canonicalises).
 */

/** A pair of absolute character offsets (text-only) within an editing root. */
export interface SelOffsets {
  start: number;
  end: number;
}

/** Copy every attribute from `from` onto `to` (used when splitting a mark). */
function copyAttrs(from: Element, to: Element): void {
  for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value);
}

/** True when two elements have an identical attribute set (name→value). */
function sameAttrs(a: Element, b: Element): boolean {
  if (a.attributes.length !== b.attributes.length) return false;
  for (const at of Array.from(a.attributes)) {
    if (b.getAttribute(at.name) !== at.value) return false;
  }
  return true;
}

/**
 * Nearest ancestor element of `node` whose tag is `tag`, stopping at (and never
 * crossing) `root`. Returns null when there is no such ancestor inside the root.
 */
export function markAncestor(node: Node | null, tag: string, root: Node): HTMLElement | null {
  const t = tag.toLowerCase();
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur.nodeType === 1 && (cur as Element).tagName.toLowerCase() === t) {
      return cur as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * The `<tag>` element that fully COVERS `range` — i.e. an ancestor of the range's
 * common container — or null when the range is not entirely inside one such mark.
 * This is the toggle predicate: a non-null result means "already marked → unwrap".
 */
export function coveringMark(range: Range, tag: string, root: Node): HTMLElement | null {
  return markAncestor(range.commonAncestorContainer, tag, root);
}

/**
 * True when a cloned fragment carries real content. Splitting a mark at a node
 * boundary can yield a fragment holding only a zero-length text node (an artifact
 * of `cloneContents` on a collapsed-at-boundary range); such a part must NOT be
 * re-wrapped into an empty `<strong></strong>` / `<a></a>` shell.
 */
function hasContent(frag: DocumentFragment): boolean {
  for (const n of Array.from(frag.childNodes)) {
    if (n.nodeType === 1) return true;
    if ((n.nodeValue?.length ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Merge `el` with an immediately-adjacent sibling of the same tag + attributes,
 * folding their children together. Returns the surviving element (which may be a
 * previous sibling `el` was merged INTO). Keeps the rendered DOM tidy so chained
 * formatting does not accrete `<strong>a</strong><strong>b</strong>`.
 */
export function normalizeAdjacent(el: HTMLElement, tag: string): HTMLElement {
  const t = tag.toLowerCase();
  let survivor = el;

  // Drop zero-length text nodes left behind by extractContents so the real
  // element sibling (if any) is adjacent and can be merged.
  const dropEmpty = (n: ChildNode | null, dir: 'prev' | 'next'): void => {
    while (n && n.nodeType === 3 && (n.nodeValue?.length ?? 0) === 0) {
      const sib = dir === 'prev' ? n.previousSibling : n.nextSibling;
      n.remove();
      n = sib;
    }
  };
  dropEmpty(survivor.previousSibling, 'prev');
  dropEmpty(survivor.nextSibling, 'next');

  const prev = survivor.previousSibling;
  if (
    prev &&
    prev.nodeType === 1 &&
    (prev as Element).tagName.toLowerCase() === t &&
    sameAttrs(prev as Element, survivor)
  ) {
    while (survivor.firstChild) prev.appendChild(survivor.firstChild);
    survivor.remove();
    survivor = prev as HTMLElement;
  }

  const next = survivor.nextSibling;
  if (
    next &&
    next.nodeType === 1 &&
    (next as Element).tagName.toLowerCase() === t &&
    sameAttrs(next as Element, survivor)
  ) {
    while (next.firstChild) survivor.appendChild(next.firstChild);
    (next as Element).remove();
  }

  return survivor;
}

/**
 * Wrap the contents of `range` in a new `<tag attrs>`. Robust against partial /
 * crossing selections (uses extract+insert rather than surroundContents). The
 * resulting element is merged with adjacent same-tag siblings and the `range` is
 * left selecting the wrapped content so the caller can re-read/restore it.
 * Returns the surviving wrapper element.
 */
export function wrapRange(
  range: Range,
  tag: string,
  attrs?: Record<string, string>,
): HTMLElement {
  const doc = range.startContainer.ownerDocument ?? document;
  const el = doc.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);

  const frag = range.extractContents();
  el.appendChild(frag);
  range.insertNode(el);

  const survivor = normalizeAdjacent(el, tag);
  range.selectNodeContents(survivor);
  return survivor;
}

/**
 * Remove the mark `mark` over the portion covered by `range`, splitting it into
 * up to three parts: the prefix (still wrapped), the selection (UNWRAPPED), and
 * the suffix (still wrapped). When the range covers the whole mark, the tag is
 * dropped entirely. Returns the now-unwrapped middle nodes (for re-selection).
 *
 * Precondition: `mark` covers `range` (see {@link coveringMark}).
 */
export function unwrapMark(range: Range, mark: HTMLElement): Node[] {
  const doc = mark.ownerDocument;
  const tag = mark.tagName.toLowerCase();
  const parent = mark.parentNode;
  if (!parent) return [];

  // Prefix: from the mark's content start up to the selection start.
  const before = doc.createRange();
  before.selectNodeContents(mark);
  before.setEnd(range.startContainer, range.startOffset);
  // Suffix: from the selection end to the mark's content end.
  const after = doc.createRange();
  after.selectNodeContents(mark);
  after.setStart(range.endContainer, range.endOffset);

  const beforeFrag = before.cloneContents();
  const middleFrag = range.cloneContents();
  const afterFrag = after.cloneContents();

  const out = doc.createDocumentFragment();
  if (hasContent(beforeFrag)) {
    const b = doc.createElement(tag);
    copyAttrs(mark, b);
    b.appendChild(beforeFrag);
    out.appendChild(b);
  }
  const middleNodes = Array.from(middleFrag.childNodes);
  out.appendChild(middleFrag);
  if (hasContent(afterFrag)) {
    const a = doc.createElement(tag);
    copyAttrs(mark, a);
    a.appendChild(afterFrag);
    out.appendChild(a);
  }

  parent.replaceChild(out, mark);
  return middleNodes;
}

/** Re-point `range` to span the given (already-inserted) node list. */
function selectNodes(range: Range, nodes: Node[]): void {
  if (nodes.length === 0) return;
  range.setStartBefore(nodes[0]);
  range.setEndAfter(nodes[nodes.length - 1]);
}

/**
 * Toggle a bare/attributed inline mark over `range` within `root` (P17-6).
 *   • selection already fully inside a `<tag>` → unwrap that portion;
 *   • otherwise → wrap the selection in a fresh `<tag attrs>`.
 * Mutates the live DOM and leaves `range` selecting the affected content.
 */
export function toggleMark(
  range: Range,
  tag: string,
  root: Node,
  attrs?: Record<string, string>,
): void {
  if (range.collapsed) return;
  const covering = coveringMark(range, tag, root);
  if (covering) {
    const middle = unwrapMark(range, covering);
    selectNodes(range, middle);
  } else {
    wrapRange(range, tag, attrs);
  }
}

/**
 * True when `range` spans the entire text content of element `el`. Compares text
 * (rather than node-level boundary points, which differ between element- and
 * text-level positions) — `el` is already known to contain the range, so equal
 * text means the selection IS the whole element's content.
 */
function rangeCoversAllOf(range: Range, el: Element): boolean {
  return range.toString() === (el.textContent ?? '');
}

/**
 * Apply a colour / font-size RUN over `range` (P17-6 styled span). Unlike a bare
 * toggle, this UPDATES an existing fully-covering `<span style>` in place (so
 * re-picking a colour on the same selection does not unwrap it), or wraps a fresh
 * `<span style="prop: value">` otherwise. Clearing the last style property unwraps
 * the span. Returns the styled span (or null when it was cleared away).
 */
export function applySpanStyle(
  range: Range,
  root: Node,
  prop: string,
  value: string | null,
): HTMLElement | null {
  if (range.collapsed) return null;
  const span = coveringMark(range, 'span', root);
  if (span && rangeCoversAllOf(range, span)) {
    if (value) span.style.setProperty(prop, value);
    else span.style.removeProperty(prop);
    if (!span.getAttribute('style')) {
      const middle = unwrapMark(range, span);
      selectNodes(range, middle);
      return null;
    }
    range.selectNodeContents(span);
    return span;
  }
  if (!value) return null;
  return wrapRange(range, 'span', { style: `${prop}: ${value}` });
}

/**
 * Wrap the selection in an `<a href>` (P17-9 linkRange). Caller is responsible
 * for href validation (`isSafeHref`) — this just builds the DOM, which the
 * sanitizer re-validates on commit. Returns the anchor element.
 */
export function linkRange(range: Range, href: string): HTMLElement {
  return wrapRange(range, 'a', { href });
}

/**
 * Replace the `href` of an existing covering `<a>` (or wrap the selection in a
 * new one) — the "edit link" affordance. Returns the anchor.
 */
export function setRangeLink(range: Range, root: Node, href: string): HTMLElement {
  const anchor = coveringMark(range, 'a', root);
  if (anchor) {
    anchor.setAttribute('href', href);
    return anchor;
  }
  return linkRange(range, href);
}

/** Remove the `<a>` covering `range` (P17-9 remove). No-op when none covers it. */
export function unlinkRange(range: Range, root: Node): void {
  const anchor = coveringMark(range, 'a', root);
  if (!anchor) return;
  const middle = unwrapMark(range, anchor);
  selectNodes(range, middle);
}

// ── Text-only offset save / restore (re-select after a save+reload) ────────────

/** Total text length under `node`. */
function textLength(node: Node): number {
  if (node.nodeType === 3) return node.nodeValue?.length ?? 0;
  let n = 0;
  for (const c of Array.from(node.childNodes)) n += textLength(c);
  return n;
}

/**
 * Absolute text-character offset of (container, offset) within `root`, counting
 * only character data in document order. Lets a selection survive a DOM rebuild
 * (e.g. a save → iframe reload) where node identity is lost but text is stable.
 */
export function offsetWithin(root: Node, container: Node, offset: number): number {
  let count = 0;
  let done = false;
  const walk = (node: Node): void => {
    if (done) return;
    if (node === container) {
      if (node.nodeType === 3) {
        count += offset;
      } else {
        for (let i = 0; i < offset && i < node.childNodes.length; i++) {
          count += textLength(node.childNodes[i]);
        }
      }
      done = true;
      return;
    }
    if (node.nodeType === 3) {
      count += node.nodeValue?.length ?? 0;
      return;
    }
    for (const c of Array.from(node.childNodes)) {
      walk(c);
      if (done) return;
    }
  };
  walk(root);
  return count;
}

/** Capture a Range as text-only offsets within `root`. */
export function rangeToOffsets(root: Node, range: Range): SelOffsets {
  return {
    start: offsetWithin(root, range.startContainer, range.startOffset),
    end: offsetWithin(root, range.endContainer, range.endOffset),
  };
}

/** Resolve an absolute text offset back to a (textNode, offset) position. */
function locate(root: Node, target: number): { node: Node; offset: number } {
  let remaining = target;
  let result: { node: Node; offset: number } | null = null;
  const walk = (node: Node): void => {
    if (result) return;
    if (node.nodeType === 3) {
      const len = node.nodeValue?.length ?? 0;
      if (remaining <= len) {
        result = { node, offset: remaining };
        return;
      }
      remaining -= len;
      return;
    }
    for (const c of Array.from(node.childNodes)) {
      walk(c);
      if (result) return;
    }
  };
  walk(root);
  return result ?? { node: root, offset: root.childNodes.length };
}

/** Build a Range from text-only offsets within `root` (inverse of rangeToOffsets). */
export function offsetsToRange(root: Node, off: SelOffsets): Range {
  const doc = root.ownerDocument ?? document;
  const range = doc.createRange();
  const s = locate(root, off.start);
  const e = locate(root, off.end);
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}
