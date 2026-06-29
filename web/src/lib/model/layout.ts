/**
 * layout.ts — Layout-props model for the properties panel (P3-4 / spec 03).
 *
 * WHY THIS MODULE EXISTS:
 * =======================
 * Spec 03 encodes layout intent as `data-*` attributes rather than pixel
 * positions.  This module is the single translation layer between those raw
 * attribute strings and the typed `LayoutProps` object the UI controls bind to.
 *
 * Design contract (shared by Lane A model helpers and Lane C UI):
 *   getLayoutProps(el)         → typed snapshot for the UI to display
 *   setLayoutProps(el, delta)  → write changed props back as data-* attrs
 *   findParentOf(model, eid)   → walk upward to find the container ancestor
 *                                that the panel should target when a leaf is
 *                                selected (spec 03 "operate on selected leaf's
 *                                parent container")
 *
 * Attribute round-trip is handled by the existing edit.ts helpers:
 * getAttribute decodes entities, setAttribute encodes and marks dirty.
 * We never touch rawOpen/rawClose — only the subtree that changes goes dirty.
 */

import { getAttribute, setAttribute, removeAttribute, hasAttribute, walk } from './edit';
import type { DeckModel, ElementNode } from './types';
import { classify } from './classify';

// ─── Container kind (P3-2) ──────────────────────────────────────────────────

/**
 * The container kind for a layout element (spec 03 "The five primitives").
 *
 * 'section' — the slide root element (always a container; no data-lay needed).
 * 'stack'|'row'|'grid'|'layers' — the four structured layout primitives.
 *
 * Note: `data-free` elements are NOT containers — they use the free escape hatch
 * and getContainerKind returns null for them.
 */
export type ContainerKind = 'stack' | 'row' | 'grid' | 'layers' | 'section';

/**
 * Return the container kind for an element, or `null` if it is not a layout
 * container (i.e. free element, leaf, or passthrough).
 *
 * Rules (first match wins, mirrors classify.ts):
 *   data-free present → null (free escape hatch wins over data-lay)
 *   tag === 'section' → 'section'
 *   data-lay = stack|row|grid|layers → that kind
 *   otherwise → null
 */
export function getContainerKind(el: ElementNode): ContainerKind | null {
  // Free elements carry data-free; they are not containers.
  if (getAttribute(el, 'data-free') !== null) return null;

  const tag = el.tagName.toLowerCase();
  if (tag === 'section') return 'section';

  const lay = getAttribute(el, 'data-lay');
  if (lay === 'stack')  return 'stack';
  if (lay === 'row')    return 'row';
  if (lay === 'grid')   return 'grid';
  if (lay === 'layers') return 'layers';

  return null;
}

// ─── Value unions (spec 03 tables) ─────────────────────────────────────────

/** The `data-lay` layout primitives (spec 03 "The five primitives"). */
export type LayValue = 'stack' | 'row' | 'grid' | 'layers';

/**
 * Cross-axis alignment for stack/row (CSS align-items).
 * `stretch` is valid but omitted from the alignment toolbar (it is the CSS
 * default; exposing it would require a "clear" affordance to reset to stretch).
 */
export type AlignValue = 'start' | 'center' | 'end' | 'stretch';

/**
 * Main-axis justification for stack/row (CSS justify-content).
 * `around` is included per spec 03 table; the toolbar may choose not to surface
 * it if space is tight — the type still covers it so round-trips are lossless.
 */
export type JustifyValue = 'start' | 'center' | 'end' | 'between' | 'around';

// ─── Typed layout props snapshot ────────────────────────────────────────────

/**
 * Typed snapshot of all layout-related `data-*` attributes on an element.
 * `null` means the attribute is absent on the element (default/unset).
 *
 * `gap` and `pad` are logical-pixel integers (spec 05 "1920×1080 logical").
 * `cols` and `rows` are strings because CSS grid templates can be arbitrary
 * ("3", "1fr 2fr", "repeat(3, 1fr)"); we display them as free-text inputs.
 */
export interface LayoutProps {
  /** `data-lay` — which layout primitive the element uses. */
  lay: LayValue | null;
  /** `data-gap` — gap between children in logical pixels. */
  gap: number | null;
  /** `data-align` — cross-axis alignment (stack: horizontal; row: vertical). */
  align: AlignValue | null;
  /** `data-justify` — main-axis justification. */
  justify: JustifyValue | null;
  /** `data-pad` — inner padding in logical pixels. */
  pad: number | null;
  /** `data-cols` — grid column count or template (grid only). */
  cols: string | null;
  /** `data-rows` — grid row count or template (grid only). */
  rows: string | null;
  /**
   * `data-grow` — flex-grow factor for this element as a child of a row/stack.
   * Encodes "equal columns" intent without pixel arithmetic (spec 03).
   */
  grow: number | null;
  /**
   * `data-basis` — flex-basis for this element as a child.
   * Plain integer → logical px; otherwise a raw CSS value like "50%".
   */
  basis: string | null;
  /**
   * `data-span` — grid-column span count for this element as a grid child.
   * Must be a positive integer ≥ 1.
   */
  span: number | null;
}

// ─── Helpers to parse attribute strings into typed values ───────────────────

/** Guard: is the string a valid LayValue? */
function isLayValue(v: string): v is LayValue {
  return v === 'stack' || v === 'row' || v === 'grid' || v === 'layers';
}

/** Guard: is the string a valid AlignValue? */
function isAlignValue(v: string): v is AlignValue {
  return v === 'start' || v === 'center' || v === 'end' || v === 'stretch';
}

/** Guard: is the string a valid JustifyValue? */
function isJustifyValue(v: string): v is JustifyValue {
  return v === 'start' || v === 'center' || v === 'end' || v === 'between' || v === 'around';
}

/** Parse a logical-px attribute string ("24") to a number, or null on failure. */
function parsePx(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Read all layout-related `data-*` attributes from `el` into a typed snapshot.
 *
 * WHY A SNAPSHOT INSTEAD OF LIVE ATTRS:
 * The UI control binds to a plain JS object (spread into `$state`).  A
 * snapshot keeps controls simple: change a field → call setLayoutProps with
 * the delta — without needing reactivity over raw NodeAttr arrays.
 */
export function getLayoutProps(el: ElementNode): LayoutProps {
  const layRaw = getAttribute(el, 'data-lay');
  const alignRaw = getAttribute(el, 'data-align');
  const justifyRaw = getAttribute(el, 'data-justify');

  return {
    lay:     layRaw !== null && isLayValue(layRaw) ? layRaw : null,
    gap:     parsePx(getAttribute(el, 'data-gap')),
    align:   alignRaw !== null && isAlignValue(alignRaw) ? alignRaw : null,
    justify: justifyRaw !== null && isJustifyValue(justifyRaw) ? justifyRaw : null,
    pad:     parsePx(getAttribute(el, 'data-pad')),
    cols:    getAttribute(el, 'data-cols'),
    rows:    getAttribute(el, 'data-rows'),
    grow:    parsePx(getAttribute(el, 'data-grow')),
    basis:   getAttribute(el, 'data-basis'),
    span:    parsePx(getAttribute(el, 'data-span')),
  };
}

/**
 * Write a partial `LayoutProps` delta back to `el` as `data-*` attributes.
 *
 * Rules:
 *   • `null` value → remove the attribute (spec: absent = browser default).
 *   • Defined non-null value → set the attribute (encodes entities, marks dirty).
 *   • Keys absent from `delta` → not touched (true partial update; no dirty).
 *
 * VALIDATION: invalid enum values throw TypeError so callers catch mistakes
 * early.  Invalid numeric values (NaN, negative gap/pad, non-integer span)
 * also throw.  This keeps data-* attributes meaningful for the CSS renderer.
 *
 * This is the ONLY place that maps typed props → attribute names, so renaming
 * an attribute is a single-line change here.
 */
export function setLayoutProps(el: ElementNode, delta: Partial<LayoutProps>): void {
  // Helper: set or remove an attribute; undefined = key not in delta → no-op.
  function applyAttr(name: string, value: string | number | null | undefined): void {
    if (value === undefined) return;
    if (value === null) removeAttribute(el, name);
    else setAttribute(el, name, String(value));
  }

  // ── Enum attributes — validated against the spec's allowed sets ────────────
  if ('lay' in delta) {
    if (delta.lay !== null && delta.lay !== undefined && !isLayValue(delta.lay)) {
      throw new TypeError(`setLayoutProps: invalid data-lay value "${delta.lay}"`);
    }
    applyAttr('data-lay', delta.lay);
  }
  if ('align' in delta) {
    if (delta.align !== null && delta.align !== undefined && !isAlignValue(delta.align)) {
      throw new TypeError(`setLayoutProps: invalid data-align value "${delta.align}"`);
    }
    applyAttr('data-align', delta.align);
  }
  if ('justify' in delta) {
    if (delta.justify !== null && delta.justify !== undefined && !isJustifyValue(delta.justify)) {
      throw new TypeError(`setLayoutProps: invalid data-justify value "${delta.justify}"`);
    }
    applyAttr('data-justify', delta.justify);
  }

  // ── Non-negative integer attributes — gap and pad ─────────────────────────
  if ('gap' in delta) {
    if (delta.gap !== null && delta.gap !== undefined) validateNonNegativeInt('data-gap', delta.gap);
    applyAttr('data-gap', delta.gap);
  }
  if ('pad' in delta) {
    if (delta.pad !== null && delta.pad !== undefined) validateNonNegativeInt('data-pad', delta.pad);
    applyAttr('data-pad', delta.pad);
  }

  // ── Grid template strings — cols and rows (no strict validation, pass-through)
  if ('cols' in delta) applyAttr('data-cols', delta.cols);
  if ('rows' in delta) applyAttr('data-rows', delta.rows);

  // ── Child attributes ───────────────────────────────────────────────────────
  if ('grow' in delta) {
    if (delta.grow !== null && delta.grow !== undefined) validateNonNegativeInt('data-grow', delta.grow);
    applyAttr('data-grow', delta.grow);
  }
  if ('basis' in delta) {
    // basis is a free string (integer or "50%"); no strict validation.
    applyAttr('data-basis', delta.basis);
  }
  if ('span' in delta) {
    if (delta.span !== null && delta.span !== undefined) validatePositiveInt('data-span', delta.span);
    applyAttr('data-span', delta.span);
  }
}

// ─── Validation helpers ──────────────────────────────────────────────────────

/** Throw if `value` is not a finite, non-negative integer (≥0). */
function validateNonNegativeInt(attr: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new TypeError(
      `setLayoutProps: ${attr} must be a non-negative integer, got ${value}`,
    );
  }
}

/** Throw if `value` is not a finite positive integer (≥1). */
function validatePositiveInt(attr: string, value: number): void {
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    throw new TypeError(
      `setLayoutProps: ${attr} must be a positive integer (≥1), got ${value}`,
    );
  }
}

// ─── P14: Layout-preset marker (data-layout) ────────────────────────────────
//
// `data-layout` is a non-authoritative MARKER placed on <section> elements by
// the preset system (P14).  It records which preset was applied (e.g.
// "two-column", "title-body") so tooling can re-identify the layout without
// inspecting the full subtree.  The attribute has NO reflow semantics — it is
// purely informational.
//
// Dual-encoded: the Go validator (internal/validate/validate.go checkElement)
// accepts any non-empty string for data-layout on <section> and must stay in
// sync with the attribute name used here.

/**
 * Return the layout-preset marker (`data-layout`) of a section element, or
 * `null` if the attribute is absent or empty.
 *
 * @param section — must be a `<section>` ElementNode (caller's responsibility).
 */
export function getLayoutMarker(section: ElementNode): string | null {
  const v = getAttribute(section, 'data-layout');
  return v !== null && v.trim() !== '' ? v : null;
}

/**
 * Set or remove the `data-layout` attribute on `section`.
 *
 * - `name` — non-empty preset name → sets the attribute and marks dirty.
 * - `null` → removes the attribute.
 *
 * Throws `TypeError` when `name` is an empty string (empty values are
 * disallowed by the spec; use `null` to clear).
 *
 * @param section — must be a `<section>` ElementNode (caller's responsibility).
 */
export function setLayoutMarker(section: ElementNode, name: string | null): void {
  if (name !== null && name.trim() === '') {
    throw new TypeError('setLayoutMarker: name must be a non-empty string or null');
  }
  if (name === null) {
    removeAttribute(section, 'data-layout');
  } else {
    setAttribute(section, 'data-layout', name);
  }
}

// ─── P14: Named-slot marker (data-slot) ─────────────────────────────────────
//
// `data-slot` is a non-authoritative MARKER placed on any element (typically a
// layout container) to identify its semantic role within a preset layout (e.g.
// "content", "sidebar", "header").  Like `data-layout`, it has NO reflow
// semantics — the CSS layout is entirely driven by `data-lay` and its
// associated attributes.
//
// Dual-encoded: the Go validator (internal/validate/validate.go checkElement)
// accepts any non-empty string for data-slot on any element and must stay in
// sync with the attribute name used here.

/**
 * Return the named-slot marker (`data-slot`) of an element, or `null` if the
 * attribute is absent or empty.
 */
export function getSlot(el: ElementNode): string | null {
  const v = getAttribute(el, 'data-slot');
  return v !== null && v.trim() !== '' ? v : null;
}

/**
 * Set or remove the `data-slot` attribute on `el`.
 *
 * - `name` — non-empty slot name → sets the attribute and marks dirty.
 * - `null` → removes the attribute.
 *
 * Throws `TypeError` when `name` is an empty string (empty values are
 * disallowed by the spec; use `null` to clear).
 */
export function setSlot(el: ElementNode, name: string | null): void {
  if (name !== null && name.trim() === '') {
    throw new TypeError('setSlot: name must be a non-empty string or null');
  }
  if (name === null) {
    removeAttribute(el, 'data-slot');
  } else {
    setAttribute(el, 'data-slot', name);
  }
}

// ─── P17-18: Per-slide footer opt-out (data-footer-hidden) ──────────────────
//
// `data-footer-hidden` is a BOOLEAN marker on a `<section>` opting that slide out
// of the deck-level footer overlay. The footer is a managed custom.css rule keyed
// off `section:not([data-footer-hidden])`, so the attribute's mere PRESENCE (any
// value, including the empty boolean form) suppresses the footer on that slide.
//
// Dual-encoded: the Go validator (internal/validate/validate.go) recognises
// `data-footer-hidden` as a presence-only marker and must stay in sync on the
// attribute name.

/**
 * Return whether a section opts out of the deck footer (`data-footer-hidden`
 * present). Presence-only: any value (incl. empty) counts as hidden.
 *
 * @param section — must be a `<section>` ElementNode (caller's responsibility).
 */
export function getFooterHidden(section: ElementNode): boolean {
  return hasAttribute(section, 'data-footer-hidden');
}

/**
 * Set or clear the `data-footer-hidden` boolean marker on `section`.
 *
 * - `true` → adds `data-footer-hidden` (empty boolean form) and marks dirty.
 * - `false` → removes the attribute.
 *
 * Byte-stable: setting the value already in effect is a no-op (setAttribute /
 * removeAttribute only dirty the node when something actually changes).
 *
 * @param section — must be a `<section>` ElementNode (caller's responsibility).
 */
export function setFooterHidden(section: ElementNode, hidden: boolean): void {
  if (hidden) {
    // null → bare boolean attribute (`data-footer-hidden`, no ="" value).
    setAttribute(section, 'data-footer-hidden', null);
  } else {
    removeAttribute(section, 'data-footer-hidden');
  }
}

/**
 * Find the nearest ancestor `ElementNode` of the element carrying `eid`.
 *
 * WHY: when a *leaf* is selected the alignment toolbar should operate on its
 * enclosing container (spec 03 / spec 04 "Alignment tools"), not on the leaf
 * itself.  We walk the model tree recording parent pointers, then return the
 * nearest element ancestor of the target.
 *
 * Returns `null` when:
 *   • the eid is not found in the model, or
 *   • the element has no element parent (it IS a top-level node).
 */
export function findParentOf(model: DeckModel, eid: string): ElementNode | null {
  let result: ElementNode | null = null;

  // walk() visits every node depth-first and provides (node, parent).
  // We look for our eid and capture its parent.
  walk(model, (node, parent) => {
    if (result) return; // already found
    if (node.type === 'element') {
      const nodeEid = getAttribute(node, 'data-eid');
      if (nodeEid === eid && parent !== null) {
        result = parent;
      }
    }
  });

  return result;
}

/**
 * Given a selected `eid`, return the container element whose layout props
 * should be shown in the panel.
 *
 * Logic (spec 03 / P3-5):
 *   • If `eid` is a CONTAINER  → return it directly.
 *   • If `eid` is a LEAF/FREE  → walk up to find the nearest container ancestor.
 *   • Otherwise (passthrough)  → return null (panel shows empty state).
 *
 * WHY NOT JUST RETURN THE PARENT ALWAYS:
 * A container IS the element to show props for; returning the parent of a
 * container would expose the grandparent's props, which is confusing.
 */
export function resolveContainerForEid(
  model: DeckModel,
  eid: string,
): { el: ElementNode; isOwnContainer: boolean } | null {
  // Walk to find the element with this eid and check its class.
  let target: ElementNode | null = null;
  walk(model, (node) => {
    if (target) return;
    if (node.type === 'element' && getAttribute(node, 'data-eid') === eid) {
      target = node;
    }
  });
  if (!target) return null;

  const cls = classify(target);
  if (cls === 'container') {
    // The selected element IS the container we operate on.
    return { el: target, isOwnContainer: true };
  }

  if (cls === 'leaf' || cls === 'free') {
    // Walk up to find the nearest container ancestor.
    const parent = findNearestContainerAncestor(model, eid);
    if (parent) return { el: parent, isOwnContainer: false };
  }

  return null;
}

/**
 * Walk the model's parent-pointer chain upward from `eid` and return the first
 * ancestor that `classify()` identifies as a container.
 *
 * Internal helper used by resolveContainerForEid.  Exposed separately so tests
 * can verify the walk without going through the full resolve.
 */
export function findNearestContainerAncestor(
  model: DeckModel,
  eid: string,
): ElementNode | null {
  // Build a child→parent map in one pass, then walk up from the target.
  const parentMap = new Map<ElementNode, ElementNode | null>();
  walk(model, (node, parent) => {
    if (node.type === 'element') {
      parentMap.set(node, parent);
    }
  });

  // Find the target element.
  let target: ElementNode | null = null;
  walk(model, (node) => {
    if (target) return;
    if (node.type === 'element' && getAttribute(node, 'data-eid') === eid) {
      target = node;
    }
  });
  if (!target) return null;

  // Walk up via parentMap until we find a container.
  let cursor: ElementNode | null = parentMap.get(target) ?? null;
  while (cursor !== null) {
    if (classify(cursor) === 'container') return cursor;
    cursor = parentMap.get(cursor) ?? null;
  }
  return null;
}
