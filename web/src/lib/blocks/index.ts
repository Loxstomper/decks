/**
 * blocks/index.ts — Public surface + registration aggregation for insertable blocks.
 *
 * Importing `$lib/blocks` (which the insert palette does) pulls in `./defaults`,
 * whose import side-effect registers Lane FE-A's structural block types into the
 * registry. Lane FE-B adds their block types by:
 *   1. writing a module that calls `registerBlock(...)` for image/code/math, and
 *   2. adding a single `import './their-module';` line below.
 * The palette then lists them automatically (see types.ts REGISTRY CONTRACT).
 */

// Side-effect: register FE-A's default (structural) blocks.
import './defaults';
// Side-effect: register FE-B's media / code / math blocks (panel-driven).
import './media';

// ── Registry API ──────────────────────────────────────────────────────────────
export {
  registerBlock,
  getInsertRegistry,
  getInsertRegistryByGroup,
  getBlockDef,
  clearRegistry,
} from './registry';

// ── Insert-target resolution ──────────────────────────────────────────────────
export { resolveInsertTarget } from './target';
export type { InsertTarget } from './target';

// ── Types ─────────────────────────────────────────────────────────────────────
export type { InsertBlockDef, InsertField, BuildArgs, Placement } from './types';

// ── Pure builders (exported for tests / programmatic use) ─────────────────────
export { buildHeading, buildParagraph, buildList } from './text';
export type { HeadingLevel } from './text';
export { buildTable } from './table';
export type { TableSpec } from './table';
export { buildShape } from './shape';
export type { ShapeKind } from './shape';
export { buildEmbed } from './embed';
