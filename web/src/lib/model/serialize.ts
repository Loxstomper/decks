/**
 * serialize.ts — Deterministic serializer (P1-5 / spec 02).
 *
 * Two emission paths, chosen per node:
 *
 *   1. PASSTHROUGH (untouched subtree): emit the node's exact original `raw`
 *      bytes. This is what makes an unedited deck round-trip byte-identically
 *      for arbitrary input and is the foundation of "never destroy the unknown".
 *
 *   2. CANONICAL (edited): emit deterministic markup — attributes in a fixed,
 *      input-order-independent order with stable double-quoting. Same model
 *      always yields identical bytes (spec 02 / principle #4).
 *
 * A clean element that merely *contains* an edited descendant keeps its OWN
 * original tag bytes (rawOpen/rawClose) and only re-renders the changed child —
 * i.e. we "preserve the original serialization for untouched subtrees" and scope
 * reformatting to exactly what changed.
 *
 * DETERMINISM: `serializeDeck` is a pure function of the model. Calling it twice
 * on the same model yields identical strings; two models that differ only in the
 * INPUT order of an edited element's attributes serialize identically (canonical
 * order). These are tested in model.test.ts.
 */

import type { ElementNode, NodeAttr, SlideNode } from './types';

/** Serialize a {@link DeckModel} to an HTML string. */
export function serializeDeck(model: { nodes: SlideNode[] }): string {
  let out = '';
  for (const node of model.nodes) out += serializeNode(node);
  return out;
}

/** True if this node or any descendant was edited and must be re-rendered. */
function subtreeDirty(node: SlideNode): boolean {
  if (node.dirty) return true;
  if (node.type === 'element') {
    for (const child of node.children) if (subtreeDirty(child)) return true;
  }
  return false;
}

function serializeNode(node: SlideNode): string {
  if (node.type !== 'element') {
    return node.dirty ? renderLeaf(node) : node.raw;
  }

  // Fully clean subtree -> verbatim original bytes (passthrough).
  if (!subtreeDirty(node)) return node.raw;

  // Something inside changed. The element's own tag bytes are preserved unless
  // the element itself was edited.
  const open = node.dirty ? renderOpenTag(node) : node.rawOpen;
  if (node.isVoid || node.selfClosing) return open;

  const close = node.dirty ? renderCloseTag(node) : node.rawClose;

  if (node.rawText) {
    // Raw-text element: its single text child is emitted verbatim / canonically
    // but never escaped as markup.
    let content = '';
    for (const child of node.children) {
      // Raw-text elements only ever hold text children (parser invariant), so a
      // dirty child is always a leaf — narrow accordingly.
      if (child.dirty && child.type !== 'element') content += renderLeaf(child);
      else content += child.raw;
    }
    return open + content + close;
  }

  let inner = '';
  for (const child of node.children) inner += serializeNode(child);
  return open + inner + close;
}

/** Canonical rendering for a non-element node that was edited. */
function renderLeaf(node: Exclude<SlideNode, ElementNode>): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'comment':
      return '<!--' + node.value + '-->';
    case 'cdata':
      return '<![CDATA[' + node.value + ']]>';
    case 'doctype':
      return node.raw;
  }
}

/**
 * Canonical attribute order (deterministic, input-order independent):
 *   0. `id`
 *   1. `class`
 *   2. other (non-data, non-style) attributes, alphabetical
 *   3. `data-*` attributes, grouped, alphabetical (spec 02: "data-* grouping")
 *   4. `style` last
 * Equal group + equal name keeps original relative order (stable sort).
 */
function attrRank(name: string): number {
  const n = name.toLowerCase();
  if (n === 'id') return 0;
  if (n === 'class') return 1;
  if (n === 'style') return 4;
  if (n.startsWith('data-')) return 3;
  return 2;
}

function sortAttributes(attrs: NodeAttr[]): NodeAttr[] {
  return attrs
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const rx = attrRank(x.a.name);
      const ry = attrRank(y.a.name);
      if (rx !== ry) return rx - ry;
      const nx = x.a.name.toLowerCase();
      const ny = y.a.name.toLowerCase();
      if (nx !== ny) return nx < ny ? -1 : 1;
      return x.i - y.i; // stable for duplicate names
    })
    .map((w) => w.a);
}

function renderOpenTag(node: ElementNode): string {
  let out = '<' + node.tagName;
  for (const attr of sortAttributes(node.attributes)) {
    out += ' ' + attr.name;
    if (attr.value !== null) out += '=' + quoteAttr(attr.value);
  }
  out += node.selfClosing ? ' />' : '>';
  return out;
}

function renderCloseTag(node: ElementNode): string {
  return '</' + node.tagName + '>';
}

/** Quote an attribute value (already in source form). Prefer double quotes;
 *  fall back to single quotes if the value contains a double quote; escape only
 *  if it contains both. */
function quoteAttr(value: string): string {
  if (!value.includes('"')) return '"' + value + '"';
  if (!value.includes("'")) return "'" + value + "'";
  return '"' + value.replace(/"/g, '&quot;') + '"';
}
