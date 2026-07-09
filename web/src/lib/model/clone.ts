/**
 * clone.ts — Deep subtree clone with eid stripping (single source of truth).
 *
 * WHY THIS EXISTS:
 * ================
 * Duplicating ANY managed node (a whole slide, a free element, a clipboard
 * paste) needs the SAME primitive: a deep, source-independent copy of a subtree
 * that is ready to be re-stamped with fresh `data-eid`s. Originally this lived
 * only in slides.ts (`cloneStripEids`); P13 generalises it so slide-dup,
 * element-dup (P13-5), z-order (P13-6) and the element clipboard (P13-7) all
 * share one implementation — no drift between copies.
 *
 * CONTRACT:
 *   • Returns freshly-authored, canonical nodes: `raw`/`rawOpen`/`rawClose` are
 *     cleared and `dirty = true`, so the serializer re-renders the copy from the
 *     model (never via stale byte passthrough) and the inserted subtree is
 *     byte-stable.
 *   • Strips every `data-eid` (case-insensitively) so stampEids (model/eid.ts)
 *     re-mints unique ids for the copy on insert.
 *   • PRESERVES `data-id` and all other attributes so reveal auto-animate can
 *     still pair the original and the copy by `data-id` (spec motion-and-transitions).
 *
 * Pure over the model (no DOM, no store) → unit-testable.
 */

import type { SlideNode } from './types';

/**
 * Deep-clone a node subtree as freshly-authored, canonical nodes, stripping
 * every `data-eid` so {@link stampEids} re-mints unique ids for the copy. All
 * other attributes (including `data-id`) are preserved verbatim.
 *
 * The return type mirrors the input node type so callers cloning an element get
 * an ElementNode back (cast at the call site when needed).
 */
export function cloneSubtreeStripEids(node: SlideNode): SlideNode {
  if (node.type === 'element') {
    return {
      type: 'element',
      tagName: node.tagName,
      // Drop data-eid only; keep data-id (+ everything else) for auto-animate.
      attributes: node.attributes
        .filter((a) => a.name.toLowerCase() !== 'data-eid')
        .map((a) => ({ name: a.name, value: a.value })),
      children: node.children.map(cloneSubtreeStripEids),
      rawOpen: '',
      rawClose: '',
      selfClosing: node.selfClosing,
      isVoid: node.isVoid,
      rawText: node.rawText,
      raw: '', // force canonical render
      dirty: true,
    };
  }
  // Text / comment / cdata / doctype: copy the value, force canonical render.
  return { ...node, raw: '', dirty: true };
}
