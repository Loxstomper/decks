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
export { classify, isTextLeaf } from './classify';
export { getInlineColor, setInlineColor } from './style';
export { stampEids, nextEid } from './eid';
export { cloneSubtreeStripEids } from './clone';
export { setFree, toggleFree } from './free';
export { getSlideNotes, setSlideNotes } from './notes';
export type { LogicalRect } from './free';
// P8-7: pure structural diff between two models ("highlight what Claude changed").
export { diffModels, isEmptyDiff } from './diff';
export type { ModelDiff } from './diff';
// P8-3: client-side + remote save validation (the editor's "slides validate" guard).
export { validateSource, validateModel, validateRemote, normalizeRemote } from './validate';
export type { ValidationError, ValidationResult } from './validate';
export {
  getContainerKind,
  getLayoutProps,
  setLayoutProps,
  findParentOf,
  resolveContainerForEid,
  findNearestContainerAncestor,
  getLayoutMarker,
  setLayoutMarker,
  getSlot,
  setSlot,
} from './layout';
export type { ElementClass } from './classify';
export type {
  ContainerKind,
  LayValue,
  AlignValue,
  JustifyValue,
  LayoutProps,
} from './layout';
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
