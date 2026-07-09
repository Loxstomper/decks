/**
 * layout.ts — Layout-props model for the properties panel (P3-4 / spec layout-vocabulary).
 *
 * WHY THIS MODULE EXISTS:
 * =======================
 * Spec layout-vocabulary encodes layout intent as `data-*` attributes rather than pixel
 * positions.  This module is the single translation layer between those raw
 * attribute strings and the typed `LayoutProps` object the UI controls bind to.
 *
 * Design contract (shared by Lane A model helpers and Lane C UI):
 *   getLayoutProps(el)         → typed snapshot for the UI to display
 *   setLayoutProps(el, delta)  → write changed props back as data-* attrs
 *   findParentOf(model, eid)   → walk upward to find the container ancestor
 *                                that the panel should target when a leaf is
 *                                selected (spec layout-vocabulary "operate on selected leaf's
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
 * The container kind for a layout element (spec layout-vocabulary "The five primitives").
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

// ─── Value unions (spec layout-vocabulary tables) ─────────────────────────────────────────

/** The `data-lay` layout primitives (spec layout-vocabulary "The five primitives"). */
export type LayValue = 'stack' | 'row' | 'grid' | 'layers';

/**
 * Cross-axis alignment for stack/row (CSS align-items).
 * `stretch` is valid but omitted from the alignment toolbar (it is the CSS
 * default; exposing it would require a "clear" affordance to reset to stretch).
 */
export type AlignValue = 'start' | 'center' | 'end' | 'stretch';

/**
 * Main-axis justification for stack/row (CSS justify-content).
 * `around` is included per spec layout-vocabulary table; the toolbar may choose not to surface
 * it if space is tight — the type still covers it so round-trips are lossless.
 */
export type JustifyValue = 'start' | 'center' | 'end' | 'between' | 'around';

// ─── Typed layout props snapshot ────────────────────────────────────────────

/**
 * Typed snapshot of all layout-related `data-*` attributes on an element.
 * `null` means the attribute is absent on the element (default/unset).
 *
 * `gap` and `pad` are logical-pixel integers (spec scaling-and-resolution "1920×1080 logical").
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
   * Encodes "equal columns" intent without pixel arithmetic (spec layout-vocabulary).
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

// ─── P17-20: Per-slide auto-advance (data-autoslide) ────────────────────────
//
// `data-autoslide` is a reveal-native attribute on a `<section>`: the number of
// milliseconds reveal waits before auto-advancing past that slide. It overrides
// the deck-level `autoSlide` config for that one slide. A non-negative integer;
// `0` pauses auto-advance on the slide. We model it as `number | null` where
// `null` means "no override" (attribute absent → inherit the deck default).
//
// Dual-encoded: the Go validator (internal/validate/validate.go) accepts
// `data-autoslide` as a non-negative integer and must stay in sync.

/**
 * Return the per-slide auto-advance interval (`data-autoslide`, in ms) of a
 * section, or `null` when the attribute is absent or not a non-negative
 * integer.
 *
 * @param section — must be a `<section>` ElementNode (caller's responsibility).
 */
export function getAutoslide(section: ElementNode): number | null {
  const v = getAttribute(section, 'data-autoslide');
  if (v === null) return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * Set or remove the `data-autoslide` attribute on `section`.
 *
 * - `ms` — non-negative integer → sets the attribute and marks dirty.
 * - `null` → removes the attribute (inherit the deck default).
 *
 * Throws `TypeError` when `ms` is negative or not an integer.
 *
 * @param section — must be a `<section>` ElementNode (caller's responsibility).
 */
export function setAutoslide(section: ElementNode, ms: number | null): void {
  if (ms !== null && (!Number.isInteger(ms) || ms < 0)) {
    throw new TypeError('setAutoslide: ms must be a non-negative integer or null');
  }
  if (ms === null) {
    removeAttribute(section, 'data-autoslide');
  } else {
    setAttribute(section, 'data-autoslide', String(ms));
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

// ─── P17: Chart block accessors (data-chart / data-chart-data) ──────────────
//
// A Chart.js chart is a <canvas> carrying two MARKER attributes the editor owns:
//   • `data-chart`      — the chart TYPE string ("bar", "line", "pie", …); also
//                         the marker the vendored plugin scans for.
//   • `data-chart-data` — a JSON Chart.js config `{type, data, options?}` the
//                         runtime plugin JSON.parses to render the chart.
// These have NO layout/reflow semantics; they are content for the chart plugin.
//
// Dual-encoded: the Go validator (internal/validate/validate.go checkElement)
// accepts a non-empty data-chart string and a parseable data-chart-data JSON on a
// canvas, and classify.ts recognises the same marker as a leaf. Keep the three in
// sync on the attribute names.

/** Typed snapshot of a chart canvas's marker attributes. */
export interface ChartProps {
  /** The chart type string from `data-chart` (e.g. "bar"), or null if absent. */
  type: string | null;
  /** The raw `data-chart-data` JSON string (decoded literal), or null if absent. */
  data: string | null;
}

/**
 * Read a chart canvas's `data-chart` + `data-chart-data` markers as a typed
 * snapshot. Empty/absent attributes read as `null`. Pure; never mutates.
 */
export function getChartProps(el: ElementNode): ChartProps {
  const type = getAttribute(el, 'data-chart');
  const data = getAttribute(el, 'data-chart-data');
  return {
    type: type !== null && type.trim() !== '' ? type : null,
    data: data !== null && data !== '' ? data : null,
  };
}

/**
 * Write the chart markers on `el` (a <canvas>): set `data-chart` to the type and
 * `data-chart-data` to the JSON config string, marking the element dirty.
 *
 * - `type`     — non-empty chart type string. Throws `TypeError` when empty.
 * - `dataJson` — the JSON config string, written verbatim (the caller validates
 *                it parses; layout.ts does not re-stringify, keeping bytes stable).
 */
export function setChartProps(el: ElementNode, type: string, dataJson: string): void {
  if (type.trim() === '') {
    throw new TypeError('setChartProps: type must be a non-empty string');
  }
  setAttribute(el, 'data-chart', type);
  setAttribute(el, 'data-chart-data', dataJson);
}

// ─── P19: QR block accessors (data-qr / data-qr-*) ──────────────────────────
//
// A QR code is a <div> carrying the editor's own marker attributes:
//   • `data-qr`       — the encoded PAYLOAD (a URL or text); non-empty.
//   • `data-qr-ec`    — error-correction level: 'L' | 'M' | 'Q' | 'H' (default M).
//   • `data-qr-fg`    — module (foreground) colour (default #000000).
//   • `data-qr-bg`    — background colour (default #ffffff).
//   • `data-qr-quiet` — quiet-zone width in modules, non-negative int (default 4).
// These have NO layout/reflow semantics; they are functional INPUTS to QR
// generation (the vendored plugin reads them to draw scannable modules) — stored
// as data-qr-* attributes rather than CSS, a deliberate exception to the
// editor-owns-layout / you-own-styling split (spec layout-vocabulary "QR code").
//
// Dual-encoded: the Go validator (internal/validate/validate.go) and classify.ts
// recognise the same markers. Keep the allowed-sets in sync on attribute names
// and the EC enum.

/** Error-correction levels accepted by the QR generator (spec layout-vocabulary "QR code"). */
export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

/** Guard: is the string a valid QR error-correction level? */
function isQrEcLevel(v: string): v is QrEcLevel {
  return v === 'L' || v === 'M' || v === 'Q' || v === 'H';
}

/** Typed snapshot of a QR div's marker attributes. `null` = attribute absent. */
export interface QrProps {
  /** `data-qr` payload (URL/text), or null if absent/empty. */
  payload: string | null;
  /** `data-qr-ec` error-correction level, or null if absent/invalid. */
  ec: QrEcLevel | null;
  /** `data-qr-fg` foreground colour, or null if absent. */
  fg: string | null;
  /** `data-qr-bg` background colour, or null if absent. */
  bg: string | null;
  /** `data-qr-quiet` quiet-zone modules, or null if absent/invalid. */
  quiet: number | null;
}

/**
 * Read a QR div's `data-qr` + `data-qr-*` markers as a typed snapshot. Empty or
 * absent attributes read as `null`. Pure; never mutates.
 */
export function getQrProps(el: ElementNode): QrProps {
  const payload = getAttribute(el, 'data-qr');
  const ecRaw = getAttribute(el, 'data-qr-ec');
  return {
    payload: payload !== null && payload !== '' ? payload : null,
    ec: ecRaw !== null && isQrEcLevel(ecRaw) ? ecRaw : null,
    fg: getAttribute(el, 'data-qr-fg'),
    bg: getAttribute(el, 'data-qr-bg'),
    quiet: parsePx(getAttribute(el, 'data-qr-quiet')),
  };
}

/**
 * Write a partial `QrProps` delta back to `el` (a <div>) as `data-qr-*`
 * attributes, marking it dirty.
 *
 * Rules (mirror setLayoutProps):
 *   • `null` value → remove the attribute.
 *   • defined non-null value → set the attribute.
 *   • keys absent from `delta` → untouched.
 *
 * VALIDATION: `payload` must be a non-empty string (use `null` to clear); `ec`
 * must be one of L/M/Q/H; `quiet` a non-negative integer. Invalid values throw
 * TypeError so callers catch mistakes early.
 */
export function setQrProps(el: ElementNode, delta: Partial<QrProps>): void {
  function applyAttr(name: string, value: string | number | null | undefined): void {
    if (value === undefined) return;
    if (value === null) removeAttribute(el, name);
    else setAttribute(el, name, String(value));
  }

  if ('payload' in delta) {
    if (delta.payload !== null && delta.payload !== undefined && delta.payload.trim() === '') {
      throw new TypeError('setQrProps: payload must be a non-empty string or null');
    }
    applyAttr('data-qr', delta.payload);
  }
  if ('ec' in delta) {
    if (delta.ec !== null && delta.ec !== undefined && !isQrEcLevel(delta.ec)) {
      throw new TypeError(`setQrProps: invalid data-qr-ec value "${delta.ec}"`);
    }
    applyAttr('data-qr-ec', delta.ec);
  }
  if ('fg' in delta) applyAttr('data-qr-fg', delta.fg);
  if ('bg' in delta) applyAttr('data-qr-bg', delta.bg);
  if ('quiet' in delta) {
    if (delta.quiet !== null && delta.quiet !== undefined) {
      validateNonNegativeInt('data-qr-quiet', delta.quiet);
    }
    applyAttr('data-qr-quiet', delta.quiet);
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
 * enclosing container (spec layout-vocabulary / spec canvas-interaction "Alignment tools"), not on the leaf
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
 * Logic (spec layout-vocabulary / P3-5):
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
