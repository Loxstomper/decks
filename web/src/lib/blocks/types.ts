/**
 * blocks/types.ts — Insert-palette registry contract (P5-1, spec layout-vocabulary "Leaf block types").
 *
 * WHY A REGISTRY (and not a hard-coded palette):
 * ==============================================
 * The insert palette (P5-1) is the single seam every block type plugs into.
 * Lane FE-A ships the structural blocks (text / table / shape / embed); Lane
 * FE-B ships image / code / math. Rather than couple the palette to a fixed
 * list, the palette renders whatever is in the REGISTRY. New block types are
 * added by *registering* a definition — the palette needs no edits.
 *
 * REGISTRY CONTRACT (read this before adding a block type)
 * --------------------------------------------------------
 *   1. Build a pure builder in your own file under `web/src/lib/blocks/` that
 *      returns a model `ElementNode` subtree assembled exclusively via the
 *      edit.ts factories (createElement / createText / appendChild). The node
 *      MUST be self-contained and offline-safe: zero external URLs in the
 *      emitted markup (embeds are the sole, documented exception — see embed.ts).
 *   2. Register an `InsertBlockDef` for it via `registerBlock(def)` (registry.ts).
 *      Registration is idempotent by `id`, so a re-imported module (HMR / tests)
 *      never double-lists a block.
 *   3. Ensure your registering module is imported so the side-effect runs —
 *      add one `import './yourfile';` line to `blocks/index.ts` (the palette
 *      imports that barrel, so the registration is then live).
 *
 * The builder is PURE: it takes the palette-collected `args` and returns a fresh
 * subtree. It does not touch the store, selection, or the DOM. The insert seam
 * (`deckStore.insertBlock`) owns placement, eid-stamping, undo and selection.
 */

import type { ElementNode } from '$lib/model/types';

/**
 * A single user input the palette collects *before* calling `build()`.
 *
 * Most blocks need none (their builder has sensible defaults). Blocks that need
 * a value the editor cannot guess — e.g. an embed URL — declare `fields`, and
 * the palette renders a small form, then passes the collected values to
 * `build(args)` keyed by `name`.
 */
export interface InsertField {
  /** Key under which the collected value is passed to `build(args)`. */
  name: string;
  /** Human-readable label shown beside the input. */
  label: string;
  /** Input kind — drives the rendered control and light validation. */
  type: 'text' | 'url' | 'number';
  /** Placeholder text for an empty input. */
  placeholder?: string;
  /** Initial value. */
  default?: string | number;
  /** When true the palette will not enable "Insert" until this field is filled. */
  required?: boolean;
}

/** Values collected from a block's {@link InsertField}s, keyed by field `name`. */
export type BuildArgs = Record<string, string | number | undefined>;

/**
 * How the insert seam should place the built node relative to the current
 * selection/container.
 *
 *   'flow' — a normal block: inserted INTO the current container (or after the
 *            selected leaf). Participates in stack/row/grid layout.
 *   'free' — an absolutely-positioned block (carries its own data-free + coords,
 *            e.g. shapes / embeds): inserted into the current SLIDE container so
 *            its logical x/y are relative to the slide, escaping the flow.
 *
 * The builder still fully owns the node's attributes; `placement` only tells the
 * seam which ancestor to drop it into.
 */
export type Placement = 'flow' | 'free';

/**
 * A registered, insertable block type. The palette lists these (grouped by
 * `group`); choosing one (after collecting any `fields`) calls `build(args)`
 * and hands the resulting subtree to the insert seam.
 */
export interface InsertBlockDef {
  /** Stable unique id (e.g. `'text-heading'`). Registration de-dupes on this. */
  id: string;
  /** Label shown in the palette (e.g. `'Heading'`). */
  label: string;
  /** Group heading the palette buckets this under (e.g. `'Text'`, `'Media'`). */
  group: string;
  /**
   * Icon as SVG path data (`d` attribute), drawn by the palette inside a
   * `0 0 24 24` viewBox. A bare path string keeps the registry free of Svelte
   * imports so it is trivially unit-testable.
   */
  icon: string;
  /** Where the seam should place the built node. Defaults to `'flow'`. */
  placement?: Placement;
  /** Inputs the palette collects before building (omit when none are needed). */
  fields?: InsertField[];
  /**
   * Pure builder: returns a fresh model subtree from the collected `args`.
   *
   * Required for blocks the palette can build inline from `fields` (text / table
   * / shape / embed). OMITTED for `panel`-driven blocks (image / code / math),
   * whose dedicated Svelte panel builds the node asynchronously and hands it to
   * the seam via its `onInsert` callback — see `panel` below.
   */
  build?: (args?: BuildArgs) => ElementNode;
  /**
   * Identifier of a Svelte panel component that owns this block's richer insert
   * flow (e.g. image upload / provider search / a code or math editor). When set,
   * the palette opens that panel in a modal instead of building inline, passing
   * it `{ deckName, onInsert, onCancel }`; the panel calls `onInsert(node)` with
   * the finished subtree and the seam places it exactly like a built block.
   *
   * Kept as a string (not a component import) so the registry stays free of
   * Svelte/runtime imports and trivially unit-testable; InsertPalette.svelte
   * resolves the string to the concrete component. Exactly one of `build` or
   * `panel` must be provided.
   */
  panel?: string;
}
