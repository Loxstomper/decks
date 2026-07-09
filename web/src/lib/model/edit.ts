/**
 * edit.ts — Mutation + query helpers over the model (spec document-model).
 *
 * These are the operations a deck store (P1-7+) builds on. Every mutation marks
 * the affected node `dirty`, which switches that node from byte-stable
 * passthrough to canonical re-rendering on the next `serializeDeck` — scoping
 * reformatting to exactly what changed.
 *
 * Attribute/text VALUES cross the boundary as *literals*: `getAttribute` decodes
 * entities, `setAttribute`/`setText` encode them. Stored values stay in source
 * form so untouched nodes never churn.
 */

import { decodeEntities, encodeAttr, encodeText } from './entities';
import type { DeckModel, ElementNode, NodeAttr, SlideNode, TextNode } from './types';

/** Find an attribute (case-insensitive name match) on an element. */
function findAttr(el: ElementNode, name: string): NodeAttr | undefined {
  const lname = name.toLowerCase();
  return el.attributes.find((a) => a.name.toLowerCase() === lname);
}

/** Read an attribute as a decoded literal. Returns `null` if absent; `''` for a
 *  boolean attribute present without a value. */
export function getAttribute(el: ElementNode, name: string): string | null {
  const attr = findAttr(el, name);
  if (attr === undefined) return null;
  return attr.value === null ? '' : decodeEntities(attr.value);
}

/** True if the attribute is present (with or without a value). */
export function hasAttribute(el: ElementNode, name: string): boolean {
  return findAttr(el, name) !== undefined;
}

/** Set (or add) an attribute from a literal value, encoding to source form and
 *  marking the element dirty. Pass `null` for a boolean attribute. */
export function setAttribute(el: ElementNode, name: string, value: string | null): void {
  const stored = value === null ? null : encodeAttr(value);
  const existing = findAttr(el, name);
  if (existing) existing.value = stored;
  else el.attributes.push({ name, value: stored });
  el.dirty = true;
}

/** Remove an attribute (if present) and mark the element dirty. */
export function removeAttribute(el: ElementNode, name: string): void {
  const lname = name.toLowerCase();
  const before = el.attributes.length;
  el.attributes = el.attributes.filter((a) => a.name.toLowerCase() !== lname);
  if (el.attributes.length !== before) el.dirty = true;
}

/** Replace a text node's content from a literal, encoding entities and marking
 *  it dirty. */
export function setText(node: TextNode, literal: string): void {
  node.value = encodeText(literal);
  node.dirty = true;
}

/** Depth-first walk over every node in the model. */
export function walk(
  model: DeckModel,
  visit: (node: SlideNode, parent: ElementNode | null) => void,
): void {
  const recurse = (node: SlideNode, parent: ElementNode | null) => {
    visit(node, parent);
    if (node.type === 'element') {
      for (const child of node.children) recurse(child, node);
    }
  };
  for (const node of model.nodes) recurse(node, null);
}

/** Find the element carrying the given `data-eid` (stable per-deck id, spec document-model).
 *  Returns the first match in document order, or `null`. */
export function findByEid(model: DeckModel, eid: string): ElementNode | null {
  let found: ElementNode | null = null;
  walk(model, (node) => {
    if (found || node.type !== 'element') return;
    if (getAttribute(node, 'data-eid') === eid) found = node;
  });
  return found;
}

/** All elements matching a (lowercased) tag name, in document order. */
export function getElementsByTagName(model: DeckModel, tagName: string): ElementNode[] {
  const lname = tagName.toLowerCase();
  const out: ElementNode[] = [];
  walk(model, (node) => {
    if (node.type === 'element' && node.tagName.toLowerCase() === lname) out.push(node);
  });
  return out;
}

/**
 * All reveal.js slide sections: the direct `<section>` children of
 * `.reveal > .slides`. (A top-level section is a horizontal slide; a section
 * nested directly inside one is a vertical-stack slide — both are returned.)
 */
export function getSlides(model: DeckModel): ElementNode[] {
  const slidesContainers: ElementNode[] = [];
  walk(model, (node) => {
    if (
      node.type === 'element' &&
      node.tagName.toLowerCase() === 'div' &&
      (getAttribute(node, 'class') ?? '').split(/\s+/).includes('slides')
    ) {
      slidesContainers.push(node);
    }
  });
  const out: ElementNode[] = [];
  for (const container of slidesContainers) {
    for (const child of container.children) {
      if (child.type === 'element' && child.tagName.toLowerCase() === 'section') {
        out.push(child);
      }
    }
  }
  return out;
}

/**
 * Create a new, canonical element node (always re-rendered, never passthrough).
 * Attribute values are literals and will be entity-encoded on serialize.
 */
export function createElement(
  tagName: string,
  attributes: Record<string, string | null> = {},
): ElementNode {
  const attrs: NodeAttr[] = Object.entries(attributes).map(([name, value]) => ({
    name,
    value: value === null ? null : encodeAttr(value),
  }));
  return {
    type: 'element',
    tagName,
    attributes: attrs,
    children: [],
    rawOpen: '',
    rawClose: '',
    selfClosing: false,
    isVoid: false,
    rawText: false,
    raw: '',
    dirty: true,
  };
}

/** Create a new text node from a literal string (entity-encoded on serialize). */
export function createText(literal: string): TextNode {
  return { type: 'text', value: encodeText(literal), raw: '', dirty: true };
}

/** Append a child to an element. The parent re-serializes its children (because
 *  the new child is dirty) while keeping its own original tag bytes. */
export function appendChild(parent: ElementNode, child: SlideNode): void {
  parent.children.push(child);
  child.dirty = true;
}
