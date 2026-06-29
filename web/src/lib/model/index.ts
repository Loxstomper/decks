/**
 * model/index.ts — Public surface of the DOM-as-model core (P1-4/5/6, spec 02).
 *
 * The load-bearing correctness core: parse a deck into a source-preserving tree,
 * mutate it, and serialize it back deterministically with byte-stable
 * passthrough for everything untouched. See types.ts for the full rationale.
 *
 * Typical integrator usage:
 *
 *   import { parseDeck, serializeDeck, findByEid, setAttribute } from '$lib/model';
 *   const model = parseDeck(html);
 *   const el = findByEid(model, 't1');
 *   if (el) setAttribute(el, 'class', 'fragment');
 *   await save(serializeDeck(model)); // untouched subtrees byte-identical
 */

export { parseDeck } from './parse';
export { serializeDeck } from './serialize';
export {
  getAttribute,
  hasAttribute,
  setAttribute,
  removeAttribute,
  setText,
  walk,
  findByEid,
  getElementsByTagName,
  getSlides,
  createElement,
  createText,
  appendChild,
} from './edit';
export { decodeEntities, encodeAttr, encodeText } from './entities';
export type {
  DeckModel,
  SlideNode,
  ElementNode,
  TextNode,
  CommentNode,
  CdataNode,
  DoctypeNode,
  NodeAttr,
  NodeType,
} from './types';
